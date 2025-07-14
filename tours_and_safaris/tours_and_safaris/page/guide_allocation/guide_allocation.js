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
			<button class="btn btn-sm btn-secondary" id="print-calendar">Print Calendar</button>
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
	let selectedTasks = []; // Track selected tasks for bulk actions
	let multiSelectMode = false;
	let blackoutModeInstructor = null;
	let blackoutSelections = [];


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
			
			// Separate parent tasks and subtasks
			const parentTasks = processedTasks.filter(task => !task.parent_task);
			const subTasks = processedTasks.filter(task => task.parent_task);
			
			// Group subtasks by parent
			const subTasksByParent = {};
			subTasks.forEach(subTask => {
				if (!subTasksByParent[subTask.parent_task]) {
					subTasksByParent[subTask.parent_task] = [];
				}
				subTasksByParent[subTask.parent_task].push(subTask);
			});
			
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
				parentTasks: parentTasks,
				subTasks: subTasks,
				subTasksByParent: subTasksByParent,
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
			const filtered = tasksToRender.filter(task => {
				const currentDay = day.clone().startOf('day');

				if (task.custom_assigned_date) {
					const assignedMoment = moment(task.custom_assigned_date);
					const taskDay = assignedMoment.clone().startOf('day');
					const taskSlot = assignedMoment.hour() < 13 ? 'AM' : 'PM';

					return taskDay.isSame(currentDay) && taskSlot === slot;
				}

				const taskStart = moment(task.exp_start_date).startOf('day');
				const taskEnd = moment(task.exp_end_date || task.exp_start_date).startOf('day');

				return currentDay.isBetween(taskStart, taskEnd, null, '[]');
			});

			console.log(`Tasks for ${day.format('YYYY-MM-DD')} ${slot}:`, filtered.map(t => t.subject));
			return filtered;
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
					data-task-people="${task.custom_no_of_people || ''}"
					data-task-project="${task.project || ''}"
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
				data-task-people="${task.custom_no_of_people || ''}"
				data-task-project="${task.project || ''}"
				data-exp-start="${task.exp_start_date}"
				data-exp-end="${task.exp_end_date || task.exp_start_date}"
				data-day-index="${dayIndex}" 
				data-slot="${slot}" 
				style="background-color: ${color}; cursor: grab; position: relative;">
				${dragHandle}${content}
			</td>`;


		},
		getTaskRangeHighlight(task, day, color) {
			const taskStart = moment(task.original_exp_start_date || task.exp_start_date).startOf('day');
			const taskEnd = moment(task.original_exp_end_date || task.exp_end_date || task.exp_start_date).startOf('day');
			const currentDay = day.clone().startOf('day');
			
			if (!currentDay.isBetween(taskStart, taskEnd, null, '[]')) {
				return '';
			}
			
			const isStart = currentDay.isSame(taskStart);
			const isEnd = currentDay.isSame(taskEnd);
			const lightColor = color + '33'; 
			const borderColor = color + '77'; 
			
			let classes = 'task-range-highlight';
			let styles = `background-color: ${lightColor}; border-color: ${borderColor};`;
			
			if (isStart && isEnd) {
				styles += ` border: 2px solid ${borderColor}; border-radius: 4px;`;
			} else if (isStart) {
				classes += ' task-range-start';
			} else if (isEnd) {
				classes += ' task-range-end';
			} else {
				classes += ' task-range-middle';
			}
			
			return { classes, styles };
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
                week_start_date: currentWeekStart.format('YYYY-MM-DD'),
                split_tasks: true 
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


async loadActivityTypes() {
    try {
        const response = await frappe.call({
            method: "frappe.client.get_list",
            args: {
                doctype: "Activity Type",
                fields: ["name"],
                limit_page_length: 100
            }
        });

        const activities = response.message || [];
        const $body = $('#activity-list-body');
        $body.empty();

        activities.forEach(activity => {
			const row = `
				<tr>
					<td>
						<input type="checkbox" class="activity-checkbox" value="${activity.name}" />
						${activity.name}
					</td>
					<td>${activity.description || ''}</td>
				</tr>
			`;
			$body.append(row);
		});

    } catch (err) {
        console.error("Failed to load activity types", err);
        $('#activity-list-body').html(`<tr><td colspan="2">Error loading activities</td></tr>`);
    }
}
,

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

	async function assignMultipleTasksFromStartCell(instructorName, strategy) {
	const weekKey = currentWeekStart.format('YYYY-MM-DD');
	const data = weekData[weekKey];
	const assignments = data.instructorAssignments[instructorName] || [];
	
	// Find available slots for the instructor
	const availableSlots = [];
	for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
	const slotDate = moment(currentWeekStart).add(dayIndex, 'days');
	
	['AM', 'PM'].forEach(slot => {
		if (strategy === 'AM slots only' && slot === 'PM') return;
		if (strategy === 'PM slots only' && slot === 'AM') return;

		// Check if slot is already taken
		const isOccupied = assignments.some(a => a.dayIndex === dayIndex && a.slot === slot);
		if (isOccupied) return;

		// Validate that each selected task can be assigned to this date
		const validForAll = selectedTasks.every(task => {
			const taskStart = moment(task.exp_start_date).startOf('day');
			const taskEnd = moment(task.exp_end_date || task.exp_start_date).startOf('day');
			return slotDate.isBetween(taskStart, taskEnd, null, '[]');
		});

		if (validForAll) {
			availableSlots.push({ dayIndex, slot });
		}
	});
}

	
	if (availableSlots.length < selectedTasks.length) {
		frappe.show_alert(`Only ${availableSlots.length} slots available, but ${selectedTasks.length} tasks selected`, 5);
		return;
	}
	
	// Assign tasks to available slots
	let successCount = 0;
	for (let i = 0; i < selectedTasks.length && i < availableSlots.length; i++) {
		const task = selectedTasks[i];
		const slot = availableSlots[i];
		
		try {
			await Methods.createAllocation(task.name, slot.dayIndex, slot.slot, instructorName);
			successCount++;
		} catch (error) {
			console.error(`Failed to assign ${task.subject}:`, error);
		}
	}
	
	//frappe.show_alert(`Assigned ${successCount}/${selectedTasks.length} tasks to ${instructorName}`, 4);
	
	// Clean up and refresh
	exitMultiSelectMode();
	await loadAndRenderCalendar();
}

async function assignMultipleTasksFromStartCell(instructor, startDayIndex, startSlot) {
	if (selectedTasks.length === 0) {
		frappe.show_alert('No tasks selected', 3);
		return;
	}

	const weekKey = currentWeekStart.format('YYYY-MM-DD');
	const data = weekData[weekKey];
	const assignments = data.instructorAssignments[instructor] || [];

	const sequence = [];
	let dayIndex = startDayIndex;
	let slot = startSlot;

	// Build the sequence of available cells
	for (let i = 0; i < 7 * 2; i++) { // Max 14 slots (7 days * 2 slots)
		if (dayIndex >= 7) break;

		const isOccupied = assignments.some(a => a.dayIndex === dayIndex && a.slot === slot);
		if (!isOccupied) {
			sequence.push({ dayIndex, slot });
		}

		// Move to next slot
		if (slot === 'AM') {
			slot = 'PM';
		} else {
			slot = 'AM';
			dayIndex++;
		}

		if (sequence.length >= selectedTasks.length) break;
	}

	if (sequence.length < selectedTasks.length) {
		frappe.show_alert(`Only ${sequence.length} available slots for ${selectedTasks.length} tasks`, 5);
		return;
	}

	// Assign tasks
	let successCount = 0;
	for (let i = 0; i < selectedTasks.length; i++) {
		const task = selectedTasks[i];
		const target = sequence[i];
		const taskStart = moment(task.exp_start_date);
		const taskEnd = moment(task.exp_end_date || task.exp_start_date);
		const targetDate = moment(currentWeekStart).add(target.dayIndex, 'days');

		if (!targetDate.isBetween(taskStart, taskEnd, null, '[]')) {
			console.warn(`Skipping ${task.subject} — out of date range`);
			continue;
		}

		try {
			await Methods.createAllocation(task.name, target.dayIndex, target.slot, instructor);
			successCount++;
		} catch (error) {
			console.error(`Failed to assign ${task.subject}`, error);
		}
	}

	//frappe.show_alert(`Assigned ${successCount}/${selectedTasks.length} tasks to ${instructor}`, 4);
	exitMultiSelectMode();
	await loadAndRenderCalendar();
}


	async function assignTaskAcrossWeek(task, instructorName) {
	const weekKey = currentWeekStart.format('YYYY-MM-DD');
	const data = weekData[weekKey];
	const assignments = data.instructorAssignments[instructorName] || [];

	const taskStart = moment(task.exp_start_date).startOf('day');
	const taskEnd = moment(task.exp_end_date || task.exp_start_date).startOf('day');

	let successCount = 0;

	for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
		const slotDate = moment(currentWeekStart).add(dayIndex, 'days');

		// ✅ Only assign if slotDate is within task range
		if (!slotDate.isBetween(taskStart, taskEnd, null, '[]')) continue;

		for (let slot of ['AM', 'PM']) {
			const isOccupied = assignments.some(a => a.dayIndex === dayIndex && a.slot === slot);
			if (isOccupied) continue;

			try {
				await Methods.createAllocation(task.name, dayIndex, slot, instructorName);
				successCount++;
				break; // one assignment per day
			} catch (err) {
				console.error(`Failed to assign on ${slotDate.format('ddd')} ${slot}`, err);
			}
		}
	}

	if (successCount === 0) {
		frappe.show_alert(`No available slots for ${instructorName} in task date range`, 5);
	} else {
		frappe.show_alert(`Assigned "${task.subject}" to ${instructorName} on ${successCount} day(s)`, 4);
		await loadAndRenderCalendar();
	}
}

	
	// Main Functions
	async function loadAndRenderCalendar() {
		try {
			// Force reload to get fresh data
			const data = await Methods.loadWeekData(currentWeekStart, true);
			if (data) {
				renderCalendar(data);
				await Methods.loadActivityTypes();
			}
		} catch (error) {
			console.error('Error loading calendar:', error);
			frappe.show_alert("Error loading calendar data", 5);
		}
	}	// Drag and Drop

	
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
				totalPeople: 0,
				parentTasks: [],
				subTasks: []
			};
		}
		
		// Separate parent and sub tasks
		if (task.parent_task) {
			customerMap[customer].subTasks.push(task);
		} else {
			customerMap[customer].parentTasks.push(task);
			customerMap[customer].main.push(task);
		}
		
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

    let html = '<div id="calendar-scroll-wrapper" style="max-height: 80vh; overflow-y: auto; overflow-x: auto;"><table class="table table-bordered"><thead><tr><th>Customer / Instructor</th>';
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

		const renderedTaskNames = new Set();

		weekDays.forEach((day, dayIndex) => {
			['AM', 'PM'].forEach(slot => {
				const slotTasks = Methods.getTasksForSlot(tasksToRender, day, slot).filter(task => {
					return !renderedTaskNames.has(task.name);
				});

				let backgroundStyle = '';
				
				// Enhanced background highlighting for date ranges
				const currentDay = day.clone().startOf('day');
				
				// Check if any task's date range covers this day
				const coveringTasks = tasksToRender.filter(task => {
					const taskStart = moment(task.original_exp_start_date || task.exp_start_date).startOf('day');
					const taskEnd = moment(task.original_exp_end_date || task.exp_end_date || task.exp_start_date).startOf('day');
					
					return currentDay.isBetween(taskStart, taskEnd, null, '[]');
				});

				if (coveringTasks.length > 0) {
					const lightColor = color + '33'; 
					backgroundStyle = `background-color: ${lightColor}; border: 1px solid ${color}55;`;
				}

				html += `<td class="drop-zone" data-day-index="${dayIndex}" data-slot="${slot}" style="vertical-align: top; min-height: 40px; ${backgroundStyle}">`;

				if (slotTasks.length > 0) {
					slotTasks.forEach(task => {
						html += Methods.makeTaskCellClickable(task, dayIndex, slot, color, true);
						renderedTaskNames.add(task.name);
					});
				}

				html += `</td>`;
			});
		});

		html += '</tr>';
	}


    for (const [customer, grouped] of Object.entries(customerMap)) {
		const color = Methods.getColorForCustomer(customer);
		if (grouped.main.length > 0 || grouped.subTasks.length > 0) {
			const peopleCount = grouped.totalPeople;
			
			if (grouped.hasGroups && grouped.groupsData.length > 0) {
				// Render main customer row
				const customerLabel = peopleCount > 0 ? 
					`<strong>${customer} (${peopleCount} people)</strong> <button class="btn btn-xs btn-info split-groups-btn" data-customer="${customer}" data-people="${peopleCount}" data-action="manage">Manage Groups (${grouped.groupsData.length})</button>` : 
					`<strong>${customer}</strong> <button class="btn btn-xs btn-info split-groups-btn" data-customer="${customer}" data-people="${peopleCount}" data-action="manage">Manage Groups (${grouped.groupsData.length})</button>`;
				
				renderTaskRow(customerLabel, grouped.parentTasks, color);
				
				// Render group subtasks
				grouped.groupsData.forEach((group, index) => {
					// Find subtasks for this group 
					const groupSubTasks = grouped.subTasks.filter(subTask => {
					
						return subTask.custom_group_name === group.group_name || 
							subTask.custom_group_index === index ||
							subTask.subject.includes(group.group_name) ||
							(subTask.custom_customer_groups && 
								subTask.custom_customer_groups.includes(group.group_name));
					});
					
					console.log(`Group ${group.group_name} subtasks:`, groupSubTasks.map(t => ({
						name: t.name,
						subject: t.subject,
						custom_group_name: t.custom_group_name,
						parent_task: t.parent_task
					})));
					
					const groupLabel = `<span class="group-row">├─ ${group.group_name} (${group.people_count} people)</span>`;
					renderTaskRow(groupLabel, groupSubTasks, color, true);
				});
			} else {
				// Render main customer with option to split
				const customerLabel = peopleCount > 0 ? 
					`<strong>${customer} (${peopleCount} people)</strong> <button class="btn btn-xs btn-primary split-groups-btn" data-customer="${customer}" data-people="${peopleCount}" data-action="split">Split Groups</button>` : 
					`<strong>${customer}</strong>`;
				
				// Show parent tasks
				renderTaskRow(customerLabel, grouped.parentTasks, color);
				
				// Show any existing subtasks
				if (grouped.subTasks.length > 0) {
					grouped.subTasks.forEach(subTask => {
						const subTaskLabel = `<span class="group-row">├─ ${subTask.subject} ${subTask.custom_group_name ? '(' + subTask.custom_group_name + ')' : ''}</span>`;
						renderTaskRow(subTaskLabel, [subTask], color, true);
					});
				}
			}
		}
	}
    // Render instructors 
    instructors.forEach(instr => {
        html += `<tr><td>
    <span class="text-primary">— ${instr.instructor_name}</span>
    <button class="btn btn-xs btn-outline-dark ml-2 blackout-toggle" 
            data-instructor="${instr.name}">
        <i class="fa fa-eye-slash"></i> Blackout
    </button>
