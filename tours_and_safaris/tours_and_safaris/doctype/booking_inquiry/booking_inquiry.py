# Copyright (c) 2025, wanguimbutu and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt, today, getdate
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
    existing_quotation = frappe.get_all(
        "Quotation", 
        filters={"custom_booking_inquiry": inquiry_name, "docstatus": 1}, 
        fields=["name"]
    )
    
    if existing_quotation:
        frappe.throw("A quotation has already been created and submitted for this Booking Inquiry.")

    # Get company and currency info
    company = frappe.defaults.get_user_default("Company")
    company_currency = frappe.db.get_value("Company", company, "default_currency")
    quotation_currency = inquiry.billing_currency or company_currency

    # Get the proper exchange rate
    conversion_rate = 1.0
    if quotation_currency != company_currency:
        # Try to get exchange rate from Currency Exchange doctype
        exchange_rate = frappe.db.get_value(
            "Currency Exchange",
            {"from_currency": quotation_currency, "to_currency": company_currency},
            "exchange_rate"
        )
        
        if exchange_rate:
            conversion_rate = flt(exchange_rate)
        else:
            # If no exchange rate exists, try the reverse
            reverse_rate = frappe.db.get_value(
                "Currency Exchange",
                {"from_currency": company_currency, "to_currency": quotation_currency},
                "exchange_rate"
            )
            
            if reverse_rate and flt(reverse_rate) != 0:
                conversion_rate = 1.0 / flt(reverse_rate)
            else:
                # Use inquiry exchange rate as fallback
                conversion_rate = flt(inquiry.get("exchange_rate")) or 1.0
                
                # If still no valid rate, throw an error
                if conversion_rate == 0:
                    frappe.throw(
                        f"Exchange Rate not found for {quotation_currency} to {company_currency}. "
                        f"Please create a Currency Exchange record or set the exchange rate in the Booking Inquiry."
                    )

    # Proceed with creating a new quotation
    quotation = frappe.get_doc({
        "doctype": "Quotation",
        "quotation_to": "Customer",
        "party_name": inquiry.customer,
        "custom_arrival_date": inquiry.from_date,
        "custom_depature_date": inquiry.to_date,
        "custom_booking_inquiry": inquiry.name,
        "custom_no_of_people": inquiry.no_of_people,
        "custom_no_of_adults": inquiry.no_of_adults,
        "custom_no_of_children": inquiry.no_of_children,
        "currency": quotation_currency,
        "conversion_rate": conversion_rate,  # Use calculated conversion rate
        "custom_accommodation_needed": inquiry.accommodation_needed,
        "custom_rooms": inquiry.rooms,
        "custom_tents": inquiry.tents,
        "custom_is_consolidated": inquiry.is_consolidated,
        "custom_consolidated_amount": inquiry.consolidated_amount,
        "custom_remarks": inquiry.remarks,
        "custom_grade": inquiry.grade,
        "custom_is_meals_at_camp": inquiry.is_meals_at_camp,
        "items": []
    })

    # Check for consolidated activities
    if inquiry.get("is_consolidated"):
        activity = inquiry.activities[0] if inquiry.activities else None
        if activity:
            quotation.append("items", {
                "item_code": activity.item_code or "SC-014",
                "item_name": activity.activity_name or "Multi Activity",
                "qty": flt(activity.qty) or 1.0,
                "rate": flt(activity.rate) or 0.0
            })
    else:
        # Activities
        for activity in inquiry.get("activities") or []:
            quotation.append("items", {
                "item_code": activity.item_code,
                "item_name": activity.activity_name,
                "qty": flt(activity.qty) or 1.0,
                "rate": flt(activity.rate) or 0.0
            })

        # Rooms
        for room in inquiry.get("room_booking") or []:
            quotation.append("items", {
                "item_code": room.room_type,
                "item_name": room.room_type_name or "Room",
                "description": f"Room Booking: {room.room_type or 'N/A'}",
                "qty": flt(room.qty) or 1.0,
                "rate": flt(room.rate) or 0.0
            })

        # Tents
        for tent in inquiry.get("tent_selection") or []:
            quotation.append("items", {
                "item_code": tent.tent_type,
                "item_name": tent.tent_name or "Tent",
                "description": f"Tent: {tent.tent_type or 'N/A'}",
                "qty": flt(tent.qty) or 1.0,
                "rate": flt(tent.rate) or 0.0
            })

        # Transport
        for transport in inquiry.get("transport_service") or []:
            quotation.append("items", {
                "item_code": transport.transport_name,
                "item_name": transport.item_name or "Transport",
                "qty": flt(transport.qty) or 1.0,
                "rate": flt(transport.rate) or 0.0
            })

        # Hired Services
        for service in inquiry.get("hired_service") or []:
            quotation.append("items", {
                "item_code": service.service_name,
                "item_name": service.name or "Service",
                "qty": flt(service.qty) or 1.0,
                "rate": flt(service.rate) or 0.0
            })

        # Meals
        for meal in inquiry.get("meals") or []:
            quotation.append("items", {
                "item_code": meal.meal_type,
                "item_name": meal.meal_type or "Meal",
                "qty": flt(meal.qty) or 1.0,
                "rate": flt(meal.rate) or 0.0
            })

    # Ensure every item has valid qty and rate
    for item in quotation.items:
        item.qty = flt(item.qty) or 1.0
        item.rate = flt(item.rate) or 0.0

    # Let ERPNext calculate totals (this will set base amounts correctly)
    quotation.run_method("calculate_taxes_and_totals")

    # Ensure base totals are set with fallback values
    quotation.total = flt(quotation.total) or 0.0
    quotation.base_total = flt(quotation.base_total) or flt(quotation.total) * conversion_rate
    quotation.net_total = flt(quotation.net_total) or flt(quotation.total)
    quotation.base_net_total = flt(quotation.base_net_total) or flt(quotation.net_total) * conversion_rate
    quotation.grand_total = flt(quotation.grand_total) or flt(quotation.total)
    quotation.base_grand_total = flt(quotation.base_grand_total) or flt(quotation.grand_total) * conversion_rate

    # Clear payment schedule AFTER totals are set
    quotation.set("payment_schedule", [])

    # Insert quotation safely
    quotation.insert(ignore_permissions=True)

    return {"quotation_name": quotation.name, "url": f"/app/quotation/{quotation.name}"}

@frappe.whitelist()
def update_calendar_info(doc, method):
    if doc.customer and doc.no_of_people:
        doc.calendar_info = f"{doc.customer} ({doc.no_of_people}) adults:({doc.no_of_adults}) children:({doc.no_of_children})"