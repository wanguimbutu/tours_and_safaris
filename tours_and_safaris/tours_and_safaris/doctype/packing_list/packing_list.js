// Copyright (c) 2025, wanguimbutu and contributors
// For license information, please see license.txt

frappe.ui.form.on("Packing List", {
    refresh: function(frm) {
        // Try to render directly using the field's wrapper
        let html_content = frm.get_docfield && frm.get_docfield("meal_plan_table")
            ? frm.get_docfield("meal_plan_table").default || ""
            : "";

        // Backup: get from a hidden Text field if needed
        if (!html_content && frm.doc._meal_plan_table_copy) {
            html_content = frm.doc._meal_plan_table_copy;
        }

        if (frm.fields_dict.meal_plan_table) {
            frm.fields_dict.meal_plan_table.$wrapper.html(html_content);
        }
    }
});


