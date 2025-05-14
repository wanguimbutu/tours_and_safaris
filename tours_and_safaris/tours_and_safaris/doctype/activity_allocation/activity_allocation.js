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
                    status: "Completed",
                    completed_on: frappe.datetime.get_today(),
                    completed_by: frappe.session.user
                }
            },
            callback: function(response) {
                if (response.message) {
                    console.log(" Task marked as Completed:", frm.doc.task);
                    frappe.msgprint(__("Task marked as Completed."));

                    
                    check_parent_task_completion(frm.doc.task);
                } else {
                    frappe.msgprint(__("Failed to update task."));
                    console.error(" Error: Could not mark task as completed:", response);
                }
            },
            error: function(err) {
                console.error(" API Call Failed when updating Task:", err);
            }
        });
    },
    refresh: function (frm) {
        if (!frm.is_new()) {
            frm.add_custom_button('Reassign', () => {
                let activityDialog = new frappe.ui.Dialog({
                    title: 'Reassign Instructor',
                    fields: [
                        {
                            label: 'Activity Date',
                            fieldname: 'activity_date',
                            fieldtype: 'Date',
                            reqd: 1
                        },
                        {
                            label: 'Session',
                            fieldname: 'session',
                            fieldtype: 'Link',
                            options: 'Session Type',
                            onchange: function () {
                                const values = activityDialog.get_values();
                                if (!values || !values.activity_date) {
                                    frappe.msgprint("Please select Activity Date first.");
                                    return;
                                }
    
                                const date = frappe.datetime.obj_to_str(frappe.datetime.str_to_obj(values.activity_date)).split(" ")[0];
    
                                if (values.session === 'FULL DAY') {
                                    activityDialog.set_value('start_time', `${date} 08:00:00`);
                                    activityDialog.set_value('end_time', `${date} 17:30:00`);
                                    activityDialog.set_df_property('session_type', 'hidden', 1);
                                } else {
                                    activityDialog.set_df_property('session_type', 'hidden', 0);
                                }
                            }
                        },
                        {
                            label: 'Session Type',
                            fieldname: 'session_type',
                            fieldtype: 'Select',
                            options: ['AM', 'PM'],
                            onchange: function () {
                                const values = activityDialog.get_values();
                                if (!values || !values.activity_date) {
                                    frappe.msgprint("Please select Activity Date first.");
                                    return;
                                }
    
                                const date = frappe.datetime.obj_to_str(frappe.datetime.str_to_obj(values.activity_date)).split(" ")[0];
                                if (values.session_type === 'AM') {
                                    activityDialog.set_value('start_time', `${date} 08:00:00`);
                                    activityDialog.set_value('end_time', `${date} 12:30:00`);
                                } else {
                                    activityDialog.set_value('start_time', `${date} 13:30:00`);
                                    activityDialog.set_value('end_time', `${date} 17:30:00`);
                                }
                            }
                        },
                        {
                            label: 'Activity Name',
                            fieldname: 'activity_name',
                            fieldtype: 'Link',
                            options: 'Activity Type',
                            reqd: 0
                        },
                        {
                            label: 'Start Time',
                            fieldname: 'start_time',
                            fieldtype: 'Datetime',
                            reqd: 0
                        },
                        {
                            label: 'End Time',
                            fieldname: 'end_time',
                            fieldtype: 'Datetime',
                            reqd: 0
                        },
                    ],
                    primary_action_label: 'Get Instructors',
                    primary_action(values) {
                        frappe.call({
                            method: 'tours_and_safaris.tours_and_safaris.doctype.activity_allocation.activity_allocation.get_instructors',
                            args: {
                                activity_name: values.activity_name,
                                activity_date: values.activity_date,
                                start_time: values.start_time,
                                end_time: values.end_time
                            },
                            callback: function (r) {
                                if (r.message && r.message.length > 0) {
                                    activityDialog.hide();
    
                                    let instructor_map = {};
                                    let instructor_fields = [];
    
                                    r.message.forEach((inst, idx) => {
                                        let fieldname = `instructor_${idx}`;
                                        instructor_map[fieldname] = inst;
    
                                        instructor_fields.push({
                                            label: `${inst.instructor} (${inst.qualification})`,
                                            fieldname: fieldname,
                                            fieldtype: 'Check'
                                        });
                                    });
    
                                    const instructorDialog = new frappe.ui.Dialog({
                                        title: 'Select Instructors',
                                        fields: instructor_fields,
                                        primary_action_label: 'Assign Selected',
                                        primary_action(selected) {
                                        
                                            const child_table =
                                                frm.doc.instructor_assignment && frm.doc.instructor_assignment.length
                                                    ? 'instructor_assignment'
                                                    : 'activity_allocation_details';
    
                                            frm.clear_table(child_table);
    
                                            Object.entries(selected).forEach(([key, is_checked]) => {
                                                if (is_checked) {
                                                    const inst = instructor_map[key];
                                                    const row = frm.add_child(child_table);
    
                                                    row.activity_date = values.activity_date;
                                                    row.session = values.session;
                                                    row.session_type = values.session_type;
                                                    row.activity_name = values.activity_name;
                                                    row.instructor = inst.instructor;
                                                    row.qualification = inst.qualification;
                                                    row.start_time = values.start_time;
                                                    row.end_time = values.end_time;
    
                                                    if (child_table === 'instructor_assignment') {
                                                        row.from_date = values.activity_date;
                                                        row.to_date = values.activity_date;
                                                    }
                                                }
                                            });
    
                                            frm.set_value('status', 'Reassigned');
                                            frm.refresh_field(child_table);
                                            frm.refresh_field('status');
                                            instructorDialog.hide();
    
                                            frappe.call({
                                                method: 'tours_and_safaris.tours_and_safaris.doctype.activity_allocation.activity_allocation.create_calendar_events_on_reassign',
                                                args: {
                                                    allocation_name: frm.doc.name
                                                },
                                                callback: () => {
                                                    frappe.show_alert({ message: 'Calendar updated', indicator: 'green' });
                                                }
                                            });
                                        }
                                    });
    
                                    instructorDialog.show();
                                } else {
                                    frappe.msgprint('No available instructors found for the given time slot.');
                                }
                            }
                        });
                    }
                });
    
                activityDialog.show();
            });
        }
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

        if (!row.activity_name) return;

        frappe.call({
            method: "tours_and_safaris.tours_and_safaris.doctype.activity_allocation.activity_allocation.get_instructors",
            args: { activity_name: row.activity_name,
                activity_date: row.activity_date,
                start_time: row.start_time,
                end_time: row.end_time
            },
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
                    frappe.msgprint("No available instructors found for this activity.");
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
    },
    session: function(frm, cdt, cdn) {
        set_session_times(frm, cdt, cdn);
    },
    session_period: function(frm, cdt, cdn) {
        set_session_times(frm, cdt, cdn);
    },
    activity_date: function(frm, cdt, cdn) {
        set_session_times(frm, cdt, cdn);
    },
    activity_date: function (frm, cdt, cdn) {
        const child = locals[cdt][cdn];
        const start_date = frm.doc.start_date;
        const end_date = frm.doc.end_date;

        if (child.activity_date && start_date && end_date) {
            const selected = frappe.datetime.str_to_obj(child.activity_date);
            const start = frappe.datetime.str_to_obj(start_date);
            const end = frappe.datetime.str_to_obj(end_date);

            if (selected < start || selected > end) {
                frappe.msgprint(__('Activity Date must be between Start Date and End Date of the allocation.'));
                frappe.model.set_value(cdt, cdn, 'activity_date', '');
            }
        }
    },
    instructor: function (frm, cdt, cdn) {
        const row = locals[cdt][cdn];

        // Only act if this is a newly added instructor row
        if (row.__islocal && row.instructor) {
            // Copy reference fields from the first non-empty row (could be the one just above)
            const reference_row = frm.doc.activity_allocation_details.find(r => r.activity_date && r.session && r.session_period);

            if (reference_row) {
                row.activity_date = reference_row.activity_date;
                row.session = reference_row.session;
                row.session_period = reference_row.session_period;
                row.start_time = reference_row.start_time;
                row.end_time = reference_row.end_time;
                frm.refresh_field("activity_allocation_details");
            }
        }
    }
});

