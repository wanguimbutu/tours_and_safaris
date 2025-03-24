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
         frappe.throw(("From Date cannot be in the past. Please select a valid date."))
         
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
@frappe.whitelist()
def apply_exchange_rate_conversion(doc, method):
    """Ensure exchange rate conversion applies only once before inserting."""
    
    # If already converted, do nothing
    if doc.get("exchange_applied"):  
        frappe.msgprint("Exchange rate already applied, skipping conversion.")
        return

    if doc.billing_currency and doc.billing_currency != "KES":
        frappe.msgprint(f"Applying exchange rate conversion for {doc.billing_currency}")

        def convert_rates(rows):
            for row in rows:
                # Store original rate if not already set
                if not row.get("original_rate"):
                    row.original_rate = row.rate  # Keep the fetched rate

                # Convert using the original rate and store a backup
                row.converted_rate = row.original_rate / doc.exchange_rate  
                row.rate = row.converted_rate  # Ensure rate stays converted
                row.currency = doc.billing_currency  

                # Ensure amount updates correctly
                if hasattr(row, "amount") and hasattr(row, "qty"):
                    row.amount = row.rate * row.qty
                elif hasattr(row, "amount"):
                    row.amount = row.rate  

        # Apply to all relevant child tables
        convert_rates(doc.activities)
        convert_rates(doc.tent_selection)
        convert_rates(doc.room_booking)
        convert_rates(doc.meals)
        convert_rates(doc.hired_service)
        convert_rates(doc.transport_service)

        # Update total cost
        doc.proposed_total_cost = sum(
            row.amount for table in [
                doc.activities,
                doc.tent_selection,
                doc.room_booking,
                doc.meals,
                doc.hired_service,
                doc.transport_service
            ] for row in table if hasattr(row, "amount")
        )

        
        doc.exchange_applied = True  
        frappe.msgprint("Exchange rate conversion applied and locked.")

@frappe.whitelist()
def prevent_rate_reset(doc, method):
    """Ensure that converted rates are retained before submission."""
    if doc.billing_currency and doc.billing_currency != "KES":
        frappe.msgprint("Ensuring converted rates are retained before submission.")

        def retain_converted_rates(rows):
            for row in rows:
                # If converted_rate exists, force rate to stay converted
                if row.get("converted_rate"):
                    row.rate = row.converted_rate
                    row.currency = doc.billing_currency  

        retain_converted_rates(doc.activities)
        retain_converted_rates(doc.tent_selection)
        retain_converted_rates(doc.room_booking)
        retain_converted_rates(doc.meals)
        retain_converted_rates(doc.hired_service)
        retain_converted_rates(doc.transport_service)

        frappe.msgprint("Converted rates retained successfully.")

@frappe.whitelist()
def lock_rates_after_fetch(doc, method):
    """Prevent ERPNext from resetting rates after fetching standard prices."""
    if doc.billing_currency and doc.billing_currency != "KES":
        frappe.msgprint("Locking converted rates to prevent overwrite.")

        def lock_rates(rows):
            for row in rows:
                if row.get("converted_rate"):
                    row.rate = row.converted_rate  
                   # row.currency = doc.billing_currency  
                    row.db_set("rate", row.converted_rate)  
                    #row.db_set("currency", doc.billing_currency)  

        lock_rates(doc.activities)
        lock_rates(doc.tent_selection)
        lock_rates(doc.room_booking)
        lock_rates(doc.meals)
        lock_rates(doc.hired_service)
        lock_rates(doc.transport_service)

        frappe.msgprint("Rates locked.")

