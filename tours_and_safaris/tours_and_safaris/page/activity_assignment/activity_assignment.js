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
                fields: ['name', 'subject', 'custom_customer', 'custom_no_of_people', 'exp_start_date', 'exp_end_date', 'parent_task']
            },
            callback: function (taskRes) {
                const allTasks = taskRes.message || [];
                
            
                const mainTasks = allTasks.filter(t => !t.parent_task);
                const subTasks = allTasks.filter(t => t.parent_task);
                
                const uniqueCustomers = [...new Set(allTasks.map(t => t.custom_customer))];

                const customerColors = {};
                uniqueCustomers.forEach((cust, idx) => {
                    const hue = (idx * 57) % 360;
                    customerColors[cust] = `hsl(${hue}, 70%, 80%)`;
                });

        
                customerGroups = {};
                uniqueCustomers.forEach(cust => {
                    const customerMainTasks = mainTasks.filter(t => t.custom_customer === cust);
                    const customerSubTasks = subTasks.filter(t => t.custom_customer === cust);
                    

                    if (customerMainTasks.length > 0) {
                        const mainTask = customerMainTasks[0];
                        customerGroups[cust] = [{ 
                            name: cust, 
                            people: mainTask.custom_no_of_people || 0,
                            isMain: true,
                            taskName: mainTask.name
                        }];
                        
                    
                        customerSubTasks.forEach(subTask => {
                            customerGroups[cust].push({
                                name: cust,
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

                        fetchAllocations(weekStart, weekEnd, (allocations) => {
                            
                            let html = `
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

                            // Attach print handler
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
                                            ? `${group.name} Group ${gIndex + 1} (${group.people})`
                                            : `${group.name} (${group.people})`;

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

                            // Render tasks in correct rows
                            allTasks.forEach(task => {
                                const color = customerColors[task.custom_customer];
                                const start = new Date(task.exp_start_date);
                                const end = new Date(task.exp_end_date);
                            
                                for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                                    const dayIndex = weekDates.findIndex(wd => formatDate(wd.date) === formatDate(d));
                                    if (dayIndex !== -1) {
                                        // Find the correct row index for this task
                                        let custRowIndex = 0;
                                        let found = false;
                                        
                                        for (const [custName, groups] of Object.entries(customerGroups)) {
                                            if (custName === task.custom_customer) {
                                                // Find the specific group/subtask this task belongs to
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
                                        
                                        const amCell = $(`#cust-${custRowIndex}-${dayIndex}-am`);
                                        
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
                                            const color = $(this).css('background-color');
                                        
                                            clipboard = { subject, customer, color, people };
                                        
                                            frappe.show_alert(`Copied: ${subject} (${people} pax)`);
                                        });
                                        
                                        amCell.append(el);
                                    }
                                }
                            });
                            
                            $('.task-cell').off('click').on('click', function () {
                                const subject = $(this).data('subject');
                                const color = $(this).css('background-color');
                                const customer = $(this).data('customer');
                            
                                clipboard = { subject, color, custom_customer: customer };
                                frappe.show_alert(`Copied ${subject}`);
                            });

                            allocations.forEach(allocation => {
                                allocation.details.forEach(detail => {
                                    const date = new Date(detail.activity_date);
                                    const dayIndex = weekDates.findIndex(d => formatDate(d.date) === formatDate(date));
                                    if (dayIndex !== -1) {
                                        const block = detail.start_time.includes('13') ? 'pm' : 'am';
                                        const instIndex = instructors.findIndex(i => i.name === detail.instructor);
                                        const cellId = `inst-${instIndex}-${dayIndex}-${block}`;
                                        const task = allTasks.find(t => t.subject === detail.activity_name);
                                        const color = customerColors[task?.custom_customer] || '#ddd';
                                        const el = $(`<div class="assigned-task" style="background-color: ${color}; padding: 2px 6px; border-radius: 4px; margin-bottom: 2px; cursor: pointer;" title="Click to remove">${detail.activity_name}</div>`);
                                        
                                        el.data('allocation-name', allocation.name);
                                        el.data('activity-date', detail.activity_date);
                                        el.data('instructor', detail.instructor);

                                        el.attr('draggable', true);
                    
                                        el.on('dragstart', function (e) {
                                            e.originalEvent.dataTransfer.setData('text/plain', JSON.stringify({
                                                activity_name: $(this).text(),
                                                allocation_name: $(this).data('allocation-name'),
                                                activity_date: $(this).data('activity-date'),
                                                instructor: $(this).data('instructor')
                                            }));
                                        });
                            
                                        el.on('click', function (e) {
                                            if (!e.originalEvent?.dataTransfer) {
                                            
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
                                                                detail.activity_name === task.subject &&
                                                                detail.activity_date === detail.activity_date &&
                                                                detail.instructor === detail.instructor
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
                                          doc.activity_allocation_details.push({
                                            activity_name: subject,
                                            activity_date: date,
                                            instructor,
                                            start_time
                                          });
                          
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
                                            start_time
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
                                            if (
                                                detail.activity_name === data.activity_name &&
                                                detail.activity_date === data.activity_date &&
                                                detail.instructor === data.instructor
                                            ) {
                                                detail.instructor = newInstructor;
                                                changed = true;
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
                    } 
                }); 
            } 
        }); 
    };
                        
    renderPage();
};