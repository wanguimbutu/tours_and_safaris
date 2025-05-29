import frappe

@frappe.whitelist()
def remove_activity_allocation(instructor, activity_date, activity_name):
    """
    Removes an activity allocation detail row matching by instructor, date, and activity_name.
    If the allocation document becomes empty, delete the entire document.
    """
    allocations = frappe.get_all("Activity Allocation", filters={"docstatus": 0}, pluck="name")

    for alloc_name in allocations:
        doc = frappe.get_doc("Activity Allocation", alloc_name)

        for i, row in enumerate(doc.activity_allocation_details):
            if (
                row.instructor.strip() == instructor.strip() and
                str(row.activity_date) == activity_date and
                row.activity_name.strip() == activity_name.strip()
            ):
                doc.activity_allocation_details.pop(i)

                if not doc.activity_allocation_details:
                    doc.delete()
                    return {"status": "deleted", "doc": alloc_name}
                else:
                    doc.save()
                    return {"status": "updated", "doc": alloc_name}

    return {"status": "not_found"}

import frappe
from frappe.model.document import Document
from frappe import _

@frappe.whitelist()
def submit_activity_allocation(name):
    if not name:
        frappe.throw(_("Missing document name"))
    
    doc = frappe.get_doc("Activity Allocation", name)
    if doc.docstatus != 0:
        return {"status": "already_submitted"}
    
    doc.submit()
    return {"status": "submitted", "name": name}


@frappe.whitelist()
def get_week_data(week_start_date):
    """
    Single API call to get all data needed for a week
    Returns: tasks, instructors, existing_allocations, instructor_qualifications
    """
    try:
        week_start = frappe.utils.getdate(week_start_date)
        week_end = frappe.utils.add_days(week_start, 6)
        
        # Get all data in parallel using efficient queries
        tasks = get_tasks_for_week(week_start, week_end)
        instructors = get_active_instructors()
        allocations = get_existing_allocations_optimized(week_start, week_end)
        
        return {
            "tasks": tasks,
            "instructors": instructors, 
            "allocations": allocations,
            "week_start": str(week_start),
            "week_end": str(week_end)
        }
    except Exception as e:
        frappe.log_error(f"Error in get_week_data: {str(e)}")
        return {"error": str(e)}

def get_tasks_for_week(week_start, week_end):
    """Optimized task fetching with single query"""
    
    # Determine status filters based on week timing
    current_week_start = frappe.utils.today()
    current_week_start = frappe.utils.get_first_day_of_week(current_week_start)
    
    if week_start < current_week_start:
        # Past week - all statuses
        status_condition = ""
    elif week_start > frappe.utils.add_days(current_week_start, 6):
        # Future week - only Open
        status_condition = "AND t.status = 'Open'"
    else:
        # Current week - Open and Working
        status_condition = "AND t.status IN ('Open', 'Working')"
    
    # Single query to get all tasks with subtasks
    query = f"""
        SELECT 
            t.name,
            t.subject,
            t.custom_customer_name,
            t.custom_customer,
            t.parent_task,
            t.exp_start_date,
            t.exp_end_date,
            t.custom_no_of_people,
            t.status,
            -- Get parent task info if this is a subtask
            pt.subject as parent_subject,
            pt.custom_customer_name as parent_customer_name
        FROM `tabTask` t
        LEFT JOIN `tabTask` pt ON t.parent_task = pt.name
        WHERE 
            t.custom_is_activity = 1
            AND t.exp_start_date <= %s
            AND COALESCE(t.exp_end_date, t.exp_start_date) >= %s
            {status_condition}
        ORDER BY 
            t.custom_customer_name,
            COALESCE(t.parent_task, t.name),
            t.subject
    """
    
    tasks = frappe.db.sql(query, (week_end, week_start), as_dict=True)
    
    # Process task dependencies in single query
    task_names = [t.name for t in tasks]
    if task_names:
        dependencies = frappe.db.sql("""
            SELECT parent, task
            FROM `tabTask Depends On`
            WHERE parent IN ({})
        """.format(','.join(['%s'] * len(task_names))), task_names, as_dict=True)
        
        # Add dependent tasks
        dependent_task_names = list(set([d.task for d in dependencies]))
        if dependent_task_names:
            dependent_tasks = frappe.db.sql(f"""
                SELECT name, subject, custom_customer_name, custom_customer,
                       exp_start_date, exp_end_date, custom_no_of_people, status
                FROM `tabTask`
                WHERE name IN ({','.join(['%s'] * len(dependent_task_names))})
            """, dependent_task_names, as_dict=True)
            
            # Mark as subtasks and add to main list
            for dt in dependent_tasks:
                parent_dep = next((d for d in dependencies if d.task == dt.name), None)
                if parent_dep:
                    dt.parent_task = parent_dep.parent
                    parent_task = next((t for t in tasks if t.name == parent_dep.parent), None)
                    if parent_task:
                        dt.custom_customer_name = dt.custom_customer_name or parent_task.custom_customer_name
                        dt.exp_start_date = dt.exp_start_date or parent_task.exp_start_date
                        dt.exp_end_date = dt.exp_end_date or parent_task.exp_end_date
            
            tasks.extend(dependent_tasks)
    
    return tasks

