import frappe


def execute():
    """Older Availability records copied the whole group's calendar_info
    (every room in the allocation). Reset each one to its own customer - room."""
    rows = frappe.db.sql(
        """
        select a.name, a.room_name, coalesce(nullif(a.customer_name, ''), c.customer_name, a.customer) as customer
        from `tabAvailability` a
        left join `tabCustomer` c on c.name = a.customer
        """,
        as_dict=True,
    )
    for row in rows:
        info = " - ".join(filter(None, [row.customer, row.room_name]))
        frappe.db.set_value("Availability", row.name, "calendar_info", info, update_modified=False)
