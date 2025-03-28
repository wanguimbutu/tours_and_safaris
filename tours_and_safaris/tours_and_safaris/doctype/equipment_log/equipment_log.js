// Copyright (c) 2025, wanguimbutu and contributors
// For license information, please see license.txt

frappe.ui.form.on("Equipment Log", {
    after_save: function(frm) {
        if (frm.doc.task_name) {
            frappe.call({
                method: "frappe.client.set_value",
                args: {
                    doctype: "Task",
                    name: frm.doc.task_name,
                    fieldname: "status",
                    value: "Completed"
                },
                callback: function(response) {
                    if (!response.exc) {
                        frappe.show_alert({message: "Task marked as Working", indicator: "green"});
                    }
                }
            });
        }
    }
});
