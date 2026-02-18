frappe.ui.form.on("Reservation", {
    refresh: function (frm) {
       // calculate_total_cost(frm);
        toggle_accommodation_fields(frm);
            calculate_total_amount(frm);
           // toggle_exchange_rate_field(frm);
    
            // 🔹 Ensure exchange rate is applied when converting from Booking Inquiry
           // if (frm.doc.billing_currency && frm.doc.billing_currency !== 'KES') {
           //     recalculate_rates(frm);
          //  }
          
        if (frm.doc.accommodation_type === "Rooms") {
            frm.set_df_property("room_booking", "hidden", 0);
        }


        if (frm.doc.docstatus === 1) {
            // Check if a quotation already exists for this reservation
            frappe.call({
                method: "frappe.client.get_list",
                args: {
                    doctype: "Sales Order",
                    filters: {
                        "custom_reservation": frm.doc.name,
                        "docstatus": 1  // Submitted quotations
                    },
                    fields: ["name"]
                },
                callback: function(response) {
                    if (response.message && response.message.length > 0) {
                        frm.remove_custom_button(__('Create Sales Order'));
                    } else {
                        frm.add_custom_button('Create Sales Order', function () {
                            frappe.call({
                                method: "tours_and_safaris.tours_and_safaris.doctype.reservation.reservation.create_sales_order",
                                args: { reservation_name: frm.doc.name },
                                callback: function (response) {
                                    if (response.message) {
                                        frappe.msgprint({
                                            title: __("Success"),
                                            message: `Sales Order <a href="/app/sales-order/${response.message.sales_order_name}" target="_blank">${response.message.sales_order_name}</a> created successfully.`,
                                            indicator: "green"
                                        });
        
                                        frappe.set_route("Form", "Sales Order", response.message.sales_order_name);
                                    }
                                }
                            });
                        }, __("Actions"));
                    }
                }
            });
        }
        if (frm.doc.docstatus === 1 && frm.doc.status !== "Rescheduled") {
            frm.add_custom_button(__('Reschedule'), function () {
                frappe.call({
                    method: 'frappe.client.get',
                    args: {
                        doctype: "Reservation",
                        name: frm.doc.name
                    },
                    callback: function (res) {
                        if (!res.message) return;

                        let reservation = res.message;

                        frappe.prompt([
                            { fieldname: 'new_start_date', label: 'New Start Date', fieldtype: 'Date', reqd: true, default: reservation.start_date },
                            { fieldname: 'new_end_date', label: 'New End Date', fieldtype: 'Date', reqd: true, default: reservation.end_date },
                            { fieldname: 'no_of_people', label: 'No of People', fieldtype: 'Int', reqd: false, default: reservation.no_of_people },
                            { fieldname: 'reason', label: 'Reason', fieldtype: 'Small Text' },
                            {
                                fieldname: 'activities',
                                fieldtype: 'Table',
                                label: 'Activities',
                                cannot_add_rows: false,
                                in_place_edit: true,
                                data: (reservation.activities || []).map(row => ({
                                    activity_group: row.activity_group,
                                    activity_name: row.activity_name,
                                    qty: row.qty,
                                    rate: row.rate,
                                    amount: row.amount
                                })),
                                fields: [
                                    { fieldtype: 'Link', fieldname: 'activity_group', options: 'Item Group', label: 'Activity Group', in_list_view: true, reqd: true },
                                    { fieldtype: 'Link', fieldname: 'activity_name', label: 'Activity Name', options: 'Activity Type', in_list_view: true, reqd: true },
                                    { fieldtype: 'Int', fieldname: 'qty', label: 'Qty', in_list_view: true, reqd: true },
                                    { fieldtype: 'Currency', fieldname: 'rate', label: 'Rate', in_list_view: true },
                                    { fieldtype: 'Currency', fieldname: 'amount', label: 'Amount', in_list_view: true }
                                ]
                            },
                            {
                                fieldname: 'meals',
                                fieldtype: 'Table',
                                label: 'Meals',
                                cannot_add_rows: false,
                                in_place_edit: true,
                                data: (reservation.meals || []).map(row => ({
                                    meal_type: row.meal_type,
                                    qty: row.qty,
                                    rate: row.rate,
                                    amount: row.amount
                                })),
                                fields: [
                                    { fieldtype: 'Link', fieldname: 'meal_type', label: 'Meal Type', options: 'Item', in_list_view: true, reqd: true },
                                    { fieldtype: 'Int', fieldname: 'qty', label: 'Qty', in_list_view: true, reqd: true },
                                    { fieldtype: 'Currency', fieldname: 'rate', label: 'Rate', in_list_view: true },
                                    { fieldtype: 'Currency', fieldname: 'amount', label: 'Amount', in_list_view: true }
                                ]
                            }
                        ], function (values) {
                            frappe.call({
                                method: 'tours_and_safaris.tours_and_safaris.doctype.reservation.reservation.reschedule_reservation',
                                args: {
                                    reservation_name: frm.doc.name,
                                    new_start_date: values.new_start_date,
                                    new_end_date: values.new_end_date,
                                    no_of_people: values.no_of_people,
                                    activities: values.activities,
                                    meals: values.meals,
                                    reason: values.reason
                                },
                                callback: function (r) {
                                    if (!r.exc) {
                                        frappe.msgprint(__('Reservation rescheduled. New Sales Order: ') + r.message);
                                        frm.reload_doc();
                                    }
                                }
                            });
                        }, 'Reschedule Reservation', 'Submit');
                    }
                });
            });
        }


    },
        
    room_booking_add: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        apply_room_name_filter(frm, row);
    },

    room_booking_remove: function(frm, cdt, cdn) {
        // You can add any logic here if needed when a row is removed
    },
    arrival_date: function(frm) {
    // Allow back-dated arrival dates.
    // Just ensure departure (if set) is not before arrival.
    if (frm.doc.arrival_date && frm.doc.depature_date && frm.doc.depature_date < frm.doc.arrival_date) {
        frappe.msgprint(__('Departure Date cannot be before Arrival Date.'));
        frm.set_value('depature_date', '');
    }
    fetch_available_rooms(frm);
},

    depature_date: function(frm) {
        if (frm.doc.depature_date && frm.doc.arrival_date && frm.doc.depature_date < frm.doc.arrival_date) {
            frappe.msgprint(__('Departure Date cannot be before Arrival Date.'));
            frm.set_value('depature_date', ''); 
        }
        fetch_available_rooms(frm);
    },
   // billing_currency: function(frm) {
        //toggle_exchange_rate_field(frm);
        //recalculate_rates(frm);
   // },

    //exchange_rate: function(frm) {
      //  recalculate_rates(frm);
   // },

    no_of_people: function(frm){
        validate_people_count(frm);
    },

    no_of_adults:function(frm){
        validate_people_count(frm);
    },

    no_of_children:function(frm){
        validate_people_count(frm);
    },
    
    accommodation_needed: function (frm) {
        toggle_accommodation_fields(frm);
    },

    rooms: function (frm) {
        toggle_accommodation_fields(frm);
    },

    tents: function (frm) {
        toggle_accommodation_fields(frm);
    },

    own_tents: function (frm) {
        toggle_accommodation_fields(frm);
    },

    room_type: function (frm) {
        fetch_available_rooms(frm);
    },

    accommodation_type: function (frm) {
        toggle_accommodation_fields(frm);
    },

    onload: function(frm) {
        set_room_type_filter(frm);
    },
    room_booking_add: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        apply_room_name_filter(frm, row);
    },

    status: function (frm) {
        if (frm.doc.status === "Confirmed Reservation") {
            confirm_room_reservations(frm);
        }
    },
    customer:function (frm){
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
    }

    /*validate: function (frm) {
        calculate_total_cost(frm);
    }*/
});



