// Copyright (c) 2025, wanguimbutu and contributors
// For license information, please see license.txt

frappe.ui.form.on("Activity Allocation", {
    on_submit: function(frm) {
        console.log("🔹 Activity Allocation Submitted:", frm.doc.name); 

        if (!frm.doc.task) {
            frappe.msgprint(__("No associated task found."));
            console.warn("No associated Task found in Activity Allocation.");
            return;
        }

        console.log("Task Found:", frm.doc.task); 

        
        frappe.call({
            method: "frappe.client.set_value",
            args: {
                doctype: "Task",
                name: frm.doc.task,
                fieldname: {
                    status: "Working",
                    //completed_on: frappe.datetime.get_today(),
                    //completed_by: frappe.session.user
                }
            },
            callback: function(response) {
                if (response.message) {
                    console.log(" Task marked as Working:", frm.doc.task);
                    frappe.msgprint(__("Task marked as working."));

                    
                    check_parent_task_completion(frm.doc.task);
                } else {
                    frappe.msgprint(__("Failed to update task."));
                    console.error(" Error: Could not mark task as working:", response);
                }
            },
            error: function(err) {
                console.error(" API Call Failed when updating Task:", err);
            }
        });
    }
});


function check_parent_task_completion(task_name) {
    console.log("🔹 Checking Parent Task for:", task_name); 

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
                console.log("Parent Task Found:", parent_task); 

                
                frappe.call({
                    method: "frappe.client.get_list",
                    args: {
                        doctype: "Task",
                        filters: { parent_task: parent_task, status: ["!=", "Completed"] },
                        fields: ["name"]
                    },
                    callback: function(r) {
                        if (r.message.length === 0) { 
                    
                            console.log(" All Subtasks Completed. Updating Parent Task:", parent_task);
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
                                        console.log("Parent Task marked as Completed:", parent_task);
                                        frappe.msgprint(__("Parent task marked as completed."));
                                    } else {
                                        console.error(" Failed to update Parent Task:", response);
                                    }
                                },
                                error: function(err) {
                                    console.error("API Call Failed when updating Parent Task:", err);
                                }
                            });
                        } else {
                            console.log("Some subtasks are still pending. Parent Task NOT updated.");
                        }
                    },
                    error: function(err) {
                        console.error("Error fetching Subtasks:", err);
                    }
                });
            } else {
                console.log(" No Parent Task Found. No further action needed.");
            }
        },
        error: function(err) {
            console.error(" Error fetching Parent Task:", err);
        }
    });
}

let safetyDialogOpen = false;
let activityDialogOpen = false;

