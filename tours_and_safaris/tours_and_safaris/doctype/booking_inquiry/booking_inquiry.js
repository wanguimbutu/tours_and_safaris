frappe.ui.form.on('Booking Inquiry', {
    onload: function(frm) {
        if (!frm.doc.inquiry_date) {
            frm.set_value('inquiry_date', frappe.datetime.get_today());
        }

        frm.trigger('toggle_fields');
    },
    refresh: function(frm) {
        calculate_total_amount(frm);
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
            toggle_meals_table(frm);
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

                
                lead.first_name = frm.doc.customer || '';
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
        
            frm.set_value("from_date", '');
        }
    },
    to_date:function(frm){
        if(frm.doc.to_date && frappe.datetime.get_diff(frm.doc.to_date, frm.doc.from_date) < 0){
            frappe.msgprint("To Date cannot be earlier than From Date.");

            frm.set_value("to_date", '');
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
    },
    no_of_people: function(frm) {
        update_qty_fields(frm);
        calculate_total_cost(frm);
        validate_people_count(frm);
    },
    no_of_adults: function(frm){
        validate_people_count(frm);
    },
    no_of_children: function(frm){
        validate_people_count(frm);
    },

    meals_required: function(frm){
        toggle_meals_table(frm);
    },
    
}); 

function validate_people_count(frm) {
    let total_people = frm.doc.no_of_people;
    let adults = frm.doc.no_of_adults;
    let children = frm.doc.no_of_children;

    if (total_people && adults !== undefined && children !== undefined) {
        if (total_people !== (adults + children)) {
            frappe.msgprint(__('Total People must be equal to the sum of Adults and Children.'));
            frm.set_value('no_of_people', '');
        }
    }
}

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

function toggle_meals_table(frm) {
    frm.set_df_property("meals", "hidden", !frm.doc.meals_required);
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
        reservation.customer_name = frm.doc.customer;
        reservation.status = "Reserved";
        reservation.no_of_people = frm.doc.no_of_people; 
        reservation.no_of_adults = frm.doc.no_of_adults;
        reservation.no_of_children = frm.doc.no_of_children;
        reservation.arrival_date = frm.doc.from_date;  
        reservation.depature_date = frm.doc.to_date; 
        reservation.guest_details = frm.doc.guest_details;
        reservation.activities =frm.doc.activities;
        reservation.tent_selection = frm.doc.tent_selection;
        reservation.room_type_booking = frm.doc.room_booking;
        reservation.transport = frm.doc.transport_service;
        reservation.accommodation_needed = frm.doc.accommodation_needed;
        reservation.rooms = frm.doc.rooms;
        reservation.tents = frm.doc.tents;
        reservation.dietary_requirements = frm.doc.dietary_preferences;
        reservation.proposed_total_cost = frm.doc.proposed_total_cost;
        reservation.meals = frm.doc.meals;

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
        
        convert_lead_to_customer(frm.doc.customer, function(customer) {
            frm.set_value("customer", customer); 
            frm.save();  
            create_reservation(frm); 
        });
    } else {
        
        create_reservation(frm);
    }
}

function convert_lead_to_customer(lead_name, callback) {
    frappe.call({
        method: "frappe.client.insert",
        args: {
            doc: {
                doctype: "Customer",
                customer: lead_name
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


function validate_qty(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    let max_people = frm.doc.no_of_people || 0;

    if (row.qty > max_people) {
        frappe.msgprint(__("Quantity cannot exceed No of People (" + max_people + ")"));
        row.qty = max_people;
        frm.refresh_field(cdt);
    }

    calculate_row_amount(frm, cdt, cdn);
    calculate_total_cost(frm);
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
function update_amount(frm, cdt, cdn, table_name) {
    let row = locals[cdt][cdn];

    // Validate qty against no_of_people
    let no_of_people = frm.doc.no_of_people || 0;
    if (row.qty > no_of_people) {
        frappe.msgprint(__('Quantity cannot exceed the number of people.'));
        frappe.model.set_value(cdt, cdn, 'qty', no_of_people);
        return;
    }

    if (row.qty && row.rate) {
        frappe.model.set_value(cdt, cdn, 'amount', row.qty * row.rate);
    } else {
        frappe.model.set_value(cdt, cdn, 'amount', 0);
    }

    calculate_total_amount(frm);
}

// Function to calculate total amount from all relevant tables
function calculate_total_amount(frm) {
    let total = 0;

    // List of tables to sum amounts from
    let tables = ['activities', 'tent_selection','room_booking','hired_services','meals','transport'];

    tables.forEach(table => {
        (frm.doc[table] || []).forEach(row => {
            total += row.amount || 0;
        });
    });

    frm.set_value('proposed_total_cost', total); // Assuming 'total_amount' is the total field
}

// Attach the update function dynamically to multiple tables
['Activity Package', 'Tent Selection','Meal Inquiry','Room Type Booking','Reservation Services','Transport'].forEach(table_name => {
    frappe.ui.form.on(table_name, {
        qty: function(frm, cdt, cdn) {
            update_amount(frm, cdt, cdn, table_name);
        
        },
        rate: function(frm, cdt, cdn) {
            update_amount(frm, cdt, cdn, table_name);
        }
    });
});
