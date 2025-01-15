// Copyright (c) 2025, wanguimbutu and contributors
// For license information, please see license.txt

frappe.ui.form.on('Booking Inquiry', {
    refresh: function(frm) {
        // Hide both fields initially
        frm.set_df_property('no_of_tents_needed', 'hidden', 1);
        frm.set_df_property('room_booking', 'hidden', 1);

        // Calculate total cost on form refresh
        calculate_total_cost(frm);
    },
    accommodation_type: function(frm) {
        // Hide both fields initially
        frm.set_df_property('no_of_tents_needed', 'hidden', 1);
        frm.set_df_property('room_booking', 'hidden', 1);

        // Show fields based on the selected accommodation type
        if (frm.doc.accommodation_type === 'Rooms') {
            frm.set_df_property('room_booking', 'hidden', 0);
        } else if (frm.doc.accommodation_type === 'Tents') {
            frm.set_df_property('no_of_tents_needed', 'hidden', 0);
        }
    },
    // Recalculate total cost when activities table changes
    activities_add: function(frm) {
        calculate_total_cost(frm);
    },
    activities_remove: function(frm) {
        calculate_total_cost(frm);
    },
    // Recalculate total cost when room booking table changes
    room_booking_add: function(frm) {
        calculate_total_cost(frm);
    },
    room_booking_remove: function(frm) {
        calculate_total_cost(frm);
    },
    // Recalculate when cost or price values are changed
    'activities.*.cost': function(frm) {
        calculate_total_cost(frm);
    },
    'room_booking.*.price': function(frm) {
        calculate_total_cost(frm);
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