function set_session_times(frm, cdt, cdn) {
    let row = locals[cdt][cdn];

    if (!row.activity_date || !row.session) return;

    const session = row.session;
    const period = (row.session_period || '');

    // Time definitions
    const times = {
        am: ['08:00:00', '12:30:00'],
        pm: ['13:30:00', '17:30:00'],
        full_day: ['08:00:00', '17:30:00']
    };

    if (session === 'HALF DAY') {
        if (period === 'AM') {
            [row.start_time, row.end_time] = times.am.map(t => combine_date_time(row.activity_date, t));
        } else if (period === 'PM') {
            [row.start_time, row.end_time] = times.pm.map(t => combine_date_time(row.activity_date, t));
        }
    } else if (session === 'FULL DAY' || session === 'ALL DAY') {
        [row.start_time, row.end_time] = times.full_day.map(t => combine_date_time(row.activity_date, t));
    } else if (session === 'PER SESSION') {
        if (period === 'AM') {
            [row.start_time, row.end_time] = times.am.map(t => combine_date_time(row.activity_date, t));
        } else if (period === 'PM') {
            [row.start_time, row.end_time] = times.pm.map(t => combine_date_time(row.activity_date, t));
        }
    }

    frm.refresh_field('activity_allocation_details');
}

function combine_date_time(date_str, time_str) {
    return `${frappe.datetime.obj_to_str(frappe.datetime.str_to_obj(date_str)).split(" ")[0]} ${time_str}`;
}

