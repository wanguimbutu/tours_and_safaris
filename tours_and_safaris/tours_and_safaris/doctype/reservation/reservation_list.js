frappe.listview_settings['Reservation'] = {
    onload: function (listview) {
        listview.page.add_inner_button(__('📅 Calendar View'), function () {
            window.location.href = "/app/reservation/view/calendar/Reservations";
        });
    },

    formatters: {
        calendar_icon: function (value, df, doc) {
            return `<a href="/app/reservation/view/calendar/Reservations" title="View in Calendar">
                        <i class="fa fa-calendar" style="font-size: 16px; color: #007bff;"></i>
                    </a>`;
        }
    },

    add_fields: ["status", "check_in_date", "check_out_date"],

    get_indicator: function (doc) {
        if (doc.status === "Confirmed Reservation") {
            return [__("Confirmed"), "green", "status,=,Confirmed Reservation"];
        } else if (doc.status === "Pending") {
            return [__("Pending"), "orange", "status,=,Pending"];
        }
    }
};
