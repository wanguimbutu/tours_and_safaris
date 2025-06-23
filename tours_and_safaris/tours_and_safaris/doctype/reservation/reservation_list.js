frappe.views.calendar['Reservation'] = {
    field_map: {
        start: "start",
        end: "end",
        id: "id",
        title: "title",
        allDay: 1,
    },
    get_events_method: "tours_and_safaris.tours_and_safaris.doctype.reservation.reservation.get_events"
};
