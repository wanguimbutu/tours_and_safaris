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
    from frappe.utils import add_days
    if doc.from_date:
        earliest_allowed = getdate(add_days(today(), -3))
        if getdate(doc.from_date) < earliest_allowed:
            frappe.throw("From Date cannot be more than 3 days in the past.")
    if doc.from_date and doc.to_date and getdate(doc.to_date) <= getdate(doc.from_date):
        frappe.throw("To Date must be later than From Date.")
         
@frappe.whitelist()
def validate_people_count(doc, method):
    no_of_adults = doc.get("no_of_adults") or 0
    no_of_children = doc.get("no_of_children") or 0
    # Only validate if the user has filled in adults or children
    if not no_of_adults and not no_of_children:
        return
    total = no_of_adults + no_of_children
    if doc.get("no_of_people") and doc.get("no_of_people") != total:
        frappe.throw("No of People must equal the sum of No of Adults and No of Children.")

@frappe.whitelist()
def validate_guest_details(doc, method):
    # Guest details is optional — only validate if rows have been added
    if not doc.get("guest_details"):
        return

    guest_adults = 0
    guest_children = 0
    for guest in doc.get("guest_details"):
        if guest.age and guest.age.lower() == "adult":
            guest_adults += 1
        elif guest.age and guest.age.lower() == "child":
            guest_children += 1

    no_of_adults = doc.get("no_of_adults") or 0
    no_of_children = doc.get("no_of_children") or 0

    # Only cross-check if adults/children fields are filled
    if no_of_adults and guest_adults != no_of_adults:
        frappe.throw(
            "Mismatch in Adults: Guest Details has {} adults, but 'No of Adults' is set to {}.".format(guest_adults, no_of_adults)
        )
    if no_of_children and guest_children != no_of_children:
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
            parts = []
            if activity.session_period:
                parts.append(activity.session_period)
            if activity.arrival_time:
                parts.append(f"Arrival: {activity.arrival_time}")
            activity_desc = f"{activity.activity_name} ({', '.join(parts)})" if parts else activity.activity_name
            quotation.append("items", {
                "item_code": activity.item_code,
                "item_name": activity.activity_name,
                "description": activity_desc,
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

        # Add meals
        for meal in inquiry.get("meals") or []:
            if not meal.meal_type:
                frappe.log_error(f"Meal row skipped — no meal_type set (Booking Inquiry: {inquiry_name})", "create_quotation")
                continue
            sessions = [s for s, flag in [("Breakfast", meal.breakfast), ("Lunch", meal.lunch), ("Dinner", meal.dinner)] if flag]
            session_label = ", ".join(sessions) if sessions else ""
            meal_name = meal.meal_name or meal.meal_type
            description = f"{meal_name} ({session_label})" if session_label else meal_name
            quotation.append("items", {
                "item_code": meal.meal_type,
                "item_name": meal_name,
                "description": description,
                "qty": flt(meal.qty) or 1.0,
                "rate": flt(meal.rate) or 0.0
            })

    quotation.insert(ignore_permissions=True)

    return {"quotation_name": quotation.name, "url": f"/app/quotation/{quotation.name}"}

@frappe.whitelist()
def update_calendar_info(doc, method):
    if doc.customer and doc.no_of_people:
        doc.calendar_info = f"{doc.customer} ({doc.no_of_people}) adults:({doc.no_of_adults}) children:({doc.no_of_children})"


@frappe.whitelist()
def sync_booking_inquiry_changes(doc, method):
    """Propagate field changes from a submitted Booking Inquiry to its linked Quotation and Reservation."""
    if doc.flags.get("from_sync"):
        return

    # ── Quotation (scalar custom fields only) ──────────────────────────────
    quotations = frappe.get_all(
        "Quotation",
        filters={"custom_booking_inquiry": doc.name, "docstatus": ["!=", 2]},
        fields=["name"]
    )
    for qt in quotations:
        frappe.db.set_value("Quotation", qt["name"], {
            "custom_arrival_date": doc.from_date,
            "custom_depature_date": doc.to_date,
            "custom_no_of_people": doc.no_of_people,
            "custom_no_of_adults": doc.no_of_adults,
            "custom_no_of_children": doc.no_of_children,
            "custom_accommodation_needed": doc.accommodation_needed,
            "custom_rooms": doc.rooms,
            "custom_tents": doc.tents,
            "custom_is_consolidated": doc.is_consolidated,
            "custom_consolidated_amount": doc.consolidated_amount,
            "custom_grade": doc.grade,
            "custom_is_meals_at_camp": doc.is_meals_at_camp,
            "custom_remarks": doc.remarks,
        })

    # ── Reservation (scalar + child tables) ───────────────────────────────
    reservations = frappe.get_all(
        "Reservation",
        filters={"booking_inquiry": doc.name, "docstatus": ["!=", 2]},
        fields=["name"]
    )
    for res in reservations:
        res_doc = frappe.get_doc("Reservation", res["name"])
        res_doc.flags.from_sync = True
        res_doc.flags.ignore_validate_update_after_submit = True

        # Scalar fields
        res_doc.arrival_date = doc.from_date
        res_doc.depature_date = doc.to_date
        res_doc.no_of_people = doc.no_of_people
        res_doc.no_of_adults = doc.no_of_adults
        res_doc.no_of_children = doc.no_of_children
        res_doc.accommodation_needed = doc.accommodation_needed
        res_doc.rooms = doc.rooms
        res_doc.tents = doc.tents
        res_doc.is_consolidated = doc.is_consolidated
        res_doc.consolidated_amount = doc.consolidated_amount
        res_doc.grade = doc.grade
        res_doc.is_meals_at_camp = doc.is_meals_at_camp
        res_doc.billing_currency = doc.billing_currency

        # Activities
        res_doc.activities = []
        for row in doc.get("activities") or []:
            res_doc.append("activities", {
                "activity_group": row.activity_group,
                "activity_name": row.activity_name,
                "session_period": row.session_period,
                "arrival_time": row.arrival_time,
                "qty": row.qty,
                "rate": row.rate,
                "amount": row.amount,
                "item_code": row.item_code,
            })

        # Meals
        res_doc.meals = []
        for row in doc.get("meals") or []:
            res_doc.append("meals", {
                "date": row.date,
                "day": row.day,
                "breakfast": row.breakfast,
                "lunch": row.lunch,
                "dinner": row.dinner,
                "meal_type": row.meal_type,
                "qty": row.qty,
                "rate": row.rate,
                "amount": row.amount,
            })

        # Transport
        res_doc.transport_service = []
        for row in doc.get("transport_service") or []:
            res_doc.append("transport_service", {
                "transport_name": row.transport_name,
                "vehicle_name": row.vehicle_name,
                "qty": row.qty,
                "rate": row.rate,
                "amount": row.amount,
            })

        # Hired services (BI field: hired_service → Reservation field: hired_services)
        res_doc.hired_services = []
        for row in doc.get("hired_service") or []:
            res_doc.append("hired_services", {
                "service_name": row.service_name,
                "qty": row.qty,
                "rate": row.rate,
                "amount": row.amount,
            })

        # Tent selection
        res_doc.tent_selection = []
        for row in doc.get("tent_selection") or []:
            res_doc.append("tent_selection", {
                "tent_type": row.tent_type,
                "qty": row.qty,
                "rate": row.rate,
                "amount": row.amount,
            })

        # Room booking (BI field: room_booking → Reservation field: room_type_booking)
        res_doc.room_type_booking = []
        for row in doc.get("room_booking") or []:
            res_doc.append("room_type_booking", {
                "room_type": row.room_type,
                "qty": row.qty,
                "rate": row.rate,
                "amount": row.amount,
            })

        res_doc.save(ignore_permissions=True)

    updated = []
    if quotations:
        updated.append(f"{len(quotations)} Quotation(s)")
    if reservations:
        updated.append(f"{len(reservations)} Reservation(s)")
    if updated:
        frappe.msgprint(f"Auto-updated: {', '.join(updated)}.", alert=True, indicator="green")


@frappe.whitelist()
def propagate_booking_inquiry_amendment(doc, method):
    """When an amended Booking Inquiry is submitted, auto-create a new Quotation
    and propagate key field changes to the existing Reservation chain."""
    if not doc.amended_from:
        return

    # Auto-create a fresh Quotation for the amended inquiry
    try:
        result = create_quotation(doc.name)
        new_quotation = result.get("quotation_name") if result else None
    except Exception as e:
        frappe.log_error(f"Amendment: failed to create quotation for {doc.name}: {e}")
        new_quotation = None

    # Update any Reservation still linked to the old Booking Inquiry (draft state)
    reservations = frappe.get_all(
        "Reservation",
        filters={"booking_inquiry": doc.amended_from},
        fields=["name", "docstatus"]
    )
    for res in reservations:
        update = {
            "booking_inquiry": doc.name,
            "arrival_date": doc.from_date,
            "depature_date": doc.to_date,
            "no_of_people": doc.no_of_people,
            "no_of_adults": doc.no_of_adults,
            "no_of_children": doc.no_of_children,
        }
        if new_quotation:
            update["quotation"] = new_quotation
        frappe.db.set_value("Reservation", res.name, update)

    msg = "Booking Inquiry amended."
    if new_quotation:
        msg += f" New Quotation <b>{new_quotation}</b> created automatically."
    frappe.msgprint(msg, title="Amendment Propagated", indicator="green")


@frappe.whitelist()
def propagate_quotation_amendment(doc, method):
    """When an amended Quotation is submitted, update the linked Reservation to reference the new Quotation."""
    if not doc.amended_from:
        return

    reservations = frappe.get_all(
        "Reservation",
        filters={"quotation": doc.amended_from},
        fields=["name"]
    )
    for res in reservations:
        update = {
            "quotation": doc.name,
        }
        # Also sync key fields from the quotation if available
        if doc.get("custom_arrival_date"):
            update["arrival_date"] = doc.custom_arrival_date
        if doc.get("custom_depature_date"):
            update["depature_date"] = doc.custom_depature_date
        if doc.get("custom_no_of_people"):
            update["no_of_people"] = doc.custom_no_of_people
        if doc.get("custom_no_of_adults"):
            update["no_of_adults"] = doc.custom_no_of_adults
        if doc.get("custom_no_of_children"):
            update["no_of_children"] = doc.custom_no_of_children
        frappe.db.set_value("Reservation", res["name"], update)

    if reservations:
        frappe.msgprint(
            f"Quotation amended. Linked Reservation(s) updated to reference new Quotation <b>{doc.name}</b>.",
            title="Amendment Propagated", indicator="green"
        )


@frappe.whitelist()
def cancel_linked_documents(doc, method):
    """Cancel all documents linked to this Booking Inquiry on cancellation.

    Cancellation order (deepest child first):
      1. Sales Orders (cancelling SO also handles Project via its own hooks)
      2. Reservations
      3. Quotations
    """
    inquiry_name = doc.name

    # Get all reservations linked to this inquiry
    reservations = frappe.get_all(
        "Reservation",
        filters={"booking_inquiry": inquiry_name, "docstatus": 1},
        fields=["name"]
    )

    for res in reservations:
        res_name = res["name"]

        # Step 1: Cancel Sales Orders — cancelling SO handles Project cancellation
        sales_orders = frappe.get_all(
            "Sales Order",
            filters={"custom_reservation": res_name, "docstatus": ["in", [0, 1]]},
            fields=["name", "docstatus"]
        )
        for so in sales_orders:
            if so["docstatus"] == 1:
                so_doc = frappe.get_doc("Sales Order", so["name"])
                so_doc.flags.ignore_links = True
                so_doc.cancel()
            # Clear the reservation link so Frappe won't block the Reservation cancel
            frappe.db.set_value("Sales Order", so["name"], "custom_reservation", None)

        frappe.db.commit()

        # Step 2: Cancel the Reservation
        res_doc = frappe.get_doc("Reservation", res_name)
        res_doc.flags.ignore_links = True
        res_doc.cancel()

    frappe.db.commit()

    # Step 3: Cancel Quotations
    quotations = frappe.get_all(
        "Quotation",
        filters={"custom_booking_inquiry": inquiry_name, "docstatus": 1},
        fields=["name"]
    )
    for qt in quotations:
        qt_doc = frappe.get_doc("Quotation", qt["name"])
        qt_doc.flags.ignore_links = True
        qt_doc.cancel()

    frappe.msgprint(
        "All linked documents (Sales Orders, Reservations, Quotations) have been cancelled.",
        title="Linked Documents Cancelled",
        indicator="blue"
    )
