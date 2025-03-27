frappe.listview_settings['Activity Allocation'] = {
    onload: function (listview) {
        listview.page.add_inner_button(__('📅 Calendar View'), function () {
            window.location.href = "/app/activity-allocation/view/calendar/Instructor%20Allocation";
        });
    },

    formatters: {
        calendar_icon: function (value, df, doc) {
            return `<a href="/app/activity-allocation/view/calendar/Instructor%20Allocation" title="View in Calendar">
                        <i class="fa fa-calendar" style="font-size: 16px; color: #007bff;"></i>
                    </a>`;
        }
    },

    add_fields: ["status", "start_date", "end_date"],


};
