frappe.listview_settings['Activity Allocation'] = {
    onload: function (listview) {
        listview.page.add_inner_button(__('📅 Calendar View'), function () {
            window.location.href = "/app/activity-calendar-event/view/calendar/activity%20allocation";
        });
    },

    add_fields: ["status", "instructor", "customer", "start_time", "end_time"],

    formatters: {
        calendar_icon: function (value, df, doc) {
            return `<a href="/app/activity-calendar-event/view/calendar/activity%20allocation" title="View in Calendar">
                        <i class="fa fa-calendar" style="font-size: 16px; color: #007bff;"></i>
                    </a>`;
        }
    },

    get_indicator: function (doc) {
        if (doc.status === "Completed") {
            return [__("Completed"), "green", "status,=,Completed"];
        } else if (doc.status === "Pending") {
            return [__("Pending"), "orange", "status,=,Pending"];
        }
    },

    style: function (doc) {
        let colors = {};  // Store colors for consistency
        let assignedColors = {};  // Track assigned colors

        function getRandomColor(name) {
            if (assignedColors[name]) {
                return assignedColors[name]; // Reuse color if assigned before
            }
            let letters = "0123456789ABCDEF";
            let color = "#";
            for (let i = 0; i < 6; i++) {
                color += letters[Math.floor(Math.random() * 16)];
            }
            assignedColors[name] = color; // Save assigned color
            return color;
        }

        let instructorColor = getRandomColor(doc.instructor || "Unknown Instructor");
        let customerColor = getRandomColor(doc.customer || "Unknown Customer");

        return {
            "background": `linear-gradient(to right, ${instructorColor}, ${customerColor})`,
            "color": "white",
            "font-weight": "bold"
        };
    }
};
