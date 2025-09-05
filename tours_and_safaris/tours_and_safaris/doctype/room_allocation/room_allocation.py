import frappe
from frappe.model.document import Document
from frappe import _

class RoomAllocation(Document):
    def on_submit(self):
        for booked_room in self.booked_rooms:
            # Check if this room is already booked in the given date range
            existing = frappe.get_all(
                "Availability",
                filters={
                    "room_name": booked_room.room_name,
                    "check_in_date": ["<", self.departure_date],  
                    "check_out_date": [">", self.arrival_date]   
                },
                limit=1
            )

            if existing:
                frappe.throw(
                    _("Room {0} is already allocated between {1} and {2}. Please choose another room.")
                    .format(booked_room.room_name, self.arrival_date, self.departure_date)
                )

            # If not booked, create the availability record
            availability = frappe.new_doc("Availability")
            availability.room_name = booked_room.room_name  
            availability.room_type = booked_room.room_type  
            availability.reservation = self.reservation     
            availability.check_in_date = self.arrival_date
            availability.check_out_date = self.departure_date
            availability.customer = self.customer
            availability.calendar_info = self.calendar_info
            availability.group_room = f"{self.customer}-{booked_room.room_name}"

            availability.insert(ignore_permissions=True) 
            availability.submit()

@frappe.whitelist()
def get_available_rooms(room_type, check_in_date, check_out_date):
    # get all rooms of this type
    available_rooms = frappe.get_all(
        "Rooms",  
        filters={"room_type": room_type},
        pluck="name"
    )

    # get rooms already booked in the given date range
    # Using proper overlap logic: existing booking overlaps if:
    # existing.check_in < new.check_out AND existing.check_out > new.check_in
    booked_rooms = frappe.get_all(
        "Availability", 
        filters={
            "room_name": ["in", available_rooms],   
            "check_in_date": ["<", check_out_date],  # Changed from <= to <
            "check_out_date": [">", check_in_date]   # Changed from >= to >
        },
        pluck="room_name"
    )

    # final set = all rooms - booked rooms
    final_rooms = list(set(available_rooms) - set(booked_rooms))

    return final_rooms