/*function calculate_total_cost(frm) {
    if (!frm.doc.booking_inquiry) return;

    frappe.call({
        method: "frappe.client.get_value",
        args: {
            doctype: "Booking Inquiry",
            filters: { name: frm.doc.booking_inquiry },
            fieldname: "proposed_cost"
        },
        callback: function(response) {
            if (response.message) {
                frm.set_value("proposed_total_cost", response.message.proposed_total_cost);
            }
        }
    });
}
*/

// Toggle exchange rate field visibility
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

function recalculate_rates(frm) {
    // Prevent recalculation if the document is submitted
    if (frm.doc.docstatus === 1) return;

    if (frm.doc.billing_currency && frm.doc.billing_currency !== 'KES' && frm.doc.exchange_rate) {
        let tables = [ 'tent_selection',  'hired_services',  'transport_service'];

        tables.forEach(table => {
            (frm.doc[table] || []).forEach(row => {
                // Only update if the rate hasn't been set already (prevents overwriting after submission)
                if (row.original_rate && !row.converted_rate) { 
                    let converted_rate = row.original_rate / frm.doc.exchange_rate;
                    
                    frappe.model.set_value(row.doctype, row.name, 'converted_rate', converted_rate);
                    frappe.model.set_value(row.doctype, row.name, 'rate', converted_rate);
                    frappe.model.set_value(row.doctype, row.name, 'currency', frm.doc.billing_currency);
                }
            });
        });

        calculate_total_amount(frm);
    }
}
*/

