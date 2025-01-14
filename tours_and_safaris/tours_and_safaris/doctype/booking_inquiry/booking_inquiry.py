# Copyright (c) 2025, wanguimbutu and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

class BookingInquiry(Document):
    def on_submit(self):
       
        self.create_calendar_event()
        
        
        self.prompt_for_kitlist_attachment()

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
                "custom_booking_inquiry": self.name
            })
            event.insert(ignore_permissions=True)
            frappe.db.commit()
        except Exception as e:
            frappe.log_error(
                message=f"Failed to create calendar event for Booking Inquiry {self.name}. Error: {str(e)}",
                title="Calendar Event Creation Failed"
            )
            frappe.throw(f"An error occurred while creating the calendar event. Error: {str(e)}")

    def prompt_for_kitlist_attachment(self):
        # Check if a kit list is already attached
        attachments = frappe.get_all("File", filters={"attached_to_doctype": self.doctype, "attached_to_name": self.name})
        
        if not attachments:
            frappe.msgprint(
                title="Kit List Required",
                msg="Please attach a kit list document to this Booking Inquiry.",
                indicator="orange"
            )
				#notify the user of missing kit list attachment
            frappe.throw("Submission incomplete. Please attach a kit list.")

        # If attachment exists, send it via email
        self.send_kitlist_email()

    def send_kitlist_email(self):
        try:
        
            attachment = frappe.get_all(
                "File",
                filters={"attached_to_doctype": self.doctype, "attached_to_name": self.name},
                fields=["file_url"],
                limit=1
            )[0]

            
            recipient = self.customer_email
            subject = f"Kit List for Your Booking Inquiry {self.name}"
            message = f"""
                Dear {self.customer_name},
                
                Thank you for your booking inquiry. Please find attached the kit list for your reference.
                
                Best regards,
            """
            
            frappe.sendmail(
                recipients=[recipient],
                subject=subject,
                message=message,
                attachments=[{"file_url": attachment.get("file_url")}]
            )
            frappe.msgprint("Kit list has been emailed to the customer.")
        
        except Exception as e:
            frappe.log_error(
                message=f"Failed to send kit list email for Booking Inquiry {self.name}. Error: {str(e)}",
                title="Kit List Email Failed"
            )
            frappe.throw(f"An error occurred while sending the kit list email. Error: {str(e)}")
