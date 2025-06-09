// Copyright (c) 2025, wanguimbutu and contributors
// For license information, please see license.txt

frappe.ui.form.on('Packing List', {
    refresh: function(frm){
        frm.add_custom_button('Calculate Equipment', () => {
            if (!frm.doc.no_of_adults && !frm.doc.no_of_children) {
                frappe.msgprint('Please enter number of adults or children.');
                return;
            }

            frappe.call({
                method: 'tours_and_safaris.tours_and_safaris.doctype.packing_list.packing_list.calculate_and_insert_equipment',
                args: {
                    docname: frm.doc.name,
                    no_of_adults: frm.doc.no_of_adults || 0,
                    no_of_children: frm.doc.no_of_children || 0,
                    no_of_guides: frm.doc.no_of_guides || 0
                },
                callback: function (r) {
                    if (!r.exc) {
                        frappe.msgprint('Equipment calculated and updated.');
                        frm.reload_doc();  // Refresh to show updated child table
                    }
                }
            });
        });
    
    },
    meal_plan: function(frm) {
        if (frm.doc.meal_plan) {
            frappe.model.with_doc("Meal Plan", frm.doc.meal_plan, function() {
                let meal_plan_doc = frappe.model.get_doc("Meal Plan", frm.doc.meal_plan);
                console.log("Meal Plan Doc (with children):", meal_plan_doc); 
                render_meal_plan_table_in_packing_list(frm, meal_plan_doc);
            });
        } else {
            frm.fields_dict.meal_plan_table.$wrapper.html('');
        }
    },

    onload: function(frm) {
        if (frm.doc.meal_plan) {
            frm.trigger('meal_plan');
        }
    }
});

function render_meal_plan_table_in_packing_list(frm, meal_plan_doc) {
    let start_date = meal_plan_doc.start_date;
    let end_date = meal_plan_doc.end_date;

    if (!start_date || !end_date) return;

    let start = moment(start_date);
    let end = moment(end_date);

    if (end.isBefore(start)) {
        frappe.msgprint(__('End date cannot be before start date.'));
        return;
    }

    const meal_types = ["Breakfast", "Lunch", "Dinner", "Snack"];

    // ✅ CORRECT child table fieldname
    let mealMap = {};
    (meal_plan_doc.meal_plan_entry || []).forEach(entry => {
        let date = moment(entry.date).format('YYYY-MM-DD');
        let meal_type = entry.meal_type;

        if (!mealMap[date]) mealMap[date] = {};
        mealMap[date][meal_type] = entry.meal_name;
    });

    console.log("Meal Map:", mealMap);

    let html = `
        <table class="table table-bordered">
            <thead>
                <tr>
                    <th>Date</th>
                    ${meal_types.map(type => `<th>${type}</th>`).join('')}
                </tr>
            </thead>
            <tbody>
    `;

    for (let date = moment(start); date.isSameOrBefore(end); date.add(1, 'days')) {
        let formatted_date = date.format('YYYY-MM-DD');
        let display_date = date.format('ddd MM/DD/YY');

        let meals = mealMap[formatted_date] || {};

        html += `
            <tr data-date="${formatted_date}">
                <td>${display_date}</td>
                ${meal_types.map(type => `
                    <td>${frappe.utils.escape_html(meals[type] || '')}</td>
                `).join('')}
            </tr>
        `;
    }

    html += `</tbody></table>`;
    frm.fields_dict.meal_plan_table.$wrapper.html(html);
}
