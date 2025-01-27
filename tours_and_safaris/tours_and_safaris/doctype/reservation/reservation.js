// Copyright (c) 2025, wanguimbutu and contributors
// For license information, please see license.txt

frappe.ui.form.on("Reservation", {
    refresh: function (frm) {
        // Always calculate total cost
        calculate_total_cost(frm);

        // Set up visibility for sections and tables
        toggle_accommodation_fields(frm);

        // Add a button to create a Quotation if the document is submitted
        if (frm.doc.docstatus === 1) { // Check if the document is submitted
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
                            items: (frm.doc.activities || []).map(activity => ({
                                item_name: activity.activity_name,
                                description: activity.description || "",
                                qty: activity.quantity || 1,
                                rate: activity.cost || 0
                            }))
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
            }, __("Actions")); // Group the button under "Actions"
        }
    },

    // Triggered when accommodation_type is selected
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

    // Recalculate total cost when activities table changes
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

    // Recalculate when cost or price values are changed
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

// Function to calculate total cost
function calculate_total_cost(frm) {
    let total_cost = 0;

    // Sum up the cost from activities table
    if (frm.doc.activities) {
        frm.doc.activities.forEach(activity => {
            total_cost += flt(activity.cost);
        });
    }

    // Sum up the price from room booking table
    if (frm.doc.room_booking) {
        frm.doc.room_booking.forEach(room => {
            total_cost += flt(room.price);
        });
    }

    // Update the proposed total cost field
    frm.set_value('proposed_total_cost', total_cost);
}

// Function to toggle accommodation fields
function toggle_accommodation_fields(frm) {
    // Hide both fields initially
    frm.set_df_property('no_of_tents', 'hidden', 1);
    frm.set_df_property('room_booking', 'hidden', 1);

    // Show fields based on the selected accommodation type
    if (frm.doc.accommodation_type === 'Rooms') {
        frm.set_df_property('room_booking', 'hidden', 0);
    } else if (frm.doc.accommodation_type === 'SWS Tents' || frm.doc.accommodation_type === 'Own Tents') {
        frm.set_df_property('no_of_tents', 'hidden', 0);
    }
}
