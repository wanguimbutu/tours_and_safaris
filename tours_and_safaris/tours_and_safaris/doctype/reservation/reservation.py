# Copyright (c) 2025, wanguimbutu and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime

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
            # Get the category of the activity
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

    # Add accommodation cost to the total cost
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
    
    if reservation.hired_services:
        for service in reservation.hired_services:
            quotation.append("items", {
                "item_code": "SERVICE",
                "item_name": service.service_name or "Service",
                "qty": 1,
                "rate": service.price or 0
            })

    # Save the quotation as a draft (not submitted)
    quotation.insert(ignore_permissions=True)
    
    # Return the newly created quotation name
    return quotation.name

@frappe.whitelist()
def update_room_availability(doc, method=None):
    """Update room availability status based on reservation status."""
    
    if not doc.room_booking:
        return  # Exit if no rooms are booked

    room_status = None
    if doc.status == "Reserved":
        room_status = "Reserved"
    elif doc.status == "Confirmed Reservation":
        room_status = "Booked"

    if room_status:
        for room in doc.room_booking:
            # Find availability records for the room in the given date range
            availability_records = frappe.get_all(
                "Availability",
                filters={
                    "room": room.room_number,  # Ensure this matches your field name in Availability
                    "date": ["between", [doc.check_in_date, doc.check_out_date]]
                },
                fields=["name"]
            )

            # Update each found availability record
            for record in availability_records:
                availability_doc = frappe.get_doc("Availability", record.name)
                availability_doc.status = room_status
                availability_doc.save()
                frappe.db.commit()  # Ensure changes persist in the database

@frappe.whitelist()
def create_check_in(reservation_name):
    """Creates a Check-In document for the reservation."""
    
    reservation = frappe.get_doc("Reservation", reservation_name)
    
    check_in = frappe.get_doc({
        "doctype": "Check In",
        "reservation": reservation.name,
        "customer_name": reservation.customer_name,
        "check_in_time": now_datetime(),
        "room_details": reservation.room_booking
    })
    
    check_in.insert()
    
    # Mark reservation as checked in
    reservation.checked_in = 1
    reservation.save()
    
    frappe.db.commit()
    
    return check_in.name

@frappe.whitelist()
def create_check_out(reservation_name):
    """Creates a Check-Out document and a Maintenance Log for the reservation."""
    
    reservation = frappe.get_doc("Reservation", reservation_name)
    
    check_out = frappe.get_doc({
        "doctype": "Check Out Log",
        "reservation": reservation.name,
        "customer_name": reservation.customer_name,
        "check_out_datetime": now_datetime(),
        "room_details": reservation.room_booking
    })
    
    check_out.insert()
    
    # Create Maintenance Log for each room
    for room in reservation.room_booking:
        maintenance_log = frappe.get_doc({
            "doctype": "Maintenance Log",
            "room": room.room_number,
            "maintenance_date": now_datetime(),
            "description": "Routine maintenance after guest check-out"
            
        })
        maintenance_log.insert()
    
    # Mark reservation as checked out
    reservation.checked_out = 1
    reservation.save()
    
    frappe.db.commit()
    
    return check_out.name
