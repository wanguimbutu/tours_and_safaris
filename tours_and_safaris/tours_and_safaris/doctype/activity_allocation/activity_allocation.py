# Copyright (c) 2025, wanguimbutu and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class ActivityAllocation(Document):
	pass


@frappe.whitelist()
def get_instructors(activity_name):
    """Fetches instructor names for a given activity and logs details."""

    # Log the activity being searched
    frappe.logger().info(f"Fetching instructors for activity: {activity_name}")

    # Step 1: Get instructor names from the child table
    instructor_names = frappe.get_all(
        "Instructor Activity Level",  # Ensure this child table exists
        filters={"activity_name": activity_name},
        pluck="parent"  # Get the parent Instructor names
    )

    # Log instructor names fetched from child table
    frappe.logger().info(f"Instructor names linked to activity: {instructor_names}")

    # Step 2: Fetch actual instructor details
    instructors = []
    if instructor_names:
        instructors = frappe.get_all(
            "Instructor",
            filters={"name": ["in", instructor_names]},
            pluck="name1"  # Fetch 'name1' instead of 'title'
        )

    # Log final instructors returned
    frappe.logger().info(f"Filtered Instructors: {instructors}")

    return instructors


import frappe

def allocate_instructor(doc, method):
    """Updates status to 'Allocated' and creates a Timesheet for the assigned instructors."""

    # Update status to 'Allocated'
    frappe.db.set_value("Activity Allocation", doc.name, "status", "Allocated")

    # Dictionary to track instructors and their activities
    instructor_activities = {}

    for row in doc.activity_allocation_details:
        if row.instructor and row.activity_name:
            # Fetch Activity Type from the Activity Name (assuming Activity Name links to Activity Type)
            activity_type = frappe.db.get_value("Activity Type", {"name": row.activity_name}, "name")

            if not activity_type:
                frappe.throw(f"Activity Type not found for Activity Name: {row.activity_name}. Please ensure it exists.")

            if row.instructor not in instructor_activities:
                instructor_activities[row.instructor] = []

            instructor_activities[row.instructor].append(activity_type)

    if not instructor_activities:
        frappe.throw("No instructor assigned in Activity Allocation Details.")

    # Create Timesheet entries for each instructor
    for instructor, activities in instructor_activities.items():
        time_logs = []
        for activity_type in set(activities):  # Avoid duplicates
            time_logs.append({
                "activity_type": activity_type,
                "project": doc.project_name,
                "hours": 1  # Instructor will fill this later
            })

        # Create Timesheet for Instructor with Customer and Project
        timesheet = frappe.get_doc({
            "doctype": "Timesheet",
            "employee": instructor,
            "customer": doc.customer,
            "project": doc.project_name,
            "time_logs": time_logs
        })

        timesheet.insert(ignore_permissions=True)
        frappe.msgprint(f"Timesheet {timesheet.name} created for Instructor {instructor}.")
