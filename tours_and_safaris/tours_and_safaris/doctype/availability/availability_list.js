frappe.views.calendar["Availability"] = {
    field_map: {
        "start": "start",
        "end": "end",
        "id": "name",
        "title": "title",
        "allDay": "allDay"
    },
    
    // Use custom method instead of default
    get_events_method: "tours_and_safaris.tours_and_safaris.doctype.availability.availability.get_calendar_events"
};