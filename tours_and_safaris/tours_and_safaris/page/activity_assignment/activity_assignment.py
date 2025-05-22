import frappe

@frappe.whitelist()
def submit_activity_allocation(name):
    doc = frappe.get_doc("Activity Allocation", name)
    if doc.docstatus == 0:
        doc.submit()
        return {"message": f"{name} submitted successfully."}
    else:
        return {"message": f"{name} is already submitted."}
