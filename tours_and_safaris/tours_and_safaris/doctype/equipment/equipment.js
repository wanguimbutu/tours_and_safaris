// Copyright (c) 2025, wanguimbutu and contributors
// For license information, please see license.txt

frappe.ui.form.on('Equipment', {
    onload: function(frm) {
        toggle_equipment_details(frm);  // ensures it's hidden initially
    },

    is_itemized: function(frm) {
        toggle_equipment_details(frm);
    }
});

function toggle_equipment_details(frm) {
    frm.set_df_property('equipment_details', 'hidden', !frm.doc.is_itemized);
}
