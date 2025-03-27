// Copyright (c) 2025, wanguimbutu and contributors
// For license information, please see license.txt

frappe.ui.form.on("Activity Allocation", {
    on_submit: function(frm) {
        console.log("🔹 Activity Allocation Submitted:", frm.doc.name); // ✅ Log submission

        if (!frm.doc.task) {
            frappe.msgprint(__("No associated task found."));
            console.warn("⚠️ No associated Task found in Activity Allocation.");
            return;
        }

        console.log("✅ Task Found:", frm.doc.task); // ✅ Log found Task

        // ✅ Mark the Task as Completed
        frappe.call({
            method: "frappe.client.set_value",
            args: {
                doctype: "Task",
                name: frm.doc.task,
                fieldname: {
                    status: "Completed",
                    completed_on: frappe.datetime.get_today(),
                    completed_by: frappe.session.user
                }
            },
            callback: function(response) {
                if (response.message) {
                    console.log("✅ Task marked as Completed:", frm.doc.task);
                    frappe.msgprint(__("Task marked as completed."));

                    // ✅ Now check if Parent Task should be marked as completed
                    check_parent_task_completion(frm.doc.task);
                } else {
                    frappe.msgprint(__("Failed to update task."));
                    console.error("❌ Error: Could not mark task as completed:", response);
                }
            },
            error: function(err) {
                console.error("❌ API Call Failed when updating Task:", err);
            }
        });
    }
});


function check_parent_task_completion(task_name) {
    console.log("🔹 Checking Parent Task for:", task_name); // ✅ Log task being checked

    frappe.call({
        method: "frappe.client.get_value",
        args: {
            doctype: "Task",
            filters: { name: task_name },
            fieldname: "parent_task"
        },
        callback: function(response) {
            if (response.message && response.message.parent_task) {
                let parent_task = response.message.parent_task;
                console.log("✅ Parent Task Found:", parent_task); // ✅ Log Parent Task

                // ✅ Check if all subtasks are completed
                frappe.call({
                    method: "frappe.client.get_list",
                    args: {
                        doctype: "Task",
                        filters: { parent_task: parent_task, status: ["!=", "Completed"] },
                        fields: ["name"]
                    },
                    callback: function(r) {
                        if (r.message.length === 0) { 
                            // ✅ All subtasks are completed → Mark Parent Task as Completed
                            console.log("✅ All Subtasks Completed. Updating Parent Task:", parent_task);
                            frappe.call({
                                method: "frappe.client.set_value",
                                args: {
                                    doctype: "Task",
                                    name: parent_task,
                                    fieldname: {
                                        status: "Completed",
                                        completed_on: frappe.datetime.get_today(),
                                        completed_by: frappe.session.user
                                    }
                                },
                                callback: function(response) {
                                    if (response.message) {
                                        console.log("✅ Parent Task marked as Completed:", parent_task);
                                        frappe.msgprint(__("Parent task marked as completed."));
                                    } else {
                                        console.error("❌ Failed to update Parent Task:", response);
                                    }
                                },
                                error: function(err) {
                                    console.error("❌ API Call Failed when updating Parent Task:", err);
                                }
                            });
                        } else {
                            console.log("🔸 Some subtasks are still pending. Parent Task NOT updated.");
                        }
                    },
                    error: function(err) {
                        console.error("❌ Error fetching Subtasks:", err);
                    }
                });
            } else {
                console.log("🔸 No Parent Task Found. No further action needed.");
            }
        },
        error: function(err) {
            console.error("❌ Error fetching Parent Task:", err);
        }
    });
}


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
});

