# Copyright (c) 2025, wanguimbutu and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class Instructor(Document):
	def before_insert(self):
		if not self.position:
			self.position = str(get_next_position())


def get_next_position():
	"""Next free slot after the highest numeric position (used to order instructors in Guide Allocation)."""
	last = frappe.db.sql(
		"""
		select max(cast(position as unsigned))
		from `tabInstructor`
		where position regexp '^[0-9]+$'
		"""
	)[0][0]
	return (last or 0) + 1
