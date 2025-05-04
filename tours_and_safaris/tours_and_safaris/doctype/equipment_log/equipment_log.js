// Copyright (c) 2025, wanguimbutu and contributors
// For license information, please see license.txt

frappe.ui.form.on("Equipment Log", {
    after_save: function(frm) {
        if (frm.doc.task_name) {
            frappe.call({
                method: "frappe.client.set_value",
                args: {
                    doctype: "Task",
                    name: frm.doc.task_name,
                    fieldname: "status",
                    value: "Completed"
                },
                callback: function(response) {
                    if (!response.exc) {
                        frappe.show_alert({message: "Task marked as Working", indicator: "green"});
                    }
                }
            });
        }
    },
    equipment_name: function(frm) {
        fetch_and_fill_itemized(frm);
    },
    quantity_issued: function(frm) {
        fetch_and_fill_itemized(frm);
    }
});

function fetch_and_fill_itemized(frm) {
    if (!frm.doc.equipment_name) return;

    frappe.call({
        method: 'frappe.client.get',
        args: {
            doctype: 'Equipment',
            name: frm.doc.equipment_name
        },
        callback: function(res) {
            const equipment = res.message;
            if (!equipment) return;

            // Clear both tables first
            frm.clear_table('itemized_equipment_issue');
            frm.clear_table('unitemized_equipment_issue');
            frm.refresh_fields(['itemized_equipment_issue', 'unitemized_equipment_issue']);

            if (equipment.is_itemized) {
                let available_serials = (equipment.equipment_details || []).filter(row => row.status === "Available");

                if (available_serials.length === 0) {
                    frappe.msgprint("No available itemized equipment found.");
                    return;
                }

                let quantity = frm.doc.quantity_issued || 20;
                if (!frm.doc.quantity_issued) {
                    frappe.msgprint(`Quantity not entered. Defaulting to first ${quantity} available items.`);
                }

                available_serials.slice(0, quantity).forEach(serial => {
                    let child = frm.add_child('itemized_equipment_issue');
                    child.serial_number = serial.serial_number;
                    child.equipment_name = frm.doc.equipment_name;
                    child.select = 1;
                });

                frm.refresh_field('itemized_equipment_issue');
                frappe.msgprint(`Added ${Math.min(quantity, available_serials.length)} itemized units.`);
            } else {
                // Equipment is not itemized: advise user to manually use the unitemized table
                frappe.msgprint("This equipment is not itemized. You can manually fill the Unitemized Equipment Issue table.");
            }
        }
    });
}

