# Copyright (c) 2025, wanguimbutu and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from datetime import datetime


class Availability(Document):
    def update_room_status(self):
        today = datetime.today().date()

        # Fetch all availability records where check-in date is today and status is "Booked"
        availability_entries = frappe.get_all(
            "Availability",
            filters={"check_in_date": today, "status": "Booked"},
            fields=["name", "room_name"]
        )

        for entry in availability_entries:
            # Update Availability status to Reserved
            frappe.db.set_value("Availability", entry["name"], "status", "Reserved")

            # Also update the Room status
            frappe.db.set_value("Rooms", entry["room_number"], "status", "Reserved")

        frappe.db.commit()

def process_checkout():
    today = datetime.today().date()
    checkout_time = today.strftime("%Y-%m-%d") + " 10:00:00"  # Set to 10 AM

    # Fetch all rooms with check-out today
    availability_entries = frappe.get_all(
        "Availability",
        filters={"check_out_date": today, "status": "Reserved"},
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
