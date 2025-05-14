frappe.listview_settings['Room Allocation'] = {
    onload: function (listview) {
        listview.page.add_inner_button(__('📅 Calendar View'), function () {
            window.location.href = "app/availability/view/calendar/Availability";
        });
    },

    formatters: {
        customer: function (value, df, doc) {
            function getColorForCustomer(customer) {
                const colors = ["#ff6b6b", "#1dd1a1", "#54a0ff", "#f368e0", "#ff9f43", "#10ac84", "#5f27cd"];
                let hash = 0;
                for (let i = 0; i < customer.length; i++) {
                    hash = customer.charCodeAt(i) + ((hash << 5) - hash);
                }
                return colors[Math.abs(hash) % colors.length];
            }

            let customer = doc.customer || "Unknown";
            let people = doc.no_of_people || 0;
            let color = getColorForCustomer(customer);

            return `
                <div style="display: flex; align-items: center; gap: 6px;">
                    <a href="app/availability/view/calendar/Availability" title="View in Calendar">
                        <i class="fa fa-calendar" style="color: ${color}; font-size: 14px;"></i>
                    </a>
                    <span style="color: ${color}; font-size: 12px;">
                        ${frappe.utils.escape_html(customer)} (${people})
                    </span>
                </div>
            `;
        }
    },

    add_fields: ["status", "arrival_date", "depature_date", "customer", "no_of_people"],

    get_indicator: function (doc) {
        if (doc.status === "Confirmed Reservation") {
            return [__("Confirmed"), "green", "status,=,Confirmed Reservation"];
        } else if (doc.status === "Pending") {
            return [__("Pending"), "orange", "status,=,Pending"];
        }
    }

    
};