</td>`;

        for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
			['AM', 'PM'].forEach(slot => {
				const isBlackout = data.blackouts?.[instr.name]?.[`${dayIndex}_${slot}`];
				const assigned = (instructorAssignments[instr.name] || []).find(
					a => a.dayIndex === dayIndex && a.slot === slot
				);

				if (isBlackout) {
					html += `<td class="blackout-slot drop-zone" 
						data-instructor="${instr.name}" 
						data-day-index="${dayIndex}" 
						data-slot="${slot}" 
						style="background: repeating-linear-gradient(45deg,#ccc,#ccc 10px,#bbb 10px,#bbb 20px); 
							color: #555; 
							text-align: center; 
							min-height: 40px; 
							cursor: not-allowed;">
						<em>Blackout</em>
					</td>`;
				} else if (assigned) {
					const customerForColor = assigned.task.custom_customer_name || 'Unknown';
					const assignedColor = Methods.getColorForCustomer(customerForColor);

					html += `<td class="assigned-task drop-zone" 
						data-instructor="${instr.name}" 
						data-day-index="${dayIndex}" 
						data-slot="${slot}" 
						data-task-name="${assigned.task.name}" 
						data-subject="${assigned.task.subject}" 
						style="background:${assignedColor}; cursor:pointer; position: relative; min-height: 40px;">
						${assigned.task.subject} 
						<span class="remove-assignment" 
							style="color:red; cursor:pointer; font-weight:bold; position: absolute; top: 2px; right: 5px;">&times;</span>
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
	html += `
	<div class="mt-4">
		<h5 style="cursor: pointer;" data-toggle="collapse" data-target="#activity-selector" aria-expanded="false" aria-controls="activity-selector">
			<span>▶</span> Select Additional Activities for Multiactivity Task
		</h5>
		<div id="activity-selector" class="collapse table table-sm table-bordered">
		<table class="table">
			<thead>
			<tr><th>Activity</th><th>Action</th></tr>
			</thead>
			<tbody id="activity-list-body">
			<tr><td colspan="2">Loading activities...</td></tr>
			</tbody>
		</table>
		</div>
		<div class="mt-2 text-right">
			<button class="btn btn-sm btn-success" id="add-selected-activities">Add Selected Activities</button>
		</div>
	</div>
	`;
	const $buttonContainer = $('.mb-3.d-flex.gap-2');
		if ($buttonContainer.length && $('#toggle-multi-select').length === 0) {
			const multiSelectButton = `<button class="btn btn-sm btn-info" id="toggle-multi-select">Multi-Select Mode</button>`;
			$buttonContainer.append(multiSelectButton);
		}

		$('#calendar-container').on('click', '.assignable-cell', function (e) {
			// Don't trigger selection when dragging
			if (e.target.classList.contains('drag-handle')) {
				return;
			}
			
			e.preventDefault();
			e.stopPropagation();
			
			const taskData = {
				name: $(this).data('task-name'),
				subject: $(this).data('task-subject'),
				custom_customer_name: $(this).data('task-customer'),
				exp_start_date: $(this).data('exp-start'),
				exp_end_date: $(this).data('exp-end'),
				custom_no_of_people: $(this).data('task-people'),
				project: $(this).data('task-project'),
				element: this
			};
			
			if (multiSelectMode) {
				// Multi-select mode
				const existingIndex = selectedTasks.findIndex(t => t.name === taskData.name);
				
				if (existingIndex >= 0) {
					// Deselect if already selected
					selectedTasks.splice(existingIndex, 1);
					$(this).removeClass('multi-selected-task');
				} else {
					// Add to selection
					selectedTasks.push(taskData);
					$(this).addClass('multi-selected-task');
				}
				
				updateMultiSelectUI();
			} else {
				// Single select mode (existing behavior)
				$('.assignable-cell').removeClass('selected-task');
				$(this).addClass('selected-task');
				
				selectedTask = taskData;
				//frappe.show_alert(`Selected: ${selectedTask.subject}`, 2);
				console.log('Selected task:', selectedTask);
			}
		});

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
			
			//console.log('Drag started:', draggedTask);
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
        $(this).html(originalContent);
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

        //frappe.show_alert(`Moved ${draggedTask.taskSubject} to ${targetDay.format('MMM D')} ${targetSlot}`, 3);
        await loadAndRenderCalendar();  

    } catch (error) {
        console.error('Error moving task:', error);
        frappe.show_alert('Error moving task: ' + (error.message || 'Unknown error'), 5);
        $(this).html(originalContent);
    } finally {
        draggedTask = null;
    }
});
	}

	function updateMultiSelectUI() {
	const count = selectedTasks.length;
	$('#selected-count').text(`${count} task${count !== 1 ? 's' : ''} selected`);
	$('#assign-multiple').prop('disabled', count === 0);
}

