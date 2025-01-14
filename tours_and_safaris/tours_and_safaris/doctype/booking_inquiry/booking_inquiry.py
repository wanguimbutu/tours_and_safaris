# Copyright (c) 2025, wanguimbutu and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

class BookingInquiry(Document):
    def on_submit(self):
        
        self.create_calendar_event()

    def create_calendar_event(self):
        try:
            
            event = frappe.get_doc({
                "doctype": "Event",
                "subject": f"Booking: {self.customer_name} ({self.name})",
                "starts_on": self.check_in_date,
                "ends_on": self.check_out_date,
                "event_type": "Public",  
                "description": (
                    f"Booking for {self.customer_name} from {self.check_in_date} "
                    f"to {self.check_out_date}. Booking Inquiry: {self.name}"
                ),
                "all_day": True, 
                "custom_booking_inquiry": self.name,  # Link the event to the Booking Inquiry``
            })
            
            # Save the event
            event.insert(ignore_permissions=True)
            frappe.db.commit()  

        except Exception as e:
            
            frappe.log_error(
                message=f"Failed to create calendar event for Booking Inquiry {self.name}. Error: {str(e)}",
                title="Calendar Event Creation Failed"
            )
           
            frappe.throw(
                f"An error occurred while creating the calendar event. Please contact support. Error: {str(e)}"
            )
