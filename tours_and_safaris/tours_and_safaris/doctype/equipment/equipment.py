# Copyright (c) 2025, wanguimbutu and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class Equipment(Document):
    def validate(self):
        # Skip validation if no equipment details are added yet or equipment is not itemized
        if not self.is_itemized:
            return
        
        # Handle itemized equipment: Ensure equipment details match the set quantity
        equipment_count = len(self.equipment_details or [])

        # Only perform validation if `no_of_equipment` is set
        if self.no_of_equipment is not None:
            if equipment_count != self.no_of_equipment:
                if equipment_count > self.no_of_equipment:
                    message = f"You have added more equipment details ({equipment_count}) than the number set ({self.no_of_equipment})."
                else:
                    message = f"You have added fewer equipment details ({equipment_count}) than the number set ({self.no_of_equipment})."
                frappe.throw(message)
        else:
            # If no_of_equipment is None, don't throw an error, but you can warn the user to fill it later
            frappe.msgprint("Please remember to fill the 'No of Equipment' field when finalizing itemized equipment details.")
pass