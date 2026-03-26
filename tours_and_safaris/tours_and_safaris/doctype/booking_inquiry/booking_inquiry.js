frappe.ui.form.on('Booking Inquiry', {
    onload: function(frm) {
        if (!frm.doc.inquiry_date) {
            frm.set_value('inquiry_date', frappe.datetime.get_today());
        }

        frm.trigger('toggle_fields');
        
    },
    refresh: function(frm) {
        calculate_total_amount(frm);
        //toggle_exchange_rate_field(frm);
        toggle_meals_table(frm);

        add_status_indicator(frm);
        // Disable form if Lost
        if (frm.doc.status === 'Lost') {
            disable_form_actions(frm);
        }

        // Show buttons only if doc is submitted
        if (frm.doc.docstatus === 1) {
            handle_create_quotation_button(frm);
        }

        // Add PDF Download Button
        if (!frm.is_new()) {
            frm.add_custom_button(__('Download PDF'), function () {
                let docname = frm.doc.name;
                let print_format = "Booking Inquiry PDF";

                window.open(frappe.urllib.get_full_url(
                    `/api/method/frappe.utils.print_format.download_pdf?doctype=Booking Inquiry&name=${docname}&format=${print_format}&no_letterhead=0`
                ));
            }, __("Actions"));
        }

        // Show "Set as Lost" only if not Lost or Quoted
        if (frm.doc.status !== "Lost" && frm.doc.status !== "Quoted") {
            frm.add_custom_button(__('Set as Lost'), function () {
                set_as_lost(frm);
            }, __("Actions"));
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
         if (frm.doc.docstatus === 0 && frm.doc.lead_name && !frm.doc.customer) {
            frm.add_custom_button("Convert Lead", () => {
                convert_lead_to_customer(frm.doc.lead_name, function(customer_id, customer_name) {
                    frm.set_value("customer", customer_id);
                    frm.set_value("customer_name", customer_name);
                    frm.save();
                });
            });
        }

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
        if (frm.doc.customer) {
            frappe.db.get_value('Customer', frm.doc.customer, 'customer_group')
                .then(r => {
                    const group = r.message.customer_group;

                    if (group === 'Schools') {
                        frm.set_df_property('grade', 'hidden', 0); 
                    } else {
                        frm.set_df_property('grade', 'hidden', 1);
                        frm.set_value('grade', null); 
                    }
                });
        } else {
            frm.set_df_property('grade', 'hidden', 1);
            frm.set_value('grade', null);
        }
        set_price_list(frm);
    },


    from_date: function(frm) {
        if (frm.doc.from_date && frappe.datetime.get_diff(frm.doc.from_date, frappe.datetime.get_today()) < 0) {
            frappe.msgprint("From Date cannot be in the past.");
            frm.set_value("from_date", '');
            return;
        }
        if (frm.doc.meals_required) populate_meal_dates(frm);
    },
    to_date: function(frm) {
        if (frm.doc.to_date && frappe.datetime.get_diff(frm.doc.to_date, frm.doc.from_date) < 0) {
            frappe.msgprint("To Date cannot be earlier than From Date.");
            frm.set_value("to_date", '');
            return;
        }
        if (frm.doc.meals_required) populate_meal_dates(frm);
    },
    

   // billing_currency: function(frm) {
      //  toggle_exchange_rate_field(frm);
        //recalculate_rates(frm);
    //},

    //exchange_rate: function(frm) {
       // recalculate_rates(frm);
    //},

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

    meals_required: function(frm) {
        toggle_meals_table(frm);
        if (frm.doc.meals_required) populate_meal_dates(frm);
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

function populate_meal_dates(frm) {
    if (!frm.doc.meals_required || !frm.doc.from_date || !frm.doc.to_date) return;

    const diff = frappe.datetime.get_day_diff(frm.doc.to_date, frm.doc.from_date);
    if (diff < 0) return;

    // Preserve existing row data keyed by date
    const existing = {};
    (frm.doc.meals || []).forEach(row => {
        if (row.date) existing[row.date] = row;
    });

    frm.clear_table("meals");

    const day_names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    for (let i = 0; i <= diff; i++) {
        const date = frappe.datetime.add_days(frm.doc.from_date, i);
        const prev = existing[date];
        const row = frm.add_child("meals");
        row.date = date;
        row.day = day_names[new Date(date).getDay()];
        if (prev) {
            row.meal_type      = prev.meal_type;
            row.meal_name      = prev.meal_name;
            row.qty            = prev.qty;
            row.rate           = prev.rate;
            row.amount         = prev.amount;
            row.converted_rate = prev.converted_rate;
            row.original_rate  = prev.original_rate;
            row.breakfast      = prev.breakfast;
            row.lunch          = prev.lunch;
            row.dinner         = prev.dinner;
        }
    }

    frm.refresh_field("meals");
}

function toggle_transport_option(frm){
    let required = frm.doc.transport_required;

    frm.set_df_property('transport_service', 'hidden', !required);

    if(!required){
        frm.set_df_property('transport_service', 'hidden', 1);
    }
}


function set_as_lost(frm) {
    frappe.prompt([
        {
            fieldname: "reason",
            label: "Reason for Cancellation",
            fieldtype: "Small Text",
            reqd: 1
        }
    ], function (values) {
        frappe.call({
            method: "frappe.client.set_value",
            args: {
                doctype: frm.doc.doctype,
                name: frm.doc.name,
                fieldname: {
                    status: "Lost",
                    reason_for_cancellation: values.reason
                }
            },
            callback: function () {
                frappe.msgprint(__('Booking Inquiry has been marked as Lost.'));
                frm.reload_doc();
            }
        });
    }, __("Set as Lost"), __("Confirm"));
}

function disable_form_actions(frm) {
    frm.disable_save();
    frm.fields.forEach(field => {
        if (field.df && field.df.fieldname !== "reason_for_cancellation") {
            frm.set_df_property(field.df.fieldname, "read_only", 1);
        }
    });
    frm.set_df_property("reason_for_cancellation", "read_only", 1);
    frm.clear_custom_buttons();
}

function handle_create_quotation_button(frm) {
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
        callback: function (response) {
            if (frm.doc.status === "Lost") {
                // Don't show anything if it's already marked lost
                return;
            }
            
            if (response.message && response.message.length > 0) {
                // Update status to Quoted if not already
                if (frm.doc.status !== "Quoted") {
                    frappe.call({
                        method: "frappe.client.set_value",
                        args: {
                            doctype: frm.doc.doctype,
                            name: frm.doc.name,
                            fieldname: {
                                status: "Quoted"
                            }
                        },
                        callback: function () {
                            frm.reload_doc();
                        }
                    });
                }
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

function add_status_indicator(frm) {
    if (frm.doc.status) {
        let indicator_color = "blue";

        if (frm.doc.status === "Quoted") {
            indicator_color = "green";
        } else if (frm.doc.status === "Lost") {
            indicator_color = "red";
        }

        frm.dashboard.clear_headline();
        frm.dashboard.add_indicator(frm.doc.status, indicator_color);
    }
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
        method: "frappe.client.get",
        args: {
            doctype: "Lead",
            name: lead_name
        },
        callback: function(res) {
            if (res.message) {
                const lead = res.message;

                frappe.call({
                    method: "frappe.client.insert",
                    args: {
                        doc: {
                            doctype: "Customer",
                            customer_name: lead.first_name || lead.lead_name,
                            customer_group: lead.custom_lead_group,
                            lead_name: lead.name
                        }
                    },
                    callback: function(res2) {
                        if (res2.message) {
                            const customer = res2.message;

                            frappe.msgprint(__('Lead converted to Customer: ' + customer.name));

                           
                            callback(customer.name, customer.customer_name);
                        }
                    }
                });
            } else {
                frappe.msgprint(__('Unable to fetch Lead: ' + lead_name));
            }
        }
    });
}


/*function toggle_exchange_rate_field(frm) {
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
/*function recalculate_rates(frm) {
   
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
*/
// Function to fetch and set rate from price list
function fetch_rate_from_price_list(frm, cdt, cdn, item_code, table) {
    let row = locals[cdt][cdn];
    if (!item_code) return;

    frappe.call({
        method: "frappe.client.get_value",
        args: {
            doctype: "Item Price",
            filters: {
                item_code: item_code,
                price_list: "Standard Selling"
            },
            fieldname: ["price_list_rate"]
        },
        callback: function(response) {
            if (response.message) {
                let price_list_rate = response.message.price_list_rate || 0;

                if (!row.original_rate) {
                    frappe.model.set_value(cdt, cdn, "original_rate", price_list_rate);
                }

                if (!row.rate || row.rate === row.original_rate) {
                    frappe.model.set_value(cdt, cdn, "rate", price_list_rate);
                }

                update_amount(frm, cdt, cdn);
            }
        }
    });
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
   /* if (frm.doc.billing_currency && frm.doc.billing_currency !== 'KES' && frm.doc.exchange_rate) {
        rate = row.original_rate / frm.doc.exchange_rate;
        frappe.model.set_value(cdt, cdn, 'rate', rate);
        frappe.model.set_value(cdt, cdn, 'currency', frm.doc.billing_currency);
    } */

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
// Function to update Item Price when manually changed
function update_price_list_rate(item_code, new_rate) {
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Item Price",
            filters: { item_code: item_code, price_list: "Standard Selling" },
            fields: ["name"]
        },
        callback: function(response) {
            if (response.message.length > 0) {
                let price_docname = response.message[0].name;
                frappe.call({
                    method: "frappe.client.set_value",
                    args: {
                        doctype: "Item Price",
                        name: price_docname,
                        fieldname: "price_list_rate",
                        value: new_rate
                    }
                });
            } else {
                frappe.call({
                    method: "frappe.client.insert",
                    args: {
                        doc: {
                            doctype: "Item Price",
                            price_list: "Standard Selling",
                            item_code: item_code,
                            price_list_rate: new_rate
                        }
                    }
                });
            }
        }
    });
}

[ 'Transport',  'Reservation Services'].forEach(table_name => {
    frappe.ui.form.on(table_name, {
        qty: function(frm, cdt, cdn) {
            update_amount(frm, cdt, cdn);
        },
        rate: function(frm, cdt, cdn) {
            update_amount(frm, cdt, cdn);
        }
    });
}); 
frappe.ui.form.on('Room Type Booking', {
    room_type: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        if (!row) {
            console.error("Row is missing in room_type.");
            return;
        }

        let price_list = "Resident";
        if (frm.doc.billing_currency && frm.doc.billing_currency !== "KES") {
            price_list = "Non Resident";
        }

        console.log(" Fetching rate from:", price_list, "for Activity:", row.room_type);

        if (row.rate && row.rate !== 0) {
            console.log(" User modified rate:", row.rate);
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
                fieldname: ["price_list_rate"]
            },
            callback: function(response) {
                console.log(" Response from Item Price:", response);

                if (response.message) {
                    if (response.message.price_list_rate) {
                        let rate = response.message.price_list_rate;
                        frappe.model.set_value(cdt, cdn, "original_rate", rate);
                        frappe.model.set_value(cdt, cdn, "rate", rate);
                        console.log("Price found:", rate, "for", row.room_type);
                    } else {
                        console.log(__(" No price found for {0} in {1}", [row.room_type, price_list]));
                    }
                } else {
                    console.log(__("No response from Item Price API"));
                }

                update_amount(frm, cdt, cdn);
            }
        });
    },

    rate: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        if (!row.room_type || row.rate === row.original_rate) {
            update_amount(frm, cdt, cdn);
            return;
        }

        let price_list = "Resident";
        if (frm.doc.billing_currency && frm.doc.billing_currency !== "KES") {
            price_list = "Non Resident";
        }

        // Check if an Item Price exists
        frappe.call({
            method: "frappe.client.get_list",
            args: {
                doctype: "Item Price",
                filters: {
                    item_code: row.room_type,
                    price_list: price_list
                },
                fields: ["name"]
            },
            callback: function(response) {
                if (response.message.length > 0) {
                    let price_docname = response.message[0].name;

                    // Update existing price list entry
                    frappe.call({
                        method: "frappe.client.set_value",
                        args: {
                            doctype: "Item Price",
                            name: price_docname,
                            fieldname: "price_list_rate",
                            value: row.rate
                        },
                        callback: () => {
                            console.log(__("Price list updated for {0}", [row.room_type]));
                        }
                    });
                } else {
                    // Create new price list entry if not found
                    frappe.call({
                        method: "frappe.client.insert",
                        args: {
                            doc: {
                                doctype: "Item Price",
                                item_code: row.room_type,
                                price_list: price_list,
                                price_list_rate: row.rate
                            }
                        },
                        callback: () => {
                            console.log(__(" Price list entry created for {0}", [row.room_type]));
                        }
                    });
                }
            }
        });

        update_amount(frm, cdt, cdn);
    },

    qty: function(frm, cdt, cdn) {
        update_amount(frm, cdt, cdn);
    }
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

        console.log(" Fetching rate from:", price_list, "for Activity:", row.activity_name);

        if (row.rate && row.rate !== 0) {
            console.log("User modified rate:", row.rate);
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
                fieldname: ["price_list_rate"]
            },
            callback: function(response) {
                console.log(" Response from Item Price:", response);

                if (response.message) {
                    if (response.message.price_list_rate) {
                        let rate = response.message.price_list_rate;
                        frappe.model.set_value(cdt, cdn, "original_rate", rate);
                        frappe.model.set_value(cdt, cdn, "rate", rate);
                        console.log(" Price found:", rate, "for", row.activity_name);
                    } else {
                        console.log(__("⚠ No price found for {0} in {1}", [row.activity_name, price_list]));
                    }
                } else {
                    console.log(__("No response from Item Price API"));
                }

                update_amount(frm, cdt, cdn);
            }
        });
    },

    rate: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
    
        if (!row || !row.activity_name) return;
    
        update_amount(frm, cdt, cdn);
    
        // Check if user changed the rate
        if (row.rate === row.original_rate) return;
    
        let price_list = frm.doc.billing_currency !== "KES" ? "Non Resident" : "Resident";
    
        // Check if Item Price exists
        frappe.call({
            method: "frappe.client.get_list",
            args: {
                doctype: "Item Price",
                filters: {
                    item_code: row.item_code,
                    price_list: price_list
                },
                fields: ["name"]
            },
            callback: function(response) {
                if (response.message.length > 0) {
                    // Update existing
                    frappe.call({
                        method: "frappe.client.set_value",
                        args: {
                            doctype: "Item Price",
                            name: response.message[0].name,
                            fieldname: "price_list_rate",
                            value: row.rate
                        },
                        callback: () => {
                            console.log(`✅ Updated Item Price for ${row.activity_name}`);
                            frappe.model.set_value(cdt, cdn, "original_rate", row.rate);  // update baseline
                        }
                    });
                } else {
                    // Create new
                    frappe.call({
                        method: "frappe.client.insert",
                        args: {
                            doc: {
                                doctype: "Item Price",
                                item_code: row.item_code,
                                item_name: row.activity_name,
                                price_list: price_list,
                                price_list_rate: row.rate
                            }
                        },
                        callback: () => {
                            console.log(` Created Item Price for ${row.activity_name}`);
                            frappe.model.set_value(cdt, cdn, "original_rate", row.rate);  // update baseline
                        }
                    });
                }
            }
        });
        
        update_amount(frm, cdt, cdn);
    },

    qty: function(frm, cdt, cdn) {
        update_amount(frm, cdt, cdn);
    },
    
});