def get_active_instructors():
    """Get all active instructors with their qualifications in one query"""
    return frappe.db.sql("""
        SELECT 
            i.name,
            i.name1 AS instructor_name,  
            GROUP_CONCAT(
                CONCAT(ial.activity_name, ':', COALESCE(ial.qualification, ''))
                SEPARATOR '|'
            ) as qualifications
        FROM `tabInstructor` i
        LEFT JOIN `tabInstructor Activity Level` ial ON ial.parent = i.name
        WHERE i.enabled = 1
        GROUP BY i.name, i.name1
        ORDER BY i.name1
    """, as_dict=True)


def get_existing_allocations_optimized(week_start, week_end):
    """Get all allocations for the week in single optimized query"""
    return frappe.db.sql("""
        SELECT 
            aa.name as allocation_id,
            aa.customer,
            aa.activity_name,
            aa.start_date,
            aa.end_date,
            aad.activity_name as detail_activity_name,
            aad.activity_date,
            aad.session,
            aad.start_time,
            aad.end_time,
            aad.qualification,
            aad.instructor
        FROM `tabActivity Allocation` aa
        INNER JOIN `tabActivity Allocation Details` aad ON aad.parent = aa.name
        WHERE 
            aa.start_date <= %s
            AND aa.end_date >= %s
            AND aad.activity_date BETWEEN %s AND %s
        ORDER BY aad.instructor, aad.activity_date, aad.start_time
    """, (week_end, week_start, week_start, week_end), as_dict=True)

@frappe.whitelist()
def create_activity_allocation_optimized(task_name, activity_date, slot, instructor_name):
    """Server-side allocation creation with validation"""
    try:
        # Get task details
        task = frappe.get_doc("Task", task_name)
        
        # Get instructor qualification
        qualification = get_instructor_qualification(instructor_name, task.subject)
        
        # Check for conflicts
        conflict = check_allocation_conflict(instructor_name, activity_date, slot)
        if conflict:
            return {"success": False, "message": "Instructor already assigned for this slot"}
        
        # Create allocation
        session_mapping = {"AM": "HALF DAY", "PM": "HALF DAY"}
        start_time = "08:00:00" if slot == "AM" else "13:30:00"
        end_time = "12:30:00" if slot == "AM" else "17:30:00"
        
        base_activity_name = task.subject.split(" - Group")[0].strip()
        
        allocation_doc = frappe.get_doc({
            "doctype": "Activity Allocation",
            "customer": task.custom_customer,
            "activity_name": base_activity_name,
            "start_date": task.exp_start_date,
            "end_date": task.exp_end_date,
            "activity_allocation_details": [{
                "activity_name": base_activity_name,
                "activity_date": activity_date,
                "session": session_mapping.get(slot, slot),
                "start_time": f"{activity_date} {start_time}",
                "end_time": f"{activity_date} {end_time}",
                "qualification": qualification,
                "instructor": instructor_name
            }]
        })
        
        allocation_doc.insert()
        
        return {
            "success": True, 
            "allocation_id": allocation_doc.name,
            "message": f"Allocation created successfully"
        }
        
    except Exception as e:
        frappe.log_error(f"Error creating allocation: {str(e)}")
        return {"success": False, "message": str(e)}

def get_instructor_qualification(instructor_name, activity_name):
    """Get instructor qualification for specific activity"""
    base_activity = activity_name.split(" - Group")[0].strip()
    
    qualification = frappe.db.sql("""
        SELECT ial.qualification
        FROM `tabInstructor Activity Level` ial
        WHERE ial.parent = %s 
        AND (ial.activity_name = %s OR ial.activity_name = %s)
        LIMIT 1
    """, (instructor_name, activity_name, base_activity))
    
    return qualification[0][0] if qualification else ""

def check_allocation_conflict(instructor_name, activity_date, slot):
    """Check if instructor already has allocation for this date/slot"""
    start_time = "08:00:00" if slot == "AM" else "13:30:00"
    full_start_time = f"{activity_date} {start_time}"
    
    existing = frappe.db.sql("""
        SELECT name
        FROM `tabActivity Allocation Details`
        WHERE instructor = %s
        AND activity_date = %s
        AND start_time = %s
        LIMIT 1
    """, (instructor_name, activity_date, full_start_time))
    
    return len(existing) > 0

