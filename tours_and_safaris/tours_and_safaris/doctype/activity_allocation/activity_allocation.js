// Copyright (c) 2025, wanguimbutu and contributors
// For license information, please see license.txt

frappe.ui.form.on("Activity Allocation Details", {
    activity_name: function (frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        if (!row.activity_name) {
            return;
        }

        // Fetch the filtered instructors for the selected activity
        frappe.call({
            method: "tours_and_safaris.tours_and_safaris.doctype.activity_allocation.activity_allocation.get_instructors",
            args: {
                activity_name: row.activity_name
            },
            callback: function (response) {
                if (response.message && response.message.length > 0) {
                    let instructors = response.message;

                    // Create a Dialog with the fetched instructor list
                    let d = new frappe.ui.Dialog({
                        title: "Select Instructor",
                        fields: [
                            {
                                fieldtype: "Select",
                                label: "Instructor",
                                fieldname: "selected_instructor",
                                options: [""].concat(instructors) // Add empty first option
                            }
                        ],
                        primary_action_label: "Select",
                        primary_action(values) {
                            if (values.selected_instructor) {
                                // Set the selected instructor in the child table
                                frappe.model.set_value(cdt, cdn, "instructor", values.selected_instructor);
                                d.hide();
                            } else {
                                frappe.msgprint("Please select an instructor.");
                            }
                        }
                    });

                    d.show();
                } else {
                    frappe.msgprint("No instructors found for this activity.");
                }
            },
            error: function (err) {
                console.error("API Error:", err);
            }
        });
    }
});

