# Copyright (c) 2025, wanguimbutu and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class Equipment(Document):
	def validate(self):
		equipment_count = len(self.equipment_details)
		if self.no_of_equipment != equipment_count:
			if equipment_count > self.no_of_equipment:
				message = f"You have added more equipment details ({equipment_count}) than the number set ({self.no_of_equipment})."
			else:
				message = f"You have added fewer equipment details ({equipment_count}) than the number set ({self.no_of_equipment})."
			frappe.throw(message)

	pass

