# Copyright (c) 2025, wanguimbutu and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt, getdate, now_datetime,add_days,nowdate,now
from datetime import datetime
from frappe.desk.calendar import get_events as original_get_events
import json

class Reservation(Document):
    pass

@frappe.whitelist()
def calculate_total_cost(reservation_name):
    """Calculate the total cost of a reservation, including accommodation, activities, and transport."""
    
    # Check if the reservation exists
    if not frappe.db.exists("Reservation", reservation_name):
        return 0  

    reservation = frappe.get_doc("Reservation", reservation_name)
    total_cost = 0
    accommodation_cost = 0
    has_watersports = False

    # Check if any selected activity belongs to the "Water Sports" category
    if reservation.activities:
        for activity in reservation.activities:
            # Get the category of the activity
            activity_category = frappe.get_value("Activity", activity.activity_name, "category")
            if activity_category == "Water Activities":
                has_watersports = True

    # Calculate accommodation costs
    if reservation.room_type_booking:
        accommodation_cost += sum(room.rate for room in reservation.room_type_booking)

    if reservation.tent_selection:
        accommodation_cost += sum(tent.qty * tent.price for tent in reservation.tent_selection)


    if has_watersports:
        accommodation_cost *= 0.5  # Apply a 50% discount

    # Calculate transport costs
    if reservation.transport:
        total_cost += sum(transport.price for transport in reservation.transport)

    total_cost += accommodation_cost

    return total_cost

@frappe.whitelist()
def create_sales_order(reservation_name):
    """Generate a sales order for a reservation."""
    reservation = frappe.get_doc("Reservation", reservation_name)
    
    if not reservation.customer_name:
        frappe.throw("Please ensure the Customer Name field is filled in the Reservation.")

    # Check if a sales order already exists and is submitted
    existing_sales_order = frappe.get_all("Sales Order", filters={"custom_reservation": reservation_name, "docstatus": 1}, fields=["name"])
    
    if existing_sales_order:
        frappe.throw("A sales order has already been created and submitted for this reservation.")

    # Create the Sales Order document
    sales_order = frappe.get_doc({
        "doctype": "Sales Order",
        "customer": reservation.customer_name,
        "transaction_date": reservation.arrival_date,
        "arrival_date": reservation.arrival_date,
        "depature_date": reservation.depature_date,
        "delivery_date": reservation.depature_date,
        "custom_reservation": reservation.name,
        "custom_no_of_people": reservation.no_of_people,
        "custom_no_of_adults": reservation.no_of_adults,
        "custom_no_of_children": reservation.no_of_children,
        "currency": reservation.billing_currency,
        "custom_is_consolidated": reservation.is_consolidated,
        "custom_grade":reservation.grade,
        "custom_is_meals_at_camp":reservation.is_meals_at_camp,
        "items": []
    })

    # Check for consolidation
    if reservation.get("is_consolidated"):
        activity = reservation.activities[0] if reservation.activities else None

        if activity:
            sales_order.append("items", {
                "item_code": activity.item_code or "SC-014",
                "item_name": activity.activity_name or "Multi Activity",
                "qty": activity.qty or 1,
                "rate": activity.rate or 0,
                "delivery_date": reservation.depature_date,

            })
    else:
        # Add activities
        if reservation.activities:
            for activity in reservation.activities:
                sales_order.append("items", {
                    "item_code": activity.item_code,
                    "item_name": activity.activity_name,
                    "qty": activity.qty,  
                    "rate": activity.rate or 0,
                    "prevdoc_docname": reservation.quotation
                })

        # Add room bookings
        if reservation.room_type_booking:
            for room in reservation.room_type_booking:
                sales_order.append("items", {
                    "item_code": room.room_type,
                    "item_name": room.room_type_name or "Room",
                    "description": f"Room Booking: {room.room_type or 'N/A'}",
                    "qty": room.qty or 1,
                    "rate": room.rate or 0,
                    "prevdoc_docname": reservation.quotation
                })

        # Add tent selections
        if reservation.tent_selection:
            for tent in reservation.tent_selection:
                sales_order.append("items", {
                    "item_code": tent.tent_type,
                    "item_name": tent.tent_type or "Tent",
                    "description": f"Tent: {tent.tent_type or 'N/A'}",
                    "qty": tent.qty or 1,
                    "rate": tent.rate or 0,
                    "prevdoc_docname": reservation.quotation
                })

        # Add transport services
        if reservation.transport_service:
            for transport in reservation.transport_service:
                sales_order.append("items", {
                    "item_code": transport.transport_name,
                    "item_name": transport.item_name,
                    "qty": transport.qty,
                    "rate": transport.rate or 0,
                    "prevdoc_docname": reservation.quotation
                })

        # Add hired services
        if reservation.hired_services:
            for service in reservation.hired_services:
                sales_order.append("items", {
                    "item_code": service.service_name,
                    "item_name": service.name or "Service",
                    "qty": service.qty,
                    "rate": service.rate or 0,
                    "prevdoc_docname": reservation.quotation
                })

        # Add meals
        if reservation.meals:
            for meals in reservation.meals:
                if not meals.meal_type:
                    continue
                sessions = [s for s, flag in [("Breakfast", meals.breakfast), ("Lunch", meals.lunch), ("Dinner", meals.dinner)] if flag]
                session_label = ", ".join(sessions) if sessions else ""
                day_label = f"{meals.day} {frappe.utils.formatdate(meals.date)}" if meals.date else ""
                description = " - ".join(filter(None, [day_label, session_label]))
                sales_order.append("items", {
                    "item_code": meals.meal_type,
                    "description": description,
                    "qty": meals.qty or 1,
                    "rate": meals.rate or 0,
                    "prevdoc_docname": reservation.quotation
                })

    sales_order.insert(ignore_permissions=True)

    return {"sales_order_name": sales_order.name, "url": f"/app/sales-order/{sales_order.name}"}




