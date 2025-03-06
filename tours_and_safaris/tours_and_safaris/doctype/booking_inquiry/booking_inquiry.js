frappe.ui.form.on('Booking Inquiry', {
    onload: function(frm) {
        if (!frm.doc.inquiry_date) {
            frm.set_value('inquiry_date', frappe.datetime.get_today());
        }

        frm.trigger('toggle_fields');
    },
    refresh: function(frm) {
        if (frm.doc.docstatus === 1) {  
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
        if (!frm.is_new()) {  // Show button only if the document is saved
            frm.add_custom_button(__('Download PDF'), function() {
                var docname = frm.doc.name;
                var doctype = "Booking Inquiry";
                var print_format = "Booking Inquiry PDF";  // Use the custom print format name

                window.open(frappe.urllib.get_full_url(
                    "/api/method/frappe.utils.print_format.download_pdf?"
                    + "doctype=" + doctype
                    + "&name=" + docname
                    + "&format=" + print_format
                    + "&no_letterhead=0"  // 0 = Use letterhead, 1 = No letterhead
                ));
            }, __("Actions"));  // Adds button under "Actions" menu
        }

        frm.fields_dict["activities"].grid.get_field("activity_name").get_query = function (doc, cdt, cdn) {
            let row = locals[cdt][cdn];
            if (row.activity_group) {
                return {
                    filters: {
                        "custom_category": row.activity_group  
                    }
                };
            }
        };
    },
    new_customer: function(frm) {
        if (frm.doc.new_customer) {
            frappe.model.with_doctype('Lead', function() {
                let lead = frappe.model.get_new_doc('Lead');

                
                lead.first_name = frm.doc.customer_name || '';
                lead.source = 'Booking Inquiry';

    
                frappe.route_options = { booking_inquiry_ref: frm };

                // Open the Lead form
                frappe.set_route('Form', 'Lead', lead.name);
            });
        }
    },
    existing_customer: function(frm) {
        frm.trigger('toggle_fields'); 
    },

    from_date: function(frm) {
    
        if (frm.doc.from_date && frappe.datetime.get_diff(frm.doc.from_date, frappe.datetime.get_today()) < 0) {
            frappe.msgprint("From Date cannot be in the past.");
        
            frm.set_value("from_date", frappe.datetime.get_today());
        }
    },

    toggle_fields: function(frm) {
        let is_existing = frm.doc.existing_customer;

        frm.toggle_display('lead_name', !is_existing); 
        frm.toggle_display('new_customer', !is_existing); 
    },
     rooms: function(frm) {
        toggle_tables(frm);
    },

    tents: function(frm) {
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

    if (!needed) {
        
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


function create_reservation(frm) {
    frappe.model.with_doctype("Reservation", function() {
        let reservation = frappe.model.get_new_doc("Reservation");

        reservation.booking_inquiry = frm.doc.name;
        reservation.customer_name = frm.doc.customer_name;
        reservation.status = "Reserved";
        reservation.no_of_people = frm.doc.no_of_people; 
        reservation.no_of_adults = frm.doc.no_of_adults;
        reservation.no_of_children = frm.doc.no_of_children;
        reservation.arrival_date = frm.doc.from_date;  
        reservation.depature_date = frm.doc.to_date; 
        reservation.activity = frm.doc.purpose_of_visit;
        reservation.guest_details = frm.doc.guest_details;
        reservation.activities =frm.doc.activities;
        reservation.tent_selection = frm.doc.tent_selection;
        reservation.room_booking = frm.doc.room_booking;
        reservation.transport = frm.doc.transport_service;
        reservation.accommodation_needed = frm.doc.accommodation_needed;
        reservation.rooms = frm.doc.rooms;
        reservation.tents = frm.doc.tents;
        reservation.dietary_requirements = frm.doc.dietary_preferences;

        frappe.set_route("Form", "Reservation", reservation.name);
    });
}

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

function handle_reservation_creation(frm) {
    if (frm.doc.new_customer) {
        // If it's a new customer, first convert the Lead to a Customer
        convert_lead_to_customer(frm.doc.customer_name, function(customer_name) {
            frm.set_value("customer_name", customer_name); // Update Booking Inquiry
            frm.save();  // Save the form after updating
            create_reservation(frm); // Now create the reservation
        });
    } else {
        // If it's an existing customer, directly create the reservation
        create_reservation(frm);
    }
}

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
    frm.disable_save();  
    frm.set_df_property("reason_for_cancellation", "read_only", 1);

    frm.fields.forEach(field => {
        frm.set_df_property(field.df.fieldname, "read_only", 1);
    });

    frm.clear_custom_buttons();  
    frm.refresh_fields();
}

frappe.ui.form.on("Activities", {
    activity_group: function (frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        if (row.activity_group) {
            frm.fields_dict["activities"].grid.get_field("activity_name").get_query = function () {
                return {
                    filters: {
                        "custom_category": row.activity_group  
                    }
                };
            };
        }
    }
});

