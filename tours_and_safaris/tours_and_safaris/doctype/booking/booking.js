
frappe.ui.form.on('Booking', {
    refresh: function(frm) {
        // Filter available rooms only
        frm.set_query('room', function() {
            return {
                filters: {
                    status: 'Available'
                }
            };
        });

        
        if (frm.doc.status === 'Open') {
            frm.add_custom_button('Check Out', function() {
                frappe.call({
                    method: 'tours_and_safaris.tours_and_safaris.doctype.booking.booking.check_out',  // Update this to match your app's path
                    args: { booking_name: frm.doc.name },
                    callback: function(response) {
                        frappe.msgprint('Room has been marked as Under Maintenance, and check-out log created.');
                        frm.reload_doc();
                    }
                });
            });
        }
    }
});
