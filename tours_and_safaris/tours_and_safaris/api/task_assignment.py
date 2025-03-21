import frappe

import frappe

@frappe.whitelist()
def get_unassigned_tasks(activity_type=None):
    filters = {"status": "Open"}  # Fetch tasks that are still open
    if activity_type:
        filters["custom_activity_name"] = activity_type  # Filter by activity type

    tasks = frappe.get_all(
        "Task",
        filters=filters,
        fields=["name", "subject", "custom_no_of_people", "custom_activity_name"]
    )

    return tasks


    return tasks

@frappe.whitelist()
def get_instructors():
    instructors = frappe.get_all(
        "Instructor",  # Fetch from the "Instructor" Doctype
        fields=["name", "instructor_name", "qualification"]  # Ensure qualification is included
    )

    return instructors

@frappe.whitelist()
def assign_instructor(task_name, instructor_names, session_type):
    import json

    # Convert instructor_names from string to list (if necessary)
    if isinstance(instructor_names, str):
        instructor_names = json.loads(instructor_names)

    if not task_name or not instructor_names:
        frappe.throw("Task Name and at least one Instructor must be provided.")

    for instructor_name in instructor_names:
        # Create the assignment record
        assignment = frappe.get_doc({
            "doctype": "Assigned Instructors",
            "parent": task_name,
            "parenttype": "Task",
            "parentfield": "assigned_instructors",
            "instructor_name": instructor_name,
            "session_type": session_type
        })
        assignment.insert(ignore_permissions=True)

    frappe.db.commit()
    return "Task assigned successfully!"



@frappe.whitelist()
def get_instructors_with_tasks(activity_name=None):
    if not activity_name:
        frappe.msgprint("No activity name provided!")
        return []

    frappe.msgprint(f"Fetching instructors for Activity: {activity_name}")  # ✅ Debugging

    # Fetch instructors who have this activity type in their Instructor Activity Level table
    qualified_instructors = frappe.db.sql("""
        SELECT DISTINCT 
            i.name AS instructor_name, 
            ial.qualification AS qualification
        FROM `tabInstructor` i
        JOIN `tabInstructor Activity Level` ial ON ial.parent = i.name
        WHERE ial.activity_name = %s
    """, (activity_name,), as_dict=True)

    if not qualified_instructors:
        frappe.msgprint(f"No instructors found for Activity: {activity_name}")  # ✅ Debugging
        return []

    # Fetch assigned tasks for each instructor
    for instructor in qualified_instructors:
        assigned_tasks = frappe.db.sql("""
            SELECT ai.parent AS task_name
            FROM `tabAssigned Instructors` ai
            WHERE ai.instructor_name = %s
        """, (instructor["instructor_name"],), as_dict=True)

        instructor["tasks"] = assigned_tasks  # Attach assigned tasks

    return qualified_instructors
