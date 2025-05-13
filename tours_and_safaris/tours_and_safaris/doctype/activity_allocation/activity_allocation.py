# Copyright (c) 2025, wanguimbutu and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
import random
from frappe.utils import get_datetime
from datetime import datetime
import json
import hashlib

class ActivityAllocation(Document):
	pass

@frappe.whitelist()
def get_instructors(activity_name, activity_date=None, start_time=None, end_time=None, is_safety_kayak=False):
    from frappe.utils import get_datetime
    import json

    frappe.logger().info(f"Fetching instructors for activity: {activity_name}")

    instructor_details = frappe.get_all(
        "Instructor Activity Level",
        filters={"activity_name": activity_name},
        fields=["parent as instructor", "qualification"]
    )

    if not instructor_details:
        frappe.logger().info("No qualified instructors found.")
        return [] if is_safety_kayak else []

    instructor_names = [row["instructor"] for row in instructor_details]

    busy_instructors = []
    if activity_date and start_time and end_time:
        overlapping_allocation = frappe.db.sql("""
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

        busy_instructors.extend(row.instructor for row in overlapping_allocation)

        overlapping_events = frappe.db.sql("""
            SELECT instructor
            FROM `tabActivity Calendar Event`
            WHERE instructor IS NOT NULL
              AND (
                  (%s BETWEEN start_time AND end_time)
                  OR (%s BETWEEN start_time AND end_time)
                  OR (start_time BETWEEN %s AND %s)
              )
        """, (start_time, end_time, start_time, end_time), as_dict=True)

        busy_instructors.extend(row.instructor for row in overlapping_events)

    busy_instructors = list(set(busy_instructors))

    available_instructor_details = [
        row for row in instructor_details
        if row["instructor"] not in busy_instructors
    ]

    if not available_instructor_details:
        frappe.logger().info("No available instructors found in time range.")
        return [] if is_safety_kayak else []

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

def get_consistent_color_for_instructor(instructor):
    
    hash_val = int(hashlib.sha256(instructor.encode()).hexdigest(), 16)
    color_index = hash_val % len(color_palette)
    return color_palette[color_index]

def allocate_instructor(doc, method):
    """Allocate instructors and create Timesheets with detailed time logs."""

    frappe.db.set_value("Activity Allocation", doc.name, "status", "Allocated")

    instructor_rows = {}

    # Combine both sources: activity_allocation_details and instructor_assignment_table
    all_rows = list(doc.activity_allocation_details) + list(doc.instructor_assignment)

    for row in all_rows:
        if row.instructor:
            instructor_rows.setdefault(row.instructor, []).append(row)

        if hasattr(row, "safety_kayak") and row.safety_kayak and hasattr(row, "safety_kayak_instructor") and row.safety_kayak_instructor:
            dummy_row = frappe._dict({
                "activity_name": "Safety Kayaking",
                "session": "Per Session",
                "qualification": getattr(row, "kayaker_qualification", None) or "Unspecified",
                "activity_date": getattr(row, "activity_date", None) or getattr(row, "from_date", None),
                "start_time": row.start_time,
                "end_time": row.end_time
            })
            instructor_rows.setdefault(row.safety_kayak_instructor, []).append(dummy_row)

    if not instructor_rows:
        frappe.throw("No instructor assigned in Activity Allocation Details or Instructor Assignment.")

    for instructor, rows in instructor_rows.items():
        time_logs = []

        for row in rows:
            # Fetch the rate
            rate = frappe.db.get_value(
                "Instructor Rate",
                {
                    "activity": row.activity_name,
                    "session_type": getattr(row, "session", "Per Session"),
                    "qualification": getattr(row, "qualification", "Unspecified"),
                },
                "rate"
            )

            if not rate:
                frappe.throw(f"No rate found for {row.activity_name} with {getattr(row, 'session', 'Per Session')} and {getattr(row, 'qualification', 'Unspecified')}.")

            # Handle dates and times
            activity_date = getattr(row, "activity_date", None) or getattr(row, "from_date", None)
            start_time = row.start_time
            end_time = row.end_time

            if not (activity_date and start_time and end_time):
                frappe.throw(f"Missing activity_date/start_time/end_time in row for {row.activity_name}")

            # Convert strings to datetime objects if necessary
            activity_date = (
                datetime.strptime(activity_date, "%Y-%m-%d").date()
                if isinstance(activity_date, str)
                else activity_date
            )

            start_time = (
                datetime.strptime(start_time, "%Y-%m-%d %H:%M:%S").time()
                if isinstance(start_time, str)
                else start_time
            )

            end_time = (
                datetime.strptime(end_time, "%Y-%m-%d %H:%M:%S").time()
                if isinstance(end_time, str)
                else end_time
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
                "task": doc.task,
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

    for detail in doc.activity_allocation_details:
        if not detail.instructor:
            continue

        create_activity_event_from_row(doc, detail, source="Activity Allocation")

    
    for row in doc.instructor_assignment:
        if not row.instructor:
            continue

        create_activity_event_from_row(doc, row, source="Instructor Assignment")


def create_activity_event_from_row(doc, row, source):
    instructor = row.instructor
    activity_name = row.activity_name
    activity_date = getattr(row, "activity_date", None) or getattr(row, "from_date", None)
    start_time = row.start_time
    end_time = row.end_time

    if not (activity_date and start_time and end_time):
        return  

    color = get_consistent_color_for_instructor(instructor)

    new_start = get_datetime(f"{activity_date} {start_time}")
    new_end = get_datetime(f"{activity_date} {end_time}")

    overlapping = frappe.db.exists(
        "Activity Calendar Event",
        {
            "instructor": instructor,
            "activity_date": activity_date,
            "docstatus": 1,
            "start_time": ("<", new_end.time()),
            "end_time": (">", new_start.time()),
        }
    )

    if overlapping:
        frappe.throw(
            f"Instructor {instructor} is already booked on {activity_date} "
            f"between {start_time} and {end_time}."
        )

    title = f"{instructor} | {activity_name} | {doc.customer_name or doc.customer}"

    event = frappe.new_doc("Activity Calendar Event")
    event.activity_allocation = doc.name
    event.activity_date = activity_date
    event.start_time = start_time
    event.end_time = end_time
    event.instructor = instructor
    event.activity_name = activity_name
    event.session = getattr(row, "session", "Per Session")
    event.session_type = getattr(row, "session_type", "Full Day")
    event.customer = doc.customer
    event.no_of_people = getattr(doc, "custom_no_of_people", 1)
    event.color = color
    event.title = title

    event.insert(ignore_permissions=True)
    event.submit()

        
@frappe.whitelist()
def create_calendar_events_on_reassign(allocation_name):
    doc = frappe.get_doc("Activity Allocation", allocation_name)

    target_table = (
        doc.instructor_assignment
        if any(getattr(row, "instructor", None) for row in doc.instructor_assignment)
        else doc.activity_allocation_details
    )

    for row in target_table:
        if row.instructor:
            create_activity_event_from_row(doc, row, source="reassign")

def delete_existing_calendar_events(docname, instructor=None):
    filters = {"activity_allocation": docname}
    if instructor:
        filters["instructor"] = instructor

    old_events = frappe.get_all(
        "Activity Calendar Event",
        filters=filters,
        fields=["name"]
    )

    for event in old_events:
        try:
            ev_doc = frappe.get_doc("Activity Calendar Event", event.name)
            if ev_doc.docstatus == 1:
                ev_doc.cancel()
            ev_doc.delete()
        except Exception as e:
            frappe.log_error(f"Failed to delete calendar event {event.name}: {e}")
