frappe.ui.form.on("Reservation", {
    refresh: function (frm) {
        calculate_total_cost(frm);
        toggle_accommodation_fields(frm);

        // Ensure room_booking stays visible if Rooms are selected
        if (frm.doc.accommodation_type === "Rooms") {
            frm.set_df_property("room_booking", "hidden", 0);
        }

        // Add custom button to create Quotation
                if (frm.doc.docstatus === 1) {
                    frm.add_custom_button('Create Quotation', function () {
                        if (!frm.doc.customer_name) {
                            frappe.msgprint(__('Please ensure the Customer Name field is filled in the Reservation.'));
                            return;
                        }
                
                        frappe.call({
                            method: "frappe.client.insert",
                            args: {
                                doc: {
                                    doctype: "Quotation",
                                    customer: frm.doc.customer_name,
                                    custom_check_in_date: frm.doc.check_in_date,
                                    custom_check_out_date: frm.doc.check_out_date,
                                    custom_reservation: frm.doc.name,
                                    items: [
                                        // Add activities
                                        ...(frm.doc.activities || []).map(activity => ({
                                            item_code:'ACTIVITY',
                                            item_name: activity.activity_name,
                                            description: activity.description || "",
                                            qty: activity.quantity || 1,
                                            rate: activity.cost || 0
                                        })),
                
                                        // Add room bookings
                                        ...(frm.doc.room_booking || []).map(room => ({
                                            item_code:'ACCOMMODATION',
                                            item_name: room.room_name || "Room",
                                            description: `Room Booking: ${room.room_name || "N/A"}`,
                                            qty: 1,
                                            rate: room.price || 0
                                        })),
                
                                        // Add tent selection (SWS Tents)
                                        ...(frm.doc.tent_selection || []).map(tent => ({
                                            item_code:'ACCOMMODATION',
                                            item_name: tent.tent_name || "Tent",
                                            description: `Tent: ${tent.tent_name || "N/A"}`,
                                            qty: tent.qty || 1,
                                            rate: tent.price || 0
                                        })),
                
                                        // Add own tents (if applicable)
                                        ...(frm.doc.no_of_tents || []).map(tent => ({
                                            item_code:'ACCOMMODATION',
                                            item_name: "Own Tent",
                                            description: `Own Tent: ${tent.tent_name || "N/A"}`,
                                            qty: tent.qty || 1,
                                            rate: tent.cost || 0
                                        })),
                
                                        // Add transport
                                        ...(frm.doc.transport || []).map(transport => ({
                                            item_code:'TRANSPORT',
                                            item_name: transport.transort_name || "Transport",
                                          //  description: `Transport via ${transport.vehicle_type || "N/A"}`,
                                            qty: 1,
                                            rate: transport.price || 0
                                        }))
                                                        ]
                                                    }
                                                },
                                                callback: function (response) {
                                                    if (response.message) {
                                                        frappe.msgprint({
                                                            title: __("Success"),
                                                            message: `Quotation <a href="/app/quotation/${response.message.name}" target="_blank">${response.message.name}</a> created successfully.`,
                                                            indicator: "green"
                                                        });
                                                    }
                                                }
                                            });
                                        }, __("Actions"));
                                    }
                                },
                        

    check_in_date: function (frm) {
        if (frm.doc.check_in_date && frm.doc.check_out_date) {
            fetch_calendar_events(frm);
        }
    },
    check_out_date: function (frm) {
        if (frm.doc.check_in_date && frm.doc.check_out_date) {
            fetch_calendar_events(frm);
        }
    },

    accommodation_type: function (frm) {
        toggle_accommodation_fields(frm);

        // Ensure room_type is visible if Rooms are selected
        if (frm.doc.accommodation_type === "Rooms") {
            frm.set_df_property("room_type", "hidden", 0);
            frm.set_df_property("room_booking", "hidden", 1); // Hide room_booking until room_type is selected
        } else {
            frm.set_df_property("room_type", "hidden", 1);
        }
    },

    room_type: function (frm) {
        if (frm.doc.room_type) {
            // Fetch available rooms based on selected room type
            frappe.call({
                method: "frappe.client.get_list",
                args: {
                    doctype: "Rooms",
                    filters: {
                        room_type: frm.doc.room_type,
                        status: "Available"
                    },
                    fields: ["name", "room_number", "base_price"]
                },
                callback: function (response) {
                    const available_rooms = response.message || [];
                    frm.set_value("room_booking", []); // Clear room_booking table

                    // Populate room_booking table with available rooms
                    available_rooms.forEach(room => {
                        const new_row = frm.add_child("room_booking");
                        new_row.room_name = room.room_name;
                        new_row.price = room.price;
                    });

                    frm.refresh_field("room_booking");
                    frm.set_df_property("room_booking", "hidden", 0); // Make room_booking visible
                }
            });
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

    'activities.*.cost': function (frm) {
        calculate_total_cost(frm);
    },
    'room_booking.*.price': function (frm) {
        calculate_total_cost(frm);
    },

    validate: function (frm) {
        const no_of_people = frm.doc.no_of_people || 0;
        const no_of_adults = frm.doc.no_of_adults || 0;
        const no_of_children = frm.doc.no_of_children || 0;

        if (no_of_people !== (no_of_adults + no_of_children)) {
            frappe.throw(
                `The total number of people (${no_of_people}) must equal the sum of adults (${no_of_adults}) and children (${no_of_children}).`
            );
        }
    }
});

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
    });
}

function calculate_total_cost(frm) {
    let total_cost = 0;

    if (frm.doc.activities) {
        frm.doc.activities.forEach(activity => {
            total_cost += flt(activity.cost);
        });
    }

    if (frm.doc.room_booking) {
        frm.doc.room_booking.forEach(room => {
            total_cost += flt(room.price);
        });
    }

    if (frm.doc.transport) {
        frm.doc.transport.forEach(transport => {
            total_cost += flt(transport.price);
        });
    }

    
    if (frm.doc.tent_selection) {
        frm.doc.tent_selection.forEach(tent => {
            total_cost += flt(tent.qty) * flt(tent.price);
        });
    }


    frm.set_value('proposed_total_cost', total_cost);
}


function toggle_accommodation_fields(frm) {
    frm.set_df_property('no_of_tents', 'hidden', 1);
    frm.set_df_property('room_booking', 'hidden', 1);
    frm.set_df_property('room_type', 'hidden', 1);
    frm.set_df_property('tent_selection', 'hidden',1);

    if (frm.doc.accommodation_type === 'Rooms') {
        frm.set_df_property('room_type', 'hidden', 0); // Show room_type
    } else if (frm.doc.accommodation_type === 'Own Tents') {
        frm.set_df_property('no_of_tents', 'hidden', 0); // Show no_of_tents for tents
    }else if(frm.doc.accommodation_type === 'SWS Tents'){
        frm.set_df_property('tent_selection', 'hidden', 0); // Show no_of_tents for tents
    }
}