@frappe.whitelist()
def remove_activity_allocation_optimized(instructor, activity_date, activity_name):
    """Optimized removal of activity allocation"""
    try:
        # Find the allocation detail
        allocation_detail = frappe.db.sql("""
            SELECT aad.name as detail_name, aad.parent as allocation_id
            FROM `tabActivity Allocation Details` aad
            INNER JOIN `tabActivity Allocation` aa ON aa.name = aad.parent
            WHERE aad.instructor = %s
            AND aad.activity_date = %s
            AND (aa.activity_name = %s OR aad.activity_name = %s)
            LIMIT 1
        """, (instructor, activity_date, activity_name, activity_name), as_dict=True)
        
        if not allocation_detail:
            return {"status": "not_found", "message": "No matching allocation found"}
        
        allocation_doc = frappe.get_doc("Activity Allocation", allocation_detail[0].allocation_id)
        
        # If only one detail, delete entire allocation
        if len(allocation_doc.activity_allocation_details) == 1:
            allocation_doc.delete()
            return {"status": "deleted", "message": "Allocation deleted"}
        else:
            # Remove specific detail
            allocation_doc.activity_allocation_details = [
                d for d in allocation_doc.activity_allocation_details 
                if d.name != allocation_detail[0].detail_name
            ]
            allocation_doc.save()
            return {"status": "updated", "message": "Allocation detail removed"}
            
    except Exception as e:
        frappe.log_error(f"Error removing allocation: {str(e)}")
        return {"status": "error", "message": str(e)}

@frappe.whitelist()
def submit_week_allocations(week_start_date):
    """Submit all draft allocations for a week"""
    try:
        week_start = frappe.utils.getdate(week_start_date)
        week_end = frappe.utils.add_days(week_start, 6)
        
        draft_allocations = frappe.db.sql("""
            SELECT DISTINCT aa.name
            FROM `tabActivity Allocation` aa
            INNER JOIN `tabActivity Allocation Details` aad ON aad.parent = aa.name
            WHERE aa.docstatus = 0
            AND aad.activity_date BETWEEN %s AND %s
        """, (week_start, week_end))
        
        success_count = 0
        error_count = 0
        
        for allocation_name in draft_allocations:
            try:
                doc = frappe.get_doc("Activity Allocation", allocation_name[0])
                doc.submit()
                success_count += 1
            except Exception as e:
                error_count += 1
                frappe.log_error(f"Error submitting {allocation_name[0]}: {str(e)}")
        
        return {
            "success": True,
            "submitted": success_count,
            "errors": error_count,
            "message": f"Submitted {success_count} allocations, {error_count} errors"
        }
        
    except Exception as e:
        frappe.log_error(f"Error in submit_week_allocations: {str(e)}")
        return {"success": False, "message": str(e)}

@frappe.whitelist()
def create_customer_groups_optimized(parent_task_name, number_of_groups):
    """Server-side group creation"""
    try:
        parent_task = frappe.get_doc("Task", parent_task_name)
        total_people = parent_task.custom_no_of_people or 0
        number_of_groups = int(number_of_groups)
        
        if total_people <= 0 or number_of_groups <= 0:
            return {"success": False, "message": "Invalid people count or group number"}
        
        people_per_group = (total_people + number_of_groups - 1) // number_of_groups  # Ceiling division
        created_tasks = []
        
        for i in range(number_of_groups):
            start_person = i * people_per_group + 1
            end_person = min((i + 1) * people_per_group, total_people)
            group_size = end_person - start_person + 1
            
            subtask = frappe.get_doc({
                "doctype": "Task",
                "subject": f"{parent_task.subject} - Group {i + 1}",
                "parent_task": parent_task.name,
                "custom_customer_name": parent_task.custom_customer_name,
                "custom_customer": parent_task.custom_customer,
                "custom_is_activity": 1,
                "custom_no_of_people": group_size,
                "exp_start_date": parent_task.exp_start_date,
                "exp_end_date": parent_task.exp_end_date,
                "status": "Open"
            })
            
            subtask.insert()
            created_tasks.append({
                "name": subtask.name,
                "subject": subtask.subject,
                "people": group_size
            })
        
        return {
            "success": True,
            "created_tasks": created_tasks,
            "message": f"Created {len(created_tasks)} groups successfully"
        }
        
    except Exception as e:
        frappe.log_error(f"Error creating groups: {str(e)}")
        return {"success": False, "message": str(e)}
    

