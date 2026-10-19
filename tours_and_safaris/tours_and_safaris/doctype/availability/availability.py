# Copyright (c) 2025, wanguimbutu and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from datetime import datetime


class Availability(Document):
    pass
@frappe.whitelist()
def update_room_status(self):
    today = datetime.today().date()

    # Fetch all availability records where check-in date is today and status is "Booked"
    availability_entries = frappe.get_all(
        "Availability",
        filters={"arrival_date": today, "status": "Booked"},
        fields=["name", "room_name"]
    )

    for entry in availability_entries:
        # Update Availability status to Reserved
        frappe.db.set_value("Availability", entry["name"], "status", "Reserved")

        # Also update the Room status
        frappe.db.set_value("Rooms", entry["room_number"], "status", "Reserved")

    frappe.db.commit()
    
@frappe.whitelist()
def process_checkout():
    today = datetime.today().date()
    checkout_time = today.strftime("%Y-%m-%d") + " 10:00:00"  # Set to 10 AM

    # Fetch all rooms with check-out today
    availability_entries = frappe.get_all(
        "Availability",
        filters={"depature_date": today, "status": "Reserved"},
        fields=["name", "room_name"]
    )

    for entry in availability_entries:
        # Create a checkout log
        checkout_log = frappe.get_doc({
            "doctype": "Checkout Log",
            "room_name": entry["room_name"],
            "checkout_date": today,
            "checkout_time": checkout_time,
            "status": "Checked Out"
        })
        checkout_log.insert(ignore_permissions=True)

        # Update Room Status to "Under Maintenance"
        frappe.db.set_value("Rooms", entry["room_number"], "status", "Under Maintenance")

        # Update Availability Status
        frappe.db.set_value("Availability", entry["name"], "status", "Checked Out")

    frappe.db.commit()
@frappe.whitelist()
def get_calendar_events(start, end, filters=None):
    """Get availability calendar events excluding cancelled documents"""
    
    events = frappe.get_all(
        "Availability",
        filters={
            "docstatus": ["!=", 2],  # Exclude cancelled documents
            "check_in_date": ["<=", end],
            "check_out_date": [">=", start]
        },
        fields=[
            "name",
            "calendar_info",
            "check_in_date",
            "check_out_date",
            "room_name",
            "customer",
            "customer_name",
            "docstatus"
        ]
    )

    # Older records may have an empty customer_name, so look it up from Customer
    missing = {e.customer for e in events if e.customer and not e.customer_name}
    customer_names = dict(frappe.get_all(
        "Customer",
        filters={"name": ["in", list(missing)]},
        fields=["name", "customer_name"],
        as_list=True
    )) if missing else {}

    calendar_events = []
    for event in events:
        # Double-check that document is not cancelled
        if event.docstatus != 2:
            customer = event.customer_name or customer_names.get(event.customer) or event.customer
            title = " - ".join(filter(None, [customer, event.room_name]))
            calendar_events.append({
                "name": event.name,
                "title": title or event.calendar_info or event.name,
                "start": event.check_in_date,
                "end": event.check_out_date,
                "allDay": 1,
                "doctype": "Availability"
            })
    
    return calendar_events
