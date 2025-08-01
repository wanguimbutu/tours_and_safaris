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
'''@frappe.whitelist()
def apply_exchange_rate_conversion(doc, method):
    """Ensure exchange rate conversion applies only once before inserting."""
    
    # If already converted, do nothing
    if doc.get("exchange_applied"):  
        return

    if doc.billing_currency and doc.billing_currency != "KES":

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
'''
@frappe.whitelist()
def prevent_rate_reset(doc, method):
    """Ensure that converted rates are retained before submission."""
    if doc.billing_currency and doc.billing_currency != "KES":

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

    

@frappe.whitelist()
def lock_rates_after_fetch(doc, method):
    """Prevent ERPNext from resetting rates after fetching standard prices."""
    if doc.billing_currency and doc.billing_currency != "KES":

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

        

@frappe.whitelist()
def create_quotation(inquiry_name):
    """Generate a quotation for a reservation."""
    inquiry = frappe.get_doc("Booking Inquiry", inquiry_name)
    
    if not inquiry.customer:
        frappe.throw("Please ensure the Customer Name field is filled in the Booking Inquiry.")

    # Check if a quotation already exists and is submitted
    existing_quotation = frappe.get_all("Quotation", filters={"custom_booking_inquiry": inquiry_name, "docstatus": 1}, fields=["name"])
    
    if existing_quotation:
        frappe.throw("A quotation has already been created and submitted for this Booking Inquiry.")

    # Proceed with creating a new quotation
    quotation = frappe.get_doc({
        "doctype": "Quotation",
        "quotation_to":"Customer",  
        "party_name": inquiry.customer,
        "custom_arrival_date": inquiry.from_date,
        "depature_date": inquiry.to_date,
        "custom_booking_inquiry": inquiry.name,
        "custom_no_of_people": inquiry.no_of_people,
        "custom_no_of_adults": inquiry.no_of_adults,
        "custom_no_of_children": inquiry.no_of_children,
        "currency": inquiry.billing_currency,
        "custom_accommodation_needed": inquiry.accommodation_needed,
        "custom_rooms": inquiry.rooms,
        "custom_tents": inquiry.tents,
        "custom_is_consolidated": inquiry.is_consolidated,
        "custom_consolidated_amount": inquiry.consolidated_amount,
        "custom_remarks": inquiry.remarks,
        "custom_grade":inquiry.grade,
        "custom_is_meals_at_camp":inquiry.is_meals_at_camp,
        "items": []
    })

    # Check for consolidation
    if inquiry.get("is_consolidated"):
        # Assume only one activity row exists for consolidated case
        activity = inquiry.activities[0] if inquiry.activities else None

        if activity:
            quotation.append("items", {
                "item_code": activity.item_code or "SC-014",
                "item_name": activity.activity_name or "Multi Activity",
                "qty": activity.qty or 1,
                "rate": activity.rate or 0
            })


    else:
        # Add activities
        if inquiry.activities:
            for activity in inquiry.activities:
                quotation.append("items", {
                    "item_code": activity.item_code,
                    "item_name": activity.activity_name,
                    "qty": activity.qty,  
                    "rate": activity.rate or 0
                })

        # Add room bookings
        if inquiry.room_booking:
            for room in inquiry.room_booking:
                quotation.append("items", {
                    "item_code": room.room_type,
                    "item_name": room.room_type_name or "Room",
                    "description": f"Room Booking: {room.room_type or 'N/A'}",
                    "qty": room.qty or 1,
                    "rate": room.rate or 0
                })

        # Add tent selections
        if inquiry.tent_selection:
            for tent in inquiry.tent_selection:
                quotation.append("items", {
                    "item_code": tent.tent_type,
                    "item_name": tent.tent_name or "Tent",
                    "description": f"Tent: {tent.tent_type or 'N/A'}",
                    "qty": tent.qty or 1,
                    "rate": tent.rate or 0
                })

        # Add transport costs
        if inquiry.transport_service:
            for transport in inquiry.transport_service:
                quotation.append("items", {
                    "item_code": transport.transport_name,
                    "item_name": transport.item_name,
                    "qty": transport.qty,
                    "rate": transport.rate or 0
                })

        # Add hired services
        if inquiry.hired_service:
            for service in inquiry.hired_service:
                quotation.append("items", {
                    "item_code": service.service_name,
                    "item_name": service.name or "Service",
                    "qty": service.qty,
                    "rate": service.rate or 0
                })

        # Add meals
        if inquiry.meals:
            for meals in inquiry.meals:
                quotation.append("items", {
                    "item_code": meals.meal_type,
                    "qty": meals.qty or 1,
                    "rate": meals.rate or 0
                })

    quotation.insert(ignore_permissions=True)

    return {"quotation_name": quotation.name, "url": f"/app/quotation/{quotation.name}"}


@frappe.whitelist()
def update_calendar_info(doc, method):
    if doc.customer and doc.no_of_people:
        doc.calendar_info = f"{doc.customer} ({doc.no_of_people}) adults:({doc.no_of_adults}) children:({doc.no_of_children})"
