frappe.pages['guide-allocation'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Guide Allocation',
		single_column: true
	});
	
	$(page.body).html(`
        <div class="d-flex justify-content-between align-items-center my-3">
            <button class="btn btn-sm btn-outline-primary" id="prev-week">Previous</button>
            <h5 id="week-range-title" class="m-0">This Week</h5>
            <button class="btn btn-sm btn-outline-primary" id="next-week">Next</button>
        </div>
        <div class="mb-3 d-flex gap-2">
            <button class="btn btn-sm btn-warning" id="submit-allocations">Submit All Allocations</button>
        </div>
        <div id="loading-indicator" class="text-center" style="display: none;">
            <div class="spinner-border" role="status">
                <span class="sr-only">Loading...</span>
            </div>
            <p>Loading week data...</p>
        </div>
        <div id="calendar-container" class="table-responsive"></div>
        
    `);
	
	let currentWeekStart = moment().startOf('week');
	let selectedTask = null;
	let weekData = {}; // Cache for week data
	let loadingPromise = null; // Prevent multiple simultaneous loads
	let draggedTask = null; // Track dragged task

	// Optimized Methods
	const Methods = {
		async loadWeekData(weekStart, forceReload = false) {
			const weekKey = weekStart.format('YYYY-MM-DD');
			
			if (!forceReload && weekData[weekKey]) {
				return weekData[weekKey];
			}
			
			if (loadingPromise && !forceReload) {
				return await loadingPromise;
			}
			
			this.showLoading(true);
			
			try {
				loadingPromise = frappe.call({
					method: "tours_and_safaris.tours_and_safaris.page.guide_allocation.guide_allocation.get_week_data",
					args: {
						week_start_date: weekKey
					}
				});
				
				const response = await loadingPromise;
				
				if (response.message && !response.message.error) {
					const processed = this.processWeekData(response.message);
					weekData[weekKey] = processed;
					
					
					const tasksWithGroups = processed.tasks.filter(t => t.custom_customer_groups);
					if (tasksWithGroups.length > 0) {
						console.log('Tasks with groups found:', tasksWithGroups.map(t => ({
							name: t.name,
							customer: t.custom_customer_name,
							groups: t.custom_customer_groups
						})));
					}
					
					return processed;
				} else {
					throw new Error(response.message?.error || "Failed to load week data");
				}
			} catch (error) {
				console.error('Error loading week data:', error);
				frappe.show_alert("Error loading week data: " + error.message, 5);
				return null;
			} finally {
				this.showLoading(false);
				loadingPromise = null;
			}
		},

		processWeekData(rawData) {
			const { tasks, instructors, allocations } = rawData;
			
			const processedTasks = tasks.map(task => {
				if (task.custom_assigned_date) {
					const assignedMoment = moment(task.custom_assigned_date);
					return {
						...task,
						original_exp_start_date: task.exp_start_date,
						original_exp_end_date: task.exp_end_date,
						exp_start_date: assignedMoment.format('YYYY-MM-DD'),
						exp_end_date: assignedMoment.format('YYYY-MM-DD'),
						assigned_slot: assignedMoment.hour() < 13 ? 'AM' : 'PM'
					};
				}
				return task;
			});
			
			// Process instructor qualifications
			const processedInstructors = instructors.map(instructor => {
				const qualificationMap = {};
				if (instructor.qualifications) {
					instructor.qualifications.split('|').forEach(qual => {
						const [activity, qualification] = qual.split(':');
						if (activity) {
							qualificationMap[activity] = qualification || '';
						}
					});
				}
				return {
					...instructor,
					qualificationMap
				};
			});
			
			// Process allocations into assignments
			const instructorAssignments = {};
			allocations.forEach(allocation => {
				const instructor = allocation.instructor;
				const activityDate = moment(allocation.activity_date);
				const weekStart = moment(rawData.week_start);
				const dayIndex = activityDate.diff(weekStart, 'days');
				
				if (dayIndex >= 0 && dayIndex < 7) {
					const slot = this.getSlotFromSessionAndTime(allocation.session, allocation.start_time);
					
					if (!instructorAssignments[instructor]) {
						instructorAssignments[instructor] = [];
					}
					
					const originalTask = tasks.find(t => t.name === allocation.task_name || 
														t.name.includes(allocation.task_name));

					const taskObj = {
						name: allocation.allocation_id,
						subject: allocation.detail_activity_name || allocation.activity_name,
						custom_customer_name: originalTask?.custom_customer_name || allocation.customer || 'Unknown'
					};
					
					instructorAssignments[instructor].push({
						task: taskObj,
						dayIndex: dayIndex,
						slot: slot,
						allocationId: allocation.allocation_id
					});
				}
			});
			
			return {
				...rawData,
				tasks: processedTasks,
				instructors: processedInstructors,
				instructorAssignments
			};
		},

				showLoading(show) {
			if (show) {
				$('#loading-indicator').show();
				$('#calendar-container').hide();
			} else {
				$('#loading-indicator').hide();
				$('#calendar-container').show();
			}
		},

		getSlotFromSessionAndTime(session, startTime) {
			if (session === "AM") return "AM";
			if (session === "PM") return "PM";
			
			if (startTime) {
				const time = moment(startTime, "YYYY-MM-DD HH:mm:ss");
				const hour = time.hour();
				return hour < 13 ? "AM" : "PM";
			}
			
			return "AM";
		},

		getColorForCustomer(customerName) {
			if (!customerName) customerName = "Unknown";
			
			const colors = [
				"#FFB6C1", "#FFD700", "#ADFF2F", "#40E0D0", "#FFA07A",
				"#87CEFA", "#9370DB", "#FF69B4", "#98FB98", "#F08080"
			];
			let hash = 0;
			for (let i = 0; i < customerName.length; i++) {
				hash = customerName.charCodeAt(i) + ((hash << 5) - hash);
			}
			const index = Math.abs(hash) % colors.length;
			return colors[index];
		},

		getWeekDays() {
			const weekDays = [];
			for (let i = 0; i < 7; i++) {
				weekDays.push(moment(currentWeekStart).add(i, 'days'));
			}
			return weekDays;
		},

		getTasksForSlot(tasksToRender, day, slot) {
			return tasksToRender.filter(task => {
				
				if (task.custom_assigned_date) {
					const assignedMoment = moment(task.custom_assigned_date);
					const taskDay = assignedMoment.clone().startOf('day');
					const currentDay = day.clone().startOf('day');
					const taskSlot = assignedMoment.hour() < 13 ? 'AM' : 'PM';
					
					return taskDay.isSame(currentDay) && taskSlot === slot;
				}
				
				const taskStart = moment(task.exp_start_date).startOf('day');
				const taskEnd = moment(task.exp_end_date || task.exp_start_date).startOf('day');
				const currentDay = day.clone().startOf('day');
				
				return currentDay.isBetween(taskStart, taskEnd, null, '[]');
			});
		},

		canTaskBeMoved(task, targetDay) {
			const taskStart = moment(task.original_exp_start_date || task.exp_start_date);
			const taskEnd = moment(task.original_exp_end_date || task.exp_end_date || taskStart);
			
			return targetDay.isSameOrAfter(taskStart, 'day') && targetDay.isSameOrBefore(taskEnd, 'day');
		},

		makeTaskCellClickable(task, dayIndex, slot, color, inline = false) {
			const peopleInfo = task.custom_no_of_people ? ` (${task.custom_no_of_people} people)` : '';
			const content = `${task.subject}${peopleInfo}`;
			
			const dragHandle = '<span class="drag-handle" style="cursor: grab; margin-right: 5px;">⋮⋮</span>';
		
			const style = `
				display: inline-block;
				background-color: ${color};
				padding: 2px 6px;
				margin: 2px 0;
				border-radius: 4px;
				font-size: 90%;
				line-height: 1.2;
				position: relative;
			`;
		
			if (inline) {
				return `<div class="assignable-cell draggable-task" 
					draggable="true"
					data-task-name="${task.name}"
					data-task-subject="${task.subject}"
					data-task-customer="${task.custom_customer_name || ''}"
					data-exp-start="${task.original_exp_start_date || task.exp_start_date}"
					data-exp-end="${task.original_exp_end_date || task.exp_end_date || task.exp_start_date}"
					data-day-index="${dayIndex}" 
					data-slot="${slot}" 
					style="${style}; cursor: grab;">
					${dragHandle}${content}
				</div>`;
			}
		
			return `<td class="assignable-cell draggable-task" 
				draggable="true"
				data-task-name="${task.name}"
				data-task-subject="${task.subject}"
				data-task-customer="${task.custom_customer_name || ''}"
				data-exp-start="${task.exp_start_date}"
				data-exp-end="${task.exp_end_date || task.exp_start_date}"
				data-day-index="${dayIndex}" 
				data-slot="${slot}" 
				style="background-color: ${color}; cursor: grab; position: relative;">
				${dragHandle}${content}
			</td>`;
		},

		async createAllocation(taskName, dayIndex, slot, instructorName) {
			const activityDate = moment(currentWeekStart).add(dayIndex, 'days').format("YYYY-MM-DD");
			
			try {
				const response = await frappe.call({
					method: "tours_and_safaris.tours_and_safaris.page.guide_allocation.guide_allocation.create_activity_allocation_optimized",
					args: {
						task_name: taskName,
						activity_date: activityDate,
						slot: slot,
						instructor_name: instructorName
					}
				});
				
				if (response.message && response.message.success) {
					return response.message;
				} else {
					throw new Error(response.message?.message || "Failed to create allocation");
				}
			} catch (error) {
				console.error('Error creating allocation:', error);
				throw error;
			}
		},

		async removeAllocation(instructor, dayIndex, slot, taskSubject) {
			const activityDate = moment(currentWeekStart).add(dayIndex, 'days').format("YYYY-MM-DD");
			const activityName = taskSubject.split(" - Group")[0].trim();
			
			try {
				const response = await frappe.call({
					method: "tours_and_safaris.tours_and_safaris.page.guide_allocation.guide_allocation.remove_activity_allocation_optimized",
					args: {
						instructor: instructor,
						activity_date: activityDate,
						activity_name: activityName
					}
				});
				
				return response.message;
			} catch (error) {
				console.error('Error removing allocation:', error);
				throw error;
			}
		},

async updateTaskSchedule(taskName, newDate, slot) {
    console.log('updateTaskSchedule called with:', { taskName, newDate, slot });
    
    try {
        const requestData = {
            task_name: taskName,
            new_date: newDate,
            slot: slot
        };
        
        console.log('Making frappe.call with:', requestData);
        
        const response = await frappe.call({
            method: "tours_and_safaris.tours_and_safaris.page.guide_allocation.guide_allocation.update_task_schedule",
            args: requestData
        });
        
        console.log('Raw response from server:', response);
        
        if (response && response.message) {
            console.log('Response message:', response.message);
            
            if (response.message.success) {
                console.log('Update successful:', response.message);
                return response.message;
            } else {
                console.error('Update failed:', response.message);
                throw new Error(response.message.message || "Failed to update task schedule");
            }
        } else {
            console.error('Invalid response structure:', response);
            throw new Error("Invalid response from server");
        }
    } catch (error) {
        console.error('Error in updateTaskSchedule:', error);
        
        if (error.name === 'NetworkError' || error.message.includes('fetch')) {
            throw new Error('Network error - please check your connection');
        }
        
        if (error.message && error.message.includes('permission')) {
            throw new Error('Permission denied - please check your user permissions');
        }
        
        if (error.message && error.message.includes('method not found')) {
            throw new Error('Backend method not found - please ensure update_task_schedule method exists');
        }
        
        throw error;
    }
}
,
async splitCustomerIntoGroups(customerName, totalPeople, numberOfGroups) {
    try {
        const response = await frappe.call({
            method: "tours_and_safaris.tours_and_safaris.page.guide_allocation.guide_allocation.split_customer_groups",
            args: {
                customer_name: customerName,
                total_people: totalPeople,
                number_of_groups: numberOfGroups,
                week_start_date: currentWeekStart.format('YYYY-MM-DD')
            }
        });
        
        if (response.message && response.message.success) {
            return response.message;
        } else {
            throw new Error(response.message?.message || "Failed to split customer into groups");
        }
    } catch (error) {
        console.error('Error splitting customer into groups:', error);
        throw error;
    }
},

async testBackendConnection() {
    try {
        console.log('Testing backend connection...');
        
        const response = await frappe.call({
            method: "tours_and_safaris.tours_and_safaris.page.guide_allocation.guide_allocation.get_week_data",
            args: {
                week_start_date: moment().startOf('week').format('YYYY-MM-DD')
            }
        });
        
        console.log('Backend connection test result:', response);
        return response;
    } catch (error) {
        console.error('Backend connection test failed:', error);
        throw error;
    }
}
	};
	
	
	// Main Functions
	async function loadAndRenderCalendar() {
		try {
			// Force reload to get fresh data
			const data = await Methods.loadWeekData(currentWeekStart, true);
			if (data) {
				renderCalendar(data);
			}
		} catch (error) {
			console.error('Error loading calendar:', error);
			frappe.show_alert("Error loading calendar data", 5);
		}
	}
	
	function renderCalendar(data) {
    const { tasks, instructors, instructorAssignments } = data;
    const weekDays = Methods.getWeekDays();
    const customerMap = {};

    $('#week-range-title').text(`${weekDays[0].format('MMM D')} - ${weekDays[6].format('MMM D, YYYY')}`);

    tasks.forEach(task => {
        const customer = task.custom_customer_name || "Unknown";
        if (!customerMap[customer]) {
            customerMap[customer] = { 
                main: [], 
                sub: [],
                hasGroups: false,
                groupsData: [],
                totalPeople: 0
            };
        }
        customerMap[customer].main.push(task);
        
        if (task.custom_no_of_people) {
            customerMap[customer].totalPeople = Math.max(
                customerMap[customer].totalPeople, 
                parseInt(task.custom_no_of_people) || 0
            );
        }
        
        if (task.custom_customer_groups) {
            try {
                let groups;

                if (typeof task.custom_customer_groups === 'string') {
                    groups = JSON.parse(task.custom_customer_groups);
                } else {
                    groups = task.custom_customer_groups;
                }
                
                if (Array.isArray(groups) && groups.length > 0) {
                    
                    const validGroups = groups.filter(group => 
                        group && 
                        typeof group === 'object' && 
                        group.group_name && 
                        group.people_count !== undefined
                    );
                    
                    if (validGroups.length > 0) {
                        customerMap[customer].hasGroups = true;
                        customerMap[customer].groupsData = validGroups;
                        console.log(`Found ${validGroups.length} groups for ${customer}:`, validGroups);
                    }
                }
            } catch (e) {
                console.error(`Error parsing customer groups for ${customer}:`, e, task.custom_customer_groups);
            }
        }
    });

    console.log('Customer Map with Groups:', customerMap);

    let html = '<div style="overflow-x: auto;"><table class="table table-bordered"><thead><tr><th>Customer / Instructor</th>';
    weekDays.forEach(day => {
        html += `<th class="drop-zone" data-day-index="${weekDays.indexOf(day)}">${day.format('ddd D')}<br>AM</th><th class="drop-zone" data-day-index="${weekDays.indexOf(day)}">${day.format('ddd D')}<br>PM</th>`;
    });
    html += '</tr></thead><tbody>';

    function renderTaskRow(label, tasksToRender, color, indent = false) {
        html += `<tr><td style="background-color: ${color}; padding-left: ${indent ? '20px' : '0'};">${label}</td>`;
        
        const taskPlacements = [];

        tasksToRender.forEach(task => {
            if (task.custom_assigned_date) {
                const assignedMoment = moment(task.custom_assigned_date);
                const dayIndex = assignedMoment.diff(moment(currentWeekStart), 'days');
                const slot = assignedMoment.hour() < 13 ? 'AM' : 'PM';
                
                if (dayIndex >= 0 && dayIndex < 7) {
                    taskPlacements.push({ task, dayIndex, slot });
                }
            } else {
                const taskStart = moment(task.exp_start_date);
                const dayIndex = taskStart.diff(moment(currentWeekStart), 'days');
                const slot = task.assigned_slot || 'AM';
                
                if (dayIndex >= 0 && dayIndex < 7) {
                    taskPlacements.push({ task, dayIndex, slot });
                }
            }
        });

        weekDays.forEach((day, dayIndex) => {
            ['AM', 'PM'].forEach(slot => {
                const match = taskPlacements.find(t => t.dayIndex === dayIndex && t.slot === slot);
                if (match) {
                    html += `<td class="drop-zone" data-day-index="${dayIndex}" data-slot="${slot}" style="vertical-align: top; min-height: 40px;">${
                        Methods.makeTaskCellClickable(match.task, dayIndex, slot, color, true)
                    }</td>`;
                } else {
                    html += `<td class="drop-zone" data-day-index="${dayIndex}" data-slot="${slot}" style="vertical-align: top; min-height: 40px;"></td>`;
                }
            });
        });

        html += '</tr>';
    }

    for (const [customer, grouped] of Object.entries(customerMap)) {
        const color = Methods.getColorForCustomer(customer);
        if (grouped.main.length > 0) {
            const peopleCount = grouped.totalPeople;
            
            if (grouped.hasGroups && grouped.groupsData.length > 0) {
                console.log(`Rendering groups for ${customer}:`, grouped.groupsData);
                
            
                const customerLabel = peopleCount > 0 ? 
                    `<strong>${customer} (${peopleCount} people)</strong> <button class="btn btn-xs btn-info split-groups-btn" data-customer="${customer}" data-people="${peopleCount}" data-action="manage">Manage Groups (${grouped.groupsData.length})</button>` : 
                    `<strong>${customer}</strong> <button class="btn btn-xs btn-info split-groups-btn" data-customer="${customer}" data-people="${peopleCount}" data-action="manage">Manage Groups (${grouped.groupsData.length})</button>`;
                
                
                renderTaskRow(customerLabel, [], color);
                
            
                grouped.groupsData.forEach((group, index) => {
                  
                    const groupTasks = grouped.main; 
                    
                    const groupLabel = `<span class="group-row">├─ ${group.group_name} (${group.people_count} people)</span>`;
                    renderTaskRow(groupLabel, groupTasks, color, true);
                });
            } else {
                
                const customerLabel = peopleCount > 0 ? 
                    `<strong>${customer} (${peopleCount} people)</strong> <button class="btn btn-xs btn-primary split-groups-btn" data-customer="${customer}" data-people="${peopleCount}" data-action="split">Split Groups</button>` : 
                    `<strong>${customer}</strong>`;
                
                renderTaskRow(customerLabel, grouped.main, color);
            }
        }
    }
    // Render instructors 
    instructors.forEach(instr => {
        html += `<tr><td><span class="text-primary">— ${instr.instructor_name}</span></td>`;
        for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
            ['AM', 'PM'].forEach(slot => {
                const assigned = (instructorAssignments[instr.name] || []).find(
                    a => a.dayIndex === dayIndex && a.slot === slot
                );
                if (assigned) {
                    html += `<td class="assigned-task drop-zone" 
                        data-instructor="${instr.name}" 
                        data-day-index="${dayIndex}" 
                        data-slot="${slot}" 
                        data-task-name="${assigned.task.name}" 
                        data-subject="${assigned.task.subject}" 
                        style="background:${Methods.getColorForCustomer(assigned.task.custom_customer_name)}; cursor:pointer; position: relative; min-height: 40px;">
                        ${assigned.task.subject} 
                        <span class="remove-assignment" style="color:red; cursor:pointer; font-weight:bold; position: absolute; top: 2px; right: 5px;">&times;</span>
                    </td>`;
                } else {
                    html += `<td class="assignable-slot drop-zone" 
                        data-instructor="${instr.name}" 
                        data-day-index="${dayIndex}" 
                        data-slot="${slot}" 
                        style="cursor:pointer; border:2px dashed #ccc; text-align:center; min-height: 40px;">
                        <small>${slot}</small>
                    </td>`;
                }
            });
        }
        html += '</tr>';
    });

    html += '</tbody></table></div>';
    $('#calendar-container').html(html);
    
    // Initialize drag and drop after rendering
    initializeDragAndDrop();
	}

	// Drag and Drop function
	function initializeDragAndDrop() {
		// Handle drag start
		$('#calendar-container').on('dragstart', '.draggable-task', function(e) {
			draggedTask = {
			elementHTML: this.outerHTML,
			taskName: $(this).data('task-name'),
			taskSubject: $(this).data('task-subject'),
			customer: $(this).data('task-customer'),
			expStart: $(this).data('exp-start'),
			expEnd: $(this).data('exp-end'),
			originalDayIndex: $(this).data('day-index'),
			originalSlot: $(this).data('slot')
		};

			
			$(this).css('opacity', '0.5');
			
			// Set drag effect
			e.originalEvent.dataTransfer.effectAllowed = 'move';
			e.originalEvent.dataTransfer.setData('text/html', this.outerHTML);
			
			console.log('Drag started:', draggedTask);
		});

		// Handle drag end
		$('#calendar-container').on('dragend', '.draggable-task', function(e) {
			$(this).css('opacity', '1');
			$('.drop-zone').removeClass('drag-over drag-valid drag-invalid');
		});

		// Handle drag over
		$('#calendar-container').on('dragover', '.drop-zone', function(e) {
			e.preventDefault();
			e.originalEvent.dataTransfer.dropEffect = 'move';
			
			if (draggedTask) {
				const targetDayIndex = parseInt($(this).data('day-index'));
				const targetSlot = $(this).data('slot');
				const targetDay = moment(currentWeekStart).add(targetDayIndex, 'days');
				
				const canMove = Methods.canTaskBeMoved({
					exp_start_date: draggedTask.expStart,
					exp_end_date: draggedTask.expEnd
				}, targetDay);
				
				$('.drop-zone').removeClass('drag-over drag-valid drag-invalid');
				
				if (canMove) {
					$(this).addClass('drag-over drag-valid');
				} else {
					$(this).addClass('drag-over drag-invalid');
				}
			}
		});

		// Handle drag leave
		$('#calendar-container').on('dragleave', '.drop-zone', function(e) {
			$(this).removeClass('drag-over drag-valid drag-invalid');
		});

		// Handle drop
		$('#calendar-container').on('drop', '.drop-zone', async function (e) {
			e.preventDefault();

			const originalContent = $(this).html();

			if (!draggedTask || !draggedTask.elementHTML) {
				console.warn("Dragged task or its HTML is missing — drop cancelled");
				return;
			}

			try {
				const targetDayIndex = parseInt($(this).data('day-index'));
				const targetSlot = $(this).data('slot') || draggedTask.originalSlot;
				const targetDay = moment(currentWeekStart).add(targetDayIndex, 'days');

				$('.drop-zone').removeClass('drag-over drag-valid drag-invalid');

				const canMove = Methods.canTaskBeMoved({
					exp_start_date: draggedTask.expStart,
					exp_end_date: draggedTask.expEnd
				}, targetDay);

				if (!canMove) {
					frappe.show_alert(`Task cannot be moved to ${targetDay.format('MMM D')}`, 5);
					draggedTask = null;
					return;
				}

				if (targetDayIndex === draggedTask.originalDayIndex && targetSlot === draggedTask.originalSlot) {
					draggedTask = null;
					return;
				}

				$(this).html('<small>Moving...</small>');

				const newDate = targetDay.format('YYYY-MM-DD');
				await Methods.updateTaskSchedule(draggedTask.taskName, newDate, targetSlot);

				const $newElement = $(draggedTask.elementHTML).css('opacity', '1');
				$newElement.data('day-index', targetDayIndex);
				$newElement.data('slot', targetSlot);

				$(this).html('').append($newElement);

				frappe.show_alert(`Moved ${draggedTask.taskSubject} to ${targetDay.format('MMM D')} ${targetSlot}`, 3);
			} catch (error) {
				console.error('Error moving task:', error);
				frappe.show_alert('Error moving task: ' + (error.message || 'Unknown error'), 5);
				$(this).html(originalContent); 
			} finally {
				draggedTask = null;
			}
		});
	}

	$('#calendar-container').on('click', '.split-groups-btn', function(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const customer = $(this).data('customer');
    const totalPeople = $(this).data('people');
    const action = $(this).data('action');
    
    console.log('Split groups clicked:', { customer, totalPeople, action });
    
    if (action === 'manage') {
        
        frappe.show_alert(`Managing ${$(this).text().match(/\((\d+)\)/)?.[1] || 0} groups for ${customer}`, 5);
        return;
    }
    
    if (!totalPeople || totalPeople <= 1) {
        frappe.show_alert('Customer must have more than 1 person to split into groups', 5);
        return;
    }
    
    const dialog = new frappe.ui.Dialog({
        title: `Split ${customer} into Groups`,
        fields: [
            {
                label: `Total People: ${totalPeople}`,
                fieldtype: 'HTML',
                options: `<p><strong>Total People:</strong> ${totalPeople}</p>`
            },
            {
                label: 'Number of Groups',
                fieldname: 'number_of_groups',
                fieldtype: 'Int',
                reqd: 1,
                default: 2,
                description: 'How many groups do you want to create?'
            }
        ],
        primary_action_label: 'Split Groups',
        primary_action: async (values) => {
            if (values.number_of_groups < 1 || values.number_of_groups > totalPeople) {
                frappe.show_alert('Number of groups must be between 1 and total people', 5);
                return;
            }
            
            try {
                dialog.hide();
                frappe.show_alert('Splitting customer into groups...', 3);
                
                const result = await Methods.splitCustomerIntoGroups(
                    customer, 
                    totalPeople, 
                    values.number_of_groups
                );
                
                frappe.show_alert(`Successfully split ${customer} into ${values.number_of_groups} groups`, 5);
                await loadAndRenderCalendar(); 
                
            } catch (error) {
                console.error('Error splitting groups:', error);
                frappe.show_alert('Error splitting groups: ' + (error.message || 'Unknown error'), 5);
            }
        }
    });
    
    dialog.show();
});

	$('#calendar-container').on('click', '.assignable-cell', function (e) {
		// Don't trigger selection when dragging
		if (e.target.classList.contains('drag-handle')) {
			return;
		}
		
		e.preventDefault();
		e.stopPropagation();
		
		// Clear previous selections
		$('.assignable-cell').removeClass('selected-task');
		$(this).addClass('selected-task');
		
		// Store selected task data
		selectedTask = {
			name: $(this).data('task-name'),
			subject: $(this).data('task-subject'),
			custom_customer_name: $(this).data('task-customer')
		};
		
		frappe.show_alert(`Selected: ${selectedTask.subject}`, 2);
		console.log('Selected task:', selectedTask);
	});

	$('#calendar-container').on('click', '.assignable-slot', async function (e) {
		e.preventDefault();
		e.stopPropagation();
		
		if (!selectedTask) {
			frappe.show_alert('Please select a task first by clicking on it', 5);
			return;
		}
		
		const instructor = $(this).data('instructor');
		const dayIndex = parseInt($(this).data('day-index'));
		const slot = $(this).data('slot');
		
		console.log('Assigning task:', selectedTask.name, 'to instructor:', instructor, 'on day:', dayIndex, 'slot:', slot);
		
		try {
			// Show loading state
			$(this).html('<small>Assigning...</small>');
			
			const result = await Methods.createAllocation(selectedTask.name, dayIndex, slot, instructor);
			console.log('Assignment result:', result);
			
			frappe.show_alert(`Assigned ${selectedTask.subject} to ${instructor}`, 3);
			await loadAndRenderCalendar();
			
			// Clear selection
			selectedTask = null;
			$('.assignable-cell').removeClass('selected-task');
			
		} catch (error) {
			console.error('Assignment error:', error);
			frappe.show_alert(error.message || 'Error assigning task', 5);
			// Restore original content
			$(this).html(`<small>${slot}</small>`);
		}
	});

	$('#calendar-container').on('click', '.remove-assignment', async function (e) {
		e.preventDefault();
		e.stopPropagation();
		
		const cell = $(this).closest('.assigned-task');
		const instructor = cell.data('instructor');
		const dayIndex = parseInt(cell.data('day-index'));
		const slot = cell.data('slot');
		const subject = cell.data('subject');
		
		console.log('Removing assignment:', instructor, dayIndex, slot, subject);
		
		try {
			// Show loading state
			cell.html('<small>Removing...</small>');
			
			const result = await Methods.removeAllocation(instructor, dayIndex, slot, subject);
			console.log('Removal result:', result);
			
			frappe.show_alert(`Removed assignment from ${instructor}`, 3);
			await loadAndRenderCalendar();
			
		} catch (error) {
			console.error('Removal error:', error);
			frappe.show_alert(error.message || 'Error removing assignment', 5);
			// Reload to restore original state
			await loadAndRenderCalendar();
		}
	});

	$('#calendar-container').on('click', '.assigned-task', function (e) {
		if (!$(e.target).hasClass('remove-assignment')) {
			e.preventDefault();
			e.stopPropagation();
			frappe.show_alert('This slot is already assigned. Click the × to remove it.', 3);
		}
	});

	$('#submit-allocations').on('click', async () => {
		try {
			const res = await frappe.call({
				method: 'tours_and_safaris.tours_and_safaris.page.guide_allocation.guide_allocation.submit_week_allocations',
				args: { week_start_date: currentWeekStart.format('YYYY-MM-DD') }
			});
			frappe.show_alert(res.message.message);
			await loadAndRenderCalendar();
		} catch (error) {
			frappe.show_alert('Error submitting allocations', 5);
		}
	});

	

	$('#prev-week').on('click', () => {
		currentWeekStart.subtract(7, 'days');
		loadAndRenderCalendar();
	});

	$('#next-week').on('click', () => {
		currentWeekStart.add(7, 'days');
		loadAndRenderCalendar();
	});

	
		$('<style>').prop('type', 'text/css').html(`
			.selected-task {
				border: 3px solid #007bff !important;
				box-shadow: 0 0 5px rgba(0,customer123,255,0.5);
			}
			.assignable-slot:hover {
				background-color: #e9ecef !important;
			}
			.assigned-task:hover {
				opacity: 0.8;
			}
			.remove-assignment:hover {
				color: #dc3545 !important;
				font-size: 16px;
			}
			.split-groups-btn {
				margin-left: 10px;
				font-size: 11px;
				padding: 2px 6px;
			}

			.group-row {
				font-style: italic;
				color: #666;
			}
		`).appendTo('head');

	// Initialize
	loadAndRenderCalendar();
}