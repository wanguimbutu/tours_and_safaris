frappe.ui.form.on("Reservation", {
    refresh: function (frm) {
    
        calculate_total_cost(frm);

        toggle_accommodation_fields(frm);

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
                            items: [
                        
                                ...(frm.doc.activities || []).map(activity => ({
                                    item_name: activity.activity_name,
                                    description: activity.description || "",
                                    qty: activity.quantity || 1,
                                    rate: activity.cost || 0
                                })),

                                ...(frm.doc.room_booking || []).map(room => ({
                                    item_name: room.room_name || "Room",
                                    description: `Room Booking: ${room.room_name || "N/A"}`,
                                    qty: 1,
                                    rate: room.price || 0
                                })),

                            
                                ...(frm.doc.no_of_tents || []).map(tent => ({
                                    item_name: "Tent",
                                    description: `Tent: ${tent.tent_name || "N/A"}`,
                                    qty: tent.quantity || 1,
                                    rate: tent.cost || 0
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

    accommodation_type: function (frm) {
        toggle_accommodation_fields(frm);
    },

    activity: function (frm) {
        if (frm.doc.activity === 'Safari') {
            frm.set_df_property('safari_section', 'hidden', 0);
            frm.set_df_property('mtkenya_section', 'hidden', 1);
        } else if (frm.doc.activity === 'Mt.Kenya') {
            frm.set_df_property('mtkenya_section', 'hidden', 0);
            frm.set_df_property('safari_section', 'hidden', 1);
        } else {
            frm.set_df_property('safari_section', 'hidden', 1);
            frm.set_df_property('mtkenya_section', 'hidden', 1);
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

    
    frm.set_value('proposed_total_cost', total_cost);
}


function toggle_accommodation_fields(frm) {
    
    frm.set_df_property('no_of_tents', 'hidden', 1);
    frm.set_df_property('room_booking', 'hidden', 1);


    if (frm.doc.accommodation_type === 'Rooms') {
        frm.set_df_property('room_booking', 'hidden', 0);
    } else if (frm.doc.accommodation_type === 'SWS Tents' || frm.doc.accommodation_type === 'Own Tents') {
        frm.set_df_property('no_of_tents', 'hidden', 0);
    }
}
