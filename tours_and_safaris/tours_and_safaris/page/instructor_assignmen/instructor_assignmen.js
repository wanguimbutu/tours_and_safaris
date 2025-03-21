frappe.pages['instructor-assignmen'].on_page_load = function(wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Instructor Allocation',
        single_column: true
    });

    // Inject CSS for styling
    $("<style>")
        .prop("type", "text/css")
        .html(`
            .assign-task-btn {
                display: block !important;
                visibility: visible !important;
                opacity: 1 !important;
            }
            .selected-task {
                border: 2px solid #007bff !important;
                background-color: #f0f8ff !important;
            }
            .instructor-checkbox {
                margin-right: 5px;
            }
        `)
        .appendTo("head");

    // Filters Row
    let filters = $(`
        <div class="filters row mb-3">
            <div class="col-md-4">
                <label><strong>Activity Type:</strong></label>
                <div id="activity-type-filter"></div>
            </div>
        </div>
    `).appendTo(page.body);

    let activity_filter = frappe.ui.form.make_control({
        parent: $("#activity-type-filter"),
        df: {
            label: "Activity Type",
            fieldname: "activity_type",
            fieldtype: "Link",
            options: "Activity Type"
        },
        only_input: true,
        change() {
            loadUnassignedTasks(activity_filter.get_value());
        }
    });
    activity_filter.refresh();

    // Task List Container
    let container = $(`
        <div class="row mt-4">
            <div class="col-md-12">
                <h4 class="text-danger">Unassigned Tasks</h4>
                <div id="task-list"></div>
            </div>
        </div>
    `).appendTo(page.body);

    function loadUnassignedTasks(activity_type) {
        frappe.call({
            method: "tours_and_safaris.tours_and_safaris.api.task_assignment.get_unassigned_tasks",
            args: { activity_type: activity_type },
            callback: function(r) {
                let tasks = r.message || [];
                $("#task-list").empty();

                tasks.forEach(task => {
                    let task_card = $(`
                        <div class="col-md-6">
                            <div class="card border shadow-sm mb-4 task-card" 
                                data-task="${task.name}" 
                                data-activity="${task.custom_activity_name}">
                                <div class="card-header bg-danger text-white">
                                    <h5>${task.subject} (${task.custom_no_of_people} People)</h5>
                                </div>
                                <div class="card-body">
                                    <p><strong>Activity Type:</strong> ${task.custom_activity_name || 'N/A'}</p>
                                    <label><strong>Session Type:</strong></label>
                                    <select class="form-control session-select">
                                        <option value="Morning">Morning</option>
                                        <option value="Afternoon">Afternoon</option>
                                    </select>
                                    <label><strong>Select Instructors:</strong></label>
                                    <div class="instructor-list"></div>
                                    <button class="btn btn-primary mt-3 assign-task-btn w-100">
                                        Assign Task
                                    </button>
                                </div>
                            </div>
                        </div>
                    `);
                    
                    $("#task-list").append(task_card);
                });
            }
        });
    }

    // Fetch instructors when a task is selected
    $(document).on("click", ".task-card", function(event) {
        // Prevent task selection if clicking inside checkboxes or dropdowns
        if ($(event.target).is("input, select, label")) {
            return;
        }
    
        $(".task-card").removeClass("selected-task");
        $(this).addClass("selected-task");
    
        let activityName = $(this).data("activity");
        let instructorList = $(this).find(".instructor-list");
    
        if (!activityName || activityName.trim() === '') {
            frappe.msgprint("⚠️ No activity name provided. Please select a valid task.");
            return;
        }
    
        // Log activity name for debugging
        console.log(`🟢 Fetching instructors for Activity: ${activityName}`);
    
        // Fetch instructors
        frappe.call({
            method: "tours_and_safaris.tours_and_safaris.api.task_assignment.get_instructors_with_tasks",
            args: { activity_name: activityName },
            callback: function(r) {
                let instructors = r.message || [];
                instructorList.empty();
    
                if (instructors.length === 0) {
                    frappe.msgprint("⚠️ No qualified instructors found for this activity.");
                    return;
                }
    
                instructors.forEach(instructor => {
                    instructorList.append(`
                        <div>
                            <input type="checkbox" class="instructor-checkbox" value="${instructor.instructor_name}">
                            ${instructor.instructor_name} - ${instructor.qualification}
                        </div>
                    `);
                });
            }
        });
    });
    
    // Prevent clicking on checkboxes from selecting the task
    $(document).on("click", ".instructor-checkbox", function(event) {
        event.stopPropagation();  // Prevents checkbox click from triggering the task selection
    });
    

   // Prevent clicking the "Assign Task" button from selecting the task card
   $(document).on("click", ".assign-task-btn", function(event) {
    event.stopPropagation();  // Prevents task selection when clicking the button

    let taskCard = $(this).closest(".task-card");
    let taskName = taskCard.data("task");
    let sessionType = taskCard.find(".session-select").val();
    let selectedInstructors = [];

    // Get checked instructors
    taskCard.find(".instructor-checkbox:checked").each(function() {
        selectedInstructors.push($(this).val());
    });

    if (!taskName || selectedInstructors.length === 0) {
        frappe.msgprint("⚠️ Please select at least one instructor before assigning.");
        return;
    }

    let currentUser = frappe.session.user; // Get current logged-in user

    console.log(`🟢 Assigning task ${taskName} to instructors: ${selectedInstructors.join(", ")} by ${currentUser}`);

    // Call API to assign the instructor
    frappe.call({
        method: "tours_and_safaris.tours_and_safaris.api.task_assignment.assign_instructor",
        args: { 
            task_name: taskName, 
            instructor_names: selectedInstructors, 
            session_type: sessionType 
        },
        callback: function(r) {
            frappe.msgprint("✅ Task Assigned Successfully!");

            // Update task status to "Completed" and set "Completed By"
            frappe.call({
                method: "frappe.client.set_value",
                args: {
                    doctype: "Task",
                    name: taskName,
                    fieldname: {
                        status: "Completed",
                        completed_by: currentUser  // Store the current user
                    }
                },
                callback: function(r) {
                    frappe.msgprint("🎯 Task marked as Completed!");
                    loadUnassignedTasks();  // Refresh task list
                }
            });
        }
    });
});


    loadUnassignedTasks();
};
