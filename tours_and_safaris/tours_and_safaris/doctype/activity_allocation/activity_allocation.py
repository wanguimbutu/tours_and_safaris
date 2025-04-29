# Copyright (c) 2025, wanguimbutu and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
import random
from frappe.utils import get_datetime
from datetime import datetime


class ActivityAllocation(Document):
	pass

@frappe.whitelist()
def get_instructors(activity_name, activity_date=None, start_time=None, end_time=None, is_safety_kayak=False):
    from frappe.utils import get_datetime
    import json

    frappe.logger().info(f"Fetching instructors for activity: {activity_name}")

    # Step 1: Get all qualified instructors for this activity
    instructor_details = frappe.get_all(
        "Instructor Activity Level",
        filters={"activity_name": activity_name},
        fields=["parent as instructor", "qualification"]
    )

    if not instructor_details:
        frappe.logger().info("No qualified instructors found.")
        return [] if is_safety_kayak else []

    instructor_names = [row["instructor"] for row in instructor_details]

    # Step 2: Get instructors who are already booked during this time slot
    busy_instructors = []
    if activity_date and start_time and end_time:
        overlapping = frappe.db.sql("""
            SELECT iad.instructor
            FROM `tabActivity Allocation Details` iad
            INNER JOIN `tabActivity Allocation` ia ON ia.name = iad.parent
            WHERE iad.instructor IS NOT NULL
              AND iad.activity_date = %s
              AND (
                  (%s BETWEEN iad.start_time AND iad.end_time)
                  OR (%s BETWEEN iad.start_time AND iad.end_time)
                  OR (iad.start_time BETWEEN %s AND %s)
              )
              AND ia.docstatus < 2
        """, (activity_date, start_time, end_time, start_time, end_time), as_dict=True)

        busy_instructors = [row.instructor for row in overlapping]

    # Step 3: Filter out busy instructors
    available_instructor_details = [
        row for row in instructor_details
        if row["instructor"] not in busy_instructors
    ]

    if not available_instructor_details:
        frappe.logger().info("No available instructors found in time range.")
        return [] if is_safety_kayak else []

    # Step 4: Get instructor display names
    instructors = frappe.get_all(
        "Instructor",
        filters={"name": ["in", [row["instructor"] for row in available_instructor_details]]},
        fields=["name as instructor_id", "name1 as instructor_name"]
    )

    instructor_map = {inst["instructor_id"]: inst["instructor_name"] for inst in instructors}

    final_instructors = [
        {
            "instructor": instructor_map.get(row["instructor"], row["instructor"]),
            "qualification": row["qualification"]
        }
        for row in available_instructor_details
    ]

    frappe.logger().info(f"Final Instructor List: {final_instructors}")

    return final_instructors


color_palette = [
    "#FF5733", "#33C3FF", "#85FF33", "#FFC300", "#DAF7A6",
    "#C70039", "#900C3F", "#581845", "#00BCD4", "#8BC34A"
]

def get_random_color_for_instructor(instructor):
    cache_key = f"instructor_color::{instructor}"
    cached_color = frappe.cache().get_value(cache_key)
    if cached_color:
        return cached_color
    new_color = random.choice(color_palette)
    frappe.cache().set_value(cache_key, new_color)
    return new_color

