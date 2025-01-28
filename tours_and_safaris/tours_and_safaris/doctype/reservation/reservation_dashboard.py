from frappe import _


def get_data():
	return {
		"fieldname": "reservation",
		"non_standard_fieldnames": {
			"Quotation":"custom_reservation"
		},
		
	}