frappe.ui.form.on('Meal Details', {
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

        console.log(" Fetching rate from:", price_list, "for Activity:", row.meal_type);

        if (row.rate && row.rate !== 0) {
            console.log("User modified rate:", row.rate);
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
                fieldname: ["price_list_rate"]
            },
            callback: function(response) {
                console.log(" Response from Item Price:", response);

                if (response.message) {
                    if (response.message.price_list_rate) {
                        let rate = response.message.price_list_rate;
                        frappe.model.set_value(cdt, cdn, "original_rate", rate);
                        frappe.model.set_value(cdt, cdn, "rate", rate);
                        console.log(" Price found:", rate, "for", row.meal_type);
                    } else {
                        console.log(__("⚠ No price found for {0} in {1}", [row.meal_type, price_list]));
                    }
                } else {
                    console.log(__("No response from Item Pri1ce API"));
                }

                update_amount(frm, cdt, cdn);
            }
        });
    },

    rate: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        if (!row.meal_type || row.rate === row.original_rate) {
            update_amount(frm, cdt, cdn);
            return;
        }

        let price_list = "Resident";
        if (frm.doc.billing_currency && frm.doc.billing_currency !== "KES") {
            price_list = "Non Resident";
        }

        // Check if an Item Price exists
        frappe.call({
            method: "frappe.client.get_list",
            args: {
                doctype: "Item Price",
                filters: {
                    item_code: row.meal_type,
                    price_list: price_list
                },
                fields: ["name"]
            },
            callback: function(response) {
                if (response.message.length > 0) {
                    let price_docname = response.message[0].name;

                    // Update existing price list entry
                    frappe.call({
                        method: "frappe.client.set_value",
                        args: {
                            doctype: "Item Price",
                            name: price_docname,
                            fieldname: "price_list_rate",
                            value: row.rate
                        },
                        callback: () => {
                            console.log(__(" Price list updated for {0}", [row.meal_type]));
                        }
                    });
                } else {
                    // Create new price list entry if not found
                    frappe.call({
                        method: "frappe.client.insert",
                        args: {
                            doc: {
                                doctype: "Item Price",
                                item_code: row.meal_type,
                                price_list: price_list,
                                price_list_rate: row.rate
                            }
                        },
                        callback: () => {
                            console.log(__("Price list entry created for {0}", [row.meal_type]));
                        }
                    });
                }
            }
        });

        update_amount(frm, cdt, cdn);
    },

    qty: function(frm, cdt, cdn) {
        update_amount(frm, cdt, cdn);
    }
});


