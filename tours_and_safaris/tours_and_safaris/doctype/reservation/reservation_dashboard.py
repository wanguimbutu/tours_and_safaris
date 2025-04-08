from frappe import _

def get_data(data=None):
    return {
        "fieldname": "name", 
        "non_standard_fieldnames": {
            "Sales Order": "custom_reservation",  # Custom link field in Quotation
            #"Quotation": "booking_inquiry",       # Field from previous step
        },
        "transactions": [
            {
                "label": _("Linked Documents"),
                "items": ["Sales Order"]
            }
        ]
    }