function exitMultiSelectMode() {
	multiSelectMode = false;
	selectedTasks = [];
	$('#toggle-multi-select').text('Multi-Select Mode').removeClass('btn-warning').addClass('btn-info');
	$('#multi-select-controls').hide();
	$('.assignable-cell').removeClass('multi-selected-task');
	$('.assignable-slot').removeClass('multi-select-mode');
	frappe.show_alert('Multi-select mode disabled', 2);
}

function showInstructorSelectionDialog() {
	// Get current week data for instructors
	const weekKey = currentWeekStart.format('YYYY-MM-DD');
	const data = weekData[weekKey];
	
	if (!data || !data.instructors) {
		frappe.show_alert('No instructor data available', 5);
		return;
	}
	
	const dialog = new frappe.ui.Dialog({
		title: `Assign ${selectedTasks.length} Tasks`,
		fields: [
			{
				label: 'Selected Tasks',
				fieldtype: 'HTML',
				options: `<ul>${selectedTasks.map(t => `<li>${t.subject} (${t.custom_customer_name})</li>`).join('')}</ul>`
			},
			{
				label: 'Instructor',
				fieldname: 'instructor',
				fieldtype: 'Select',
				options: data.instructors.map(i => i.instructor_name).join('\n'),
				reqd: 1
			},
			{
				label: 'Assignment Strategy',
				fieldname: 'strategy',
				fieldtype: 'Select',
				options: 'Spread across available slots\nAM slots only\nPM slots only',
				default: 'Spread across available slots',
				reqd: 1
			}
		],
		primary_action_label: 'Assign All',
		primary_action: async (values) => {
			dialog.hide();
			await assignMultipleTasksFromStartCell(values.instructor, values.strategy);
		}
	});
	
	dialog.show();
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
$('#calendar-container').on('click', '.add-activity-btn', async function () {
    const activityType = $(this).data('activity');
    
    if (!selectedTask || selectedTask.subject !== "Multi Activity") {
        frappe.show_alert("Please select a 'Multiactivity' task in the calendar first.", 5);
        return;
    }

    try {
        const result = await frappe.call({
            method: "tours_and_safaris.tours_and_safaris.page.guide_allocation.guide_allocation.create_multiactivity_task",
            args: {
                customer: selectedTask.custom_customer_name,
				customer_name: selectedTask.custom_customer_name,
				no_of_people: selectedTask.custom_no_of_people,
                activity_type: activityType,
                start_date: selectedTask.exp_start_date,
                end_date: selectedTask.exp_end_date,
				project:selectedTask.project
            }
        });

       // frappe.show_alert(`Activity "${activityType}" added for ${selectedTask.custom_customer_name}`, 4);
        await loadAndRenderCalendar();
		
    } catch (error) {
        console.error('Error adding multiactivity task:', error);
        frappe.show_alert('Failed to add activity', 5);
    }
});
$('#calendar-container').on('click', '#add-selected-activities', async function () {
    if (!selectedTask || selectedTask.subject !== "Multi Activity") {
        frappe.show_alert("Please select a 'Multiactivity' task first.", 5);
        return;
    }

    const selectedActivities = [];
    $('.activity-checkbox:checked').each(function () {
        selectedActivities.push($(this).val());
    });

    if (selectedActivities.length === 0) {
        frappe.show_alert("No activities selected.", 5);
        return;
    }

    const commonData = {
    customer: selectedTask.custom_customer_name,
    custom_customer_name: selectedTask.custom_customer_name,  
    start_date: selectedTask.exp_start_date,
    end_date: selectedTask.exp_end_date,
    number_of_people: selectedTask.custom_no_of_people,
    custom_no_of_people: selectedTask.custom_no_of_people,   
    project: selectedTask.project                            
};


    frappe.show_alert("Creating selected activity tasks...", 3);
	
    try {
        for (let activity of selectedActivities) {
			console.log("Sending activity with data:", { ...commonData, activity });

            await frappe.call({
                method: "tours_and_safaris.tours_and_safaris.page.guide_allocation.guide_allocation.create_multiactivity_task",
                args: {
                    ...commonData,
                    activity_type: activity
                }
				
            });
        }

        //frappe.show_alert(`Created ${selectedActivities.length} activity tasks`, 4);
        await loadAndRenderCalendar();

    } catch (err) {
        console.error("Error creating multiactivity tasks:", err);
        frappe.show_alert("Failed to create some activities", 5);
    }
});


$('#calendar-container').on('click', '.assignable-slot', async function (e) {
	e.preventDefault();
	e.stopPropagation();

	const instructor = $(this).data('instructor');
	const dayIndex = parseInt($(this).data('day-index'));
	const slot = $(this).data('slot');

	// Handle blackout mode
	if (blackoutModeInstructor === instructor) {
		const $cell = $(this);
		const alreadySelected = blackoutSelections.find(b => b.dayIndex === dayIndex && b.slot === slot);

		if (alreadySelected) {
			blackoutSelections = blackoutSelections.filter(b => !(b.dayIndex === dayIndex && b.slot === slot));
			$cell.removeClass('blackout-selected');
		} else {
			blackoutSelections.push({ instructor, dayIndex, slot });
			$cell.addClass('blackout-selected');
		}
		return;
	}

	// Multi-select mode (you can remove this if you're not using it anymore)
	if (multiSelectMode && selectedTasks.length > 0) {
		await assignMultipleTasksFromStartCell(instructor, dayIndex, slot);
		return;
	}

	// ✅ Assign single selected task
	if (selectedTask) {
		try {
			$(this).html('<small>Assigning...</small>');

			await Methods.createAllocation(selectedTask.name, dayIndex, slot, instructor);

			await loadAndRenderCalendar(); // Reflect the assignment
			// DO NOT clear selectedTask — user may want to keep assigning
			// selectedTask = null; ❌
			// $('.assignable-cell').removeClass('selected-task'); ❌

		} catch (error) {
			console.error('Assignment error:', error);
			frappe.show_alert(error.message || 'Error assigning task', 5);
			$(this).html(`<small>${slot}</small>`);
		}
	} else {
		frappe.show_alert('Please select a task first by clicking on it', 4);
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

	$('#calendar-container').on('click', '.blackout-toggle', function (e) {
		e.preventDefault();
		const instructor = $(this).data('instructor');

		if (blackoutModeInstructor === instructor) {
			blackoutModeInstructor = null;
			blackoutSelections = [];
			$('.blackout-selected').removeClass('blackout-selected');
			$('.blackout-toggle').removeClass('btn-danger').addClass('btn-outline-dark').html('<i class="fa fa-eye-slash"></i> Blackout');
			$('#submit-blackouts').remove(); // 🧹 remove button
			frappe.show_alert(`Blackout mode OFF for ${instructor}`, 3);
		} else {
			blackoutModeInstructor = instructor;
			blackoutSelections = [];
			$('.blackout-toggle').removeClass('btn-danger').addClass('btn-outline-dark').html('<i class="fa fa-eye-slash"></i> Blackout');
			$(this).removeClass('btn-outline-dark').addClass('btn-danger').html('<i class="fa fa-ban"></i> Blackout ON');

			// 🆕 Add submit button
			if (!$('#submit-blackouts').length) {
				$(this).after(`
					<button id="submit-blackouts" class="btn btn-sm btn-success ml-2">
						<i class="fa fa-check-circle"></i> Submit Blackouts
					</button>
				`);
			}

			frappe.show_alert(`Blackout mode ON for ${instructor}`, 3);
		}
	});

	$('#calendar-container').on('click', 'td span.text-primary', async function (e) {
	e.preventDefault();
	e.stopPropagation();

	const instructorName = $(this).text().replace(/^[-–—]\s*/, '').trim();

	if (!instructorName) {
		frappe.show_alert("Invalid instructor", 4);
		return;
	}

	// Multi-task (multi-select mode)
	if (multiSelectMode && selectedTasks.length > 0) {
		for (const task of selectedTasks) {
			await assignTaskAcrossWeek(task, instructorName);
		}
	} 
	// Single task mode
	else if (selectedTask) {
		await assignTaskAcrossWeek(selectedTask, instructorName);
	} 
	else {
		frappe.show_alert("Please select a task first", 4);
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

		$(document).on('click', '#submit-blackouts', async function () {
    if (blackoutSelections.length === 0) {
        frappe.show_alert("No blackout slots selected.", 4);
        return;
    }

    try {
        const response = await frappe.call({
            method: 'tours_and_safaris.tours_and_safaris.page.guide_allocation.guide_allocation.bulk_toggle_blackouts',
            args: {
                instructor: blackoutModeInstructor,
                slots: blackoutSelections,
                week_start_date: currentWeekStart.format('YYYY-MM-DD')
            }
        });

        frappe.show_alert(`Updated ${blackoutSelections.length} blackout slots`, 3);

        blackoutSelections = [];
        blackoutModeInstructor = null;
        $('.blackout-selected').removeClass('blackout-selected');
        $('#submit-blackouts').remove();
        await loadAndRenderCalendar();
    } catch (err) {
        console.error('Bulk blackout failed:', err);
        frappe.show_alert('Error submitting blackout slots', 5);
    }
});


		// Exit multi-select mode
		$('#exit-multi-select').on('click', exitMultiSelectMode);

		// Clear all selections
		$(document).on('click', '#clear-selection', function () {
			selectedTasks = [];
			$('.assignable-cell').removeClass('multi-selected-task');
			updateMultiSelectUI();
		});

		// Assign multiple tasks
		$(document).on('click', '#assign-multiple', function () {
			if (selectedTasks.length === 0) {
				frappe.show_alert('No tasks selected', 3);
				return;
			}
			
			// Show instructor selection dialog
			showInstructorSelectionDialog();
		});

	$(document).on('click', '#toggle-multi-select', function () {
		multiSelectMode = !multiSelectMode;

		if (multiSelectMode) {
			$(this).text('Exit Multi-Select').removeClass('btn-info').addClass('btn-warning');
			$('#multi-select-controls').show();
			$('.assignable-slot').addClass('multi-select-mode');
			frappe.show_alert('Multi-select mode enabled. Click tasks to select multiple.', 3);
		} else {
			exitMultiSelectMode();
		}
	});

	$('#print-calendar').on('click', function () {
    const originalTitle = document.title;
    document.title = "Guide Allocation - Calendar View";

    const calendarClone = $('#calendar-container').clone();

    
    calendarClone.find('#calendar-scroll-wrapper')
        .css({
            'max-height': 'none',
            'overflow': 'visible'
        });

    const weekTitle = $('#week-range-title').text();

    const printWindow = window.open('', '', 'width=1200,height=900');
    printWindow.document.write(`
        <html>
        <head>
            <title>${originalTitle}</title>
            <link rel="stylesheet" href="/assets/frappe/css/bootstrap.css">
            <style>
                body {
                    font-family: Arial, sans-serif;
                    margin: 20px;
                    color: #000;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    table-layout: fixed;
                    word-wrap: break-word;
                }
                th, td {
                    border: 1px solid #999;
                    padding: 6px;
                    vertical-align: top;
                    font-size: 11px;
                }
                .draggable-task, .assignable-cell, .assigned-task {
                    border-radius: 4px;
                    padding: 2px 5px;
                    font-size: 10px;
                    display: inline-block;
                    margin: 1px;
                    -webkit-print-color-adjust: exact !important;
                    print-color-adjust: exact !important;
                }
                .remove-assignment, .drag-handle, .btn, .split-groups-btn, .collapse, .text-right, .selected-task {
                    display: none !important;
                }
                @media print {
                    * {
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }
                    #calendar-scroll-wrapper {
                        overflow: visible !important;
                        max-height: none !important;
                    }
                    thead th {
                        position: static !important;
                        background: #fff !important;
                    }
                }
            </style>
        </head>
        <body>
            <h2>Guide Allocation Calendar: ${weekTitle}</h2>
            ${calendarClone.html()}
        </body>
        </html>
    `);

    printWindow.document.close();
    printWindow.focus();

    setTimeout(() => {
        printWindow.print();
        printWindow.close();
        document.title = originalTitle;
    }, 600);
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
			#calendar-scroll-wrapper {
				max-height: 80vh;
				overflow-y: auto;
				overflow-x: auto;
			}
			@media screen {
			#calendar-scroll-wrapper table thead tr:first-child th {
				position: sticky;
				top: 0;
				background: #f8f9fa;
				z-index: 10;
			}
		}

		@media print {
			#calendar-scroll-wrapper {
				overflow: visible !important;
				max-height: none !important;
			}

			#calendar-scroll-wrapper table thead tr:first-child th {
				position: static !important;
				background: #fff !important;
			}
			
		}
			.drop-zone {
				transition: background-color 0.2s ease;
			}

			.task-range-highlight {
				background-color: rgba(0, 0, 0, 0.05);
				border-left: 3px solid;
			}

			.task-range-start {
				border-left: 4px solid;
				border-top-left-radius: 6px;
				border-bottom-left-radius: 6px;
			}

			.task-range-end {
				border-right: 4px solid;
				border-top-right-radius: 6px;
				border-bottom-right-radius: 6px;
			}

			.task-range-middle {
				border-top: 2px solid;
				border-bottom: 2px solid;
			}
				.blackout-slot:hover {
					background-color: #999 !important;
					color: white !important;
				}
				.blackout-toggle.btn-danger {
					background: #dc3545;
					color: white;
					border: none;
				}

			.blackout-selected {
			background-color: #ffcccc !important;
			border: 2px solid #cc0000 !important;
		}
			td span.text-primary {
				cursor: pointer;
				text-decoration: underline;
			}


		`).appendTo('head');
		const multiSelectStyles = `
			.multi-select-mode {
				border: 2px dashed #28a745 !important;
				background-color: rgba(40, 167, 69, 0.1) !important;
			}
			.multi-selected-task {
				border: 2px solid #28a745 !important;
				box-shadow: 0 0 5px rgba(40, 167, 69, 0.5);
			}
			.multi-select-controls {
				position: fixed;
				top: 20px;
				right: 20px;
				background: white;
				padding: 10px;
				border: 1px solid #ddd;
				border-radius: 5px;
				box-shadow: 0 2px 10px rgba(0,0,0,0.1);
				z-index: 1000;
				display: none;
			}
		`;
			$('<style>').prop('type', 'text/css').html(multiSelectStyles).appendTo('head');
		$(page.body).append(`
			<div class="multi-select-controls" id="multi-select-controls">
				<div class="mb-2">
					<strong>Multi-Select Mode</strong>
					<button class="btn btn-xs btn-secondary float-right" id="exit-multi-select">Exit</button>
				</div>
				<div class="mb-2">
					<span id="selected-count">0 tasks selected</span>
				</div>
				<div>
					<button class="btn btn-sm btn-success" id="assign-multiple" disabled>Assign Selected</button>
					<button class="btn btn-sm btn-danger" id="clear-selection">Clear All</button>
				</div>
			</div>
		`);

	// Initialize
	loadAndRenderCalendar();
}