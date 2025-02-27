# Copyright (c) 2025, wanguimbutu and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import today, getdate
from collections import Counter


class BookingInquiry(Document):
	pass

@frappe.whitelist()
def validate_booking_inquiry(doc, method):
    if doc.from_date and getdate(doc.from_date) < getdate(today()):
         frappe.throw(_("From Date cannot be in the past. Please select a valid date."))
         
@frappe.whitelist()
def validate_people_count(doc, method):
    no_of_adults = doc.get("no_of_adults") or 0
    no_of_children = doc.get("no_of_children") or 0
    total = no_of_adults + no_of_children

    if doc.get("no_of_people") != total:
         frappe.throw("No of People must equal the sum of No of Adults and No of Children.")

@frappe.whitelist()
def validate_guest_details(doc, method):
    # Initialize counters
    guest_adults = 0
    guest_children = 0

    # Loop through the guest_details child table
    for guest in doc.get("guest_details") or []:
        if guest.age and guest.age.lower() == "adult":
            guest_adults += 1
        elif guest.age and guest.age.lower() == "child":
            guest_children += 1

    no_of_adults = doc.get("no_of_adults") or 0
    no_of_children = doc.get("no_of_children") or 0

    if guest_adults != no_of_adults:
        frappe.throw(
            "Mismatch in Adults: Guest Details has {} adults, but 'No of Adults' is set to {}.".format(guest_adults, no_of_adults)
        )
    if guest_children != no_of_children:
        frappe.throw(
            "Mismatch in Children: Guest Details has {} children, but 'No of Children' is set to {}.".format(guest_children, no_of_children)
        )

@frappe.whitelist()
def update_diet_preferences(doc, method):
    """Update Diet Preferences child table based on Guest Details in Booking Inquiry."""
    if not doc.get("guest_details"):
        return

    # Count dietary preferences from guest details
    diet_count = Counter([guest.dietary_preference for guest in doc.get("guest_details") if guest.dietary_preference])

    # Clear existing diet preferences to prevent duplicates
    doc.set("diet_preferences", [])

    # Add updated counts to Diet Preferences child table
    for preference, count in diet_count.items():
        doc.append("diet_preferences", {
            "dietary_preference": preference,
            "total_people": count
        })
