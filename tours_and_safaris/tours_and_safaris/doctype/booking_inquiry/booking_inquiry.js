frappe.ui.form.on('Booking Inquiry', {
    onload: function(frm) {
        if (!frm.doc.inquiry_date) {
            frm.set_value('inquiry_date', frappe.datetime.get_today());
        }

        frm.trigger('toggle_fields');
    },
    refresh: function(frm) {
        calculate_total_amount(frm);
        toggle_exchange_rate_field(frm);
        toggle_meals_table(frm);

            if (frm.doc.docstatus === 1) {
                frappe.call({
                    method: "frappe.client.get_list",
                    args: {
                        doctype: "Quotation",
                        filters: {
                            "custom_booking_inquiry": frm.doc.name,
                            "docstatus": 1  
                        },
                        fields: ["name"]
                    },
                    callback: function(response) {
                        if (response.message && response.message.length > 0) {
                            frm.remove_custom_button(__('Create Quotation'));
                        } else {
                            frm.add_custom_button('Create Quotation', function () {
                                frappe.call({
                                    method: "tours_and_safaris.tours_and_safaris.doctype.booking_inquiry.booking_inquiry.create_quotation",
                                    args: { inquiry_name: frm.doc.name },
                                    callback: function (response) {
                                        if (response.message) {
                                            frappe.msgprint({
                                                title: __("Success"),
                                                message: `Quotation <a href="/app/quotation/${response.message.quotation_name}" target="_blank">${response.message.quotation_name}</a> created successfully.`,
                                                indicator: "green"
                                            });
            
                                            frappe.set_route("Form", "Quotation", response.message.quotation_name);
                                        }
                                    }
                                });
                            }, __("Actions"));
                        }
                    }
                });
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

    customer: function(frm) {
        set_price_list(frm);
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
    billing_currency: function(frm) {
        toggle_exchange_rate_field(frm);
        recalculate_rates(frm);
    },

    exchange_rate: function(frm) {
        recalculate_rates(frm);
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
        //calculate_total_cost(frm);
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


/*function create_reservation(frm) {
    frappe.model.with_doctype("Reservation", function() {
        let reservation = frappe.model.get_new_doc("Reservation");

        reservation.booking_inquiry = frm.doc.name;
        reservation.customer = frm.doc.customer;
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
        reservation.transport_service = frm.doc.transport_service;
        reservation.accommodation_needed = frm.doc.accommodation_needed;
        reservation.rooms = frm.doc.rooms;
        reservation.tents = frm.doc.tents;
        reservation.dietary_requirements = frm.doc.dietary_preferences;
        reservation.proposed_total_cost = frm.doc.proposed_total_cost;
        reservation.meals = frm.doc.meals;
        reservation.exchange_rate = frm.doc.exchange_rate;
        reservation.billing_currency = frm.doc.billing_currency;
        reservation.remarks = frm.doc.remarks;
        frappe.set_route("Form", "Reservation", reservation.name);
    });
}
    */

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

function toggle_exchange_rate_field(frm) {
    if (frm.doc.billing_currency && frm.doc.billing_currency !== 'KES') {
        frm.set_df_property('exchange_rate', 'reqd', 1); // Make required
        frm.set_df_property('exchange_rate', 'hidden', 0); // Show field
    } else {
        frm.set_df_property('exchange_rate', 'reqd', 0); // Make optional
        frm.set_df_property('exchange_rate', 'hidden', 1); // Hide field
        frm.set_value('exchange_rate', 1); // Default to 1 when KES is used
    }
}

// Recalculate rates based on exchange rate
function recalculate_rates(frm) {
    if (frm.doc.billing_currency && frm.doc.billing_currency !== 'KES' && frm.doc.exchange_rate) {
        let tables = [ 'tent_selection','transport_service','hired_service'];

        tables.forEach(table => {
            (frm.doc[table] || []).forEach(row => {
                let converted_rate = row.original_rate * frm.doc.exchange_rate;
                frappe.model.set_value(row.doctype, row.name, 'rate', converted_rate);
                frappe.model.set_value(row.doctype, row.name, 'currency', frm.doc.billing_currency);
            });
        });

        calculate_total_amount(frm);
    }
}
function update_amount(frm, cdt, cdn) {
    let row = locals[cdt][cdn];

    let excluded_tables = ['meals', 'transport_service'];

    let no_of_people = frm.doc.no_of_people || 0;
    if (!excluded_tables.includes(row.parentfield) && row.qty > no_of_people) {
        frappe.msgprint(__('Quantity cannot exceed the number of people.'));
        frappe.model.set_value(cdt, cdn, 'qty', no_of_people);
        return;
    }


    if (!row.rate) return;

    if (!row.original_rate) {
        frappe.model.set_value(cdt, cdn, 'original_rate', row.rate);
    }

    let rate = row.rate;
    if (frm.doc.billing_currency && frm.doc.billing_currency !== 'KES' && frm.doc.exchange_rate) {
        rate = row.original_rate / frm.doc.exchange_rate;
        frappe.model.set_value(cdt, cdn, 'rate', rate);
        frappe.model.set_value(cdt, cdn, 'currency', frm.doc.billing_currency);
    }

    let amount = row.qty && rate ? row.qty * rate : 0;
    frappe.model.set_value(cdt, cdn, 'amount', amount);

    calculate_total_amount(frm);
}

function calculate_total_amount(frm) {
    let total = 0;
    let tables = ['activities', 'tent_selection', 'room_booking', 'transport_service', 'meals', 'hired_service'];

    tables.forEach(table => {
        (frm.doc[table] || []).forEach(row => {
            total += row.amount || 0;
        });
    });

    frm.set_value('proposed_total_cost', total); 
}

['Activity Package', 'Tent Selection', 'Room Type Booking', 'Transport', 'Meal Inquiry', 'Reservation Services'].forEach(table_name => {
    frappe.ui.form.on(table_name, {
        qty: function(frm, cdt, cdn) {
            update_amount(frm, cdt, cdn);
        },
        rate: function(frm, cdt, cdn) {
            update_amount(frm, cdt, cdn);
        }
    });
});

frappe.ui.form.on('Activity Package', {
    activity_name: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        if (!row) {
            console.error("Row is missing in activity_name.");
            return;
        }

        
        let price_list = "Resident"; 
        if (frm.doc.billing_currency && frm.doc.billing_currency !== "KES") {
            price_list = "Non Resident";
        }

        console.log("🔍 Fetching rate from:", price_list, "for Activity:", row.activity_name);

    
        if (row.rate && row.rate !== 0) {
            console.log("🔄 User modified rate:", row.rate);
            return; 
        }

        frappe.call({
            method: "frappe.client.get_value",
            args: {
                doctype: "Item Price",
                filters: {
                    item_name: row.activity_name,  
                    price_list: price_list
                },
                fieldname: ["price_list_rate", "name"]
            },
            callback: function(response) {
                console.log("🔄 Response from Item Price:", response);

                if (response.message) {
                    if (response.message.price_list_rate) {
                        let rate = response.message.price_list_rate;
                        frappe.model.set_value(cdt, cdn, "rate", rate);
                        console.log(" Price found:", rate, "for", row.activity_name);
                    } else {
                        frappe.msgprint(__("⚠ No price found for {0} in {1}", [row.activity_name, price_list]));
                    }
                } else {
                    frappe.msgprint(__("No response from Item Price API"));
                }

                update_amount(frm, cdt, cdn);
            }
        });
    }
});

frappe.ui.form.on('Room Type Booking', {
    room_type: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        if (!row) {
            console.error("Row is missing in meal_type.");
            return;
        }

        let price_list = "Resident"; 
        if (frm.doc.billing_currency && frm.doc.billing_currency !== "KES") {
            price_list = "Non Resident";
        }

        console.log("🔍 Fetching rate from:", price_list, "for Meal Type:", row.room_type);

        if (row.rate && row.rate !== 0) {
            console.log("🔄 User modified rate:", row.rate);
            return; 
        }

        frappe.call({
            method: "frappe.client.get_value",
            args: {
                doctype: "Item Price",
                filters: {
                    item_code: row.room_type,  
                    price_list: price_list
                },
                fieldname: ["price_list_rate", "name"]
            },
            callback: function(response) {
                console.log("🔄 Response from Item Price:", response);

                if (response.message) {
                    if (response.message.price_list_rate) {
                        let rate = response.message.price_list_rate;
                        frappe.model.set_value(cdt, cdn, "rate", rate);
                        console.log(" Price found:", rate, "for", row.room_type);
                    } else {
                        frappe.msgprint(__("⚠ No price found for {0} in {1}", [row.room_type, price_list]));
                    }
                } else {
                    frappe.msgprint(__("No response from Item Price API"));
                }

    
                update_amount(frm, cdt, cdn);
            }
        });
    }
});


frappe.ui.form.on('Meal Inquiry', {
    meal_type: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        if (!row) {
            console.error("Row is missing in meal_type.");
            return;
        }

        
        let price_list = "Resident"; 
        if (frm.doc.billing_currency && frm.doc.billing_currency !== "KES") {
            price_list = "Non Resident";
        }

        console.log("🔍 Fetching rate from:", price_list, "for Meal Type:", row.room_type);

    
        if (row.rate && row.rate !== 0) {
            console.log("🔄 User modified rate:", row.rate);
            return; 
        }

    
        frappe.call({
            method: "frappe.client.get_value",
            args: {
                doctype: "Item Price",
                filters: {
                    item_code: row.meal_type,  
                    price_list: price_list
                },
                fieldname: ["price_list_rate", "name"]
            },
            callback: function(response) {
                console.log("🔄 Response from Item Price:", response);

                if (response.message) {
                    if (response.message.price_list_rate) {
                        let rate = response.message.price_list_rate;
                        frappe.model.set_value(cdt, cdn, "rate", rate);
                        console.log(" Price found:", rate, "for", row.meal_type);
                    } else {
                        frappe.msgprint(__("⚠ No price found for {0} in {1}", [row.meal_type, price_list]));
                    }
                } else {
                    frappe.msgprint(__("No response from Item Price API"));
                }

                update_amount(frm, cdt, cdn);
            }
        });
    }
});



function set_price_list(frm) {
    if (frm.doc.customer) {
        frappe.call({
            method: 'frappe.client.get_value',
            args: {
                doctype: 'Customer',
                filters: { name: frm.doc.customer },
                fieldname: 'default_currency'
            },
            callback: function(response) {
                if (response.message) {
                    let currency = response.message.default_currency;
                    let price_list = currency === 'KES' ? 'Resident Price List' : 'Non-Resident Price List';

                
                    frappe.model.set_value(frm.doctype, frm.docname, 'price_list', price_list);
                }
            }
        });
    }
}


function fetch_room_rate(frm, row, cdt, cdn) {
    if (frm.doc.customer && row.room_type) {
        frappe.call({
            method: 'frappe.client.get_value',
            args: {
                doctype: 'Customer',
                filters: { name: frm.doc.customer },
                fieldname: 'default_currency'
            },
            callback: function(response) {
                if (response.message) {
                    let currency = response.message.default_currency;
                    let price_list = currency === 'KES' ? 'Resident Price List' : 'Non-Resident Price List';

                    // Fetch rate from Item Price
                    frappe.call({
                        method: 'frappe.client.get_value',
                        args: {
                            doctype: 'Item Price',
                            filters: { 
                                price_list: price_list,
                                item_code: row.room_type
                            },
                            fieldname: 'price_list_rate'
                        },
                        callback: function(price_response) {
                            if (price_response.message) {
                                frappe.model.set_value(cdt, cdn, 'rate', price_response.message.price_list_rate);
                                update_amount(frm, cdt, cdn);  // Call your working function here
                            } else {
                                frappe.msgprint(__('No rate found for this room type in ' + price_list));
                            }
                        }
                    });
                }
            }
        });
    }
}
