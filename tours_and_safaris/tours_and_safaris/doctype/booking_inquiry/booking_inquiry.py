# Copyright (c) 2025, wanguimbutu and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import today, getdate


class BookingInquiry(Document):
	pass

@frappe.whitelist()
def validate_booking_inquiry(doc, method):
    if doc.from_date and getdate(doc.from_date) < getdate(today()):
         frappe.throw(_("From Date cannot be in the past. Please select a valid date."))
         
@frappe.whitelist()
def validate_people_count(doc, method):
    # Ensure fields are not None, defaulting to 0 if needed
    no_of_adults = doc.get("no_of_adults") or 0
    no_of_children = doc.get("no_of_children") or 0
    total = no_of_adults + no_of_children

    # Compare total with no_of_people
    if doc.get("no_of_people") != total:
         frappe.throw("No of People must equal the sum of No of Adults and No of Children.")

@frappe.whitelist()
def validate_guest_details(doc, method):
    # Initialize counters
    guest_adults = 0
    guest_children = 0

    # Loop through the guest_details child table
    for guest in doc.get("guest_details") or []:
        # Use lower() for case-insensitive comparison
        if guest.age and guest.age.lower() == "adult":
            guest_adults += 1
        elif guest.age and guest.age.lower() == "child":
            guest_children += 1

    # Get the numbers from the main document (defaulting to 0 if empty)
    no_of_adults = doc.get("no_of_adults") or 0
    no_of_children = doc.get("no_of_children") or 0

    # Check if the counts match the fields
    if guest_adults != no_of_adults:
        frappe.throw(
            "Mismatch in Adults: Guest Details has {} adults, but 'No of Adults' is set to {}.".format(guest_adults, no_of_adults)
        )
    if guest_children != no_of_children:
        frappe.throw(
            "Mismatch in Children: Guest Details has {} children, but 'No of Children' is set to {}.".format(guest_children, no_of_children)
        )