@frappe.whitelist()
def apply_exchange_rate_conversion(doc, method):
    """Ensure exchange rate conversion applies only once before inserting."""
    
    # If already converted, do nothing
    if doc.get("exchange_applied"):  
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
       # convert_rates(doc.room_booking)
        convert_rates(doc.meals)
        convert_rates(doc.hired_services)
        convert_rates(doc.transport_service)

        # Update total cost
        doc.proposed_total_cost = sum(
            row.amount for table in [
                doc.activities,
                doc.tent_selection,
               # doc.room_booking,
                doc.meals,
                doc.hired_services,
                doc.transport_service
            ] for row in table if hasattr(row, "amount")
        )

        # Mark as converted to prevent double conversion
        doc.exchange_applied = True  
        

@frappe.whitelist()
def prevent_rate_reset(doc, method):
    """Ensure that converted rates are retained before submission."""
    if doc.billing_currency and doc.billing_currency != "KES":

        def retain_converted_rates(rows):
            for row in rows:
            
                if row.get("converted_rate"):
                    row.rate = row.converted_rate
                    row.currency = doc.billing_currency  

        retain_converted_rates(doc.activities)
        retain_converted_rates(doc.tent_selection)
       # retain_converted_rates(doc.room_booking)
        retain_converted_rates(doc.meals)
        retain_converted_rates(doc.hired_services)
        retain_converted_rates(doc.transport_service)

        
@frappe.whitelist()
def update_calendar_info(doc, method):
    if doc.customer and doc.no_of_people:
        doc.calendar_info = f"{doc.customer} ({doc.no_of_people}) adults:({doc.no_of_adults}) children:({doc.no_of_children})"


from frappe.utils import getdate, nowdate, now

