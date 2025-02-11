# Copyright (c) 2025, wanguimbutu and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime

class Reservation(Document):
    def on_submit(self):
        """Create an availability record when a reservation is submitted."""
        room_bookings = self.get("room_booking", [])
        if not room_bookings:
            frappe.throw("No rooms selected for reservation")

    
        for room in room_bookings:
            self.create_availability_record(room)

    def create_availability_record(self,room):
            
            room_name = room.get("room_name")
            check_in =self.check_in_date
            check_out = self.check_out_date

            frappe.logger("Creating availability for Room {room_name}")

            availability = frappe.get_doc({
                "doctype": "Availability",
                "room_name": room.room_name,  # Ensure field names match
                "check_in_date": self.check_in_date,
                "check_out_date": self.check_out_date,
                "status": "Reserved",  # Default status when booking is confirmed
                "reservation": self.name  # Link to Reservation
            })
            availability.insert()
            frappe.db.commit()

    def on_cancel(self):
        """Remove availability record if reservation is canceled."""
        frappe.db.delete("Availability", {"reservation": self.name})

    def before_save(self):
        """Automatically update no_of_people, no_of_adults, and no_of_children based on guest_details."""
        
        if self.guest_details:
            no_of_people = len(self.guest_details)
            no_of_adults = sum(1 for guest in self.guest_details if int(guest.age) >= 18)
            no_of_children = no_of_people - no_of_adults  # Remaining guests are children
            
            # Overwrite fields
            self.no_of_people = no_of_people
            self.no_of_adults = no_of_adults
            self.no_of_children = no_of_children


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
            if activity_category == "Water Sports":
                has_watersports = True

    # Calculate accommodation costs
    if reservation.room_booking:
        accommodation_cost += sum(room.price for room in reservation.room_booking)

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
                "qty": 1,  
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
                "item_name": transport.transport_name or "Transport",
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

    
    quotation.insert(ignore_permissions=True)
    

    return quotation.name

@frappe.whitelist()
def update_room_availability(doc, method=None):
    """Update room availability status based on reservation status."""
    
    if not doc.room_booking:
        return  

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
                    "room": room.room_number,  
                    "date": ["between", [doc.check_in_date, doc.check_out_date]]
                },
                fields=["name"]
            )

            
            for record in availability_records:
                availability_doc = frappe.get_doc("Availability", record.name)
                availability_doc.status = room_status
                availability_doc.save()
                frappe.db.commit()  

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

@frappe.whitelist()
def get_available_rooms(check_in_date, check_out_date, room_type):
    """Fetch available rooms of a selected type that are not reserved for the given dates."""

    try:
        if not check_in_date or not check_out_date:
            frappe.throw("Check-in and check-out dates are required.")

        check_in_date = frappe.utils.getdate(check_in_date)
        check_out_date = frappe.utils.getdate(check_out_date)

        # Fetch reserved rooms
        reserved_rooms = frappe.get_all(
            "Availability",
            filters={
                "check_in_date": ["<=", check_out_date],  # Overlapping check-in
                "check_out_date": [">=", check_in_date]  # Overlapping check-out
            },
            fields=["room_name", "status"]
        )

        # Convert to dictionary for quick lookup
        reserved_dict = {room["room_name"]: room["status"] for room in reserved_rooms}

        # Fetch all available rooms of selected type
        rooms = frappe.get_all(
            "Rooms",
            filters={"room_type": room_type},
            fields=["room_number", "capacity", "resident_rate", "status"]
        )

        available_rooms = []
        for room in rooms:
            room_status = reserved_dict.get(room["room_number"], "Available")
            available_rooms.append({
                "room_number": room["room_number"],
                "capacity": room["capacity"],
                "resident_rate": room["resident_rate"],
                "status": room_status  # If reserved, show status
            })

        return available_rooms

    except Exception as e:
        frappe.log_error(f"Error in get_available_rooms: {str(e)}", "Room Booking Error")
        frappe.throw("An error occurred while fetching available rooms. Please check the logs.")


@frappe.whitelist()
def add_room_to_calendar(reservation_name, room_name, check_in_date, check_out_date):
    """Adds a room to the availability calendar as Reserved."""
    reservation = frappe.get_doc("Reservation", reservation_name)

    for date in frappe.utils.date_range(check_in_date, check_out_date):
        availability = frappe.get_doc({
            "doctype": "Availability",
            "room": room_name,
            "date": date,
            "status": "Reserved",
            "reservation": reservation_name
        })
        availability.insert()

    frappe.db.commit()

@frappe.whitelist()
def remove_room_from_calendar(reservation_name, room_name):
    """Removes a room from the availability calendar when unselected."""
    frappe.db.delete("Availability", {
        "reservation": reservation_name,
        "room": room_name
    })
    frappe.db.commit()

@frappe.whitelist()
def confirm_room_reservations(reservation_name):
    """Marks reserved rooms as Confirmed Reservation when the reservation is confirmed."""
    frappe.db.sql("""
        UPDATE `tabAvailability`
        SET status = 'Confirmed Reservation'
        WHERE reservation = %s
    """, (reservation_name,))

    frappe.db.commit()

@frappe.whitelist()
def update_availability_status():
    """Update availability status for rooms in a reservation."""

    # Fetch parameters from request
    reservation_id = frappe.form_dict.get("reservation_id")
    status = frappe.form_dict.get("status")

    # Ensure required parameters are provided
    if not reservation_id or not status:
        frappe.throw("Missing required parameters: reservation_id and status")

    # Fetch the reservation document
    reservation = frappe.get_doc("Reservation", reservation_id)

    if not reservation.room_booking:
        frappe.throw("No rooms found for this reservation.")

    for room in reservation.room_booking:
        room_name = room.room_name  # Ensure this field name matches in Room Booking

        availability = frappe.get_all(
            "Availability",
            filters={"room_name": room_name},
            fields=["name", "status"]
        )

        if availability:
            availability_doc = frappe.get_doc("Availability", availability[0].name)
            availability_doc.status = status
            availability_doc.save()
            frappe.db.commit()
            frappe.logger().info(f"Updated Room {room_name} to {status}")
        else:
            frappe.logger().warning(f"No Availability record found for Room {room_name}")

    return {"message": "Room availability updated successfully"}



            
@frappe.whitelist()
def check_in(reservation):
        """Mark room as 'Occupied' on check-in."""
        reservation = frappe.get_doc("Reservation", reservation)

        if not reservation.room_booking:
            frappe.throw("No rooms found for this reservation.")

        for room in reservation.room_booking:
            update_availability_status(room, "Occupied")