frappe.ui.form.on('Instructor Assignment', {
    activity_name: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        if (!row.from_date || !row.to_date) {
            frappe.msgprint(__('Please set From Date and To Date first'));
            return;
        }

        frappe.call({
            method: 'tours_and_safaris.tours_and_safaris.doctype.activity_allocation.activity_allocation.get_instructors',
            args: {
                activity_name: row.activity_name,
                activity_date: row.from_date,
                start_time: row.start_time || '08:00:00',
                end_time: row.end_time || '17:00:00',
                is_safety_kayak: row.is_safety_kayak || false
            },
            callback: function(r) {
                if (r.message && r.message.length > 0) {
                    const options = r.message.map(inst => ({
                        label: `${inst.instructor} (${inst.qualification})`,
                        value: inst.instructor
                    }));

                    const d = new frappe.ui.Dialog({
                        title: 'Select Instructors',
                        fields: [
                            {
                                fieldname: 'selected_instructors',
                                fieldtype: 'MultiCheck',
                                label: 'Instructors',
                                options: options,
                                columns: 2
                            }
                        ],
                        primary_action_label: 'Assign',
                        primary_action(values) {
                            if (values.selected_instructors.length) {
                                // Remove the original row
                                frm.get_field('instructor_assignment').grid.grid_rows_by_docname[cdn].remove();

                                // For each selected instructor, add a new row
                                values.selected_instructors.forEach(instructor => {
                                    const new_row = frm.add_child('instructor_assignment');
                                    new_row.activity_name = row.activity_name;
                                    new_row.from_date = row.from_date;
                                    new_row.to_date = row.to_date;
                                    new_row.start_time = row.start_time;
                                    new_row.end_time = row.end_time;
                                    new_row.is_safety_kayak = row.is_safety_kayak;
                                    new_row.instructor = instructor;
                                    new_row.qualification = r.message.find(i => i.instructor === instructor).qualification || "Not Specified";
                                });

                                frm.refresh_field('instructor_assignment');
                            }
                            d.hide();
                        }
                    });

                    d.show();
                } else {
                    frappe.msgprint(__('No available instructors found for this time.'));
                }
            }
        });
    },
    from_date: function(frm, cdt, cdn) {
        set_datetime_fields(frm, cdt, cdn);
    },
    to_date: function(frm, cdt, cdn) {
        set_datetime_fields(frm, cdt, cdn);
    }
});

function set_datetime_fields(frm, cdt, cdn) {
    const row = locals[cdt][cdn];

    if (row.from_date) {
        const from_date_clean = frappe.datetime.obj_to_str(
            frappe.datetime.str_to_obj(row.from_date)
        ).split(" ")[0];
        row.start_time = `${from_date_clean} 08:00:00`;
    }

    if (row.to_date) {
        const to_date_clean = frappe.datetime.obj_to_str(
            frappe.datetime.str_to_obj(row.to_date)
        ).split(" ")[0];
        row.end_time = `${to_date_clean} 17:00:00`;
    }

    frm.refresh_field('instructor_assignment');
}
