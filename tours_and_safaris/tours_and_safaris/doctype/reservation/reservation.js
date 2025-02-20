frappe.ui.form.on("Reservation", {
    refresh: function (frm) {
        calculate_total_cost(frm);
        toggle_accommodation_fields(frm);

        if (frm.doc.accommodation_type === "Rooms") {
            frm.set_df_property("room_booking", "hidden", 0);
        }

        if (frm.doc.status === "Confirmed Reservation") {
            frappe.call({
                method: "tours_and_safaris.tours_and_safaris.doctype.reservation.reservation.update_availability_status",
                args: {
                    reservation_id: frm.doc.name,
                    status:"Confirmed Reservation"
                },
                callback: function(response) {
                    if (response.message === "success") {
                        frappe.msgprint("Availability updated successfully.");
                    }
                }
            });
        }

        if (frm.doc.docstatus === 1) {
            // Check if a quotation already exists for this reservation
            frappe.call({
                method: "frappe.client.get_list",
                args: {
                    doctype: "Quotation",
                    filters: {
                        "custom_reservation": frm.doc.name,
                        "docstatus": 1  // Submitted quotations
                    },
                    fields: ["name"]
                },
                callback: function(response) {
                    if (response.message && response.message.length > 0) {
                        frm.remove_custom_button(__('Create Quotation'));
                    } else {
                        frm.add_custom_button('Create Quotation', function () {
                            frappe.call({
                                method: "tours_and_safaris.tours_and_safaris.doctype.reservation.reservation.create_quotation",
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

        // Check-In Button Logic
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
                            frm.reload_doc();
                        }
                    }
                });
            }, __("Actions"));
        }

        // Check-Out Button Logic
        let today = frappe.datetime.get_today();
        if (frm.doc.checked_in && frm.doc.depature_date <= today && !frm.doc.checked_out) {
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
                            frm.reload_doc();
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
        } else {
            frm.set_df_property("safari_section", "hidden", 1);
            frm.set_df_property("mtkenya_section", "hidden", 1);
        }
    },

    start_date: function (frm) {
        console.log("Start Date Changed");
        populate_safari_reservation(frm);
    },
    end_date: function (frm) {
        console.log("End Date Changed");
        populate_safari_reservation(frm);
    },
    safari_reservation_add: function (frm) {
        console.log("Row added to safari_reservation");
        populate_activities_from_safari(frm);
    },
    safari_reservation_remove: function (frm) {
        console.log("Row removed from safari_reservation");
        populate_activities_from_safari(frm);
    },
    
    depature_date: function (frm) {
        if (frm.doc.depature_date) {
            frm.set_value("end_date",frm.doc.depature_date);
        }
    },

    arrival_date: function (frm){
        if(frm.doc.arrival_date){
        let date_only = frapppe.datetime.get_date(frm.doc.arrival_date)
            frm.set_value("start_date", date_only);
        }
    }, 

package_name: function (frm) {
        if (frm.doc.package_name) {
            frappe.call({
                method: "frappe.client.get",
                args: {
                    doctype: "Packages",
                    name: frm.doc.package_name
                },
                callback: function (response) {
                    const package = response.message;
                    if (package && package.activity) {
                        frm.clear_table("activities");
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

    room_type: function (frm) {
        fetch_available_rooms(frm);
    },

    arrival_date: function (frm) {
        fetch_available_rooms(frm);
    },
    depature_date: function (frm) {
        fetch_available_rooms(frm);
    },

    accommodation_type: function (frm) {
        toggle_accommodation_fields(frm);
    },

    room_booking_add: function (frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        add_room_to_calendar(frm, row);
    },

    room_booking_remove: function (frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        remove_room_from_calendar(frm, row);
    },

    status: function (frm) {
        if (frm.doc.status === "Confirmed Reservation") {
            confirm_room_reservations(frm);
        }
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

function fetch_available_rooms(frm) {
    if (!frm.doc.arrival_date || !frm.doc.depature_date || !frm.doc.room_type) return;

    frappe.call({
        method: "tours_and_safaris.tours_and_safaris.doctype.reservation.reservation.get_available_rooms",
        args: {
            arrival_date: frm.doc.arrival_date,
            depature_date: frm.doc.depature_date,
            room_type: frm.doc.room_type
        },
        callback: function (response) {
            console.log("Available rooms response:", response);

            if (response.message && response.message.length > 0) {
                frm.clear_table("room_booking");
                
                response.message.forEach(room => {
                    let row = frm.add_child("room_booking");
                    row.room_name = room.room_number;
                    row.price = room.resident_rate;
                    row.status = room.status;
                    row.capacity = room.capacity;
                });

                frm.refresh_field("room_booking");
                frm.set_df_property('room_booking', 'hidden', 0);
            } else {
                frm.set_df_property('room_booking', 'hidden', 1);
                frappe.msgprint("No available rooms of this type for the selected dates.");
            }
        }
    });
}

function add_room_to_calendar(frm, row) {
    frappe.call({
        method: "tours_and_safaris.tours_and_safaris.doctype.reservation.reservation.add_room_to_calendar",
        args: {
            reservation_name: frm.doc.name,
            room_name: row.room_name,
            arrival_date: frm.doc.arrival_date,
            depature_date: frm.doc.depature_date
        }
    });
}

function remove_room_from_calendar(frm, row) {
    frappe.call({
        method: "tours_and_safaris.tours_and_safaris.doctype.reservation.reservation.remove_room_from_calendar",
        args: {
            reservation_name: frm.doc.name,
            room_name: row.room_name
        }
    });
}

function confirm_room_reservations(frm) {
    frappe.call({
        method: "tours_and_safaris.tours_and_safaris.doctype.reservation.reservation.confirm_room_reservations",
        args: {
            reservation_name: frm.doc.name
        }
    });
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

function populate_safari_reservation(frm) {
    if (!frm.doc.start_date || !frm.doc.end_date) {
    
        return;
    }

    let start = frappe.datetime.str_to_obj(frm.doc.start_date);
    let end = frappe.datetime.str_to_obj(frm.doc.end_date);

    if (start > end) {
        frappe.msgprint("Start Date must be before End Date.");
        return;
    }

    console.log("Populating safari reservation...");
    frm.clear_table("safari_reservation");

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        let row = frm.add_child("safari_reservation");
        row.day = frappe.datetime.obj_to_str(d);
        row.adventure = "";  // Initially blank, user will select
        console.log(`Added row: Day=${row.day}, Adventure= (empty)`);
    }

    frm.refresh_field("safari_reservation");
}

function populate_activities_from_safari(frm) {
    console.log("Populating activities table...");
    frm.clear_table("activities");

    let hasActivities = false;

    frm.doc.safari_reservation.forEach(row => {
        if (row.adventure && row.adventure.trim() !== "") {  
            let activity_row = frm.add_child("activities");
            activity_row.activity_name = row.adventure;
            console.log(`Added Activity: ${row.adventure}`);
            hasActivities = true;
        }
    });

    if (!hasActivities) {
        console.log("No valid adventure values found in safari_reservation.");
    }

    frm.refresh_field("activities");
}

frappe.ui.form.on("Safari Reservation", {
    adventure: function (frm, cdt, cdn) {
        let row = locals[cdt][cdn];  
        console.log(`Adventure updated for ${row.day}: ${row.adventure}`); // Debugging log
        populate_activities_from_safari(frm);
    }
});
