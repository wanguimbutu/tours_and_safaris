// Copyright (c) 2025, wanguimbutu and contributors
// For license information, please see license.txt

frappe.ui.form.on("Room Allocation", {
 	refresh(frm) {
		frm.fields_dict['booked_rooms'].grid.get_field('room_name').get_query = function(doc, cdt, cdn) {
            let row = locals[cdt][cdn];
            return {
                filters: {
                    room_type: row.room_type
                }
            };
        }
 	},
	 room_booking_add: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        apply_room_name_filter(frm, row);
    },
	room_booking_remove: function(frm, cdt, cdn) {
		let row = locals[cdt][cdn];
		apply_room_name_filter(frm, row);
	},
 });

 frappe.ui.form.on("Inquiry Room Booking", {  
    room_type(frm, cdt, cdn) {
        const row = locals[cdt][cdn];

        if (!frm.doc.arrival_date || !frm.doc.departure_date) {
            frappe.msgprint("Please select Arrival Date and Departure Date first.");
            return;
        }

        frappe.call({
            method: "tours_and_safaris.tours_and_safaris.doctype.room_allocation.room_allocation.get_available_rooms",
            args: {
                room_type: row.room_type,
                check_in_date: frm.doc.arrival_date,
                check_out_date: frm.doc.departure_date
            },
            callback: function (r) {
                if (r.message && r.message.length > 0) {
                    const options = r.message.map(room => ({ label: room, value: room }));

                    const dialog = new frappe.ui.Dialog({
                        title: `Select Rooms for ${row.room_type}`,
                        fields: [
                            {
                                label: "Available Rooms",
                                fieldname: "selected_rooms",
                                fieldtype: "MultiCheck",
                                options: options,
                                columns: 2
                            }
                        ],
                        primary_action_label: "Add Rooms",
                        primary_action(values) {
                            if (values.selected_rooms && values.selected_rooms.length > 0) {
                                frappe.model.clear_doc(cdt, cdn);

                                values.selected_rooms.forEach(room_name => {
                                    const new_row = frm.add_child("booked_rooms");
                                    new_row.room_type = row.room_type;
                                    new_row.room_name = room_name;
                                });

                                frm.refresh_field("booked_rooms");
                                dialog.hide();
                            } else {
                                frappe.msgprint("No rooms selected.");
                            }
                        }
                    });

                    dialog.show();
                } else {
                    frappe.msgprint("No available rooms for the selected Room Type and Dates.");
                }
            }
        });
	}
});

function apply_room_name_filter(frm, row) {
    frm.fields_dict['room_booking'].grid.get_field('room_name').get_query = function(doc, cdt, cdn) {
        return {
            filters: {
                room_type: row.room_type
            }
        };
    };
}