import frappe
from frappe.model.document import Document
from frappe.utils import now

class Booking(Document):
    def before_submit(self):
        """
        Before submitting a booking, ensure the room is available and update its status to 'Booked'.
        """
        room = frappe.get_doc("Rooms", self.room)

        if room.status != "Available":
            frappe.throw(f"Room {self.room} is not available for booking.")
        
        
        room.status = "Booked"
        room.save()

        frappe.msgprint(f"Room {self.room} has been successfully booked.")

    def on_cancel(self):
        """
        Revert room status to 'Available' when a booking is canceled.
        """
        room = frappe.get_doc("Rooms", self.room)
        room.status = "Available"
        room.save()

        frappe.msgprint(f"Booking for room {self.room} has been canceled. The room is now available.")

@frappe.whitelist()
def check_out(booking_name):
    """
    API to check out a booking and mark the room as 'Under Maintenance'.
    """
    booking = frappe.get_doc("Booking", booking_name)

    if booking.docstatus != 1:
        frappe.throw("Only submitted bookings can be checked out.")
    
    room = frappe.get_doc("Rooms", booking.room)

    if room.status != "Booked":
        frappe.throw(f"Room {booking.room} is not booked and cannot be checked out.")
    
    # Update room status to 'Under Maintenance'
    room.status = "Under Maintenance"
    room.save()

    # Create a maintenance log
    maintenance_log = frappe.get_doc({
        "doctype": "Maintenance Log",
        "room": booking.room,
        "maintenance_date": now(),
        "remarks": f"Room {booking.room} is now under maintenance after checkout."
    })
    maintenance_log.insert()

    frappe.msgprint(f"Checkout for booking {booking_name} is completed. Room {booking.room} is now under maintenance.")

@frappe.whitelist()
def mark_cleaned_for_room(room_name):
    """
    Mark the room as cleaned and available for booking. Update the related maintenance log.
    """
    room = frappe.get_doc("Rooms", room_name)
    
    if room.status != "Under Maintenance":
        frappe.throw(f"Room {room_name} is not under maintenance and cannot be cleaned.")

    # Update room status to 'Available' after cleaning
    room.status = "Available"
    room.save()

    frappe.msgprint(f"Room {room_name} has been cleaned and is now available for booking.")

def on_submit_maintenance_log(doc, method):
    """
    Triggered on submission of a Maintenance Log.
    When a maintenance log is submitted, mark the room as 'Available'.
    """
    if doc.doctype == "Maintenance Log":
        room = frappe.get_doc("Rooms", doc.room)
        room.status = "Available"
        room.save()

        frappe.msgprint(f"Room {doc.room} has been marked as 'Available' after maintenance log submission.")
