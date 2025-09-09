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
		<div class="mb-3">	
		 <button class="btn btn-sm btn-outline-info" id="toggle-view-mode">📅 View Month</button>
		<button class="btn btn-sm btn-outline-secondary" id="prev-month">« Prev Month</button>
		<button class="btn btn-sm btn-outline-secondary" id="next-month">Next Month »</button>
		<button class="btn btn-sm btn-outline-dark" id="zoom-out">➖ Zoom Out</button>
		<button class="btn btn-sm btn-outline-dark" id="zoom-in">➕ Zoom In</button>

		</div>
        <div class="mb-3 d-flex gap-2">
			<button class="btn btn-sm btn-warning" id="submit-allocations">Submit All Allocations</button>
			<button class="btn btn-sm btn-outline-success" id="download-pdf">📄 Download PDF</button>

		</div>
		<div class="mb-3">
			<button id="manual-refresh" class="btn btn-sm btn-outline-primary">🔄 Refresh Calendar</button>
		</div>
		
        <div id="loading-indicator" class="text-center" style="display: none;">
            <div class="spinner-border" role="status">
                <span class="sr-only">Loading...</span>
            </div>
            <p>Loading week data...</p>
        </div>
        <div id="calendar-container" class="table-responsive"></div>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>


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
	let isDragging = false;
	let dragStartCell = null;
	let dragCurrentCell = null;
	let selectedRangeCells = [];
	let viewMode = 'week';  // Can be 'week' or 'month'
	let currentMonthStart = moment().startOf('month');


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
			// Keep the color from backend task if available
				const color = task.color || '#ccc'; // use '#ccc' if backend didn't send any

				if (task.custom_assigned_date) {
					const assignedMoment = moment(task.custom_assigned_date);
					return {
						...task,
						color, // store backend color
						original_exp_start_date: task.exp_start_date,
						original_exp_end_date: task.exp_end_date,
						exp_start_date: assignedMoment.format('YYYY-MM-DD'),
						exp_end_date: assignedMoment.format('YYYY-MM-DD'),
						assigned_slot: assignedMoment.hour() < 13 ? 'AM' : 'PM'
					};
				}

				return {
					...task,
					color // store backend color
				};
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
						custom_customer_name: originalTask?.custom_customer_name || allocation.customer || 'Unknown',
						color: allocation.color || originalTask?.color || '#ccc'
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

			const weekKey = currentWeekStart.format('YYYY-MM-DD');
			const data = weekData[weekKey];
			if (data && data.tasks) {
				const match = data.tasks.find(
					t => t.custom_customer_name === customerName && t.color
				);
				if (match) {
					return match.color; // ✅ Use only the backend task color
				}
			}

			return '#ccc'; // fallback neutral if no color found
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
					data-task-color="${task.color || ''}"
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
				data-slot="${slot}" #data-task-color="${task.color || ''}"
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
	//await loadAndRenderCalendar();
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
	//await loadAndRenderCalendar();
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

		// Only assign if slotDate is within task range
		if (!slotDate.isBetween(taskStart, taskEnd, null, '[]')) continue;

		for (let slot of ['AM', 'PM']) {
			const isOccupied = assignments.some(a => a.dayIndex === dayIndex && a.slot === slot);
			if (isOccupied) continue;

			try {
				await Methods.createAllocation(task.name, dayIndex, slot, instructorName);
				successCount++;
				break; 
			} catch (err) {
				console.error(`Failed to assign on ${slotDate.format('ddd')} ${slot}`, err);
			}
			const selector = `.assignable-slot[data-instructor="${dayCell.instructor}"][data-day-index="${dayCell.dayIndex}"][data-slot="${dayCell.slot}"]`;
				$(selector).removeClass('assigned-cell').removeAttr('data-assigned');

		}
	}

	if (successCount === 0) {
		frappe.show_alert(`No available slots for ${instructorName} in task date range`, 5);
	} else {
		frappe.show_alert(`Assigned "${task.subject}" to ${instructorName} on ${successCount} day(s)`, 4);
		//await loadAndRenderCalendar();
	}
}

	
	// Main Functions
	async function loadAndRenderCalendar() {
		try {
			let data;

			if (viewMode === 'week') {
				const weekData = await Methods.loadWeekData(currentWeekStart, true);
				if (weekData) renderCalendar([weekData]); // wrap in array
			} else {
				const monthWeeks = await Methods.loadMonthWeeks(currentMonthStart);
				renderCalendar(monthWeeks); // pass array of weeks
			}


			if (data) {
				renderCalendar(data);
				await Methods.loadActivityTypes();

				$('#week-range-title').text(
					viewMode === 'week'
						? `${moment(currentWeekStart).format('MMM D')} - ${moment(currentWeekStart).add(6, 'days').format('MMM D, YYYY')}`
						: `${moment(currentMonthStart).format('MMMM YYYY')}`
				);
			}
		} catch (error) {
			console.error('Error loading calendar:', error);
			frappe.show_alert("Error loading calendar data", 5);
		}
	}

	Methods.loadMonthWeeks = async function(monthStart) {
		const monthEnd = monthStart.clone().endOf('month');
		let cursor = monthStart.clone().startOf('week');
		const weeks = [];

		while (cursor.isSameOrBefore(monthEnd)) {
			const data = await this.loadWeekData(cursor.clone(), true);
			if (data) {
				weeks.push(data);
			}
			cursor.add(7, 'days');
		}

		return weeks; // return an array of weeks
	};


	
	function renderCalendar(weeks) {
    let html = `<div id="calendar-scroll-wrapper">`;

    weeks.forEach((weekData, index) => {
        html += `<div class="week-block mb-4">`;
        html += `<h6 class="text-center">Week ${index + 1}: 
            ${moment(weekData.week_start).format('MMM D')} - 
            ${moment(weekData.week_start).add(6, 'days').format('MMM D, YYYY')}
        </h6>`;

        html += renderWeekTable(weekData); 
        html += `</div>`;
    });

    html += `</div>`;
    $('#calendar-container').html(html);

    // Update title once
    $('#week-range-title').text(
        viewMode === 'week'
            ? `${weeks[0].week_start} - ${moment(weeks[0].week_start).add(6, 'days').format('MMM D, YYYY')}`
            : `${currentMonthStart.format('MMMM YYYY')}`
    );

    initializeDragAndDrop();

    // -------------------------
    // Nested helper: Week Table
    // -------------------------
    function renderWeekTable(data) {
        const { tasks, instructors, instructorAssignments } = data;
        const customerMap = {};
        const daysToRender = [];
		for (let i = 0; i < 7; i++) {
			daysToRender.push(moment(data.week_start).clone().add(i, 'days'));
		}

        const daysToProcess = daysToRender;
		const weekStart = moment(data.week_start);

        // build customerMap
        tasks.forEach(task => {
            const groupKey = `${task.custom_customer_name || "Unknown"}__${task.project || "NoProject"}`;
            if (!customerMap[groupKey]) {
                customerMap[groupKey] = { 
                    customerName: task.custom_customer_name || "Unknown",
                    project: task.project || "",
                    main: [], 
                    sub: [],
                    hasGroups: false,
                    groupsData: [],
                    totalPeople: 0,
                    parentTasks: [],
                    subTasks: []
                };
            }

            if (task.parent_task) {
                customerMap[groupKey].subTasks.push(task);
            } else {
                customerMap[groupKey].parentTasks.push(task);
                customerMap[groupKey].main.push(task);
            }

            if (task.custom_no_of_people) {
                customerMap[groupKey].totalPeople = Math.max(
                    customerMap[groupKey].totalPeople,
                    parseInt(task.custom_no_of_people) || 0
                );
            }

            if (task.custom_customer_groups) {
                try {
                    let groups = typeof task.custom_customer_groups === 'string'
                        ? JSON.parse(task.custom_customer_groups)
                        : task.custom_customer_groups;

                    if (Array.isArray(groups) && groups.length > 0) {
                        const validGroups = groups.filter(group =>
                            group && typeof group === 'object' &&
                            group.group_name && group.people_count !== undefined
                        );

                        if (validGroups.length > 0) {
                            customerMap[groupKey].hasGroups = true;
                            customerMap[groupKey].groupsData = validGroups;
                        }
                    }
                } catch (e) {
                    console.error(`Error parsing customer groups for ${groupKey}:`, e, task.custom_customer_groups);
                }
            }
        });

        // start table
        let weekHtml = `<table class="table table-bordered table-sm"><thead><tr>
            <th style="min-width: 120px;">Instructor / Customer</th>`;

        daysToRender.forEach((day, i) => {
            weekHtml += `<th class="drop-zone" data-day-index="${i}">${day.format('ddd D')}<br>AM</th>
                         <th class="drop-zone" data-day-index="${i}">${day.format('ddd D')}<br>PM</th>`;
        });
        weekHtml += '</tr></thead><tbody>';

    // --- render customers & tasks ---
    function renderTaskRow(label, tasksToRender, color, daysToProcess, indent = false) {
        weekHtml += `<tr><td style="background-color: ${color}; padding-left: ${indent ? '20px' : '0'};">${label}</td>`;

        const renderedTaskNames = new Set();

        daysToProcess.forEach((day, dayIndex) => {
            ['AM', 'PM'].forEach(slot => {
                const slotTasks = Methods.getTasksForSlot(tasksToRender, day, slot).filter(task => {
                    return !renderedTaskNames.has(task.name);
                });

                let backgroundStyle = '';
                const currentDay = day.clone().startOf('day');

                const coveringTasks = tasksToRender.filter(task => {
                    const taskStart = moment(task.original_exp_start_date || task.exp_start_date).startOf('day');
                    const taskEnd = moment(task.original_exp_end_date || task.exp_end_date || task.exp_start_date).startOf('day');
                    return currentDay.isBetween(taskStart, taskEnd, null, '[]');
                });

                if (coveringTasks.length > 0) {
                    const lightColor = color + '33'; 
                    backgroundStyle = `background-color: ${lightColor}; border: 1px solid ${color}55;`;
                }

                weekHtml += `<td class="drop-zone" data-day-index="${dayIndex}" data-slot="${slot}" 
                                style="vertical-align: top; min-height: 40px; ${backgroundStyle}">`;

                if (slotTasks.length > 0) {
                    slotTasks.forEach(task => {
                        weekHtml += Methods.makeTaskCellClickable(task, dayIndex, slot, color, true);
                        renderedTaskNames.add(task.name);
                    });
                }

                weekHtml += `</td>`;
            });
        });

        weekHtml += '</tr>';
    }

    for (const [groupKey, grouped] of Object.entries(customerMap)) {
        const color = grouped.parentTasks[0]?.color || grouped.subTasks[0]?.color || '#ccc';
        if (grouped.main.length > 0 || grouped.subTasks.length > 0) {
            const peopleCount = grouped.totalPeople;

            if (grouped.hasGroups && grouped.groupsData.length > 0) {
                const customerLabel = `<strong>${grouped.customerName} (${grouped.project || "No Project"}) (${peopleCount} people)</strong>`;
                renderTaskRow(customerLabel, grouped.parentTasks, color, daysToProcess);

                grouped.groupsData.forEach((group, index) => {
                    const groupSubTasks = grouped.subTasks.filter(subTask =>
                        subTask.custom_group_name === group.group_name || 
                        subTask.custom_group_index === index ||
                        subTask.subject.includes(group.group_name)
                    );

                    const groupLabel = `<span class="group-row">├─ ${group.group_name} (${group.people_count} people)</span>`;
                    renderTaskRow(groupLabel, groupSubTasks, color, daysToProcess, true);
                });
            } else {
                const customerLabel = `<strong>${grouped.customerName} (${grouped.project || "No Project"}) (${peopleCount} people)</strong>`;
                renderTaskRow(customerLabel, grouped.parentTasks, color, daysToProcess);

                if (grouped.subTasks.length > 0) {
                    grouped.subTasks.forEach(subTask => {
                        const subTaskLabel = `<span class="group-row">├─ ${subTask.subject}</span>`;
                        renderTaskRow(subTaskLabel, [subTask], color, daysToProcess, true);
                    });
                }
            }
        }
    }

    // --- render instructors ---
    instructors.forEach(instr => {
        weekHtml += `<tr><td><span class="text-primary">— ${instr.instructor_name}</span></td>`;

        daysToRender.forEach((day, i) => {
            ['AM', 'PM'].forEach(slot => {
                const dayIndex = day.diff(moment(data.week_start), 'days');
                const assigned = (instructorAssignments[instr.name] || []).find(
                    a => moment(data.week_start).add(a.dayIndex, 'days').isSame(day, 'day') && a.slot === slot
                );

                if (assigned) {
                    const assignedColor = assigned.task.color || '#ccc';
                    weekHtml += `<td class="assigned-task drop-zone" 
                                    data-instructor="${instr.name}" 
                                    data-day-index="${dayIndex}" 
                                    data-slot="${slot}" 
                                    style="background:${assignedColor}; cursor:pointer; min-height: 40px;">
                                    ${assigned.task.subject}
                                </td>`;
                } else {
                    weekHtml += `<td class="assignable-slot drop-zone" 
                                    data-instructor="${instr.name}" 
                                    data-day-index="${dayIndex}" 
                                    data-slot="${slot}" 
                                    style="cursor:pointer; border:2px dashed #ccc; text-align:center; min-height: 40px;">
                                    <small>${slot}</small>
                                </td>`;
                }
            });
        });

        weekHtml += '</tr>';
    });

    weekHtml += '</tbody></table>';
    return weekHtml;
}

    function renderTaskRow(label, tasksToRender, color, daysToProcess, indent = false) {
		weekHtml += `<tr><td style="background-color: ${color}; padding-left: ${indent ? '20px' : '0'};">${label}</td>`;
		
		const taskPlacements = [];

		tasksToRender.forEach(task => {
			if (task.custom_assigned_date) {
				const assignedMoment = moment(task.custom_assigned_date);
				const dayIndex = assignedMoment.diff(weekStart, 'days');
				const slot = assignedMoment.hour() < 13 ? 'AM' : 'PM';
				
				if (dayIndex >= 0 && dayIndex < daysToProcess.length) {
					taskPlacements.push({ task, dayIndex, slot });
				}
			} else {
				const taskStart = moment(task.exp_start_date);
				const dayIndex = taskStart.diff(weekStart, 'days');
				const slot = task.assigned_slot || 'AM';
				
				if (dayIndex >= 0 && dayIndex < daysToProcess.length) {
					taskPlacements.push({ task, dayIndex, slot });
				}
			}
		});

		const renderedTaskNames = new Set();

		daysToProcess.forEach((day, dayIndex) => {
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

				weekHtml += `<td class="drop-zone" data-day-index="${dayIndex}" data-slot="${slot}" style="vertical-align: top; min-height: 40px; ${backgroundStyle}">`;

				if (slotTasks.length > 0) {
					slotTasks.forEach(task => {
						weekHtml += Methods.makeTaskCellClickable(task, dayIndex, slot, color, true);
						renderedTaskNames.add(task.name);
					});
				}

				weekHtml += `</td>`;
			});
		});

		weekHtml += '</tr>';
	}


    for (const [groupKey, grouped] of Object.entries(customerMap)) {
    	const color = grouped.parentTasks[0]?.color || grouped.subTasks[0]?.color || '#ccc';
			if (grouped.main.length > 0 || grouped.subTasks.length > 0) {
				const peopleCount = grouped.totalPeople;

				if (grouped.hasGroups && grouped.groupsData.length > 0) {
					const customerLabel = peopleCount > 0 ? 
						`<strong>${grouped.customerName} (${grouped.project || "No Project"}) (${peopleCount} people)</strong> 
						<button class="btn btn-xs btn-info split-groups-btn" 
								data-customer="${grouped.customerName}" 
								data-project="${grouped.project || ""}"
								data-people="${peopleCount}" 
								data-action="manage">
							Manage Groups (${grouped.groupsData.length})
						</button>` 
					: 
						`<strong>${grouped.customerName} (${grouped.project || "No Project"})</strong> 
						<button class="btn btn-xs btn-info split-groups-btn" 
								data-customer="${grouped.customerName}" 
								data-project="${grouped.project || ""}"
								data-people="${peopleCount}" 
								data-action="manage">
							Manage Groups (${grouped.groupsData.length})
						</button>`;

				renderTaskRow(customerLabel, grouped.parentTasks, color, daysToProcess);

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
					renderTaskRow(groupLabel, groupSubTasks, color, daysToProcess,true);
				});
			} else {
				// Render main customer with option to split
				const customerLabel = peopleCount > 0 ? 
					`<strong>${grouped.customerName} (${grouped.project || "No Project"}) (${peopleCount} people)</strong> 
					<button class="btn btn-xs btn-primary split-groups-btn" 
							data-customer="${grouped.customerName}" 
							data-project="${grouped.project || ""}"
							data-people="${peopleCount}" 
							data-action="split">Split Groups</button>` 
				: 
					`<strong>${grouped.customerName} (${grouped.project || "No Project"})</strong>`;

				
				// Show parent tasks
				renderTaskRow(customerLabel, grouped.parentTasks, color, daysToProcess);
				
				// Show any existing subtasks
				if (grouped.subTasks.length > 0) {
					grouped.subTasks.forEach(subTask => {
						const subTaskLabel = `<span class="group-row">├─ ${subTask.subject} ${subTask.custom_group_name ? '(' + subTask.custom_group_name + ')' : ''}</span>`;
						renderTaskRow(subTaskLabel, [subTask], color, daysToProcess, true);
					});
				}
			}
		}
	}
    // Render instructors 
    instructors.forEach(instr => {
        weekHtml += `<tr><td>
            <span class="text-primary">— ${instr.instructor_name}</span>
            <button class="btn btn-xs btn-outline-dark ml-2 blackout-toggle" 
                    data-instructor="${instr.name}">
                <i class="fa fa-eye-slash"></i> Blackout
            </button>
        </td>`;

        daysToRender.forEach((day) => {
            ['AM', 'PM'].forEach(slot => {
                const dayIndex = day.diff(weekStart, 'days');
                const isBlackout = data.blackouts?.[instr.name]?.[`${dayIndex}_${slot}`];
                const assigned = (instructorAssignments[instr.name] || []).find(
                    a => weekStart.clone().add(a.dayIndex, 'days').isSame(day, 'day') && a.slot === slot 
                );

                if (isBlackout) {
                    weekHtml += `<td class="blackout-slot drop-zone" 
						data-instructor="${instr.name}" 
						data-day-index="${dayIndex}" 
						data-slot="${slot}" 
						style="background: repeating-linear-gradient(45deg,#ccc,#ccc 10px,#bbb 10px,#bbb 20px); 
							color: #555; 
							text-align: center; 
							min-height: 40px; 
							position: relative; 
							cursor: not-allowed;">
						<em>Blackout</em>
						<span class="remove-blackout" 
							style="color:red; cursor:pointer; font-weight:bold; position: absolute; top: 2px; right: 5px;">&times;</span>
					</td>`;
                } else if (assigned) {
                    const customerForColor = assigned.task.custom_customer_name || 'Unknown';
                    const assignedColor = assigned.task.color || '#ccc';

                    weekHtml += `<td class="assigned-task drop-zone" 
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
                    weekHtml += `<td class="assignable-slot drop-zone" 
                        data-instructor="${instr.name}" 
                        data-day-index="${dayIndex}" 
                        data-slot="${slot}" 
                        style="cursor:pointer; border:2px dashed #ccc; text-align:center; min-height: 40px;">
                        <small>${slot}</small>
                    </td>`;
                }
            });
        });

        weekHtml += '</tr>';
    });

    weekHtml += '</tbody></table></div>';
	weekHtml += `
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
				color: $(this).data('task-color') || Methods.getColorForCustomer($(this).data('task-customer')), // store color
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
				// Single select mode
				$('.assignable-cell').removeClass('selected-task');
				$(this).addClass('selected-task');
				//$('.sticky-selected-task').removeClass('sticky-selected-task'); 
				//$(this).closest('tr').addClass('sticky-selected-task');

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
			originalSlot: $(this).data('slot'),
			color: $(this).css('background-color'),
			 color: $(this).data('task-color') || '',
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
		// Handle drop
// Handle drop
$('#calendar-container').on('drop', '.drop-zone', async function (e) {
    e.preventDefault();

    const originalContent = $(this).html();

    if (!draggedTask || !draggedTask.elementHTML) {
        console.warn("Dragged task or its HTML is missing — drop cancelled");
        $(this).html(originalContent);
        return;
    }

    // Preserve draggedTask data before it gets cleared
    const taskData = {
        taskName: draggedTask.taskName,
        taskSubject: draggedTask.taskSubject,
        customer: draggedTask.customer,
        expStart: draggedTask.expStart,
        expEnd: draggedTask.expEnd,
        originalDayIndex: draggedTask.originalDayIndex,
        originalSlot: draggedTask.originalSlot
    };

    try {
        const targetDayIndex = parseInt($(this).data('day-index'));
        const targetSlot = $(this).data('slot') || taskData.originalSlot;
        const targetDay = moment(currentWeekStart).add(targetDayIndex, 'days');

        $('.drop-zone').removeClass('drag-over drag-valid drag-invalid');

        const canMove = Methods.canTaskBeMoved({
            exp_start_date: taskData.expStart,
            exp_end_date: taskData.expEnd
        }, targetDay);

        if (!canMove) {
            frappe.show_alert(`Task cannot be moved to ${targetDay.format('MMM D')}`, 5);
            return;
        }

        // If dropping in the same location, do nothing
        if (targetDayIndex === taskData.originalDayIndex && targetSlot === taskData.originalSlot) {
            return;
        }

        // Show loading state
        $(this).html('<small>Moving...</small>');

        const newDate = targetDay.format('YYYY-MM-DD');
        
        // Update task schedule on backend
        await Methods.updateTaskSchedule(taskData.taskName, newDate, targetSlot);

        // SUCCESS: Update the UI visually without refresh
        
        // 1. Find and clear the original cell
        const originalSelector = `.draggable-task[data-task-name="${taskData.taskName}"]`;
        const $originalCell = $(originalSelector).closest('td');
        if ($originalCell.length) {
            // If it was the only task in that cell, clear it
            const $taskElements = $originalCell.find('.draggable-task');
            if ($taskElements.length === 1) {
                // This was the only task, clear the cell
                $originalCell.html('');
            } else {
                // Remove just this task element
                $(originalSelector).remove();
            }
        }

        // 2. Clear the loading state and add the task to the new cell
        const color = taskData.color || '#ccc';
        const taskHtml = Methods.makeTaskCellClickable({
            name: taskData.taskName,
            subject: taskData.taskSubject,
            custom_customer_name: taskData.customer,
            custom_no_of_people: '', 
            exp_start_date: newDate,
            exp_end_date: newDate,
            original_exp_start_date: taskData.expStart,
            original_exp_end_date: taskData.expEnd,
			
        }, targetDayIndex, targetSlot, color, true);

        // Replace the "Moving..." text with the task content
        $(this).html(originalContent + taskHtml);

        // Show success message
        //frappe.show_alert(`Moved ${taskData.taskSubject} to ${targetDay.format('MMM D')} ${targetSlot}`, 3);

    } catch (error) {
        console.error('Error moving task:', error);
        frappe.show_alert('Error moving task: ' + (error.message || 'Unknown error'), 5);
        // Restore original content on error
        $(this).html(originalContent);
    } finally {
        // Always clear draggedTask at the end
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
    
    if (
		!selectedTask || 
		(selectedTask.subject !== "Multi Activity" || selectedTask.subject !== "Adventure Safari -Multi Activity")
	) {
		frappe.show_alert("Please select either 'Multi Activity' or 'Adventure Safari - Multi Activity' in the calendar first.", 5);
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
				project:selectedTask.project,
				custom_color: selectedTask.color || '#ccc'
            }
        });

       // frappe.show_alert(`Activity "${activityType}" added for ${selectedTask.custom_customer_name}`, 4);
       // await loadAndRenderCalendar();
		
    } catch (error) {
        console.error('Error adding multiactivity task:', error);
        frappe.show_alert('Failed to add activity', 5);
    }
});
$('#calendar-container').on('click', '#add-selected-activities', async function () {
    if (
		!selectedTask || 
		!(selectedTask.subject === "Multi Activity" || selectedTask.subject === "Adventure Safari -Multi Activity")
	) {
		frappe.show_alert("Please select either 'Multi Activity' or 'Adventure Safari - Multi Activity' task first.", 5);
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
    project: selectedTask.project,
	custom_color: selectedTask.color || '#ccc'                           
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
       // await loadAndRenderCalendar();

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

	//  Assign single selected task
	if (selectedTask) {
		try {
			$(this).html('<small>Assigning...</small>');

			await Methods.createAllocation(selectedTask.name, dayIndex, slot, instructor);

		// VISUAL UPDATE ONLY (no refresh)
		const $cell = $(this);
		const color = selectedTask.color || '#ccc';

		$cell
		.removeClass('assignable-slot')
		.addClass('assigned-task')
		.html(`
			${selectedTask.subject}
			<span class="remove-assignment" 
			style="color:red; cursor:pointer; font-weight:bold; position: absolute; top: 2px; right: 5px;">&times;</span>
		`)
		.css({
			backgroundColor: color,
			cursor: 'pointer',
			position: 'relative'
		});

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

			// Safe access to subject
			let subject = cell.data('subject');

			// Fallback: Try to extract subject from DOM if missing
			if (!subject) {
				subject = cell.text().trim().split('\n')[0] || '';
				console.warn('Subject missing from data attribute. Falling back to text content:', subject);
			}

			console.log('Removing assignment:', instructor, dayIndex, slot, subject);

			try {
				// Show loading
				cell.html('<small>Removing...</small>');

				await Methods.removeAllocation(instructor, dayIndex, slot, subject);

				frappe.show_alert(`Removed assignment from ${instructor}`, 3);

				// Visual revert without refresh
				cell
					.removeClass('assigned-task')
					.addClass('assignable-slot')
					.html(`<small>${slot}</small>`)
					.removeAttr('data-task-name')
					.removeAttr('data-subject')
					.removeAttr('data-assigned')
					.css({
						backgroundColor: '',
						cursor: 'pointer',
						position: 'relative'
					});
			} catch (error) {
				console.error('Removal error:', error);
				frappe.show_alert(error.message || 'Error removing assignment', 5);

				// restore subject text in case of failure
				cell.html(`${subject}<span class="remove-assignment" style="color:red; cursor:pointer; font-weight:bold; position: absolute; top: 2px; right: 5px;">&times;</span>`);
			}
		});


	$('#calendar-container').on('click', '.assigned-task', function (e) {
		if (!$(e.target).hasClass('remove-assignment')) {
			e.preventDefault();
			e.stopPropagation();
			frappe.show_alert('This slot is already assigned. Click the × to remove it.', 3);
		}
	});

	$('#calendar-container').on('mousedown', '.assignable-slot', function (e) {
			isDragging = true;
			selectedRangeCells = [];
			$('.assignable-slot').removeClass('multi-cell-selected');

			dragStartCell = getCellMeta(this);
			dragCurrentCell = dragStartCell;

			selectRange(dragStartCell, dragCurrentCell);
			e.preventDefault();
		});

		$('#calendar-container').on('mouseenter', '.assignable-slot', function (e) {
			if (isDragging) {
				dragCurrentCell = getCellMeta(this);
				selectRange(dragStartCell, dragCurrentCell);
			}
		});

		$(document).on('mouseup', function () {
			isDragging = false;
		});

		function getCellMeta(cell) {
			return {
				instructor: $(cell).data('instructor'),
				dayIndex: parseInt($(cell).data('day-index')),
				slot: $(cell).data('slot'),
				element: cell
			};
		}

		function selectRange(start, end) {
			selectedRangeCells = [];

			const instructors = $('#calendar-container .assignable-slot')
				.map(function () {
					return $(this).data('instructor');
				}).get()
				.filter((v, i, a) => a.indexOf(v) === i); // unique instructors

			const instructorStart = instructors.indexOf(start.instructor);
			const instructorEnd = instructors.indexOf(end.instructor);

			const minInstructor = Math.min(instructorStart, instructorEnd);
			const maxInstructor = Math.max(instructorStart, instructorEnd);

			const dayStart = Math.min(start.dayIndex, end.dayIndex);
			const dayEnd = Math.max(start.dayIndex, end.dayIndex);

			const slotOrder = ['AM', 'PM'];
			const slotStart = slotOrder.indexOf(start.slot);
			const slotEnd = slotOrder.indexOf(end.slot);
			const minSlot = Math.min(slotStart, slotEnd);
			const maxSlot = Math.max(slotStart, slotEnd);

			$('.assignable-slot').each(function () {
				const instr = $(this).data('instructor');
				const day = $(this).data('day-index');
				const slot = $(this).data('slot');

				const iIndex = instructors.indexOf(instr);
				const sIndex = slotOrder.indexOf(slot);

				if (
					iIndex >= minInstructor && iIndex <= maxInstructor &&
					day >= dayStart && day <= dayEnd &&
					sIndex >= minSlot && sIndex <= maxSlot
				) {
					$(this).addClass('multi-cell-selected');
					selectedRangeCells.push({
						instructor: instr,
						dayIndex: day,
						slot: slot
					});
				}
			});

		}
		
		$(document).on('keydown', async function (e) {
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
				e.preventDefault();

				if (!selectedTask) {
					frappe.show_alert("Please select a task to paste.", 4);
					return;
				}

				if (!selectedRangeCells || selectedRangeCells.length === 0) {
					frappe.show_alert("No cells selected. Highlight cells first.", 4);
					return;
				}

				let taskStart = moment(selectedTask.exp_start_date).startOf('day');
				let taskEnd = moment(selectedTask.exp_end_date || selectedTask.exp_start_date).startOf('day');

				let count = 0;
					for (const cell of selectedRangeCells) {
					const cellDate = moment(currentWeekStart).add(cell.dayIndex, 'days').startOf('day');
					const inRange = cellDate.isBetween(taskStart, taskEnd, null, '[]');

					if (!inRange) continue;

					try {
						await Methods.createAllocation(selectedTask.name, cell.dayIndex, cell.slot, cell.instructor);
						count++;

						const selector = `.assignable-slot[data-instructor="${cell.instructor}"][data-day-index="${cell.dayIndex}"][data-slot="${cell.slot}"]`;
						const $cell = $(selector);

						const color = selectedTask.color || '#ccc';


						$cell
						.removeClass('assignable-slot multi-cell-selected')
						.addClass('assigned-task')
						.html(`
							${selectedTask.subject}
							<span class="remove-assignment" 
							style="color:red; cursor:pointer; font-weight:bold; position: absolute; top: 2px; right: 5px;">&times;</span>
						`)
						.css({
							backgroundColor: color,
							cursor: 'pointer',
							position: 'relative'
						});

					} catch (err) {
						console.error(`Failed to assign to ${cell.instructor} ${cell.dayIndex} ${cell.slot}`, err);
					}
				
				}
			}
		});


		$(document).on('click', '#manual-refresh', async function () {
			await loadAndRenderCalendar();
			frappe.show_alert("Calendar refreshed");
		});

		$(document).on('click', '#toggle-view-mode', async function () {
			viewMode = viewMode === 'week' ? 'month' : 'week';

			if (viewMode === 'week') {
				$('#toggle-view-mode').text('📅 View Month');
				currentWeekStart = currentMonthStart.clone().startOf('week'); // sync week with month
			} else {
				$('#toggle-view-mode').text('📆 View Week');
				currentMonthStart = currentWeekStart.clone().startOf('month'); // sync month with week
			}

			await loadAndRenderCalendar();
		});

		$(document).on('click', '#download-pdf', function () {
			const calendarWrapper = document.getElementById('calendar-scroll-wrapper');
			if (!calendarWrapper) {
				frappe.show_alert('Calendar is not rendered yet.');
				return;
			}

			// Store original styles
			const originalWrapperStyle = calendarWrapper.getAttribute('style') || '';
			const table = calendarWrapper.querySelector('table');
			const originalTableStyle = table ? table.getAttribute('style') || '' : '';

			// Temporarily modify styles for PDF generation
			calendarWrapper.style.maxHeight = 'unset';
			calendarWrapper.style.overflow = 'visible';
			calendarWrapper.style.height = 'auto';
			
			if (table) {
				table.style.pageBreakInside = 'auto';
				table.style.breakInside = 'auto';
			}

			// Set different options based on view mode
			const opt = viewMode === 'month' ? {
				margin: [0.2, 0.1, 0.2, 0.1], // smaller margins for month view
				filename: `Calendar-Month-${currentMonthStart.format('YYYY-MM')}.pdf`,
				image: { 
					type: 'jpeg', 
					quality: 0.95,
					useCORS: true 
				},
				html2canvas: { 
					scale: 1.5, // slightly lower scale for month view to fit better
					scrollY: 0,
					scrollX: 0,
					allowTaint: true,
					useCORS: true,
					height: calendarWrapper.scrollHeight,
					width: calendarWrapper.scrollWidth
				},
				jsPDF: { 
					unit: 'in', 
					format: 'a2', // larger format for month view
					orientation: 'landscape',
					putOnlyUsedFonts: true,
					compress: true
				},
				pagebreak: { 
					mode: ['avoid-all', 'css', 'legacy'],
					before: '.page-break-before',
					after: '.page-break-after' 
				}
			} : {
				margin: 0.3,
				filename: `Calendar-Week-${currentWeekStart.format('YYYY-MM-DD')}.pdf`,
				image: { type: 'jpeg', quality: 0.98 },
				html2canvas: { scale: 2, scrollY: 0 },
				jsPDF: { unit: 'in', format: 'a3', orientation: 'landscape' }
			};

			frappe.show_alert('Generating PDF...', 3);

			html2pdf().set(opt).from(calendarWrapper).save().then(() => {
				// Restore original styles
				calendarWrapper.setAttribute('style', originalWrapperStyle);
				if (table) {
					table.setAttribute('style', originalTableStyle);
				}
				frappe.show_alert('PDF downloaded successfully!', 3);
			}).catch(err => {
				console.error('PDF generation failed:', err);
				// Restore original styles on error
				calendarWrapper.setAttribute('style', originalWrapperStyle);
				if (table) {
					table.setAttribute('style', originalTableStyle);
				}
				frappe.show_alert('PDF generation failed. Please try again.', 5);
			});
		});

	$('#calendar-container').on('click', '.blackout-toggle', function (e) {
		e.preventDefault();
		const instructor = $(this).data('instructor');

		if (blackoutModeInstructor === instructor) {
			blackoutModeInstructor = null;
			blackoutSelections = [];
			$('.blackout-selected').removeClass('blackout-selected');
			$('.blackout-toggle').removeClass('btn-danger').addClass('btn-outline-dark').html('<i class="fa fa-eye-slash"></i> Blackout');
			$('#submit-blackouts').remove(); 
			frappe.show_alert(`Blackout mode OFF for ${instructor}`, 3);
		} else {
			blackoutModeInstructor = instructor;
			blackoutSelections = [];
			$('.blackout-toggle').removeClass('btn-danger').addClass('btn-outline-dark').html('<i class="fa fa-eye-slash"></i> Blackout');
			$(this).removeClass('btn-outline-dark').addClass('btn-danger').html('<i class="fa fa-ban"></i> Blackout ON');

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

	$('#calendar-container').on('click', '.remove-blackout', async function (e) {
		e.preventDefault();
		e.stopPropagation();

		const cell = $(this).closest('.blackout-slot');
		const instructor = cell.data('instructor');
		const dayIndex = parseInt(cell.data('day-index'));
		const slot = cell.data('slot');

		try {
			cell.html('<small>Removing...</small>');

			const response = await frappe.call({
				method: 'tours_and_safaris.tours_and_safaris.page.guide_allocation.guide_allocation.toggle_blackout',
				args: {
					instructor: instructor,
					day_index: dayIndex,
					slot: slot,
					week_start_date: currentWeekStart.format('YYYY-MM-DD')
				}
			});

			if (response.message) {
				frappe.show_alert(`${response.message.message}`, 3);
				cell.replaceWith(`
					<td class="assignable-slot drop-zone" 
						data-instructor="${instructor}" 
						data-day-index="${dayIndex}" 
						data-slot="${slot}" 
						style="cursor:pointer; border:2px dashed #ccc; text-align:center; min-height: 40px;">
						<small>${slot}</small>
					</td>
				`);
			} else {
				throw new Error('Failed to remove blackout');
			}
		} catch (err) {
			console.error('Error removing blackout:', err);
			frappe.show_alert(err.message || 'Error removing blackout', 5);
			cell.html(`<em>Blackout</em>
				<span class="remove-blackout" 
					style="color:red; cursor:pointer; font-weight:bold; position: absolute; top: 2px; right: 5px;">&times;</span>`);
		}
	});

	$('#calendar-container').on('click', '.blackout-slot', async function(e) {
		e.preventDefault();
		e.stopPropagation();
		
		const $cell = $(this);
		const instructor = $cell.data('instructor');
		const dayIndex = parseInt($cell.data('day-index'));
		const slot = $cell.data('slot');

		// If blackout mode is active for this instructor, treat it as selection toggle
		if (blackoutModeInstructor === instructor) {
			const alreadySelected = blackoutSelections.find(b =>
				b.dayIndex === dayIndex && b.slot === slot
			);

			if (alreadySelected) {
				blackoutSelections = blackoutSelections.filter(b =>
					!(b.dayIndex === dayIndex && b.slot === slot)
				);
				$cell.removeClass('blackout-selected');
			} else {
				blackoutSelections.push({ instructor, dayIndex, slot });
				$cell.addClass('blackout-selected');
			}
			return;
		}

		try {
			const originalContent = $cell.html();
			$cell.html('<small>Removing...</small>');

			const response = await frappe.call({
				method: 'tours_and_safaris.tours_and_safaris.page.guide_allocation.guide_allocation.toggle_blackout',
				args: {
					instructor: instructor,
					day_index: dayIndex,
					slot: slot,
					week_start_date: currentWeekStart.format('YYYY-MM-DD')
				}
			});

			if (response.message) {
				frappe.show_alert(`${response.message.message}`, 3);

				$cell.replaceWith(`
					<td class="assignable-slot drop-zone" 
						data-instructor="${instructor}" 
						data-day-index="${dayIndex}" 
						data-slot="${slot}" 
						style="cursor:pointer; border:2px dashed #ccc; text-align:center; min-height: 40px;">
						<small>${slot}</small>
					</td>
				`);
			} else {
				throw new Error('Failed to remove blackout');
			}
		} catch (error) {
			console.error('Error removing blackout:', error);
			frappe.show_alert('Error removing blackout: ' + (error.message || 'Unknown error'), 5);
			$cell.html(originalContent);
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

				// VISUAL update — now includes the × icon
				for (const blk of blackoutSelections) {
					const selector = `.assignable-slot[data-instructor="${blk.instructor}"][data-day-index="${blk.dayIndex}"][data-slot="${blk.slot}"]`;
					const $cell = $(selector);

					$cell
						.removeClass('assignable-slot blackout-selected')
						.addClass('blackout-slot')
						.css({
							background: 'repeating-linear-gradient(45deg,#ccc,#ccc 10px,#bbb 10px,#bbb 20px)',
							color: '#555',
							textAlign: 'center',
							minHeight: '40px',
							cursor: 'not-allowed',
							position: 'relative'
						})
						.html(`
							<em>Blackout</em>
							<span class="remove-blackout" 
								style="color:red; cursor:pointer; font-weight:bold; position: absolute; top: 2px; right: 5px;">&times;</span>
						`);
				}

				// Clear blackout mode
				blackoutSelections = [];
				blackoutModeInstructor = null;
				$('#submit-blackouts').remove();
				$('.blackout-selected').removeClass('blackout-selected');
				$('.blackout-toggle')
					.removeClass('btn-danger')
					.addClass('btn-outline-dark')
					.html('<i class="fa fa-eye-slash"></i> Blackout');

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

	$(document).on('click', '#prev-month', async function () {
		currentMonthStart.subtract(1, 'month');
		await loadAndRenderCalendar();
	});

	$(document).on('click', '#next-month', async function () {
		currentMonthStart.add(1, 'month');
		await loadAndRenderCalendar();
	});

	let zoomLevel = 1;

	$(document).on('click', '#zoom-in', function () {
		zoomLevel += 0.1; // increase 10%
		$('#calendar-scroll-wrapper').css('transform', `scale(${zoomLevel})`);
	});

	$(document).on('click', '#zoom-out', function () {
		zoomLevel = Math.max(0.5, zoomLevel - 0.1); // don’t go smaller than 50%
		$('#calendar-scroll-wrapper').css('transform', `scale(${zoomLevel})`);
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
			.multi-cell-selected {
				outline: 2px solid #28a745;
				background-color: rgba(40, 167, 69, 0.1);
			}
			.sticky-selected-task {
				position: sticky;
				top: 38px; /* or adjust depending on header height */
				z-index: 15;
				background: #fff;
				box-shadow: 0 2px 4px rgba(0,0,0,0.1);
			}
			
			@media print {
				#calendar-scroll-wrapper {
					overflow: visible !important;
					max-height: none !important;
					height: auto !important;
				}
				
				#calendar-scroll-wrapper table {
					page-break-inside: auto !important;
					break-inside: auto !important;
				}
				
				#calendar-scroll-wrapper table tr {
					page-break-inside: avoid;
					break-inside: avoid;
				}
				
				#calendar-scroll-wrapper table thead {
					display: table-header-group;
				}
				
				.no-print {
					display: none !important;
				}
				#calendar-scroll-wrapper {
					transform-origin: top left;
					transition: transform 0.2s ease-in-out;
				}
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