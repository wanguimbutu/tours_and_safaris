from datetime import timedelta
import frappe
from frappe import _
import json

from frappe.utils import getdate
from frappe.utils.file_manager import get_file
from frappe.utils import nowdate

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
    Returns: tasks, instructors, existing_allocations, instructor_qualifications, blackouts
    """
    try:
        week_start = frappe.utils.getdate(week_start_date)
        week_end = frappe.utils.add_days(week_start, 6)
        
        tasks = get_tasks_for_week(week_start, week_end)
        instructors = get_active_instructors()
        allocations = get_existing_allocations_optimized(week_start, week_end)

        # ✅ Fetch instructor blackouts for the week
        blackouts = frappe.get_all(
            "Instructor Blackout",
            filters={"date": ["between", [week_start, week_end]]},
            fields=["instructor", "date", "slot"]
        )

        # ✅ Build blackout map as { instructor: { "dayIndex_slot": True } }
        blackout_map = {}
        for b in blackouts:
            day_index = (b.date - week_start).days
            key = f"{day_index}_{b.slot}"
            blackout_map.setdefault(b.instructor, {})[key] = True

        return {
            "tasks": tasks,
            "instructors": instructors,
            "allocations": allocations,
            "blackouts": blackout_map,  
            "week_start": str(week_start),
            "week_end": str(week_end)
        }

    except Exception as e:
        frappe.log_error(f"Error in get_week_data: {str(e)}")
        return {"error": str(e)}

def get_tasks_for_week(week_start, week_end):
    """Optimized task fetching with single query, considering custom_assigned_date"""
    
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
    # Updated to consider custom_assigned_date when it has a value
    query = f"""
        SELECT 
            t.name,
            t.subject,
            t.custom_customer_name,
            t.custom_customer,
            t.custom_customer_groups,
            t.parent_task,
            t.exp_start_date,
            t.exp_end_date,
            t.color,
            t.custom_assigned_date,
            t.custom_no_of_people,
            t.status,
            t.project,
            -- Get parent task info if this is a subtask
            pt.subject as parent_subject,
            pt.custom_customer_name as parent_customer_name
        FROM `tabTask` t
        LEFT JOIN `tabTask` pt ON t.parent_task = pt.name
        WHERE 
            t.custom_is_activity = 1
            AND (
                -- If custom_assigned_date exists, check if it falls within the week
                (t.custom_assigned_date IS NOT NULL 
                 AND t.custom_assigned_date >= %s 
                 AND t.custom_assigned_date <= %s)
                OR
                -- If custom_assigned_date is NULL, use original date logic
                (t.custom_assigned_date IS NULL 
                 AND t.exp_start_date <= %s
                 AND COALESCE(t.exp_end_date, t.exp_start_date) >= %s)
            )
            {status_condition}
        ORDER BY 
            t.custom_customer_name,
            COALESCE(t.parent_task, t.name),
            t.subject
    """
    
    # Pass the week_start and week_end parameters for both conditions
    tasks = frappe.db.sql(query, (week_start, week_end, week_end, week_start), as_dict=True)
    
    
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
                       exp_start_date, exp_end_date, custom_assigned_date, 
                       custom_no_of_people,custom_customer_groups, status,color,project
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
                        # Also inherit custom_assigned_date if not set
                        dt.custom_assigned_date = dt.custom_assigned_date or parent_task.custom_assigned_date
                        dt.project = dt.project or parent_task.project
            tasks.extend(dependent_tasks)
    
    return tasks
def get_active_instructors():
    """Get all active instructors with their qualifications and position"""
    return frappe.db.sql("""
        SELECT 
            i.name,
            i.name1 AS instructor_name,
            CAST(COALESCE(i.position, 999) AS UNSIGNED) as position,
            GROUP_CONCAT(
                CONCAT(ial.activity_name, ':', COALESCE(ial.qualification, ''))
                SEPARATOR '|'
            ) as qualifications
        FROM `tabInstructor` i
        LEFT JOIN `tabInstructor Activity Level` ial ON ial.parent = i.name
        WHERE i.enabled = 1
        GROUP BY i.name, i.name1, i.position
        ORDER BY CAST(COALESCE(i.position, 999) AS UNSIGNED) ASC, i.name1 ASC
    """, as_dict=True)

def get_existing_allocations_optimized(week_start, week_end):
    """Get all allocations for the week in single optimized query"""
    return frappe.db.sql("""
        SELECT 
            aa.name as allocation_id,
            aa.customer,
            aa.activity_name,
            aa.task,
            t.color, 
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
        LEFT JOIN `tabTask` t ON t.name = aa.task  
        WHERE 
            aa.start_date <= %s
            AND aa.end_date >= %s
            AND aad.activity_date BETWEEN %s AND %s
        ORDER BY aad.instructor, aad.activity_date, aad.start_time
    """, (week_end, week_start, week_start, week_end), as_dict=True)

@frappe.whitelist()
def create_activity_allocation_optimized(task_name, activity_date, slot, instructor_name):
    """Server-side allocation creation with validation and AM+PM -> FULL DAY merge"""
    try:
        # Get task details
        task = frappe.get_doc("Task", task_name)

        # Get instructor qualification
        qualification = get_instructor_qualification(instructor_name, task.subject)

        # Times per slot
        slot_times = {
            "AM": ("08:00:00", "12:30:00"),
            "PM": ("13:30:00", "17:30:00"),
            "FULL": ("08:00:00", "17:30:00"),
        }

        base_activity_name = task.subject.split(" - Group")[0].strip()

        # Find or create allocation doc
        existing_alloc = frappe.get_all(
            "Activity Allocation",
            filters={
                "task": task.name,
                "activity_name": base_activity_name,
                "customer": task.custom_customer,
                "docstatus": 0,
            },
            limit=1,
        )

        if existing_alloc:
            allocation_doc = frappe.get_doc("Activity Allocation", existing_alloc[0].name)
        else:
            allocation_doc = frappe.get_doc({
                "doctype": "Activity Allocation",
                "customer": task.custom_customer,
                "task": task.name,
                "activity_name": base_activity_name,
                "start_date": task.exp_start_date,
                "end_date": task.exp_end_date,
                "activity_allocation_details": []
            })

        # Look for existing row for same date + instructor + activity
        matching_rows = [
            d for d in allocation_doc.activity_allocation_details
            if (d.instructor == instructor_name and 
                str(d.activity_date) == str(activity_date) and
                d.activity_name == base_activity_name)
        ]

        if matching_rows:
            existing_row = matching_rows[0]  
            
            if existing_row.session == "FULL DAY":
                return {"success": False, "message": "Instructor already assigned full day for this activity"}
            elif existing_row.session == "HALF DAY":
                # Get the existing slot's start time to determine AM/PM
                existing_start_time = existing_row.start_time
                
                # Convert to string format if it's a datetime object
                if hasattr(existing_start_time, 'time'):
                    existing_time_str = existing_start_time.time().strftime('%H:%M:%S')
                else:
                    # extract time part
                    existing_time_str = str(existing_start_time).split(' ')[-1]
                
                # Determine if existing slot is AM or PM
                existing_slot = "AM" if existing_time_str == slot_times["AM"][0] else "PM"
                
                # Check if we're trying to add the complementary slot
                if (existing_slot == "AM" and slot == "PM") or (existing_slot == "PM" and slot == "AM"):
                    # Merge to full day
                    existing_row.session = "FULL DAY"
                    existing_row.start_time = f"{activity_date} {slot_times['FULL'][0]}"
                    existing_row.end_time = f"{activity_date} {slot_times['FULL'][1]}"
                    allocation_doc.save()
                    
                    return {
                        "success": True,
                        "allocation_id": allocation_doc.name,
                        "message": "Allocation merged to full day successfully"
                    }
                else:
                    return {"success": False, "message": f"Instructor already has {existing_slot} slot for this activity"}
        else:
            # Create new half-day allocation
            start_time, end_time = slot_times[slot]
            allocation_doc.append("activity_allocation_details", {
                "activity_name": base_activity_name,
                "activity_date": activity_date,
                "session": "HALF DAY",
                "start_time": f"{activity_date} {start_time}",
                "end_time": f"{activity_date} {end_time}",
                "qualification": qualification,
                "instructor": instructor_name
            })
            
            if allocation_doc.is_new():
                allocation_doc.insert()
                action = "created"
            else:
                allocation_doc.save()
                action = "updated"

            return {
                "success": True,
                "allocation_id": allocation_doc.name,
                "message": f"Half-day allocation {action} successfully"
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
def update_task_schedule(task_name, new_date, slot):
    """Update the custom_assigned_date field in the task document"""
    try:
        # Validate inputs
        if not task_name or not new_date or not slot:
            return {"success": False, "message": "Missing required parameters"}
        
        # Parse the new date and create datetime based on slot
        from datetime import datetime, time
        import pytz
        
        # Parse the date
        new_date_obj = frappe.utils.getdate(new_date)
        
        # Set time based on slot
        if slot.upper() == 'AM':
            new_time = time(9, 0)  # 9:00 AM
        else:  # PM
            new_time = time(14, 0)  # 2:00 PM
        
        # Combine date and time
        new_datetime = datetime.combine(new_date_obj, new_time)
        
        # Get the task document
        task_doc = frappe.get_doc("Task", task_name)
        
        # Check if the task exists
        if not task_doc:
            return {"success": False, "message": "Task not found"}
        
        # Update the custom_assigned_date field
        task_doc.custom_assigned_date = new_datetime
        
        # Save the document
        frappe.db.set_value("Task", task_name, "custom_assigned_date", new_datetime)
        
        # Commit the transaction
        frappe.db.commit()
        
        return {
            "success": True, 
            "message": f"Task schedule updated successfully to {new_date} {slot}",
            "assigned_date": new_datetime.strftime("%Y-%m-%d %H:%M:%S")
        }
        
    except Exception as e:
        frappe.log_error(f"Error updating task schedule: {str(e)}", "Task Schedule Update Error")
        return {"success": False, "message": f"Error updating task schedule: {str(e)}"}


# Also add this helper method to better handle task data processing
def process_task_with_assigned_date(task):
    """Process a single task to handle custom_assigned_date properly"""
    if task.get('custom_assigned_date'):
        # Convert string to datetime if needed
        if isinstance(task['custom_assigned_date'], str):
            assigned_datetime = frappe.utils.get_datetime(task['custom_assigned_date'])
        else:
            assigned_datetime = task['custom_assigned_date']
        
        # Extract date and determine slot
        assigned_date = assigned_datetime.date()
        assigned_hour = assigned_datetime.hour
        assigned_slot = 'AM' if assigned_hour < 13 else 'PM'
        
        # Update task data for frontend consumption
        task.update({
            'original_exp_start_date': task.get('exp_start_date'),
            'original_exp_end_date': task.get('exp_end_date'),
            'exp_start_date': assigned_date.strftime('%Y-%m-%d'),
            'exp_end_date': assigned_date.strftime('%Y-%m-%d'),
            'assigned_slot': assigned_slot,
            'custom_assigned_date': assigned_datetime.strftime('%Y-%m-%d %H:%M:%S')
        })
    
    return task


@frappe.whitelist()
def split_customer_groups(customer_name, total_people, number_of_groups, week_start_date, split_tasks=False):
    """
    Split a customer into multiple groups and optionally create subtasks for each group
    """
    try:
        total_people = int(total_people)
        number_of_groups = int(number_of_groups)
        
        if number_of_groups < 1:
            return {"success": False, "message": "Number of groups must be at least 1"}
        
        if number_of_groups > total_people:
            return {"success": False, "message": "Number of groups cannot exceed total people"}
        
        # Calculate people per group
        base_people_per_group = total_people // number_of_groups
        extra_people = total_people % number_of_groups
        
        # Create groups data
        groups_data = []
        for i in range(number_of_groups):
            people_in_group = base_people_per_group + (1 if i < extra_people else 0)
            group_data = {
                "group_name": f"Group {i + 1}",
                "people_count": people_in_group,
                "group_index": i
            }
            groups_data.append(group_data)
        
        # Find all tasks for this customer in the specified week
        week_end_date = frappe.utils.add_days(week_start_date, 6)
        
        # Get parent tasks (tasks without parent_task)
        parent_tasks = frappe.get_all(
            "Task",
            filters={
                "custom_customer_name": customer_name,
                "exp_start_date": ["between", [week_start_date, week_end_date]],
                "parent_task": ["is", "not set"],
                "custom_is_activity":1
            },
            fields=["name", "subject", "project", "exp_start_date", "exp_end_date", 
                   "custom_customer_name", "custom_no_of_people"]
        )
        
        if not parent_tasks:
            return {"success": False, "message": f"No tasks found for customer {customer_name} in the specified week"}
        
        # Update parent tasks with groups data
        for parent_task in parent_tasks:
            task_doc = frappe.get_doc("Task", parent_task.name)
            task_doc.custom_customer_groups = json.dumps(groups_data)
            task_doc.save()
        
        created_subtasks = []
        
        for parent_task in parent_tasks:
            try:
                parent_doc = frappe.get_doc("Task", parent_task.name)
                
                # Check if subtasks already exist for this parent
                existing_subtasks = frappe.get_all(
                    "Task",
                    filters={"parent_task": parent_doc.name},
                    fields=["name"]
                )
                
                # If subtasks already exist, delete them first to avoid duplicates
                if existing_subtasks:
                    for existing in existing_subtasks:
                        frappe.delete_doc("Task", existing.name)
                    frappe.db.commit()
                
                for group in groups_data:
                    # Create subtask for each group
                    subtask = frappe.new_doc("Task")
                    subtask.subject = f"{parent_doc.subject} - {group['group_name']}"
                    subtask.project = parent_doc.project
                    subtask.parent_task = parent_doc.name
                    subtask.exp_start_date = parent_doc.exp_start_date
                    subtask.exp_end_date = parent_doc.exp_end_date or parent_doc.exp_start_date
                    subtask.custom_customer_name = parent_doc.custom_customer_name
                    subtask.color =parent_doc.color
                    subtask.custom_no_of_people = group['people_count']
                    subtask.custom_group_name = group['group_name']
                    subtask.custom_group_index = group['group_index']
                    
                    
                    
                    if hasattr(parent_doc, 'custom_assigned_date') and parent_doc.custom_assigned_date:
                        subtask.custom_assigned_date = parent_doc.custom_assigned_date
                    
                    # Set status to match parent
                    if hasattr(parent_doc, 'status'):
                        subtask.status = parent_doc.status
                    
                    # Save the subtask
                    subtask.insert()
                    frappe.db.commit()  
                    
                    created_subtasks.append({
                        "name": subtask.name,
                        "subject": subtask.subject,
                        "group_name": group['group_name'],
                        "people_count": group['people_count']
                    })
                    
                    frappe.logger().info(f"Created subtask: {subtask.name} for group {group['group_name']}")
                    
            except Exception as subtask_error:
                frappe.log_error(f"Error creating subtasks for parent {parent_task.name}: {str(subtask_error)}")
        
        response_data = {
            "success": True,
            "message": f"Successfully split {customer_name} into {number_of_groups} groups",
            "groups_created": groups_data,
            "parent_tasks_updated": len(parent_tasks),
            "subtasks_created": len(created_subtasks),
            "subtasks": created_subtasks
        }
        
        frappe.logger().info(f"Customer {customer_name} split into {number_of_groups} groups. "
                           f"Updated {len(parent_tasks)} parent tasks, created {len(created_subtasks)} subtasks")
        
        return response_data
        
    except ValueError as e:
        frappe.log_error(f"Invalid input in split_customer_groups: {str(e)}")
        return {"success": False, "message": "Invalid input values"}
        
    except Exception as e:
        frappe.log_error(f"Error in split_customer_groups: {str(e)}")
        return {"success": False, "message": f"Error splitting customer groups: {str(e)}"}
    
@frappe.whitelist()
def delete_customer_group_splitting(customer_name, week_start_date):
    """
    Delete all group splits (subtasks + group JSON) for a customer's activity tasks in a given week.
    Fixed version that properly clears cache and handles re-splitting.
    """
    try:
        week_end_date = frappe.utils.add_days(week_start_date, 6)

        parent_tasks = frappe.get_all(
            "Task",
            filters={
                "custom_customer_name": customer_name,
                "exp_start_date": ["between", [week_start_date, week_end_date]],
                "parent_task": ["is", "not set"],
                "custom_is_activity": 1
            },
            fields=["name"]
        )

        if not parent_tasks:
            return {
                "success": False,
                "message": f"No activity tasks found for {customer_name} in the given week."
            }

        deleted_subtasks = 0
        updated_parents = 0

        for parent in parent_tasks:
            parent_doc = frappe.get_doc("Task", parent.name)

            subtasks = frappe.get_all(
                "Task",
                filters={"parent_task": parent_doc.name},
                fields=["name"]
            )

            for sub in subtasks:
                try:
                    frappe.db.sql("""
                        DELETE FROM `tabTask Depends On`
                        WHERE parent = %s OR task = %s
                    """, (sub.name, sub.name))
                    
                    frappe.db.sql("""
                        UPDATE `tabTask`
                        SET parent_task = NULL
                        WHERE parent_task = %s
                    """, (sub.name,))
                    
                    child_tables = ["tabTask Depends On", "tabActivity Cost"]
                    for child_table in child_tables:
                        try:
                            frappe.db.sql(f"""
                                DELETE FROM `{child_table}`
                                WHERE parent = %s
                            """, (sub.name,))
                        except Exception:
                            pass
                    
                    frappe.db.sql("""
                        DELETE FROM `tabTask`
                        WHERE name = %s
                    """, (sub.name,))
                    
                    frappe.clear_document_cache("Task", sub.name)
                    
                    deleted_subtasks += 1
                    frappe.logger().info(f"Successfully deleted subtask: {sub.name}")

                except Exception as del_err:
                    frappe.log_error(
                        title="Group Split Delete Error",
                        message=f"Failed to delete subtask {sub.name}: {str(del_err)}"
                    )

            frappe.db.sql("""
                DELETE FROM `tabTask Depends On`
                WHERE parent = %s OR task = %s
            """, (parent_doc.name, parent_doc.name))

            if getattr(parent_doc, "custom_customer_groups", None):
                frappe.db.set_value("Task", parent_doc.name, "custom_customer_groups", None)
                updated_parents += 1
                
                frappe.clear_document_cache("Task", parent_doc.name)

        frappe.db.commit()
        
        frappe.clear_cache(doctype="Task")

        response = {
            "success": True,
            "message": f"Deleted {deleted_subtasks} subtasks and reset {updated_parents} parent task(s).",
            "deleted_subtasks": deleted_subtasks,
            "updated_parents": updated_parents
        }

        frappe.logger().info(response["message"])
        return response

    except Exception as e:
        frappe.log_error(title="Delete Group Splitting Error", message=str(e))
        return {"success": False, "message": f"Error deleting group splitting: {str(e)}"}
    
@frappe.whitelist()
def create_multiactivity_task(customer, activity_type, start_date, end_date,
                               custom_customer_name=None, custom_no_of_people=None, project=None):
    frappe.logger().info({
        "msg": "create_multiactivity_task called",
        "customer": customer,
        "activity_type": activity_type,
        "custom_customer_name": custom_customer_name,
        "custom_no_of_people": custom_no_of_people,
        "project": project
    })

    task = frappe.new_doc("Task")
    task.subject = activity_type
    task.custom_customer = customer

    task.custom_customer_name = (
        custom_customer_name or frappe.db.get_value("Customer", customer, "customer_name")
    )

    task.activity_type = activity_type
    task.exp_start_date = start_date
    task.exp_end_date = end_date
    task.custom_is_activity = 1
    task.status = "Open"

    if custom_no_of_people:
        task.custom_no_of_people = custom_no_of_people

    if project:
        task.project = project

    task.insert()
    return {"success": True, "task": task.name}

@frappe.whitelist()
def toggle_blackout(instructor, day_index, slot, week_start_date):
    week_start = getdate(week_start_date)
    day_index = int(day_index)
    date = week_start + timedelta(days=day_index)

    existing = frappe.get_all(
        "Instructor Blackout",
        filters={"instructor": instructor, "date": date, "slot": slot},
        limit=1
    )

    if existing:
        frappe.delete_doc("Instructor Blackout", existing[0].name)
        return {"message": "Blackout removed"}
    else:
        doc = frappe.get_doc({
            "doctype": "Instructor Blackout",
            "instructor": instructor,
            "date": date,
            "slot": slot,
            "week_start_date": week_start
        })
        doc.insert()
        return {"message": "Blackout added"}

@frappe.whitelist()
def bulk_toggle_blackouts(instructor, slots, week_start_date):
    import json
    from frappe.utils import getdate, add_days

    week_start = getdate(week_start_date)
    slots = json.loads(slots) if isinstance(slots, str) else slots
    toggled = []

    for s in slots:
        day_index = int(s["dayIndex"])
        slot = s["slot"]
        date = add_days(week_start, day_index)

        existing = frappe.get_all("Instructor Blackout", filters={
            "instructor": instructor,
            "date": date,
            "slot": slot
        })

        if existing:
            frappe.delete_doc("Instructor Blackout", existing[0].name)
        else:
            doc = frappe.get_doc({
                "doctype": "Instructor Blackout",
                "instructor": instructor,
                "date": date,
                "slot": slot,
                "week_start_date": week_start
            })
            doc.insert()

        toggled.append(f"{date} {slot}")

    return {"message": f"Toggled {len(toggled)} blackout slots."}



@frappe.whitelist()
def queue_calendar_email(recipient_emails, file_url, filename=None):
    """Queue the calendar PDF email using ERPNext's email system."""
    import json
    if isinstance(recipient_emails, str):
        recipient_emails = json.loads(recipient_emails)

    if not recipient_emails:
        frappe.throw(_("No recipient emails found."))

    file_doc = get_file(file_url)
    if not file_doc or not file_doc[1]:
        frappe.throw(_("Could not retrieve file content."))

    file_content = file_doc[1]
    filename = filename or f"Guide_Allocation_{nowdate()}.pdf"

    subject = f"Guide Allocation Calendar - {nowdate()}"
    message = """
        <p>Dear Instructor,</p>
        <p>Please find attached the latest Guide Allocation calendar.</p>
        <p>Regards,<br>Your Scheduling Team</p>
    """

    # ✅ Use ERPNext's built-in queued email system
    frappe.enqueue(
        method=frappe.sendmail,
        queue='long',
        recipients=recipient_emails,
        subject=subject,
        message=message,
        attachments=[{
            'fname': filename,
            'fcontent': file_content,
            'content_type': 'application/pdf'
        }],
        reference_doctype='Project',
        reference_name=None,
        now=False
    )

    return {"success": True, "message": f"Queued email for {len(recipient_emails)} instructors."}
