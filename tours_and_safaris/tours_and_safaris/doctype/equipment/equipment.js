// Copyright (c) 2025, wanguimbutu and contributors
// For license information, please see license.txt

frappe.ui.form.on("Equipment", {
 	refresh(frm) {
        toggle_itemized_field(frm);
 	},
    is_itemized:function(frm){
        toggle_itemized_field(frm);
    }

 });
function toggle_itemized_field(frm){
    if(frm.doc.is_itemized === 1){
        frm.set.df.property("equipment_details","hidden", 0);
    }
    else{
        frm.set.df.property("equipment_details","hidden", 1);
    }
}