from frappe import _

def get_data(data=None):
    return {
        "fieldname": "name",  # Primary key of Booking Inquiry
        "non_standard_fieldnames": {
            "Quotation": "custom_booking_inquiry",  # Custom link field in Quotation
            "Reservation": "booking_inquiry",       # Field from previous step
        },
        "transactions": [
            {
                "label": _("Linked Documents"),
                "items": ["Quotation", "Reservation"]
            }
        ]
    }
