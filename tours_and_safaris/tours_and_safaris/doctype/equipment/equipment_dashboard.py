from frappe import _

def get_data(data=None):
    return {
        "fieldname": "name", 
        "non_standard_fieldnames": {
            "Equipment Log": "equipment_name",  
        },
        "transactions": [
            {
                "label": _("Linked Documents"),
                "items": ["Equipment Log"]
            }
        ]
    }