@frappe.whitelist()
def reschedule_reservation(reservation_name, new_start_date, new_end_date, no_of_people=None, activities=None, meals=None, reason=None):
    from frappe.utils import getdate, nowdate, now
    import json

    # Parse dates
    new_start = getdate(new_start_date)
    new_end = getdate(new_end_date)
    #today = getdate(nowdate())

    #if new_end <= new_start:
        #frappe.throw("End Date must be after Start Date.")
    #if new_start < today:
        #frappe.throw("Start Date (also used as Delivery Date) cannot be in the past.")

    # Parse tables from JSON
    if activities and isinstance(activities, str):
        activities = json.loads(activities)
    if meals and isinstance(meals, str):
        meals = json.loads(meals)

    # Fetch original reservation
    original = frappe.get_doc("Reservation", reservation_name)

    if original.status != "Confirmed Reservation":
        frappe.throw("Only confirmed reservations can be rescheduled.")

    # Mark original as rescheduled
    original.status = "Rescheduled"
    original.rescheduled_on = now()
    original.reschedule_reason = reason
    original.save()

    # Cancel old sales order
    sales_order = frappe.get_doc("Sales Order", {"custom_reservation": reservation_name})
    if sales_order.docstatus == 1:
        sales_order.cancel()
        if sales_order.project:
            try:
                project = frappe.get_doc("Project", sales_order.project)
                project.status = "Cancelled"
                project.save()
            except Exception as e:
                frappe.log_error(f"Failed to cancel project {sales_order.project}: {str(e)}", "Project Status Update Error")

    # Create new reservation
    new_res = frappe.copy_doc(original)
    new_res.name = None
    new_res.status = "Confirmed Reservation"
    new_res.start_date = new_start
    new_res.end_date = new_end
    new_res.arrival_date = new_start
    new_res.depature_date = new_end
    if no_of_people:
        new_res.no_of_people = no_of_people

    # Replace activities & meals if passed
    if activities is not None:
        new_res.activities = []
        for act in activities:
            qty = flt(act.get("qty") or 0)
            rate = flt(act.get("rate") or 0)
            amount = qty * rate
            new_res.append("activities", {
                "activity_group": act.get("activity_group"),
                "activity_name": act.get("activity_name"),
                "qty": qty,
                "rate": rate,
                "amount": amount
            })
    if meals is not None:
        new_res.meals = []
        for meal in meals:
            qty = flt(meal.get("qty") or 0)
            rate = flt(meal.get("rate") or 0)
            amount = qty * rate
            new_res.append("meals", {
                "meal_type": meal.get("meal_type"),
                "qty": qty,
                "rate": rate,
                "amount": amount
            })

    new_res.original_reservation = reservation_name
    new_res.rescheduled_on = None
    new_res.reschedule_reason = None
    new_res.flags.ignore_permissions = True
    new_res.run_method("calculate_taxes_and_totals")

    new_res.insert()
    new_res.submit()

    so = frappe.get_doc({
        "doctype": "Sales Order",
        "customer": new_res.customer_name,
        "arrival_date": new_res.arrival_date,
        "depature_date": new_res.depature_date,
        "delivery_date": new_res.depature_date,
        "custom_reservation": new_res.name,
        "custom_no_of_people": new_res.no_of_people,
        "custom_no_of_adults": new_res.no_of_adults,
        "custom_no_of_children": new_res.no_of_children,
        "currency": new_res.billing_currency,
        "custom_is_consolidated": new_res.is_consolidated,
        "custom_grade": new_res.grade,
        "custom_is_meals_at_camp": new_res.is_meals_at_camp,
        "items": []
    })

    if new_res.get("is_consolidated"):
        activity = new_res.activities[0] if new_res.activities else None
        if activity:
            so.append("items", {
                "item_code": activity.item_code or "SC-014",
                "item_name": activity.activity_name or "Multi Activity",
                "qty": activity.qty or 1,
                "rate": activity.rate or 0
            })
    else:
        if new_res.activities:
            for activity in new_res.activities:
                so.append("items", {
                    "item_code": activity.item_code,
                    "item_name": activity.activity_name,
                    "qty": activity.qty,
                    "rate": activity.rate or 0,
                    "prevdoc_docname": new_res.quotation
                })

        if new_res.room_type_booking:
            for room in new_res.room_type_booking:
                so.append("items", {
                    "item_code": room.room_type,
                    "item_name": room.room_type_name or "Room",
                    "description": f"Room Booking: {room.room_type or 'N/A'}",
                    "qty": room.qty or 1,
                    "rate": room.rate or 0,
                    "prevdoc_docname": new_res.quotation
                })

        if new_res.tent_selection:
            for tent in new_res.tent_selection:
                so.append("items", {
                    "item_code": tent.tent_type,
                    "item_name": tent.tent_type or "Tent",
                    "description": f"Tent: {tent.tent_type or 'N/A'}",
                    "qty": tent.qty or 1,
                    "rate": tent.rate or 0,
                    "prevdoc_docname": new_res.quotation
                })

        if new_res.transport_service:
            for transport in new_res.transport_service:
                so.append("items", {
                    "item_code": transport.transport_name,
                    "item_name": transport.item_name,
                    "qty": transport.qty,
                    "rate": transport.rate or 0,
                    "prevdoc_docname": new_res.quotation
                })

        if new_res.hired_services:
            for service in new_res.hired_services:
                so.append("items", {
                    "item_code": service.service_name,
                    "item_name": service.name or "Service",
                    "qty": service.qty,
                    "rate": service.rate or 0,
                    "prevdoc_docname": new_res.quotation
                })

        if new_res.meals:
            for meal in new_res.meals:
                if not meal.meal_type:
                    continue
                sessions = [s for s, flag in [("Breakfast", meal.breakfast), ("Lunch", meal.lunch), ("Dinner", meal.dinner)] if flag]
                session_label = ", ".join(sessions) if sessions else ""
                day_label = f"{meal.day} {frappe.utils.formatdate(meal.date)}" if meal.date else ""
                description = " - ".join(filter(None, [day_label, session_label]))
                so.append("items", {
                    "item_code": meal.meal_type,
                    "description": description,
                    "qty": meal.qty or 1,
                    "rate": meal.rate or 0,
                    "prevdoc_docname": new_res.quotation
                })

    so.insert(ignore_permissions=True)
    so.submit()

    return {"new_reservation": new_res.name, "new_sales_order": so.name}

