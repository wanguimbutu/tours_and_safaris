frappe.ui.form.on('Booking Inquiry', {
    onload: function(frm) {
        if (!frm.doc.inquiry_date) {
            frm.set_value('inquiry_date', frappe.datetime.get_today());
        }

        frm.trigger('toggle_fields');
    },
    refresh: function(frm) {
        if (frm.doc.docstatus === 1) {  // Only show buttons after submission
            if (frm.doc.status === "Lost") {
                disable_form_actions(frm);
            } else {
                frm.add_custom_button(__('Create Reservation'), function() {
                    create_reservation(frm);
                }, __("Actions"));

                frm.add_custom_button(__('Set as Lost'), function() {
                    set_as_lost(frm);
                }, __("Actions"));
            }
        }
    },
    new_customer: function(frm) {
        if (frm.doc.new_customer) {
            frappe.model.with_doctype('Lead', function() {
                let lead = frappe.model.get_new_doc('Lead');

                // Pre-fill details
                lead.first_name = frm.doc.customer_name || '';
                lead.source = 'Booking Inquiry';

                // Store the current Booking Inquiry ID in route_options
                frappe.route_options = { booking_inquiry_ref: frm };

                // Open the Lead form
                frappe.set_route('Form', 'Lead', lead.name);
            });
        }
    },
    existing_customer: function(frm) {
        frm.trigger('toggle_fields'); // Toggle fields when "Existing Customer" is checked/unchecked
    },

    toggle_fields: function(frm) {
        let is_existing = frm.doc.existing_customer;

        frm.toggle_display('lead_name', !is_existing); // Hide Lead Name if Existing Customer is checked
        frm.toggle_display('new_customer', !is_existing); // Hide New Customer if Existing Customer is checked
    },
     rooms: function(frm) {
        toggle_tables(frm);
    },

    tents: function(frm) {
        toggle_tables(frm);
    },

    own_tents: function(frm) {
        toggle_tables(frm);
    }, 
    accommodation_needed: function(frm) {
        toggle_accommodation_options(frm);
    },
    transport_required: function(frm){
        toggle_transport_option(frm);
    }
}); 

function toggle_tables(frm) {
    let show_rooms = frm.doc.rooms;
    let show_tents = frm.doc.tents;
    let own_tents = frm.doc.own_tents;

    // If "Own Tents" is selected, hide both tables
    if (own_tents) {
        frm.set_df_property('room_booking', 'hidden', 1);
        frm.set_df_property('tent_selection', 'hidden', 1);
    } else {
        frm.set_df_property('room_booking', 'hidden', !show_rooms);
        frm.set_df_property('tent_selection', 'hidden', !show_tents);
    }

    frm.refresh_fields();
}

function toggle_accommodation_options(frm) {
    let needed = frm.doc.accommodation_needed;

    frm.set_df_property('rooms', 'hidden', !needed);
    frm.set_df_property('tents', 'hidden', !needed);
    frm.set_df_property('own_tents', 'hidden', !needed);

    if (!needed) {
        // If Accommodation Needed is unchecked, hide everything
        frm.set_df_property('room_booking', 'hidden', 1);
        frm.set_df_property('tent_selection', 'hidden', 1);
    }

    frm.refresh_fields();
}

function toggle_transport_option(frm){
    let required = frm.doc.transport_required;

    frm.set_df_property('transport_service', 'hidden', !required);

    if(!required){
        frm.set_df_property('transport_service', 'hidden', 1);
    }
}

// Function to create a reservation without saving it
function create_reservation(frm) {
    frappe.model.with_doctype("Reservation", function() {
        let reservation = frappe.model.get_new_doc("Reservation");

        // Map fields from Booking Inquiry to Reservation
        reservation.booking_inquiry = frm.doc.name;
        reservation.customer_name = frm.doc.customer_name;
        reservation.status = "Reserved";
        reservation.no_of_people = frm.doc.no_of_people; 
        reservation.no_of_adults = frm.doc.no_of_adults;
        reservation.no_of_children = frm.doc.no_of_children;
        reservation.arrival_date = frm.doc.from_date;  // Map from_date to arrival_date
        reservation.depature_date = frm.doc.to_date;  // Map to_date to departure_date
        reservation.activity = frm.doc.purpose_of_visit;
        reservation.guest_details = frm.doc.guest_details;
        reservation.tent_selection = frm.doc.tent_selection;
        reservation.room_booking = frm.doc.room_booking;
        reservation.transport = frm.doc.transport_service;



        // Open the new Reservation form without saving
        frappe.set_route("Form", "Reservation", reservation.name);
    });
}
// Function to set Booking Inquiry as Lost
function set_as_lost(frm) {
    frappe.prompt([
        {
            fieldname: "reason",
            label: "Reason for Cancellation",
            fieldtype: "Small Text",
            reqd: 1
        }
    ],
    function(values) {
        frappe.model.set_value(frm.doctype, frm.doc.name, "status", "Lost");
        frappe.model.set_value(frm.doctype, frm.doc.name, "reason_for_cancellation", values.reason);
        frm.refresh();
        frappe.msgprint(__('Booking Inquiry has been marked as Lost.'));
    },
    __("Set as Lost"),
    __("Confirm"));
}

// Function to convert a Lead to a Customer
function convert_lead_to_customer(lead_name, callback) {
    frappe.call({
        method: "frappe.client.insert",
        args: {
            doc: {
                doctype: "Customer",
                customer_name: lead_name
            }
        },
        callback: function(res) {
            if (res.message) {
                frappe.msgprint(__('Lead converted to Customer: ' + res.message.name));
                callback(res.message.name);
            }
        }
    });
}
function disable_form_actions(frm) {
    frm.disable_save();  // Disable Save button
    frm.set_df_property("reason_for_cancellation", "read_only", 1);

    frm.fields.forEach(field => {
        frm.set_df_property(field.df.fieldname, "read_only", 1);
    });

    frm.clear_custom_buttons();  // Remove action buttons
    frm.refresh_fields();
}