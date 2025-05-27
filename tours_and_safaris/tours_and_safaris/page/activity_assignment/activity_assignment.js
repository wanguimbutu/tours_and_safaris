frappe.pages['activity-assignment'].on_page_load = function(wrapper) {
    // Initialize the main page structure
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Activity Assignment',
        single_column: true
    });

    // Global variables for page state management
    let currentOffset = 0;      // Week navigation offset (0 = current week, -1 = previous, +1 = next)
    let clipboard = null;       // Stores copied task data for drag-and-drop functionality
    let customerGroups = {};    // Hierarchical structure of customers and their task groups

    /**
     * Calculate week dates based on offset from current week
     * @param {number} weekOffset - Number of weeks to offset (0 = current week)
     * @returns {Object} Object containing start date and array of week days
     */
    const getWeekDates = (weekOffset = 0) => {
        const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const today = new Date();
        const sunday = new Date(today);
        
        // Calculate Sunday of the target week
        sunday.setDate(sunday.getDate() - sunday.getDay() + (weekOffset * 7));
        sunday.setHours(0, 0, 0, 0);

        const slots = [];
        // Generate all 7 days of the week
        for (let i = 0; i < 7; i++) {
            const d = new Date(sunday);
            d.setDate(sunday.getDate() + i);
            const baseKey = d.toISOString().slice(0, 10);
            slots.push({ 
                label: `${weekDays[d.getDay()]} ${d.getDate()}`, 
                date: new Date(d), 
                key: baseKey 
            });
        }
        return { start: sunday, days: slots };
    };

    /**
     * Format date to YYYY-MM-DD string
     * @param {Date} date - Date object to format
     * @returns {string} Formatted date string
     */
    const formatDate = date => date.toISOString().slice(0, 10);

    /**
     * Generate consistent color for customer using hash-based algorithm
     * This ensures the same customer always gets the same color across sessions
     * @param {string} customerName - Customer name to generate color for
     * @returns {string} HSL color string
     */
    const getCustomerColor = (customerName) => {
        if (!customerName) return '#ddd';
        
        // Simple hash function for consistent color generation
        let hash = 0;
        for (let i = 0; i < customerName.length; i++) {
            const char = customerName.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        
        // Convert hash to hue value (0-360) and return HSL color
        const hue = Math.abs(hash) % 360;
        return `hsl(${hue}, 70%, 80%)`;
    };

    /**
     * Determine session type and timing based on activity details
     * Analyzes if activities are scheduled for AM (08:00), PM (13:30), or both
     * @param {Array} details - Array of activity allocation details
     * @param {string} activityName - Name of the activity to analyze
     * @param {string} activityDate - Date to check for activities
     * @returns {Object|null} Session details or null if no activities found
     */
    const getSessionDetails = (details, activityName, activityDate) => {
        // Filter activities for the specific activity and date
        const sameDayActivities = details.filter(d => 
            d.activity_name === activityName && 
            d.activity_date === activityDate
        );

        // Check for AM and PM sessions
        const hasAM = sameDayActivities.some(d => d.start_time.includes('08:00'));
        const hasPM = sameDayActivities.some(d => d.start_time.includes('13:30'));
        
        // Return appropriate session configuration
        if (hasAM && hasPM) {
            return {
                session: 'Full Day',
                start_time: `${activityDate} 08:00:00`,
                end_time: `${activityDate} 17:00:00`
            };
        } else if (hasAM) {
            return {
                session: 'Half Day',
                start_time: `${activityDate} 08:00:00`,
                end_time: `${activityDate} 12:30:00`
            };
        } else if (hasPM) {
            return {
                session: 'Half Day',
                start_time: `${activityDate} 13:30:00`,
                end_time: `${activityDate} 17:30:00`
            };
        }
        return null;
    };

    /**
     * Get instructor qualification for a specific activity
     * @param {Array} instructors - Array of instructor objects with activity levels
     * @param {string} instructorName - Name of the instructor
     * @param {string} activityName - Name of the activity
     * @returns {string} Qualification string or empty string if not found
     */
    const getInstructorQualification = (instructors, instructorName, activityName) => {
        const instructor = instructors.find(i => i.name === instructorName);
        if (!instructor || !instructor.activity_levels) return '';
        
        const activityLevel = instructor.activity_levels.find(al => al.activity_name === activityName);
        return activityLevel ? activityLevel.qualification || '' : '';
    };

    /**
     * Fetch activity allocations for a given week range
     * @param {Date} weekStart - Start date of the week
     * @param {Date} weekEnd - End date of the week
     * @param {Function} callback - Callback function to handle the results
     */
    const fetchAllocations = (weekStart, weekEnd, callback) => {
        // First, get the list of allocations within the date range
        frappe.call({
            method: 'frappe.client.get_list',
            args: {
                doctype: 'Activity Allocation',
                filters: [
                    ['start_date', '<=', formatDate(weekEnd)],
                    ['end_date', '>=', formatDate(weekStart)]
                ],
                fields: ['name', 'customer', 'start_date', 'end_date', 'activity_name'],
            },
            callback: (res) => {
                const allocations = res.message || [];
    
                // Fetch detailed information for each allocation
                const promises = allocations.map(allocation =>
                    new Promise(resolve => {
                        frappe.call({
                            method: 'frappe.client.get',
                            args: {
                                doctype: 'Activity Allocation',
                                name: allocation.name
                            },
                            callback: (res2) => {
                                const fullDoc = res2.message;
                                allocation.details = fullDoc.activity_allocation_details || [];
                                resolve();
                            }
                        });
                    })
                );
    
                // Wait for all allocation details to be fetched
                Promise.all(promises).then(() => callback(allocations));
            }
        });
    };

    /**
     * Delete a specific allocation detail (unused function - kept for reference)
     * @param {string} parent - Parent allocation document name
     * @param {string} date - Activity date
     * @param {string} subject - Activity subject/name
     * @param {string} instructor - Instructor name
     */
    const deleteAllocationDetail = (parent, date, subject, instructor) => {
        frappe.call({
            method: 'frappe.client.get',
            args: {
                doctype: 'Activity Allocation',
                name: parent
            },
            callback: function(res) {
                const doc = res.message;
                if (!doc || !doc.activity_allocation_details) return;
                
                // Filter out the specific detail to delete
                doc.activity_allocation_details = doc.activity_allocation_details.filter(
                    d => !(d.activity_name === subject && d.activity_date === date && d.instructor === instructor)
                );
                
                // Save the updated document
                frappe.call({
                    method: 'frappe.client.save',
                    args: { doc }
                });
            }
        });
    };

    /**
     * Main function to render the entire page
     * This is the core function that builds the calendar interface
     */
    const renderPage = () => {
        // Get current week information
        const week = getWeekDates(currentOffset);
        const weekDates = week.days;
        const weekStart = weekDates[0].date;
        const weekEnd = weekDates[6].date;

        // Fetch all active activity tasks
        frappe.call({
            method: 'frappe.client.get_list',
            args: {
                doctype: 'Task',
                filters: {
                    status: 'Open',
                    custom_is_activity: 1
                },
                fields: ['name', 'subject', 'custom_customer', 'custom_customer_name', 'custom_no_of_people', 'exp_start_date', 'exp_end_date', 'parent_task']
            },
            callback: function (taskRes) {
                const allTasks = taskRes.message || [];
                
                // CRITICAL FIX: Determine which customers have tasks that overlap with current week
                // This fixes the production issue where split tasks weren't showing
                const customersWithTasksThisWeek = new Set();
                
                allTasks.forEach(task => {
                    // Skip tasks without valid date ranges
                    if (!task.exp_start_date || !task.exp_end_date) return;
                    
                    const start = new Date(task.exp_start_date);
                    const end = new Date(task.exp_end_date);
                    
                    // Check if task overlaps with any day in the current week
                    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                        const dayIndex = weekDates.findIndex(wd => formatDate(wd.date) === formatDate(d));
                        if (dayIndex !== -1) {
                            // Task has activity on a day within the current week
                            customersWithTasksThisWeek.add(task.custom_customer);
                            break; // No need to check other days for this task
                        }
                    }
                });

                // Filter tasks to only include those from customers with tasks this week
                const tasksInWeek = allTasks.filter(task => 
                    customersWithTasksThisWeek.has(task.custom_customer)
                );

                // Get unique customers that have tasks in the current week
                const uniqueCustomers = Array.from(customersWithTasksThisWeek);
                uniqueCustomers.sort(); // Sort for consistent ordering

                // Early exit if no customers have tasks this week
                if (uniqueCustomers.length === 0) {
                    console.log('No customers have tasks in this week');
                }

                // Generate consistent colors for each customer
                const customerColors = {};
                uniqueCustomers.forEach(cust => {
                    customerColors[cust] = getCustomerColor(cust);
                });

                // CRITICAL FIX: Build customer groups structure including subtasks
                // This is where the split task logic was failing in production
                customerGroups = {};
                uniqueCustomers.forEach(cust => {
                    // Get main tasks (tasks without parent_task) for this customer
                    const customerMainTasks = tasksInWeek.filter(t => 
                        t.custom_customer === cust && !t.parent_task
                    );
                    
                    // Get subtasks (tasks with parent_task) for this customer
                    const customerSubTasks = tasksInWeek.filter(t => 
                        t.custom_customer === cust && t.parent_task
                    );
                    
                    // Build the customer group structure
                    if (customerMainTasks.length > 0) {
                        const mainTask = customerMainTasks[0];
                        
                        // Initialize with main task
                        customerGroups[cust] = [{ 
                            name: cust,
                            displayName: mainTask.custom_customer_name || cust,
                            people: mainTask.custom_no_of_people || 0,
                            isMain: true,
                            taskName: mainTask.name
                        }];
                        
                        // Add all subtasks to the group
                        customerSubTasks.forEach(subTask => {
                            customerGroups[cust].push({
                                name: cust,
                                displayName: subTask.custom_customer_name || cust,
                                people: subTask.custom_no_of_people || 0,
                                subject: subTask.subject,
                                isSubtask: true,
                                taskName: subTask.name,
                                parentTask: subTask.parent_task
                            });
                        });
                    }
                });

                // Fetch instructor list
                frappe.call({
                    method: 'frappe.client.get_list',
                    args: {
                        doctype: 'Instructor',
                        fields: ['name']
                    },
                    callback: function (instRes) {
                        const instructors = instRes.message || [];
                        
                        // Fetch detailed instructor information including qualifications
                        const instructorPromises = instructors.map(instructor =>
                            new Promise(resolve => {
                                frappe.call({
                                    method: 'frappe.client.get',
                                    args: {
                                        doctype: 'Instructor',
                                        name: instructor.name,
                                        filters: {
                                            'enabled': 1
                                        }
                                    },
                                    callback: (res) => {
                                        // Note: There's a typo in the field name in the original code
                                        instructor.activity_levels = res.message.instructor_acrivity_level || [];
                                        resolve();
                                    }
                                });
                            })
                        );
                
                        // Wait for all instructor data to be loaded
                        Promise.all(instructorPromises).then(() => {

                            // Fetch existing allocations for the week
                            fetchAllocations(weekStart, weekEnd, (allocations) => {
                                
                                // Build the HTML structure for the calendar interface
                                let html = `
                                    <!-- Submit Activities Button -->
                                    <div style="margin-bottom: 15px;">
                                        <button id="submit-activities-btn" class="btn btn-primary">Submit Activities</button>
                                    </div>
                                    
                                    <!-- Week Navigation and Print Button -->
                                    <div style="margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center;">
                                        <div>
                                            <button class="btn btn-default prev-week">&larr; Prev</button>
                                            <span style="margin: 0 1rem; font-weight: bold;">Week of ${week.start.toDateString()}</span>
                                            <button class="btn btn-default next-week">Next &rarr;</button>
                                        </div>
                                        <button class="btn btn-primary print-button">🖨️ Print</button>
                                    </div>
                                    
                                    <!-- Main Calendar Table Container -->
                                    <div id="print-area">
                                        <div class="table-scroll-wrapper" style="max-height: 75vh; overflow-y: auto; border: 1px solid #ddd;">
                                            <table class="table table-bordered activity-table" style="border-collapse: collapse; width: 100%;">
                                                <thead>
                                                    <!-- Main header row with days -->
                                                    <tr>
                                                        <th style="position: sticky; top: 0; background-color: #fff; z-index: 3;">Customer (People)</th>`;
                                                        
                                // Generate day headers
                                weekDates.forEach(d => {
                                    html += `<th colspan="2" style="text-align: center; background-color: #f1f1f1; position: sticky; top: 0; z-index: 3;">${d.label}</th>`;
                                });

                                // AM/PM sub-headers
                                html += `</tr><tr><td style="position: sticky; top: 40px; background-color: #fff; z-index: 2;"></td>`;

                                weekDates.forEach(() => {
                                    html += `
                                        <td style="text-align:center; position: sticky; top: 40px; background-color: #fff; z-index: 2;">AM</td>
                                        <td style="text-align:center; position: sticky; top: 40px; background-color: #fff; z-index: 2;">PM</td>`;
                                });

                                html += `</tr></thead><tbody>`;

                                // Add CSS styles for the table
                                $(`<style>
                                    .activity-table thead th,
                                    .activity-table thead td {
                                        position: sticky;
                                        background-color: #fff;
                                    }

                                    .activity-table thead tr:first-child th {
                                        top: 0;
                                        z-index: 3;
                                    }

                                    .activity-table thead tr:nth-child(2) th,
                                    .activity-table thead tr:nth-child(2) td {
                                        top: 40px;
                                        z-index: 2;
                                    }

                                    .table-scroll-wrapper {
                                        overflow-y: auto;
                                        max-height: 75vh;
                                    }

                                    .drag-over {
                                        background-color: #e3f2fd !important;
                                    }

                                    /* Print styles */
                                    @media print {
                                        body * {
                                            visibility: hidden;
                                        }

                                        #print-area, #print-area * {
                                            visibility: visible;
                                        }

                                        #print-area {
                                            position: absolute;
                                            top: 0;
                                            left: 0;
                                            width: 100%;
                                        }

                                        .print-button,
                                        .prev-week,
                                        .next-week {
                                            display: none !important;
                                        }

                                        th, td {
                                            -webkit-print-color-adjust: exact !important;
                                            print-color-adjust: exact !important;
                                        }
                                    }
                                </style>`).appendTo('head');

                                // Set up print button functionality
                                setTimeout(() => {
                                    $('.print-button').on('click', () => {
                                        window.print();
                                    });
                                }, 100);

                                // Generate customer rows (main tasks and subtasks)
                                let rowIndex = 0;

                                Object.entries(customerGroups).forEach(([cust, groups]) => {
                                    const allGroups = [...groups];

                                    allGroups.forEach((group, gIndex) => {
                                        const color = customerColors[cust];
                                        
                                        // Generate appropriate label for the row
                                        const label = group.isSubtask
                                            ? `↳ ${group.subject} (${group.people})` // Subtask with indentation
                                            : allGroups.length > 1 && !group.isMain
                                                ? `${group.displayName} Group ${gIndex + 1} (${group.people})`
                                                : `${group.displayName} (${group.people})`;

                                        // Create customer row
                                        html += `<tr>
                                            <td style="background-color: ${color}; font-weight: ${group.isSubtask ? 'normal' : 'bold'}; cursor: ${group.isSubtask ? 'default' : 'pointer'}; padding-left: ${group.isSubtask ? '30px' : '10px'};"
                                                class="${group.isSubtask ? '' : 'customer-cell'}" 
                                                data-customer="${cust}" 
                                                data-index="${gIndex}">
                                                ${label}
                                            </td>`;

                                        // Create cells for each day (AM/PM)
                                        weekDates.forEach((d, dayIndex) => {
                                            ['am', 'pm'].forEach(block => {
                                                const cellId = `cust-${rowIndex}-${dayIndex}-${block}`;
                                                html += `<td id="${cellId}" style="min-height: 60px;"></td>`;
                                            });
                                        });

                                        html += `</tr>`;
                                        rowIndex++;
                                    });
                                });

                                // Add separator line
                                html += `<tr><td colspan="${weekDates.length * 2 + 1}"><hr></td></tr>`;

                                // Generate instructor rows
                                instructors.forEach((inst, instIndex) => {
                                    html += `<tr><td>${inst.name}</td>`;
                                    weekDates.forEach((d, dayIndex) => {
                                        ['am', 'pm'].forEach(block => {
                                            const cellId = `inst-${instIndex}-${dayIndex}-${block}`;
                                            html += `<td class="instructor-cell" id="${cellId}" data-col="${dayIndex}" data-instructor="${inst.name}" data-block="${block}" style="min-height: 60px;"></td>`;
                                        });
                                    });
                                    html += `</tr>`;
                                });

                                html += `</tbody></table>`;
                                $(page.body).html(html);

                                // Set up Submit Activities button functionality
                                document.getElementById("submit-activities-btn").addEventListener("click", function () {
                                    const weekStart = weekDates[0].date;
                                    const weekEnd = weekDates[weekDates.length - 1].date;
                                  
                                    // Fetch all Draft Activity Allocation documents within the week
                                    frappe.call({
                                        method: "frappe.client.get_list",
                                        args: {
                                            doctype: "Activity Allocation",
                                            filters: [
                                                ["docstatus", "=", 0], // Draft status
                                                ["start_date", ">=", frappe.datetime.obj_to_str(weekStart)],
                                                ["end_date", "<=", frappe.datetime.obj_to_str(weekEnd)]
                                            ],
                                            fields: ["name"]
                                        },
                                        callback: function (r) {
                                            if (r.message && r.message.length > 0) {
                                                const allocations = r.message;
                                                let submittedCount = 0;
                                                let failedCount = 0;
                              
                                                // Submit each allocation document
                                                allocations.forEach((doc) => {
                                                    frappe.call({
                                                        method: "tours_and_safaris.tours_and_safaris.page.activity_assignment.activity_assignment.submit_activity_allocation",
                                                        args: {
                                                            doctype: "Activity Allocation",
                                                            name: doc.name
                                                        },
                                                        callback: function () {
                                                            submittedCount++;
                                                            if (submittedCount + failedCount === allocations.length) {
                                                                frappe.show_alert(`Submitted ${submittedCount} activities.`);
                                                            }
                                                        },
                                                        error: function () {
                                                            failedCount++;
                                                            if (submittedCount + failedCount === allocations.length) {
                                                                frappe.show_alert(`Submitted ${submittedCount} activities. ${failedCount} failed.`);
                                                            }
                                                        }
                                                    });
                                                });
                                            } else {
                                                frappe.show_alert("No draft activities found for this week.");
                                            }
                                        }
                                    });
                                });
                                  
                                // Populate customer cells with task information
                                allTasks.forEach(task => {
                                    const color = customerColors[task.custom_customer];
                                    const start = new Date(task.exp_start_date);
                                    const end = new Date(task.exp_end_date);
                                
                                    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                                        const dayIndex = weekDates.findIndex(wd => formatDate(wd.date) === formatDate(d));
                                        if (dayIndex !== -1) {
                                
                                            // --- Find correct customer row index ---
                                            let custRowIndex = 0;
                                            let found = false;
                                
                                            for (const [custName, groups] of Object.entries(customerGroups)) {
                                                if (custName === task.custom_customer) {
                                                    const groupIndex = groups.findIndex(g =>
                                                        (g.isMain && !task.parent_task) ||
                                                        (g.isSubtask && g.taskName === task.name)
                                                    );
                                                    if (groupIndex !== -1) {
                                                        custRowIndex += groupIndex;
                                                        found = true;
                                                        break;
                                                    }
                                                }
                                                if (!found) {
                                                    custRowIndex += groups.length;
                                                }
                                            }
                                
                                            // --- Highlight cells ---
                                            const amCell = $(`#cust-${custRowIndex}-${dayIndex}-am`);
                                            const pmCell = $(`#cust-${custRowIndex}-${dayIndex}-pm`);
                                
                                            amCell.css('background-color', color);
                                            pmCell.css('background-color', color);
                                
                                            // --- Add task block to AM cell (main + subtasks) ---
                                                                                        // Create the task display element
                                            // Add draggable task block to AM cell
                                            const el = $(`
                                                <div 
                                                    class="task-cell" 
                                                    data-subject="${task.subject}" 
                                                    data-customer="${task.custom_customer}" 
                                                    data-people="${task.custom_no_of_people || 1}"
                                                    style="cursor: pointer; background-color: ${color}; padding: 2px 6px; border-radius: 4px; margin-bottom: 2px;">
                                                    ${task.subject}
                                                </div>
                                            `);

                                            el.off('click').on('click', function () {
                                                const subject = $(this).data('subject');
                                                const customer = $(this).data('customer');
                                                const people = $(this).data('people');
                                                clipboard = { subject, customer, people };
                                                frappe.show_alert(`Copied: ${subject} (${people} pax)`);
                                            });

                                            // ✅ Append to AM cell — this is where subtasks are probably being skipped!
                                            amCell.append(el);

                                        }
                                    }
                                });
                                
                                // Populate instructor cells with existing allocations
                                allocations.forEach(allocation => {
                                    allocation.details.forEach(detail => {
                                        const date = new Date(detail.activity_date);
                                        const dayIndex = weekDates.findIndex(d => formatDate(d.date) === formatDate(date));
                                        if (dayIndex !== -1) {
                                            const block = detail.start_time.includes('13') ? 'pm' : 'am';
                                            const instIndex = instructors.findIndex(i => i.name === detail.instructor);
                                            const cellId = `inst-${instIndex}-${dayIndex}-${block}`;
                                            const task = allTasks.find(t => t.subject === detail.activity_name);
                                            
                                            // Use consistent color lookup
                                            const color = customerColors[task?.custom_customer] || 
                                                         customerColors[allocation.customer] || 
                                                         getCustomerColor(allocation.customer || 'Unknown');
                                            
                                            // Create assigned task element
                                            const el = $(`<div class="assigned-task" style="background-color: ${color}; padding: 2px 6px; border-radius: 4px; margin-bottom: 2px; cursor: pointer;" title="Click to remove">${detail.activity_name}</div>`);
                                            
                                            // Store data attributes for manipulation
                                            el.data('allocation-name', allocation.name);
                                            el.data('activity-date', detail.activity_date);
                                            el.data('instructor', detail.instructor);
                                            el.data('activity-name', detail.activity_name);

                                            // Make element draggable
                                            el.attr('draggable', true);
                        
                                            // Set up drag start handler
                                            el.on('dragstart', function (e) {
                                                e.originalEvent.dataTransfer.setData('text/plain', JSON.stringify({
                                                    activity_name: $(this).data('activity-name'),
                                                    allocation_name: $(this).data('allocation-name'),
                                                    activity_date: $(this).data('activity-date'),
                                                    instructor: $(this).data('instructor')
                                                }));
                                            });
                                
                                            // Set up click handler for removing assignments
                                            el.on('click', function (e) {
                                                // Prevent click during drag operations
                                                if (!e.originalEvent?.dataTransfer) {
                                                    const activityName = $(this).data('activity-name');
                                                    const activityDate = $(this).data('activity-date');
                                                    const instructor = $(this).data('instructor');
                                                    
                                                    // Remove the specific allocation detail
                                                    frappe.call({
                                                        method: 'frappe.client.get',
                                                        args: {
                                                            doctype: 'Activity Allocation',
                                                            name: allocation.name
                                                        },
                                                        callback: function (res) {
                                                            const doc = res.message;
                                                            if (!doc || !doc.activity_allocation_details) return;
                                            
                                                            // Filter out the specific detail
                                                            doc.activity_allocation_details = doc.activity_allocation_details.filter(detail =>
                                                                !(
                                                                    detail.activity_name === activityName &&
                                                                    detail.activity_date === activityDate &&
                                                                    detail.instructor === instructor
                                                                )
                                                            );
                                            
                                                            // Delete entire allocation if no details remain
                                                            if (doc.activity_allocation_details.length === 0) {
                                                            frappe.call({
                                                                method: 'frappe.client.delete',
                                                                args: {
                                                                    doctype: 'Activity Allocation',
                                                                    name: allocation.name
                                                                },
                                                                callback: function () {
                                                                    frappe.show_alert('Allocation deleted');
                                                                    renderPage();
                                                                }
                                                            });
                                                        } else {
                                                            frappe.call({
                                                                method: 'frappe.client.save',
                                                                args: { doc },
                                                                callback: function () {
                                                                    frappe.show_alert('Activity removed');
                                                                    renderPage();
                                                                }
                                                            });
                                                        }
                                                    }
                                                });
                                            }
                                        });
                                        
                                        $(`#${cellId}`).append(el);
                                    }
                                });
                            });
                            
                            $('.instructor-cell')
                            .off('click')
                            .on('click', function () {
                              if (!clipboard) return;
                          
                              const cell = $(this);
                              const dayIndex = cell.data('col');
                              const instructor = cell.data('instructor');
                              const block = cell.data('block');
                              const date = weekDates[dayIndex].key;
                              const start_time = `${date} ${block === 'am' ? '08:00:00' : '13:30:00'}`;
                              const subject = clipboard.subject;
                              const customer = clipboard.customer || 'TEMP';
                              const no_of_people = clipboard.people || 1;
                          
                              frappe.call({
                                method: 'frappe.client.get_list',
                                args: {
                                  doctype: 'Activity Allocation',
                                  filters: {
                                    activity_name: subject,
                                    start_date: date,
                                    end_date: date
                                  },
                                  fields: ['name']
                                },
                                callback: function (res) {
                                  const existing = res.message?.[0];
                          
                                  if (existing) {
                                    frappe.call({
                                      method: 'frappe.client.get',
                                      args: {
                                        doctype: 'Activity Allocation',
                                        name: existing.name
                                      },
                                      callback: function (res2) {
                                        const doc = res2.message;
                                        const details = doc.activity_allocation_details || [];
                          
                                        const alreadyAssigned = details.some(d =>
                                          d.activity_name === subject &&
                                          d.activity_date === date &&
                                          d.instructor === instructor
                                        );
                          
                                        if (!alreadyAssigned) {
                                          // Add new detail
                                          const qualification = getInstructorQualification(instructors, instructor, subject);
                                            doc.activity_allocation_details.push({
                                                activity_name: subject,
                                                activity_date: date,
                                                instructor,
                                                start_time,
                                                qualification
                                            });

                                          // Update session details for all matching activities
                                          const sessionDetails = getSessionDetails(doc.activity_allocation_details, subject, date);
                                          if (sessionDetails) {
                                            doc.activity_allocation_details.forEach(detail => {
                                              if (detail.activity_name === subject && detail.activity_date === date) {
                                                detail.session = sessionDetails.session;
                                                detail.start_time = sessionDetails.start_time;
                                                detail.end_time = sessionDetails.end_time;
                                              }
                                            });
                                          }
                          
                                          frappe.call({
                                            method: 'frappe.client.save',
                                            args: { doc },
                                            callback: function () {
                                              frappe.show_alert(`Assigned ${subject} to ${instructor}`);
                                              renderPage();
                                            }
                                          });
                                        } else {
                                          frappe.msgprint("Already assigned to this instructor on that date.");
                                        }
                                      }
                                    });
                                  } else {
                                    // Determine initial session details
                                    const session = 'Half Day';
                                    const end_time = block === 'am' ? `${date} 12:30:00` : `${date} 17:30:00`;

                                    frappe.call({
                                      method: 'frappe.client.insert',
                                      args: {
                                        doc: {
                                          doctype: 'Activity Allocation',
                                          customer,
                                          activity_name: subject,
                                          start_date: date,
                                          end_date: date,
                                          custom_no_of_people: no_of_people,
                                        activity_allocation_details: [{
                                            activity_name: subject,
                                            activity_date: date,
                                            instructor,
                                            start_time,
                                            end_time,
                                            session,
                                            qualification: getInstructorQualification(instructors, instructor, subject)
                                        }]
                                        }
                                      },
                                      callback: function () {
                                        frappe.show_alert(`Created and assigned ${subject} to ${instructor}`);
                                        renderPage();
                                      }
                                    });
                                  }
                                }
                              });
                            })
                            
                            .on('dragover', function (e) {
                                e.preventDefault();
                                $(this).addClass('drag-over');
                            })
                            .on('dragleave', function (e) {
                                $(this).removeClass('drag-over');
                            })
                            .on('drop', function (e) {
                                e.preventDefault();
                                $(this).removeClass('drag-over');

                                const data = JSON.parse(e.originalEvent.dataTransfer.getData('text/plain'));
                                const newInstructor = $(this).data('instructor');

                                if (data.instructor === newInstructor) {
                                    frappe.show_alert('Already assigned to this instructor');
                                    return;
                                }

                                frappe.call({
                                    method: 'frappe.client.get',
                                    args: {
                                        doctype: 'Activity Allocation',
                                        name: data.allocation_name
                                    },
                                    callback: function (res) {
                                        const doc = res.message;
                                        if (!doc || !doc.activity_allocation_details) return;

                                        let changed = false;
                                        doc.activity_allocation_details.forEach(detail => {
                                            if (detail.activity_name === subject && detail.activity_date === date) {
                                                detail.session = sessionDetails.session;
                                                detail.start_time = sessionDetails.start_time;
                                                detail.end_time = sessionDetails.end_time;
                                                if (!detail.qualification) {
                                                    detail.qualification = getInstructorQualification(instructors, detail.instructor, subject);
                                                }
                                            }
                                        });

                                        if (changed) {
                                            frappe.call({
                                                method: 'frappe.client.save',
                                                args: { doc },
                                                callback: function () {
                                                    frappe.show_alert('Instructor updated');
                                                    renderPage();
                                                }
                                            });
                                        }
                                    }
                                });
                            });

                            $('.customer-cell').off('click').on('click', function () {
                                const cust = $(this).data('customer');
                                const index = $(this).data('index');
                                const group = customerGroups[cust][index];

                                frappe.prompt(
                                    {
                                        label: 'How many groups?',
                                        fieldname: 'group_count',
                                        fieldtype: 'Int',
                                        reqd: 1
                                    },
                                    (values) => {
                                        const numGroups = values.group_count;
                                        const totalPeople = group.people;
                                        const peoplePerGroup = Math.floor(totalPeople / numGroups);
                                        const remainder = totalPeople % numGroups;

                                        if (numGroups > 1 && peoplePerGroup > 0) {
                                            
                                            frappe.call({
                                                method: "frappe.client.get_list",
                                                args: {
                                                    doctype: "Task",
                                                    filters: {
                                                        custom_customer: cust,
                                                        parent_task: ""
                                                    },
                                                    fields: ["name", "subject"]
                                                },
                                                callback: function (r) {
                                                    const parentTask = r.message && r.message[0];

                                                    if (!parentTask) {
                                                        frappe.msgprint("Parent task not found for this customer.");
                                                        return;
                                                    }

                                                    for (let i = 0; i < numGroups; i++) {
                                                        let people = peoplePerGroup;
                                                        if (i < remainder) people += 1;

                                                        frappe.call({
                                                            method: "frappe.client.insert",
                                                            args: {
                                                                doc: {
                                                                    doctype: "Task",
                                                                    subject: parentTask.subject,
                                                                    custom_customer: cust,
                                                                    parent_task: parentTask.name,
                                                                    custom_no_of_people: people,
                                                                    custom_is_activity: 1
                                                                }
                                                            },
                                                            callback: function () {
                                                                // After last group is inserted, reload
                                                                if (i === numGroups - 1) {
                                                                    frappe.show_alert("Groups created. Reloading...");
                                                                    setTimeout(() => location.reload(), 800);
                                                                }
                                                            }
                                                        });
                                                    }
                                                }
                                            });
                                        } else {
                                            frappe.msgprint('Not enough people to split into that many groups.');
                                        }
                                    },
                                    'Split Into Groups'
                                );
                            });

                            $('.prev-week').on('click', function () {
                                currentOffset--;
                                renderPage();
                            });
                        
                            $('.next-week').on('click', function () {
                                currentOffset++;
                                renderPage();
                            });
                        }); 
                    });
                    } 
                }); 
            
            } 
        }); 
    };
                        
    renderPage();
};