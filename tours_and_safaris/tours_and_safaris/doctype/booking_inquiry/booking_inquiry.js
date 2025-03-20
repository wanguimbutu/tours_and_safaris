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
        
            frm.set_value("from_date", frappe.datetime.get_today());
        }
    },
    to_date:function(frm){
        if(frm.doc.to_date && frappe.datetime.get_diff(frm.doc.to_date, frm.doc.from_date) < 0){
            frappe.msgprint("To Date cannot be earlier than From Date.");

            frm.set_value("to_date", frm.doc.from_date);
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
    },

    meals_required: function(frm){
        toggle_meals_table(frm);
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
        reservation.customer = frm.doc.customer;
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
function update_qty_fields(frm) {
    let people_count = frm.doc.no_of_people || 0;
    console.log("Updating qty fields. People count:", people_count);

    if (frm.doc.activities) {
        frm.doc.activities.forEach(activity => {
            activity.qty = people_count;
            activity.amount = (activity.cost || 0) * people_count;
            console.log(`Updated Activity: Qty = ${activity.qty}, Cost = ${activity.cost}, Amount = ${activity.amount}`);
        });
    }

    if (frm.doc.room_booking) {
        frm.doc.room_booking.forEach(room => {
            room.qty = people_count;
            room.amount = (room.price || 0) * people_count;
            console.log(`Updated Room: Qty = ${room.qty}, Price = ${room.price}, Amount = ${room.amount}`);
        });
    }

    if (frm.doc.hired_service) {
        frm.doc.hired_service.forEach(service => {
            service.qty = people_count;
            service.amount = (service.price || 0) * people_count;
            console.log(`Updated Service: Qty = ${service.qty}, Price = ${service.price}, Amount = ${service.amount}`);
        });
    }

    if (frm.doc.tent_selection) {
        frm.doc.tent_selection.forEach(tent => {
            tent.qty = people_count;
            tent.amount = (tent.price || 0) * people_count;
            console.log(`Updated Tent: Qty = ${tent.qty}, Price = ${tent.price}, Amount = ${tent.amount}`);
        });
    }
    
    if(frm.doc.meals){
        frm.doc.meals.forEach(meals =>{
            meals.qty =people_count;
            meals.amount =(meals.cost || 0) * people_count;
            console.log(`Updated Meals: Qty = ${meals.qty}, Cost = ${meals.cost}, Amount = ${meals.amount}`);
        })
    }

    frm.refresh_field("activities");
    frm.refresh_field("room_booking");
    frm.refresh_field("hired_service");
    frm.refresh_field("tent_selection");
    frm.refresh_field("meals");
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
frappe.ui.form.on("Activity Package", {
    activities_add: function(frm, cdt, cdn) {
        update_row_qty(frm, cdt, cdn);
        calculate_total_cost(frm);
    },
    qty: function(frm, cdt, cdn) {
        calculate_row_amount(frm, cdt, cdn);
        calculate_total_cost(frm);
    },
    cost: function(frm, cdt, cdn) {
        calculate_row_amount(frm, cdt, cdn);
        calculate_total_cost(frm);
    }
});

frappe.ui.form.on("Room Type Booking", {
    room_booking_add: function(frm, cdt, cdn) {
        update_row_qty(frm, cdt, cdn);
        calculate_total_cost(frm);
    },
    qty: function(frm, cdt, cdn) {
        calculate_row_amount(frm, cdt, cdn);
        calculate_total_cost(frm);
    },
    cost: function(frm, cdt, cdn) {
        calculate_row_amount(frm, cdt, cdn);
        calculate_total_cost(frm);
    }
});

frappe.ui.form.on("Reservation Services",{
    hired_service_add: function(frm,cdt,cdn){
        update_row_qty(frm,cdt,cdn);
        calculate_total_cost(frm);
    },
    qty: function(frm, cdt, cdn) {
        calculate_row_amount(frm, cdt, cdn);
        calculate_total_cost(frm);
    },
    cost: function(frm, cdt, cdn) {
        calculate_row_amount(frm, cdt, cdn);
        calculate_total_cost(frm);
    }
});

frappe.ui.form.on("Tent Selection",{
    tent_selection_add: function(frm,cdt,cdn){
        update_row_qty(frm,cdt,cdn);
        calculate_total_cost(frm);
    },
    qty: function(frm, cdt, cdn) {
        calculate_row_amount(frm, cdt, cdn);
        calculate_total_cost(frm);
    },
    cost: function(frm, cdt, cdn) {
        calculate_row_amount(frm, cdt, cdn);
        calculate_total_cost(frm);
    }
});

frappe.ui.form.on("Meals",{
    meals_add:function(frm,cdt,cdn){
        update_row_qty(frm,cdt,cdn);
        calculate_total_cost(frm);
    },
    qty: function(frm, cdt, cdn) {
        calculate_row_amount(frm, cdt, cdn);
        calculate_total_cost(frm);
    },
    cost: function(frm, cdt, cdn) {
        calculate_row_amount(frm, cdt, cdn);
        calculate_total_cost(frm);
    }
})

frappe.ui.form.on("Transport Service", {
    transport_service_add: function(frm, cdt, cdn) {
        update_row_qty(frm, cdt, cdn);
        calculate_total_cost(frm);
    },
    qty: function(frm, cdt, cdn) {
        calculate_row_amount(frm, cdt, cdn);
        calculate_total_cost(frm);
    },
    cost: function(frm, cdt, cdn) {
        calculate_row_amount(frm, cdt, cdn);
        calculate_total_cost(frm);
    }
});

function update_row_qty(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    row.qty = frm.doc.no_of_people || 0;
    row.amount = (row.cost || 0) * row.qty;
    frm.refresh_field(cdt);
}

function calculate_row_amount(frm, cdt, cdn) {
    let row = locals[cdt][cdn];

    let qty = row.qty || 0;
    let cost = row.cost || row.price || row.rate || row.price_per_unit || 0;  // Try different possible field names

    let amount = qty * cost;

    console.log(`Before Update: Tent Row: Qty = ${qty}, Price = ${cost}, Amount = ${amount}`);

    // Ensure the amount is set properly
    frappe.model.set_value(cdt, cdn, "amount", amount);

    console.log(`After Update: Tent Row: Qty = ${qty}, Price = ${cost}, Amount = ${amount}`);
}


function calculate_total_cost(frm) {
    let total_cost = 0;

    console.log("Calculating Total Cost...");

    if (frm.doc.activities) {
        frm.doc.activities.forEach(activity => {
            let row_total = (activity.qty || 0) * (activity.cost || 0);
            console.log(`Activity Row: Qty = ${activity.qty}, Cost = ${activity.cost}, Row Total = ${row_total}`);
            total_cost += row_total;
        });
    }

    if (frm.doc.room_booking) {
        frm.doc.room_booking.forEach(room => {
            let row_total = (room.qty || 0) * (room.price || 0);
            console.log(`Room Row: Qty = ${room.qty}, Price = ${room.price}, Row Total = ${row_total}`);
            total_cost += row_total;
        });
    }

    if (frm.doc.hired_service) {
        frm.doc.hired_service.forEach(service => {
            let row_total = (service.qty || 0) * (service.price || 0);
            console.log(`Hired Service Row: Qty = ${service.qty}, Price = ${service.price}, Row Total = ${row_total}`);
            total_cost += row_total;
        });
    }

    if (frm.doc.tent_selection) {
        frm.doc.tent_selection.forEach(tent => {
            let row_total = (tent.qty || 0) * (tent.price || 0);
            console.log(`Tent Row: Qty = ${tent.qty}, Price = ${tent.price}, Row Total = ${row_total}`);
            total_cost += row_total;
        });
    }
    if(frm.doc.meals){
        frm.doc.meals.forEach(meals =>{
            let row_total = (meals.qty || 0) * (meals.cost || 0);
            console.log(`Meals Row: Qty = ${meals.qty}, Cost = ${meals.cost}, Row Total = ${row_total}`);
            total_cost += row_total;
        });
    }

    console.log("Final Calculated Total Cost:", total_cost);

    frm.set_value("proposed_total_cost", total_cost);
    frm.refresh_field("proposed_total_cost");
}
