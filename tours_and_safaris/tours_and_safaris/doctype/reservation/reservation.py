# Copyright (c) 2025, wanguimbutu and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import getdate, now_datetime

class Reservation(Document):
    def on_submit(self):
        """Create an availability record when a reservation is submitted."""
    
        if not self.room_booking and not self.tent_selection:
            frappe.msgprint("Warning: No accommodation selected for this reservation.")  # Soft warning
    
    # Process rooms
        for room in self.get("room_booking", []):
            self.create_availability_record(room, "Room")

    # Process tents
        for tent in self.get("tent_selection", []):
            self.create_availability_record(tent, "Tent")

    def create_availability_record(self, accommodation, acc_type):
        acc_name = accommodation.get("room_name") if acc_type == "Room" else accommodation.get("tent_type")
    
        frappe.logger().info(f"Creating availability for {acc_type}: {acc_name}")

        availability = frappe.get_doc({
            "doctype": "Availability",
            "room_name" if acc_type == "Room" else "tent_type": acc_name,
            "arrival_date": self.arrival_date,
            "depature_date": self.depature_date,
            "status": "Reserved",
            "reservation": self.name
        })
    
        availability.insert()
        availability.submit()
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
        "custom_arrival_date": reservation.arrival_date,
        "custom_depature_date": reservation.depature_date,
        "custom_reservation": reservation.name,
        "custom_no_of_people": reservation.no_of_people,
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
                    "date": ["between", [doc.arrival_date, doc.depature_date]]
                },
                fields=["name"]
            )

            
            for record in availability_records:
                availability_doc = frappe.get_doc("Availability", record.name)
                availability_doc.status = room_status
                availability_doc.save()
                availability_doc.submit()
                frappe.db.commit()  
@frappe.whitelist()
def get_check_in_status(reservation_name):
    """Check if the reservation has been checked in and return its status"""
    check_in = frappe.db.exists("Check In", {"reservation": reservation_name})
    check_out = frappe.db.exists("Check Out Log", {"reservation": reservation_name})
    
    return {"checked_in": bool(check_in), "checked_out": bool(check_out)}


@frappe.whitelist()
def create_check_in(reservation_name):
    """Handles check-in process."""
    reservation = frappe.get_doc("Reservation", reservation_name)
    
    check_in = frappe.get_doc({
        "doctype": "Check In",
        "reservation": reservation.name,
        "customer_name": reservation.customer_name,
        "check_in_time": now_datetime(),
        "room_details": reservation.room_booking
    })
    
    check_in.insert()
    check_in.submit()

    # Update room status to "Occupied"
    for room in reservation.room_booking:
        frappe.db.set_value("Rooms", room.room_name, "status", "Occupied")
    
    reservation.checked_in = 1
    reservation.save()
    frappe.db.commit()
    
    return check_in.name

@frappe.whitelist()
def create_check_out(reservation_name):
    """Handles check-out process and triggers maintenance logs."""
    reservation = frappe.get_doc("Reservation", reservation_name)
    
    check_out = frappe.get_doc({
        "doctype": "Check Out Log",
        "reservation": reservation.name,
        "customer_name": reservation.customer_name,
        "check_out_time": now_datetime(),
       # "room_details": reservation.room_booking
    })
    
    check_out.insert()
    check_out.submit()

    # Create Maintenance Logs
    for room in reservation.room_booking:
        maintenance_log = frappe.get_doc({
            "doctype": "Maintenance Log",
            "room_name": room.room_name,
            "maintenance_date": now_datetime(),
            "description": "Routine cleaning after check-out",
            "status": "Pending"
        })
        maintenance_log.insert()

    # Mark reservation as checked out
    reservation.checked_out = 1
    reservation.save()
    frappe.db.commit()
    
    return check_out.name

@frappe.whitelist()
def get_available_rooms(arrival_date, depature_date, room_type=None):
    """Fetch rooms that are NOT booked for the selected date range."""
    arrival_date, depature_date = getdate(arrival_date), getdate(depature_date)

    # Get all booked rooms for the selected period
    booked_rooms = frappe.get_all(
        "Availability",
        filters={
            "status": "Booked",
            "arrival_date": ["<=", depature_date],
            "depature_date": [">=", arrival_date]
        },
        fields=["room_name"]
    )

    booked_room_names = {room["room_name"] for room in booked_rooms}

    # Fetch all available rooms of the given type
    filters = {"status": "Available"}
    if room_type:
        filters["room_type"] = room_type

    available_rooms = frappe.get_all("Rooms", filters=filters, fields=["room_number", "capacity", "base_price"])

    return [room for room in available_rooms if room["room_number"] not in booked_room_names]


@frappe.whitelist()
def add_room_to_calendar(reservation_name, room_name, arrival_date, depature_date):
    """Adds a room to the availability calendar as Reserved."""
    reservation = frappe.get_doc("Reservation", reservation_name)

    for date in frappe.utils.date_range(arrival_date, depature_date):
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
def complete_maintenance(maintenance_log_name):
    """Marks maintenance as completed and makes the room available."""
    maintenance_log = frappe.get_doc("Maintenance Log", maintenance_log_name)
    
    if maintenance_log.status != "Pending":
        frappe.throw("Maintenance log must be in Pending status to complete.")

    maintenance_log.status = "Completed"
    maintenance_log.submit()

    # Update room status to Available
    frappe.db.set_value("Rooms", maintenance_log.room_name, "status", "Available")

    # Check if all rooms in the reservation are cleaned
    reservation = frappe.get_doc("Reservation", maintenance_log.reservation)
    all_rooms_cleaned = all(
        frappe.db.get_value("Rooms", room.room_name, "status") == "Available"
        for room in reservation.room_booking
    )

    if all_rooms_cleaned:
        reservation.status = "Completed"
        reservation.save()
    
    frappe.db.commit()

    return {"message": "Maintenance completed, room is now available for booking."}