function update_amount(frm, cdt, cdn) {
    let row = locals[cdt][cdn];

    // Define tables that should not be restricted by number of people
    let excluded_tables = ['meals', 'transport_service'];

    // Validate qty against no_of_people (Only if not in excluded tables)
    let no_of_people = frm.doc.no_of_people || 0;
    if (!excluded_tables.includes(row.parentfield) && row.qty > no_of_people) {
        frappe.msgprint(__('Quantity cannot exceed the number of people.'));
        frappe.model.set_value(cdt, cdn, 'qty', no_of_people);
        return;
    }

    // Only update rate if it exists (prevents infinite loop)
    if (!row.rate) return;

    // Store original rate only if not set before
    if (!row.original_rate) {
        frappe.model.set_value(cdt, cdn, 'original_rate', row.rate);
    }

    let rate = row.rate;
   /* if (frm.doc.billing_currency && frm.doc.billing_currency !== 'KES' && frm.doc.exchange_rate) {
        rate = row.original_rate / frm.doc.exchange_rate;
        frappe.model.set_value(cdt, cdn, 'rate', rate);
        frappe.model.set_value(cdt, cdn, 'currency', frm.doc.billing_currency);
    }*/

    // Calculate amount
    let amount = row.qty && rate ? row.qty * rate : 0;
    frappe.model.set_value(cdt, cdn, 'amount', amount);

    calculate_total_amount(frm);
}

// Function to calculate total amount from all relevant tables
function calculate_total_amount(frm) {
    let total = 0;
    let tables = ['activities', 'tent_selection', 'room_booking','room_type_booking', 'transport_service', 'meals', 'hired_service'];

    tables.forEach(table => {
        (frm.doc[table] || []).forEach(row => {
            total += row.amount || 0;
        });
    });

    frm.set_value('proposed_total_cost', total); // Update total amount field
}

// Attach the update function dynamically to multiple tables
['Activity Package', 'Tent Selection', 'Room Type Booking', 'Transport', 'Meal Details', 'Reservation Services'].forEach(table_name => {
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

        console.log("🔍 Fetching rate from:", price_list, "for Meal Type:", row.meal_type);

    
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
                                console.log(__('No rate found for this room type in ' + price_list));
                            }
                        }
                    });
                }
            }
        });
    }
}

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


function toggle_accommodation_fields(frm) {
    let show_accommodation = frm.doc.accommodation_needed;

    frm.set_df_property("rooms", "hidden", !show_accommodation);
    frm.set_df_property("tents", "hidden", !show_accommodation);
    frm.set_df_property("own_tents", "hidden", !show_accommodation);

    frm.set_df_property("room_booking", "hidden", !frm.doc.rooms);
    frm.set_df_property("tent_selection", "hidden", !frm.doc.tents);
}


frappe.ui.form.on('Room Type Booking', {
    room_type: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        if (!row) {
            console.error("Row is missing in room_type event.");
            return;
        }

    
        let price_list = "Resident"; 
        if (frm.doc.billing_currency && frm.doc.billing_currency !== "KES") {
            price_list = "Non Resident";
        }

        console.log("🔍 Fetching rate from:", price_list, "for Room Type:", row.room_type);

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
                console.log(" Response from Item Price:", response);

                if (response.message) {
                    if (response.message.price_list_rate) {
                        let rate = response.message.price_list_rate;
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
        if (!row.room_type) return; 
        console.log("Syncing Room Type:", row.room_type);

        let exists = frm.doc.room_booking.some(r => r.room_type === row.room_type);

        if (!exists) {
            let new_row = frm.add_child('room_booking');
            new_row.room_type = row.room_type;
            console.log(" Added Room Type to Inquiry Room Booking:", row.room_type);
        } else {
            console.log("Room Type already exists in Inquiry Room Booking:", row.room_type);
        }

        frm.refresh_field('room_booking');
    
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

                    // Set the price list in the form
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
                                update_amount(frm, cdt, cdn);  
                            } else {
                                console.log(__('No rate found for this room type in ' + price_list));
                            }
                        }
                    });
                }
            }
        });
    }
}

// Function to apply the filter to the Room Name field based on selected Room Type
function apply_room_name_filter(frm, row) {
    frm.fields_dict['room_booking'].grid.get_field('room_name').get_query = function(doc, cdt, cdn) {
        return {
            filters: {
                room_type: row.room_type // Filter based on the room type in the current row
            }
        };
    };
}