@frappe.whitelist()
def create_customer_groups_from_project(customer_name, number_of_groups, total_people):
    """
    Create independent group tasks for a customer using people count from project.
    Also updates original tasks with group information.
    """
    try:
        number_of_groups = int(number_of_groups)
        total_people = int(total_people)

        if number_of_groups <= 0 or total_people <= 0:
            return {"success": False, "message": "Invalid number of groups or people count"}

        from datetime import datetime, timedelta
        today = datetime.now().date()
        current_week_start = today - timedelta(days=today.weekday())
        current_week_end = current_week_start + timedelta(days=6)

        # Get all tasks for this customer within the current week
        base_tasks = frappe.get_list("Task",
            filters={
                "custom_customer_name": customer_name,
                "exp_start_date": ["<=", current_week_end],
                "exp_end_date": [">=", current_week_start]
            },
            fields=["name", "subject", "project", "custom_customer_name",
                    "exp_start_date", "exp_end_date"]
        )

        if not base_tasks:
            return {"success": False, "message": f"No task found for customer '{customer_name}' in the current week"}

        template_task_data = base_tasks[0]
        template_task = frappe.get_doc("Task", template_task_data.name)

        # Try to fetch people count from project if available
        if template_task.project:
            try:
                project = frappe.get_doc("Project", template_task.project)
                if project.custom_no_of_people:
                    project_people_count = int(project.custom_no_of_people)
                    if project_people_count != total_people:
                        frappe.msgprint(f"Note: Project has {project_people_count} people, using provided count {total_people}")
            except Exception:
                pass  # Ignore project lookup failure

        # Create group information
        people_per_group = total_people // number_of_groups
        remainder = total_people % number_of_groups
        created_groups = []
        group_names = []

        for i in range(number_of_groups):
            group_number = i + 1
            group_people = people_per_group + (1 if i < remainder else 0)
            group_name = f"Group {group_number} ({group_people} people)"
            group_names.append(group_name)

            # Create individual group task
            group_task = frappe.new_doc("Task")
            group_task.subject = f"{customer_name} - Group {group_number}"
            group_task.project = template_task.project
            group_task.custom_customer_name = customer_name
            group_task.custom_no_of_people = group_people
            group_task.exp_start_date = template_task.exp_start_date
            group_task.exp_end_date = template_task.exp_end_date
            group_task.status = "Open"
            group_task.description = f"Group {group_number} for {customer_name} ({group_people} people)"

            try:
                group_task.insert()
                created_groups.append({
                    "name": group_task.name,
                    "subject": group_task.subject,
                    "people": group_people
                })
            except Exception as e:
                frappe.log_error(f"Error creating group task: {str(e)}")
                return {"success": False, "message": f"Error creating group {group_number}: {str(e)}"}

        # Update all original tasks with group information
        groups_text = "\n".join(group_names)
        
        for task_data in base_tasks:
            try:
                task_doc = frappe.get_doc("Task", task_data.name)
                task_doc.custom_customer_groups = groups_text
                task_doc.save()
            except Exception as e:
                frappe.log_error(f"Error updating task {task_data.name} with groups: {str(e)}")
                # Continue with other tasks even if one fails

        frappe.db.commit()

        return {
            "success": True,
            "message": f"Successfully created {number_of_groups} groups for {customer_name} and updated {len(base_tasks)} original tasks",
            "groups": created_groups,
            "updated_tasks": len(base_tasks)
        }

    except Exception as e:
        frappe.log_error(f"Error in create_customer_groups_from_project: {str(e)}")
        return {"success": False, "message": f"Error creating groups: {str(e)}"}

import frappe
from datetime import datetime, time

@frappe.whitelist()
def update_task_schedule(task_name, new_date, slot):
    try:
        # Convert date string to date object
        date_obj = frappe.utils.getdate(new_date)

        # Set time based on slot
        if slot == "AM":
            assigned_datetime = datetime.combine(date_obj, time(8, 0))
        else:  # PM
            assigned_datetime = datetime.combine(date_obj, time(13, 30))

        # Update only the datetime field
        frappe.db.set_value("Task", task_name, "custom_assigned_date", assigned_datetime)

        return {
            "success": True,
            "message": f"Task {task_name} updated to {assigned_datetime.strftime('%Y-%m-%d %H:%M')}",
            "task_name": task_name,
            "custom_assigned_date": assigned_datetime.isoformat()
        }

    except Exception as e:
        frappe.log_error("Update Task Schedule Error", frappe.get_traceback())
        return {
            "success": False,
            "message": f"Error updating task: {str(e)}"
        }