@frappe.whitelist()
def propagate_reservation_amendment(doc, method):
    """When an amended Reservation is submitted, update the linked Sales Order chain."""
    if not doc.amended_from:
        return

    # Cancel the old sales order linked to the original reservation (if still draft)
    old_sales_orders = frappe.get_all(
        "Sales Order",
        filters={"custom_reservation": doc.amended_from, "docstatus": 0},
        fields=["name"]
    )
    for so in old_sales_orders:
        try:
            so_doc = frappe.get_doc("Sales Order", so["name"])
            frappe.db.set_value("Sales Order", so["name"], "custom_reservation", doc.name)
        except Exception as e:
            frappe.log_error(f"Amendment: failed to update SO {so['name']}: {e}")

    # Also update submitted sales orders to point to new reservation
    submitted_sales_orders = frappe.get_all(
        "Sales Order",
        filters={"custom_reservation": doc.amended_from, "docstatus": 1},
        fields=["name"]
    )
    for so in submitted_sales_orders:
        frappe.db.set_value("Sales Order", so["name"], {
            "custom_reservation": doc.name,
            "arrival_date": doc.arrival_date,
            "depature_date": doc.depature_date,
            "custom_no_of_people": doc.no_of_people,
            "custom_no_of_adults": doc.no_of_adults,
            "custom_no_of_children": doc.no_of_children,
        })

    msg = f"Reservation amended from {doc.amended_from}."
    if submitted_sales_orders or old_sales_orders:
        msg += f" Linked Sales Order(s) updated to reference new Reservation <b>{doc.name}</b>."
    frappe.msgprint(msg, title="Amendment Propagated", indicator="green")


@frappe.whitelist()
def propagate_sales_order_amendment(doc, method):
    """When an amended Sales Order is submitted, update the linked Project."""
    if not doc.amended_from:
        return

    projects = frappe.get_all(
        "Project",
        filters={"sales_order": doc.amended_from},
        fields=["name"]
    )
    for proj in projects:
        frappe.db.set_value("Project", proj["name"], "sales_order", doc.name)

    if projects:
        frappe.msgprint(
            f"Sales Order amended. Linked Project(s) updated to reference new Sales Order <b>{doc.name}</b>.",
            title="Amendment Propagated", indicator="green"
        )


@frappe.whitelist()
def get_events(start, end, filters=None):
    from frappe.utils import getdate

    start, end = getdate(start), getdate(end)

    # Exclude rescheduled and cancelled documents
    conditions = ["r.status != 'Rescheduled'", "r.docstatus != 2"]
    params = {"start": start, "end": end}

    # Handle dynamic filters safely
    if filters:
        filters = frappe.parse_json(filters)
        if isinstance(filters, dict):
            for key, value in filters.items():
                conditions.append(f"r.`{key}` = %(f_{key})s")
                params[f"f_{key}"] = value

    reservations = frappe.db.sql("""
        SELECT 
            r.name,
            r.calendar_info,
            r.arrival_date,
            r.depature_date,
            r.status,
            r.customer,
            c.custom_color
        FROM 
            `tabReservation` r
        LEFT JOIN 
            `tabCustomer` c ON r.customer = c.customer_name
        WHERE 
            r.arrival_date <= %(end)s
            AND r.depature_date >= %(start)s
            AND {conditions}
    """.format(conditions=" AND ".join(conditions)), params, as_dict=True)

    events = []
    for res in reservations:
        if not res.arrival_date or not res.depature_date:
            continue  

        # Color mapping
        if res.status == "Confirmed Reservation":
            color = res.custom_color if res.custom_color else "#28a745"  # fallback green
        elif res.status == "Pending":
            color = "#f59e0b"  # orange
        elif res.status == "Cancelled":
            color = "#ef4444"  # red
        else:
            color = "#6c757d"  # default gray

        events.append({
            "id": res.name,
            "title": res.calendar_info,
            "start": str(res.arrival_date),
            "end": str(res.depature_date),
            "allDay": True,
            "color": color,
            "url": f"/app/reservation/{res.name}"
        })

    return events
