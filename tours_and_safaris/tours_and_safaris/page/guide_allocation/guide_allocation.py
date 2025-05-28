import frappe

@frappe.whitelist()
def remove_activity_allocation(instructor, activity_date, activity_name):
    """
    Removes an activity allocation detail row matching by instructor, date, and activity_name.
    If the allocation document becomes empty, delete the entire document.
    """
    allocations = frappe.get_all("Activity Allocation", filters={"docstatus": 0}, pluck="name")

    for alloc_name in allocations:
        doc = frappe.get_doc("Activity Allocation", alloc_name)

        for i, row in enumerate(doc.activity_allocation_details):
            if (
                row.instructor.strip() == instructor.strip() and
                str(row.activity_date) == activity_date and
                row.activity_name.strip() == activity_name.strip()
            ):
                doc.activity_allocation_details.pop(i)

                if not doc.activity_allocation_details:
                    doc.delete()
                    return {"status": "deleted", "doc": alloc_name}
                else:
                    doc.save()
                    return {"status": "updated", "doc": alloc_name}

    return {"status": "not_found"}

import frappe
from frappe.model.document import Document
from frappe import _

@frappe.whitelist()
def submit_activity_allocation(name):
    if not name:
        frappe.throw(_("Missing document name"))
    
    doc = frappe.get_doc("Activity Allocation", name)
    if doc.docstatus != 0:
        return {"status": "already_submitted"}
    
    doc.submit()
    return {"status": "submitted", "name": name}
