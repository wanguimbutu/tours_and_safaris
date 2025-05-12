# Copyright (c) 2025, wanguimbutu and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe import _

class RoomAllocation(Document):
	pass

class RoomAllocation(Document):
    def on_submit(self):
        for booked_room in self.booked_rooms:
            availability = frappe.new_doc("Availability")
            availability.room_name = booked_room.room_name  
            availability.reservation = self.reservation     
            availability.check_in_date = self.arrival_date
            availability.check_out_date = self.departure_date
            availability.customer = self.customer
            availability.insert(ignore_permissions=True) 
            availability.submit() 
            
pass


@frappe.whitelist()
def get_available_rooms(room_type, check_in_date, check_out_date):
    available_rooms = frappe.get_all(
        "Rooms",  
        filters={
            "room_type": room_type
        },
        pluck="name"
    )

    booked_rooms = frappe.get_all(
        "Availability", 
        filters={
            "room_type": room_type,
            "check_in_date": ["<=", check_out_date], 
            "check_out_date": [">=", check_in_date]   
        },
        pluck="room_name"
    )

    final_rooms = list(set(available_rooms) - set(booked_rooms))

    return final_rooms