frappe.ui.form.on('Tent Selection', {
    tent_type: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        if (!row) {
            console.error("Row is missing in item_code.");
            return;
        }

        let price_list = "Resident";
        if (frm.doc.billing_currency && frm.doc.billing_currency !== "KES") {
            price_list = "Non Resident";
        }

        console.log(" Fetching rate from:", price_list, "for Activity:", row.tent_type);

        if (row.rate && row.rate !== 0) {
            console.log(" User modified rate:", row.rate);
            return;
        }

        frappe.call({
            method: "frappe.client.get_value",
            args: {
                doctype: "Item Price",
                filters: {
                    item_code: row.tent_type,
                    price_list: price_list
                },
                fieldname: ["price_list_rate"]
            },
            callback: function(response) {
                console.log(" Response from Item Price:", response);

                if (response.message) {
                    if (response.message.price_list_rate) {
                        let rate = response.message.price_list_rate;
                        frappe.model.set_value(cdt, cdn, "original_rate", rate);
                        frappe.model.set_value(cdt, cdn, "rate", rate);
                        console.log("Price found:", rate, "for", row.tent_type);
                    } else {
                        console.log(__("⚠ No price found for {0} in {1}", [row.tent_type, price_list]));
                    }1
                } else {
                    console.log(__("No response from Item Price API"));
                }

                update_amount(frm, cdt, cdn);
            }
        });
    },

    rate: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        if (!row.tent_type || row.rate === row.original_rate) {
            update_amount(frm, cdt, cdn);
            return;
        }

        let price_list = "Resident";
        if (frm.doc.billing_currency && frm.doc.billing_currency !== "KES") {
            price_list = "Non Resident";
        }

        // Check if an Item Price exists
        frappe.call({
            method: "frappe.client.get_list",
            args: {
                doctype: "Item Price",
                filters: {
                    item_code: row.tent_type,
                    price_list: price_list
                },
                fields: ["name"]
            },
            callback: function(response) {
                if (response.message.length > 0) {
                    let price_docname = response.message[0].name;

                    // Update existing price list entry
                    frappe.call({
                        method: "frappe.client.set_value",
                        args: {
                            doctype: "Item Price",
                            name: price_docname,
                            fieldname: "price_list_rate",
                            value: row.rate
                        },
                        callback: () => {
                            console.log(__("Price list updated for {0}", [row.tent_type]));
                        }
                    });
                } else {
                    // Create new price list entry if not found
                    frappe.call({
                        method: "frappe.client.insert",
                        args: {
                            doc: {
                                doctype: "Item Price",
                                item_name: row.tent_type,
                                price_list: price_list,
                                price_list_rate: row.rate
                            }
                        },
                        callback: () => {
                            console.log(__("Price list entry created for {0}", [row.tent_type]));
                        }
                    });
                }
            }
        });

        update_amount(frm, cdt, cdn);
    },

    qty: function(frm, cdt, cdn) {
        update_amount(frm, cdt, cdn);
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
