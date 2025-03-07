// Copyright (c) 2025, wanguimbutu and contributors
// For license information, please see license.txt


frappe.ui.form.on("Instructor Assignment", {
    refresh: function(frm) {
        frm.add_custom_button("Fetch All Instructors", function() {
            frappe.call({
                method: "tours_and_safaris.tours_and_safaris.doctype.instructor_assignment.instructor_assignment.get_all_instructors",
                args: {
                    activity: frm.doc.activity,
                    session_type: frm.doc.session_type
                },
                callback: function(r) {
                    if (r.message) {
                        frm.clear_table("instructor_suggestions");
                        r.message.forEach((row) => {
                            let child = frm.add_child("instructor_suggestions");
                            child.instructor = row.instructor;
                            child.qualification = row.qualification;
                        });
                        frm.refresh_field("instructor_suggestions");
                        frappe.msgprint("Instructor suggestions updated. You can now manually add or remove instructors.");
                    }
                }
            });
        });
    }
});
