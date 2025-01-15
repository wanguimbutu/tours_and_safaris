// Copyright (c) 2025, wanguimbutu and contributors
// For license information, please see license.txt

frappe.ui.form.on('Booking Inquiry', {
    refresh: function(frm) {
        // Hide both fields initially
        frm.set_df_property('no_of_tents_needed', 'hidden', 1);
        frm.set_df_property('room_booking', 'hidden', 1);
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
    }
});
