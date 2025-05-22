frappe.pages['activity-assignment'].on_page_load = function(wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Activity Assignment',
        single_column: true
    });

    let currentOffset = 0;
    let clipboard = null;
    let customerGroups = {};

    const getWeekDates = (weekOffset = 0) => {
        const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const today = new Date();
        const sunday = new Date(today);
        sunday.setDate(sunday.getDate() - sunday.getDay() + (weekOffset * 7));
        sunday.setHours(0, 0, 0, 0);

        const slots = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(sunday);
            d.setDate(sunday.getDate() + i);
            const baseKey = d.toISOString().slice(0, 10);
            slots.push({ label: `${weekDays[d.getDay()]} ${d.getDate()}`, date: new Date(d), key: baseKey });
        }
        return { start: sunday, days: slots };
    };

    const formatDate = date => date.toISOString().slice(0, 10);

    // Hash-based color generation for consistent colors
    const getCustomerColor = (customerName) => {
        if (!customerName) return '#ddd';
        let hash = 0;
        for (let i = 0; i < customerName.length; i++) {
            const char = customerName.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        const hue = Math.abs(hash) % 360;
        return `hsl(${hue}, 70%, 80%)`;
    };

    // Helper function to determine session type and times
    const getSessionDetails = (details, activityName, activityDate) => {
        const sameDayActivities = details.filter(d => 
            d.activity_name === activityName && 
            d.activity_date === activityDate
        );

        
        const hasAM = sameDayActivities.some(d => d.start_time.includes('08:00'));
        const hasPM = sameDayActivities.some(d => d.start_time.includes('13:30'));
        
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

    // Helper function to get instructor qualification for an activity
const getInstructorQualification = (instructors, instructorName, activityName) => {
    const instructor = instructors.find(i => i.name === instructorName);
    if (!instructor || !instructor.activity_levels) return '';
    
    const activityLevel = instructor.activity_levels.find(al => al.activity_name === activityName);
    return activityLevel ? activityLevel.qualification || '' : '';
};

    const fetchAllocations = (weekStart, weekEnd, callback) => {
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
    
                Promise.all(promises).then(() => callback(allocations));
            }
        });
    };

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
                doc.activity_allocation_details = doc.activity_allocation_details.filter(
                    d => !(d.activity_name === subject && d.activity_date === date && d.instructor === instructor)
                );
                frappe.call({
                    method: 'frappe.client.save',
                    args: { doc }
                });
            }
        });
    };

    const renderPage = () => {
        const week = getWeekDates(currentOffset);
        const weekDates = week.days;
        const weekStart = weekDates[0].date;
        const weekEnd = weekDates[6].date;

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
                
                // First, determine which customers actually have tasks that will be displayed this week
                const customersWithTasksThisWeek = new Set();
                
                allTasks.forEach(task => {
                    if (!task.exp_start_date || !task.exp_end_date) return;
                    
                    const start = new Date(task.exp_start_date);
                    const end = new Date(task.exp_end_date);
                    
                    // Check each day of the task's duration
                    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                        const dayIndex = weekDates.findIndex(wd => formatDate(wd.date) === formatDate(d));
                        if (dayIndex !== -1) {
                            // This task has activity on a day within the current week
                            customersWithTasksThisWeek.add(task.custom_customer);
                            break; // No need to check other days for this task
                        }
                    }
                });

                // Only include customers that have tasks displaying this week
                const tasksInWeek = allTasks.filter(task => 
                    customersWithTasksThisWeek.has(task.custom_customer)
                );

                // Only show customers that have tasks in the current week
                const uniqueCustomers = Array.from(customersWithTasksThisWeek);
                uniqueCustomers.sort(); // Sort for consistent ordering

                // If no customers have tasks this week, don't show any customer rows
                if (uniqueCustomers.length === 0) {
                    console.log('No customers have tasks in this week');
                }

                // Use hash-based color generation for consistent colors
                const customerColors = {};
                uniqueCustomers.forEach(cust => {
                    customerColors[cust] = getCustomerColor(cust);
                });

                // Build customer groups including subtasks - only for customers with tasks in this week
                customerGroups = {};
                uniqueCustomers.forEach(cust => {
                    const customerMainTasks = tasksInWeek.filter(t => t.custom_customer === cust && !t.parent_task);
                    const customerSubTasks = tasksInWeek.filter(t => t.custom_customer === cust && t.parent_task);
                    
                    // Start with main task
                    if (customerMainTasks.length > 0) {
                        const mainTask = customerMainTasks[0];
                        customerGroups[cust] = [{ 
                            name: cust,
                            displayName: mainTask.custom_customer_name || cust, // Use custom_customer_name for display
                            people: mainTask.custom_no_of_people || 0,
                            isMain: true,
                            taskName: mainTask.name
                        }];
                        
                        // Add subtasks
                        customerSubTasks.forEach(subTask => {
                            customerGroups[cust].push({
                                name: cust,
                                displayName: subTask.custom_customer_name || cust, // Use custom_customer_name for display
                                people: subTask.custom_no_of_people || 0,
                                subject: subTask.subject,
                                isSubtask: true,
                                taskName: subTask.name,
                                parentTask: subTask.parent_task
                            });
                        });
                    }
                });


                frappe.call({
                    method: 'frappe.client.get_list',
                    args: {
                        doctype: 'Instructor',
                        fields: ['name']
                    },
                    callback: function (instRes) {
                        const instructors = instRes.message || [];
                        
                        // Fetch instructor qualifications
                        const instructorPromises = instructors.map(instructor =>
                            new Promise(resolve => {
                                frappe.call({
                                    method: 'frappe.client.get',
                                    args: {
                                        doctype: 'Instructor',
                                        name: instructor.name,
                                        filters:{
                                            'enabled': 1
                                        }
                                    },
                                    callback: (res) => {
                                        instructor.activity_levels = res.message.instructor_acrivity_level || [];
                                        resolve();
                                    }
                                });
                            })
                        );
                
                        Promise.all(instructorPromises).then(() => {

                        fetchAllocations(weekStart, weekEnd, (allocations) => {
                            
                            let html = `
                                <div style="margin-bottom: 15px;">
                                    <button id="submit-activities-btn" class="btn btn-primary">Submit Activities</button>
                                    </div>
                                <div style="margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center;">
                                    <div>
                                        <button class="btn btn-default prev-week">&larr; Prev</button>
                                        <span style="margin: 0 1rem; font-weight: bold;">Week of ${week.start.toDateString()}</span>
                                        <button class="btn btn-default next-week">Next &rarr;</button>
                                    </div>
                                    <button class="btn btn-primary print-button">🖨️ Print</button>
                                </div>
                                
                                <div id="print-area">
                                    <div class="table-scroll-wrapper" style="max-height: 75vh; overflow-y: auto; border: 1px solid #ddd;">
                                        <table class="table table-bordered activity-table" style="border-collapse: collapse; width: 100%;">
                                            <thead>
                                                <tr>
                                                    <th style="position: sticky; top: 0; background-color: #fff; z-index: 3;">Customer (People)</th>`;
                                                    
                            weekDates.forEach(d => {
                                html += `<th colspan="2" style="text-align: center; background-color: #f1f1f1; position: sticky; top: 0; z-index: 3;">${d.label}</th>`;
                            });

                            html += `</tr><tr><td style="position: sticky; top: 40px; background-color: #fff; z-index: 2;"></td>`;

                            weekDates.forEach(() => {
                                html += `
                                    <td style="text-align:center; position: sticky; top: 40px; background-color: #fff; z-index: 2;">AM</td>
                                    <td style="text-align:center; position: sticky; top: 40px; background-color: #fff; z-index: 2;">PM</td>`;
                            });

                            html += `</tr></thead><tbody>`;

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

                    
                            setTimeout(() => {
                                $('.print-button').on('click', () => {
                                    window.print();
                                });
                            }, 100);

                            

                            let rowIndex = 0;

                            Object.entries(customerGroups).forEach(([cust, groups]) => {
                                const allGroups = [...groups];

                                allGroups.forEach((group, gIndex) => {
                                    const color = customerColors[cust];
                                    const label = group.isSubtask
                                        ? `↳ ${group.subject} (${group.people})`
                                        : allGroups.length > 1 && !group.isMain
                                            ? `${group.displayName} Group ${gIndex + 1} (${group.people})`
                                            : `${group.displayName} (${group.people})`;

                                    html += `<tr>
                                        <td style="background-color: ${color}; font-weight: ${group.isSubtask ? 'normal' : 'bold'}; cursor: ${group.isSubtask ? 'default' : 'pointer'}; padding-left: ${group.isSubtask ? '30px' : '10px'};"
                                            class="${group.isSubtask ? '' : 'customer-cell'}" 
                                            data-customer="${cust}" 
                                            data-index="${gIndex}">
                                            ${label}
                                        </td>`;

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

                            html += `<tr><td colspan="${weekDates.length * 2 + 1}"><hr></td></tr>`;

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

                            document.getElementById("submit-activities-btn").addEventListener("click", function () {
                                // Determine the start and end dates of the current calendar week
                                const weekStart = weekDates[0].date;
                                const weekEnd = weekDates[weekDates.length - 1].date;
                              
                                // Fetch all Activity Allocation documents in Draft status within the week
                                frappe.call({
                                  method: "frappe.client.get_list",
                                  args: {
                                    doctype: "Activity Allocation",
                                    filters: [
                                      ["docstatus", "=", 0],
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
                              
                                      // Submit each fetched document
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
                              
                            allTasks.forEach(task => {
                                const color = customerColors[task.custom_customer];
                                const start = new Date(task.exp_start_date);
                                const end = new Date(task.exp_end_date);
                            
                                for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                                    const dayIndex = weekDates.findIndex(wd => formatDate(wd.date) === formatDate(d));
                                    if (dayIndex !== -1) {
                                
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
                                
                                        // ✅ Highlight both AM and PM cells for the task duration
                                        const amCell = $(`#cust-${custRowIndex}-${dayIndex}-am`);
                                        const pmCell = $(`#cust-${custRowIndex}-${dayIndex}-pm`);
                                
                                        amCell.css('background-color', color);
                                        pmCell.css('background-color', color);
                                
                                        // Existing: Add draggable task block to AM cell (or decide which one)
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
                                
                                        amCell.append(el);
                                    }
                                }
                                
                            });

                            // Fixed: Use consistent color lookup for allocations
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
                                        const color = customerColors[task?.custom_customer] || customerColors[allocation.customer] || getCustomerColor(allocation.customer || 'Unknown');
                                        
                                        const el = $(`<div class="assigned-task" style="background-color: ${color}; padding: 2px 6px; border-radius: 4px; margin-bottom: 2px; cursor: pointer;" title="Click to remove">${detail.activity_name}</div>`);
                                        
                                        el.data('allocation-name', allocation.name);
                                        el.data('activity-date', detail.activity_date);
                                        el.data('instructor', detail.instructor);
                                        el.data('activity-name', detail.activity_name);

                                        el.attr('draggable', true);
                    
                                        el.on('dragstart', function (e) {
                                            e.originalEvent.dataTransfer.setData('text/plain', JSON.stringify({
                                                activity_name: $(this).data('activity-name'),
                                                allocation_name: $(this).data('allocation-name'),
                                                activity_date: $(this).data('activity-date'),
                                                instructor: $(this).data('instructor')
                                            }));
                                        });
                            
                                        el.on('click', function (e) {
                                            if (!e.originalEvent?.dataTransfer) {
                                                const activityName = $(this).data('activity-name');
                                                const activityDate = $(this).data('activity-date');
                                                const instructor = $(this).data('instructor');
                                                
                                                frappe.call({
                                                    method: 'frappe.client.get',
                                                    args: {
                                                        doctype: 'Activity Allocation',
                                                        name: allocation.name
                                                    },
                                                    callback: function (res) {
                                                        const doc = res.message;
                                                        if (!doc || !doc.activity_allocation_details) return;
                                        
                                                        doc.activity_allocation_details = doc.activity_allocation_details.filter(detail =>
                                                            !(
                                                                detail.activity_name === activityName &&
                                                                detail.activity_date === activityDate &&
                                                                detail.instructor === instructor
                                                            )
                                                        );
                                        
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