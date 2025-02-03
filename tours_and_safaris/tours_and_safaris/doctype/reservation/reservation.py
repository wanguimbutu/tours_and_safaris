# Copyright (c) 2025, wanguimbutu and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

class Reservation(Document):
    pass 

@frappe.whitelist()
def calculate_total_cost(reservation_name):
    """Calculate the total cost of a reservation, including accommodation, activities, and transport."""
    
    # Check if the reservation exists before proceeding
    if not frappe.db.exists("Reservation", reservation_name):
        return 0  # Return 0 cost instead of throwing an error for new documents

    reservation = frappe.get_doc("Reservation", reservation_name)
    total_cost = 0
    accommodation_cost = 0
    has_watersports = False

    # Check if any selected activity belongs to the "Water Sports" category
    if reservation.activities:
        for activity in reservation.activities:
            activity_category = frappe.get_value("Activity", activity.activity_name, "category")
            if activity_category == "Water Sports":
                has_watersports = True

    # Calculate accommodation costs
    if reservation.room_booking:
        accommodation_cost += sum(room.price for room in reservation.room_booking)

    if reservation.tent_selection:
        accommodation_cost += sum(tent.qty * tent.price for tent in reservation.tent_selection)

    # Apply discount if Water Sports activity is selected
    if has_watersports:
        accommodation_cost *= 0.5  # 50% discount on accommodation

    # Calculate transport costs
    if reservation.transport:
        total_cost += sum(transport.price for transport in reservation.transport)

    # Add everything together
    total_cost += accommodation_cost

    return total_cost

@frappe.whitelist()
def create_quotation(reservation_name):
    """Generate a quotation for a reservation."""
    reservation = frappe.get_doc("Reservation", reservation_name)
    
    if not reservation.customer_name:
        frappe.throw("Please ensure the Customer Name field is filled in the Reservation.")

    # Check if a quotation already exists and is submitted
    existing_quotation = frappe.get_all("Quotation", filters={"custom_reservation": reservation_name, "docstatus": 1}, fields=["name"])
    
    if existing_quotation:
        frappe.throw("A quotation has already been created and submitted for this reservation.")

    # Proceed with creating a new quotation
    quotation = frappe.get_doc({
        "doctype": "Quotation",
        "customer": reservation.customer_name,
        "custom_check_in_date": reservation.check_in_date,
        "custom_check_out_date": reservation.check_out_date,
        "custom_reservation": reservation.name,
        "items": []
    })

    # Add activities
    if reservation.activities:
        for activity in reservation.activities:
            quotation.append("items", {
                "item_code": "ACTIVITY",
                "item_name": activity.activity_name,
                "qty": 1,  # Default to 1 if no quantity is specified
                "rate": activity.cost or 0
            })

    # Add room bookings
    if reservation.room_booking:
        for room in reservation.room_booking:
            quotation.append("items", {
                "item_code": "ACCOMMODATION",
                "item_name": room.room_name or "Room",
                "description": f"Room Booking: {room.room_name or 'N/A'}",
                "qty": 1,
                "rate": room.price or 0
            })

    # Add tent selections
    if reservation.tent_selection:
        for tent in reservation.tent_selection:
            quotation.append("items", {
                "item_code": "ACCOMMODATION",
                "item_name": tent.tent_type or "Tent",
                "description": f"Tent: {tent.tent_type or 'N/A'}",
                "qty": tent.qty or 1,
                "rate": tent.price or 0
            })

    # Add transport costs
    if reservation.transport:
        for transport in reservation.transport:
            quotation.append("items", {
                "item_code": "TRANSPORT",
                "item_name": transport.transort_name or "Transport",
                "qty": 1,
                "rate": transport.price or 0
            })

    # Save the quotation as a draft (not submitted)
    quotation.insert(ignore_permissions=True)
    
    # Return the newly created quotation name
    return quotation.name
