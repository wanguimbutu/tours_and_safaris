# Copyright (c) 2025, wanguimbutu and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class ActivityAllocation(Document):
	pass

@frappe.whitelist()
def get_instructors(activity_name):
    frappe.logger().info(f"Fetching instructors for activity: {activity_name}")


    instructor_details = frappe.get_all(
        "Instructor Activity Level",
        filters={"activity_name": activity_name},
        fields=["parent as instructor", "qualification"]
    )

    frappe.logger().info(f"Fetched from Instructor Activity Level: {instructor_details}")

    if not instructor_details:
        return []

    instructor_names = [row["instructor"] for row in instructor_details]

    instructors = frappe.get_all(
        "Instructor",
        filters={"name": ["in", instructor_names]},
        fields=["name as instructor_id", "name1 as instructor_name"]
    )

    frappe.logger().info(f"Fetched from Instructor: {instructors}")

    # Map instructor IDs to their names
    instructor_map = {inst["instructor_id"]: inst["instructor_name"] for inst in instructors}

    final_instructors = [
        {
            "instructor": instructor_map.get(row["instructor"], row["instructor"]),
            "qualification": row["qualification"]
        }
        for row in instructor_details
    ]

    frappe.logger().info(f"Final Instructor List: {final_instructors}")

    return final_instructors


def allocate_instructor(doc, method):
    """Updates status to 'Allocated' and creates a Timesheet for the assigned instructors, fetching rate from Instructor Rate."""

    frappe.db.set_value("Activity Allocation", doc.name, "status", "Allocated")

    instructor_activities = {}

    for row in doc.activity_allocation_details:
        if row.instructor and row.activity_name:
    
            activity_type = frappe.db.get_value("Activity Type", {"name": row.activity_name}, "name")

            if not activity_type:
                frappe.throw(f"Activity Type not found for Activity Name: {row.activity_name}. Ensure it exists.")

            if row.instructor not in instructor_activities:
                instructor_activities[row.instructor] = []

            instructor_activities[row.instructor].append({
                "activity_name": row.activity_name,
                "session": row.session,  
                "qualification": row.qualification
            })

    if not instructor_activities:
        frappe.throw("No instructor assigned in Activity Allocation Details.")

    
    for instructor, activities in instructor_activities.items():
        time_logs = []

        for activity in activities:
            rate = frappe.db.get_value(
                "Instructor Rate",
                {
                    "activity": activity["activity_name"],
                    "session_type": activity["session"],  
                    "qualification": activity["qualification"]
                },
                "rate"
            )

            if not rate:
                frappe.throw(f"No rate found for {activity['activity_name']} with {activity['session']} session and {activity['qualification']}.")

            time_logs.append({
                "activity_type": activity["activity_name"],
                "project": doc.project_name,
                "hours": 1,  
                "is_billable": 1,  
                "billing_rate": rate  
            })

        timesheet = frappe.get_doc({
            "doctype": "Timesheet",
            "employee": instructor,
            "customer": doc.customer,
            "project": doc.project_name,
            "time_logs": time_logs
        })

        timesheet.insert(ignore_permissions=True)
        frappe.msgprint(f"Timesheet {timesheet.name} created for Instructor {instructor} with rate {rate}.")