def allocate_instructor(doc, method):
    """Allocate instructors and create Timesheets with detailed time logs."""

    frappe.db.set_value("Activity Allocation", doc.name, "status", "Allocated")

    instructor_rows = {}

    for row in doc.activity_allocation_details:
        if row.instructor:
            instructor_rows.setdefault(row.instructor, []).append(row)

        if row.safety_kayak and row.safety_kayak_instructor:
            dummy_row = frappe._dict({
                "activity_name": "Safety Kayaking",
                "session": "Per Session",
                "qualification": row.kayaker_qualification or "Unspecified",
                "activity_date": row.activity_date,
                "start_time": row.start_time,
                "end_time": row.end_time
            })
            instructor_rows.setdefault(row.safety_kayak_instructor, []).append(dummy_row)

    if not instructor_rows:
        frappe.throw("No instructor assigned in Activity Allocation Details.")

    for instructor, rows in instructor_rows.items():
        time_logs = []

        for row in rows:
            rate = frappe.db.get_value(
                "Instructor Rate",
                {
                    "activity": row.activity_name,
                    "session_type": row.session,
                    "qualification": row.qualification
                },
                "rate"
            )

            if not rate:
                frappe.throw(f"No rate found for {row.activity_name} with {row.session} and {row.qualification}.")

            if not (row.activity_date and row.start_time and row.end_time):
                frappe.throw(f"Missing activity_date/start_time/end_time in row for {row.activity_name}")

            activity_date = (
                datetime.strptime(row.activity_date, "%Y-%m-%d").date()
                if isinstance(row.activity_date, str)
                else row.activity_date
            )

            start_time = (
                datetime.strptime(row.start_time, "%Y-%m-%d %H:%M:%S").time()
                if isinstance(row.start_time, str)
                else row.start_time
            )
            end_time = (
                datetime.strptime(row.end_time, "%Y-%m-%d %H:%M:%S").time()
                if isinstance(row.end_time, str)
                else row.end_time
            )

            from_datetime = datetime.combine(activity_date, start_time)
            to_datetime = datetime.combine(activity_date, end_time)

            time_logs.append({
                "activity_type": row.activity_name,
                "project": doc.project_name,
                "billing_hours": 1,
                "is_billable": 1,
                "billing_rate": rate,
                "from_time": from_datetime,
                "to_time": to_datetime,
                "task":doc.task
            })

        timesheet = frappe.get_doc({
            "doctype": "Timesheet",
            "employee": instructor,
            "custom_instructor": instructor,
            "customer": doc.customer,
            "project": doc.project_name,
            "custom_activity_allocation": doc.name,
            "time_logs": time_logs
        })

        timesheet.insert(ignore_permissions=True)
        frappe.msgprint(f"Timesheet {timesheet.name} created for Instructor {instructor}.")

def process_activity_calendar_events(doc, method=None):
    color_map = {}

    for detail in doc.activity_allocation_details:
        if not detail.instructor:
            continue

        if detail.instructor not in color_map:
            color_map[detail.instructor] = "#{:06x}".format(random.randint(0, 0xFFFFFF))

        new_start = get_datetime(f"{detail.activity_date} {detail.start_time}")
        new_end = get_datetime(f"{detail.activity_date} {detail.end_time}")

        overlapping = frappe.db.exists(
            "Activity Calendar Event",
            {
                "instructor": detail.instructor,
                "activity_date": detail.activity_date,
                "docstatus": 1,
                "start_time": ("<", new_end.time()),
                "end_time": (">", new_start.time()),
            }
        )

        if overlapping:
            frappe.throw(f"Instructor {detail.instructor} is already booked on {detail.activity_date} between {detail.start_time} and {detail.end_time}.")

        event = frappe.new_doc("Activity Calendar Event")
        event.activity_allocation = doc.name
        event.activity_date = detail.activity_date
        event.start_time = detail.start_time
        event.end_time = detail.end_time
        event.instructor = detail.instructor
        event.activity_name = detail.activity_name
        event.session = detail.session
        event.session_period = detail.session_period
        event.customer = doc.customer
        event.no_of_people = doc.custom_no_of_people,
        event.color = color_map[detail.instructor]

        event.insert(ignore_permissions=True)
        event.submit()

        
@frappe.whitelist()
def update_calendar_info(doc, method):
    if doc.customer and doc.instructor:
        doc.calendar_info = f"{doc.customer} ({doc.no_of_people}) adults:({doc.no_of_adults}) children:({doc.no_of_children})"