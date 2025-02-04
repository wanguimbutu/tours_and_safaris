frappe.ui.form.on("Reservation", {
    refresh: function (frm) {
        calculate_total_cost(frm);
        toggle_accommodation_fields(frm);

        if (frm.doc.accommodation_type === "Rooms") {
            frm.set_df_property("room_booking", "hidden", 0);
        }

        if (frm.doc.docstatus === 1) {
            // Check if a quotation is already created and submitted for this reservation
            frappe.call({
                method: "frappe.client.get_list",
                args: {
                    doctype: "Quotation",
                    filters: {
                        "custom_reservation": frm.doc.name,
                        "docstatus": 1  // Looking for submitted quotations
                    },
                    fields: ["name"]
                },
                callback: function(response) {
                    if (response.message && response.message.length > 0) {
                        // If a submitted quotation exists, remove the "Create Quotation" button
                        frm.remove_custom_button(__('Create Quotation'));
                    } else {
                        // If no submitted quotation exists, show the "Create Quotation" button
                        frm.add_custom_button('Create Quotation', function () {
                            frappe.call({
                                method: "tours_and_safaris.tours_and_safaris.doctype.reservation.reservation.create_quotation", // Replace `your_app` with your actual app name
                                args: { reservation_name: frm.doc.name },
                                callback: function (response) {
                                    if (response.message) {
                                        frappe.msgprint({
                                            title: __("Success"),
                                            message: `Quotation <a href="/app/quotation/${response.message}" target="_blank">${response.message}</a> created successfully.`,
                                            indicator: "green"
                                        });
                                    }
                                }
                            });
                        }, __("Actions"));
                    }
                }
            });
        }
        if (frm.doc.room_booking && frm.doc.room_booking.length > 0 && !frm.doc.checked_in) {
            frm.add_custom_button("Check-In", function () {
                frappe.call({
                    method: "tours_and_safaris.tours_and_safaris.doctype.reservation.reservation.create_check_in",
                    args: {
                        reservation_name: frm.doc.name
                    },
                    callback: function (response) {
                        if (response.message) {
                            frappe.msgprint({
                                title: __("Success"),
                                message: `Check-In recorded successfully for ${frm.doc.customer_name}.`,
                                indicator: "green"
                            });
                            frm.reload_doc(); // Refresh document after check-in
                        }
                    }
                });
            }, __("Actions"));
        }

        // Show Check-Out button when the check-out date is reached
        let today = frappe.datetime.get_today();
        if (frm.doc.checked_in && frm.doc.check_out_date <= today && !frm.doc.checked_out) {
            frm.add_custom_button("Check-Out", function () {
                frappe.call({
                    method: "tours_and_safaris.tours_and_safaris.doctype.reservation.reservation.create_check_out",
                    args: {
                        reservation_name: frm.doc.name
                    },
                    callback: function (response) {
                        if (response.message) {
                            frappe.msgprint({
                                title: __("Success"),
                                message: `Check-Out recorded and maintenance log created.`,
                                indicator: "green"
                            });
                            frm.reload_doc(); // Refresh document after check-out
                        }
                    }
                });
            }, __("Actions"));
        }
},

activity: function (frm) {
        if (frm.doc.activity === "Safari") {
            frm.set_df_property("safari_section", "hidden", 0);
            frm.set_df_property("mtkenya_section", "hidden", 1);
        } else if (frm.doc.activity === "Mt.Kenya") {
            frm.set_df_property("mtkenya_section", "hidden", 0);
            frm.set_df_property("safari_section", "hidden", 1);
        } else if (frm.doc.activity === "Walk In") {
            frm.set_df_property("safari_section", "hidden", 1);
            frm.set_df_property("mtkenya_section", "hidden", 1);
        }
    },
    
    package_name: function (frm) {
        if (frm.doc.package_name) {
            // Fetch activities from the selected package
            frappe.call({
                method: "frappe.client.get",
                args: {
                    doctype: "Packages",
                    name: frm.doc.package_name
                },
                callback: function (response) {
                    const package = response.message;

                    if (package && package.activity) {
                        // Clear existing activities table
                        frm.clear_table("activities");

                        // Add activities from the package to the activities table
                        package.activity.forEach(activity => {
                            const new_row = frm.add_child("activities");
                            new_row.activity_name = activity.activity_name;
                            new_row.cost = activity.cost || 0;
                        });

                        frm.refresh_field("activities");
                        calculate_total_cost(frm);
                    }
                }
            });
        }
    },

    check_in_date: function (frm) {
        fetch_calendar_events(frm);
    },
    check_out_date: function (frm) {
        fetch_calendar_events(frm);
    },

    accommodation_type: function (frm) {
        toggle_accommodation_fields(frm);
    },

    activities_add: function (frm) {
        calculate_total_cost(frm);
    },
    activities_remove: function (frm) {
        calculate_total_cost(frm);
    },

    room_booking_add: function (frm) {
        calculate_total_cost(frm);
    },
    room_booking_remove: function (frm) {
        calculate_total_cost(frm);
    },

    validate: function (frm) {
        calculate_total_cost(frm);
    }
});

function calculate_total_cost(frm) {
    if (!frm.doc.name) return;

    frappe.call({
        method: "tours_and_safaris.tours_and_safaris.doctype.reservation.reservation.calculate_total_cost",
        args: { reservation_name: frm.doc.name },
        callback: function(response) {
            frm.set_value("proposed_total_cost", response.message);
        }
    });
}

function fetch_calendar_events(frm) {
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Event",
            filters: [
                ["starts_on", "<=", frm.doc.check_out_date],
                ["ends_on", ">=", frm.doc.check_in_date]
            ],
            fields: ["name", "subject", "starts_on", "ends_on", "description"]
        },
        callback: function (response) {
            const events = response.message || [];
            if (events.length) {
                let event_details = events.map(event => `
                    <b>${event.subject}</b><br>
                    <i>${event.starts_on} to ${event.ends_on}</i><br>
                    ${event.description || "No description"}<br><br>
                `).join("");

                frappe.msgprint({
                    title: __("Events Found"),
                    message: event_details,
                    wide: true
                });
            } else {
                frappe.msgprint({
                    title: __("No Events Found"),
                    message: "There are no events scheduled for the selected period.",
                    indicator: "orange"
                });
            }
        }
    })
}

function toggle_accommodation_fields(frm) {
    frm.set_df_property('no_of_tents', 'hidden', 1);
    frm.set_df_property('room_booking', 'hidden', 1);
    frm.set_df_property('room_type', 'hidden', 1);
    frm.set_df_property('tent_selection', 'hidden', 1);

    if (frm.doc.accommodation_type === 'Rooms') {
        frm.set_df_property('room_type', 'hidden', 0);
    } else if (frm.doc.accommodation_type === 'Own Tents') {
        frm.set_df_property('no_of_tents', 'hidden', 0);
    } else if (frm.doc.accommodation_type === 'SWS Tents') {
        frm.set_df_property('tent_selection', 'hidden', 0);
    }
}
