# Copyright (c) 2025, wanguimbutu and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class InstructorAssignment(Document):
	pass

@frappe.whitelist()
def get_all_instructors(activity=None, session_type=None):
    frappe.logger().info(f"Received parameters - Activity: {activity}, Session Type: {session_type}")

    # Explicitly check for None
    if not activity or not session_type:
        frappe.throw(f"Both activity and session_type parameters are required. Received: Activity={activity}, Session Type={session_type}")

    instructors = frappe.db.sql("""
        SELECT 
            ia.parent AS instructor, 
            ia.qualification, 
            ir.rate  
        FROM `tabInstructor Activity Level` ia
        LEFT JOIN `tabInstructor Rate` ir 
            ON ia.qualification = ir.qualification 
            AND ia.activity_name = ir.activity_name 
            AND ir.session_type = %s
        WHERE ia.activity_name = %s
    """, (session_type, activity), as_dict=True)

    return instructors
