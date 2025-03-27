// Copyright (c) 2025, wanguimbutu and contributors
// For license information, please see license.txt

frappe.ui.form.on("Activity Allocation Details", {
    after_save: function(frm) {
        if (frm.doc.docstatus === 1 && frm.doc.task) {  // Ensure it's submitted
            frappe.call({
                method: "frappe.client.set_value",
                args: {
                    doctype: "Task",
                    name: frm.doc.task,
                    fieldname: "status",
                    value: "Completed"
                },
                callback: function(response) {
                    frappe.msgprint(`Task ${frm.doc.task} has been marked as Completed.`);
                }
            });
        }
    },

    activity_name: function (frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        if (!row.activity_name) {
            return;
        }

        frappe.call({
            method: "tours_and_safaris.tours_and_safaris.doctype.activity_allocation.activity_allocation.get_instructors",
            args: { activity_name: row.activity_name },
            callback: function (response) {
                console.log("Instructor Response:", response.message); 

                if (response.message && response.message.length > 0) {
                    let instructorOptions = response.message.map(
                        inst => `${inst.instructor} (${inst.qualification || "No Qualification"})`
                    );

                    let d = new frappe.ui.Dialog({
                        title: "Select Instructor",
                        fields: [
                            {
                                fieldtype: "Select",
                                label: "Instructor",
                                fieldname: "selected_instructor",
                                options: ["Select Instructor"].concat(instructorOptions)
                            }
                        ],
                        primary_action_label: "Select",
                        primary_action(values) {
                            if (values.selected_instructor) {
                                let selectedInstructor = response.message.find(inst => 
                                    values.selected_instructor.startsWith(inst.instructor)
                                );

                                if (selectedInstructor) {
                                    frappe.model.set_value(cdt, cdn, "instructor", selectedInstructor.instructor);
                                    frappe.model.set_value(cdt, cdn, "qualification", selectedInstructor.qualification || "Not Specified");
                                }

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
            }
        });
    },
        
    session: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn]; 

        if (row.session === "PER SESSION") {
            frappe.model.set_value(cdt, cdn, "start_time", "");
            frappe.model.set_value(cdt, cdn, "end_time", ""); 
            frappe.model.set_df_property("start_time", "read_only", 1);
            frappe.model.set_df_property("end_time", "read_only", 1);
        } else {
            frappe.model.set_df_property("start_time", "read_only", 0);
            frappe.model.set_df_property("end_time", "read_only", 0);
        }
        
        frm.refresh_field("activity_allocation_details"); 
    }
});