frappe.ui.form.on("Activity Allocation Details", {
    activity_name: function (frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        if (!row.activity_name || activityDialogOpen) return;

        activityDialogOpen = true;

        frappe.call({
            method: "tours_and_safaris.tours_and_safaris.doctype.activity_allocation.activity_allocation.get_instructors",
            args: { activity_name: row.activity_name },
            callback: function (response) {
                if (response.message && response.message.length > 0) {
                    let options = response.message.map(inst => ({
                        label: `${inst.instructor} (${inst.qualification || "No Qualification"})`,
                        value: inst.instructor
                    }));

                    let d = new frappe.ui.Dialog({
                        title: "Select Instructors",
                        fields: [
                            {
                                fieldtype: "MultiCheck",
                                label: "Instructors",
                                fieldname: "selected_instructors",
                                options: options
                            }
                        ],
                        primary_action_label: "Assign",
                        primary_action(values) {
                            const selected = values.selected_instructors || [];
                            if (selected.length === 0) {
                                frappe.msgprint("Please select at least one instructor.");
                                return;
                            }

                            const fullList = response.message;
                            selected.forEach((instructor, index) => {
                                const match = fullList.find(i => i.instructor === instructor);
                                if (!match) return;

                                if (index === 0) {
                                    frappe.model.set_value(cdt, cdn, "instructor", match.instructor);
                                    frappe.model.set_value(cdt, cdn, "qualification", match.qualification || "Not Specified");
                                } else {
                                    let newRow = frappe.model.add_child(frm.doc, "Activity Allocation Details", "activity_allocation_details");
                                    frappe.model.set_value(newRow.doctype, newRow.name, "activity_name", row.activity_name);
                                    frappe.model.set_value(newRow.doctype, newRow.name, "session", row.session);
                                    frappe.model.set_value(newRow.doctype, newRow.name, "instructor", match.instructor);
                                    frappe.model.set_value(newRow.doctype, newRow.name, "qualification", match.qualification || "Not Specified");
                                }
                            });

                            frm.refresh_field("activity_allocation_details");
                            d.hide();
                        },
                        onhide(){
                            activityDialogOpen =false;
                        },
                    });

                    d.show();
                } else {
                    activityDialogOpen = false;
                    frappe.msgprint("No instructors found for this activity.");
                }
            },
            error:()=>{
                activityDialogOpen = false;
            },
        });
    },


    safety_kayaking: function (frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        if (!row.safety_kayaking || safetyDialogOpen) return;

        safetyDialogOpen = true;

        frappe.call({
            method: "tours_and_safaris.tours_and_safaris.doctype.activity_allocation.activity_allocation.get_instructors",
            args: { activity_name: "Safety Kayaking" },
            callback: function (response) {
                if (response.message && response.message.length > 0) {
                    let options = response.message.map(inst => ({
                        label: `${inst.instructor} (${inst.qualification || "No Qualification"})`,
                        value: inst.instructor
                    }));

                    let d = new frappe.ui.Dialog({
                        title: "Select Safety Kayaking Instructors",
                        fields: [
                            {
                                fieldtype: "MultiCheck",
                                label: "Safety Kayak Instructors",
                                fieldname: "selected_instructors",
                                options: options
                            }
                        ],
                        primary_action_label: "Assign",
                        primary_action(values) {
                            const selected = values.selected_instructors || [];
                            if (selected.length === 0) {
                                frappe.msgprint("Please select at least one instructor.");
                                return;
                            }

                            const fullList = response.message;
                            selected.forEach((instructor, index) => {
                                const match = fullList.find(i => i.instructor === instructor);
                                if (!match) return;

                                if (index === 0) {
                                    frappe.model.set_value(cdt, cdn, "safety_kayaking_instructor", match.instructor);
                                    frappe.model.set_value(cdt, cdn, "kayaker_qualification", match.qualification || "Not Specified");
                                } else {
                                    let newRow = frappe.model.add_child(frm.doc, "Activity Allocation Details", "activity_allocation_details");
                                    frappe.model.set_value(newRow.doctype, newRow.name, "activity_name", row.activity_name);
                                    frappe.model.set_value(newRow.doctype, newRow.name, "session", row.session);
                                    frappe.model.set_value(newRow.doctype, newRow.name, "safety_kayaking", 1);
                                    frappe.model.set_value(newRow.doctype, newRow.name, "safety_kayaking_instructor", match.instructor);
                                    frappe.model.set_value(newRow.doctype, newRow.name, "kayaker_qualification", match.qualification || "Not Specified");
                                }
                            });

                            frm.refresh_field("activity_allocation_details");
                            d.hide();
                        },
                        onhide(){
                            safetyDialogOpen = false;
                        }
                    });

                    d.show();
                } else {
                    safetyDialogOpen = false;
                    frappe.msgprint("No instructors found for Safety Kayaking.");
                }
            },
            error:()=>{
                safetyDialogOpen = false;
            }
        });
    }
});
frappe.ui.form.on("Activity Allocation Details", {
    activity_name: function (frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        if (!row.activity_name) return;

        frappe.call({
            method: "tours_and_safaris.tours_and_safaris.doctype.activity_allocation.activity_allocation.get_instructors",
            args: { activity_name: row.activity_name },
            callback: function (response) {
                if (response.message && response.message.length > 0) {
                    let options = response.message.map(inst => ({
                        label: `${inst.instructor} (${inst.qualification || "No Qualification"})`,
                        value: inst.instructor
                    }));

                    let d = new frappe.ui.Dialog({
                        title: "Select Instructors",
                        fields: [
                            {
                                fieldtype: "MultiCheck",
                                label: "Instructors",
                                fieldname: "selected_instructors",
                                options: options
                            }
                        ],
                        primary_action_label: "Assign",
                        primary_action(values) {
                            const selected = values.selected_instructors || [];
                            if (selected.length === 0) {
                                frappe.msgprint("Please select at least one instructor.");
                                return;
                            }

                            const fullList = response.message;
                            selected.forEach((instructor, index) => {
                                const match = fullList.find(i => i.instructor === instructor);
                                if (!match) return;

                                if (index === 0) {
                                    frappe.model.set_value(cdt, cdn, "instructor", match.instructor);
                                    frappe.model.set_value(cdt, cdn, "qualification", match.qualification || "Not Specified");
                                } else {
                                    let newRow = frappe.model.add_child(frm.doc, "Activity Allocation Details", "activity_allocation_details");
                                    frappe.model.set_value(newRow.doctype, newRow.name, "activity_name", row.activity_name);
                                    frappe.model.set_value(newRow.doctype, newRow.name, "session", row.session);
                                    frappe.model.set_value(newRow.doctype, newRow.name, "instructor", match.instructor);
                                    frappe.model.set_value(newRow.doctype, newRow.name, "qualification", match.qualification || "Not Specified");
                                }
                            });

                            frm.refresh_field("activity_allocation_details");
                            d.hide();
                        }
                    });

                    d.show();
                } else {
                    frappe.msgprint("No instructors found for this activity.");
                }
            }
        });
    },

    safety_kayak: function (frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        if (!row.safety_kayak) return;

        frappe.call({
            method: "tours_and_safaris.tours_and_safaris.doctype.activity_allocation.activity_allocation.get_instructors",
            args: { activity_name: "Safety Kayaking" },
            callback: function (response) {
                if (response.message && response.message.length > 0) {
                    let options = response.message.map(inst => ({
                        label: `${inst.instructor} (${inst.qualification || "No Qualification"})`,
                        value: inst.instructor
                    }));

                    let d = new frappe.ui.Dialog({
                        title: "Select Safety Kayaking Instructors",
                        fields: [
                            {
                                fieldtype: "MultiCheck",
                                label: "Safety Kayak Instructors",
                                fieldname: "selected_instructors",
                                options: options
                            }
                        ],
                        primary_action_label: "Assign",
                        primary_action(values) {
                            const selected = values.selected_instructors || [];
                            if (selected.length === 0) {
                                frappe.msgprint("Please select at least one instructor.");
                                return;
                            }

                            const fullList = response.message;
                            selected.forEach((instructor, index) => {
                                const match = fullList.find(i => i.instructor === instructor);
                                if (!match) return;

                                if (index === 0) {
                                    frappe.model.set_value(cdt, cdn, "safety_kayak_instructor", match.instructor);
                                    frappe.model.set_value(cdt, cdn, "kayaker_qualification", match.qualification || "Not Specified");
                                } else {
                                    let newRow = frappe.model.add_child(frm.doc, "Activity Allocation Details", "activity_allocation_details");
                                    frappe.model.set_value(newRow.doctype, newRow.name, "activity_name", row.activity_name);
                                    frappe.model.set_value(newRow.doctype, newRow.name, "session", row.session);
                                    frappe.model.set_value(newRow.doctype, newRow.name, "safety_kayaking", 1);
                                    frappe.model.set_value(newRow.doctype, newRow.name, "safety_kayak_instructor", match.instructor);
                                    frappe.model.set_value(newRow.doctype, newRow.name, "kayaker_qualification", match.qualification || "Not Specified");
                                }
                            });

                            frm.refresh_field("activity_allocation_details");
                            d.hide();
                        }
                    });

                    d.show();
                } else {
                    frappe.msgprint("No instructors found for Safety Kayaking.");
                }
            }
        });
    }
});
