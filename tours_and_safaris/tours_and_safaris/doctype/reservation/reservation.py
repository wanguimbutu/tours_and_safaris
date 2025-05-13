# Copyright (c) 2025, wanguimbutu and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import getdate, now_datetime,add_days,nowdate,now
from datetime import datetime


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
        "arrival_date": reservation.arrival_date,
        "depature_date": reservation.depature_date,
        "delivery_date": reservation.depature_date,
        "custom_reservation": reservation.name,
        "custom_no_of_people": reservation.no_of_people,
        "custom_no_of_adults": reservation.no_of_adults,
        "custom_no_of_children": reservation.no_of_children,
        "currency": reservation.billing_currency,
        "custom_is_consolidated": reservation.is_consolidated,
        "items": []
    })

    # Check for consolidation
    if reservation.get("is_consolidated"):
        consolidated_amount = reservation.get("consolidated_amount") or 0
        sales_order.append("items", {
            "item_code": "SC-014",
            "item_name": "Multi Activity",
            "description": "Consolidated package for reservation services and activities.",
            "qty": 1,
            "rate": consolidated_amount,
            "prevdoc_docname": reservation.quotation
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
                sales_order.append("items", {
                    "item_code": meals.meal_type,
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
        convert_rates(doc.room_booking)
        convert_rates(doc.meals)
        convert_rates(doc.hired_services)
        convert_rates(doc.transport_service)

        # Update total cost
        doc.proposed_total_cost = sum(
            row.amount for table in [
                doc.activities,
                doc.tent_selection,
                doc.room_booking,
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
        retain_converted_rates(doc.room_booking)
        retain_converted_rates(doc.meals)
        retain_converted_rates(doc.hired_services)
        retain_converted_rates(doc.transport_service)

        
@frappe.whitelist()
def update_calendar_info(doc, method):
    if doc.customer and doc.no_of_people:
        doc.calendar_info = f"{doc.customer} ({doc.no_of_people}) adults:({doc.no_of_adults}) children:({doc.no_of_children})"

@frappe.whitelist()
def reschedule_reservation(reservation_name, new_start_date, new_end_date, reason=None):

    original = frappe.get_doc("Reservation", reservation_name)

    if original.status != "Confirmed Reservation":
        frappe.throw("Only confirmed reservations can be rescheduled.")

    original.status = "Rescheduled"
    original.rescheduled_on = now()
    original.reschedule_reason = reason
    original.save()

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

    new_res = frappe.copy_doc(original)
    new_res.name = None
    new_res.status = "Confirmed Reservation"
    new_res.start_date = new_start_date
    new_res.end_date = new_end_date
    new_res.original_reservation = reservation_name
    new_res.rescheduled_on = None
    new_res.reschedule_reason = None
    new_res.flags.ignore_permissions = True
    new_res.insert()

    amended_so = frappe.copy_doc(sales_order)
    amended_so.name = None
    amended_so.amended_from = sales_order.name
    amended_so.docstatus = 0
    amended_so.custom_reservation = new_res.name
    amended_so.arrival_date = new_start_date
    amended_so.depature_date = new_end_date
    amended_so.delivery_date = new_start_date
    amended_so.flags.ignore_permissions = True
    amended_so.insert()
    amended_so.submit()

    return amended_so.name
