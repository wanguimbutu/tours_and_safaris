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
            <button class="btn btn-sm btn-success" id="create-groups">Create Customer Groups</button>
            <button class="btn btn-sm btn-warning" id="submit-allocations">Submit All Allocations</button>
        </div>
        <div id="loading-indicator" class="text-center" style="display: none;">
            <div class="spinner-border" role="status">
                <span class="sr-only">Loading...</span>
            </div>
            <p>Loading week data...</p>
        </div>
        <div id="calendar-container" class="table-responsive"></div>
        
        <!-- Group Creation Modal -->
        <div class="modal fade" id="groupCreationModal" tabindex="-1" role="dialog">
            <div class="modal-dialog" role="document">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Create Customer Groups</h5>
                        <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                            <span aria-hidden="true">&times;</span>
                        </button>
                    </div>
                    <div class="modal-body">
                        <div class="form-group">
                            <label for="customerSelect">Select Customer:</label>
                            <select id="customerSelect" class="form-control">
                                <option value="">Choose a customer...</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="totalPeople">Total Number of People:</label>
                            <input type="number" id="totalPeople" class="form-control" readonly>
                        </div>
                        <div class="form-group">
                            <label for="numberOfGroups">Number of Groups:</label>
                            <input type="number" id="numberOfGroups" class="form-control" min="1" max="20">
                        </div>
                        <div id="groupPreview" class="mt-3"></div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-primary" id="createGroupsBtn">Create Groups</button>
                    </div>
                </div>
            </div>
        </div>
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
			
			// Return cached data if available and not forcing reload
			if (!forceReload && weekData[weekKey]) {
				return weekData[weekKey];
			}
			
			// If already loading this week, wait for it
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
					// Process the data for easier consumption
					const processed = this.processWeekData(response.message);
					weekData[weekKey] = processed;
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
					
					const taskObj = {
						name: allocation.allocation_id,
						subject: allocation.detail_activity_name || allocation.activity_name,
						custom_customer_name: allocation.customer
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
				instructors: processedInstructors,
				instructorAssignments,
				tasks
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
			const amStart = day.clone().hour(8).minute(0);
			const amEnd = day.clone().hour(12).minute(30);
			const pmStart = day.clone().hour(13).minute(30);
			const pmEnd = day.clone().hour(17).minute(30);
		
			const startRange = slot === "AM" ? amStart : pmStart;
			const endRange = slot === "AM" ? amEnd : pmEnd;
		
			return tasksToRender.filter(task => {
				const start = moment(task.exp_start_date).startOf('day');
				const end = moment(task.exp_end_date || task.exp_start_date).endOf('day');
				const current = day.clone().startOf('day');
				return current.isBetween(start, end, null, '[]');  // Inclusive
			});
			
		},

		// Check if a task can be moved to a specific day
		canTaskBeMoved(task, targetDay) {
			const taskStart = moment(task.exp_start_date);
			const taskEnd = moment(task.exp_end_date || task.exp_start_date);
			
			// Check if target day is within the task's allowed date range
			return targetDay.isSameOrAfter(taskStart, 'day') && targetDay.isSameOrBefore(taskEnd, 'day');
		},

		makeTaskCellClickable(task, dayIndex, slot, color, inline = false) {
			const peopleInfo = task.custom_no_of_people ? ` (${task.custom_no_of_people} people)` : '';
			const content = `${task.subject}${peopleInfo}`;
			
			// Add drag handle icon
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
					data-exp-start="${task.exp_start_date}"
					data-exp-end="${task.exp_end_date || task.exp_start_date}"
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

		// New method to update task dates
		async updateTaskSchedule(taskName, newDate, slot) {
			try {
				// Create a method to update the task's scheduled date
				const response = await frappe.call({
					method: "tours_and_safaris.tours_and_safaris.page.guide_allocation.guide_allocation.update_task_schedule",
					args: {
						task_name: taskName,
						new_date: newDate,
						slot: slot
					}
				});
				
				if (response.message && response.message.success) {
					return response.message;
				} else {
					throw new Error(response.message?.message || "Failed to update task schedule");
				}
			} catch (error) {
				console.error('Error updating task schedule:', error);
				throw error;
			}
		},

		// Helper method to check if a slot is occupied
		isSlotOccupied(instructorName, dayIndex, slot, instructorAssignments) {
			const assignments = instructorAssignments[instructorName] || [];
			return assignments.some(assignment => 
				assignment.dayIndex === dayIndex && assignment.slot === slot
			);
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
				customerMap[customer] = { main: [], sub: [] };
			}
		
			// Check if this task has customer groups defined
			if (task.custom_customer_groups && task.custom_customer_groups.trim()) {
				// Parse the groups from the text field (assuming newline-separated)
				const groups = task.custom_customer_groups.split('\n').map(g => g.trim()).filter(g => g);
				
				// Create virtual group tasks for each group
				groups.forEach((groupName, index) => {
					const groupTask = {
						...task,
						name: `${task.name}_group_${index}`,
						subject: `${task.subject} - ${groupName}`,
						custom_group_name: groupName,
						// Keep original task properties for scheduling
						exp_start_date: task.exp_start_date,
						exp_end_date: task.exp_end_date,
						custom_no_of_people: task.custom_no_of_people
					};
					
					// Avoid duplicates
					if (!customerMap[customer].sub.some(t => t.name === groupTask.name)) {
						customerMap[customer].sub.push(groupTask);
					}
				});
				
				// Don't add the original task to main if it has groups
				// The groups will represent this task
			} else {
				// This is a regular task without groups - add to main
				if (!customerMap[customer].main.some(t => t.name === task.name)) {
					customerMap[customer].main.push(task);
				}
			}
		});

		let html = '<div style="overflow-x: auto;"><table class="table table-bordered"><thead><tr><th>Customer / Instructor</th>';
		weekDays.forEach(day => {
			html += `<th class="drop-zone" data-day-index="${weekDays.indexOf(day)}">${day.format('ddd D')}<br>AM</th><th class="drop-zone" data-day-index="${weekDays.indexOf(day)}">${day.format('ddd D')}<br>PM</th>`;
		});
		html += '</tr></thead><tbody>';

		function renderTaskRow(label, tasksToRender, color, indent = false) {
			html += `<tr><td style="background-color: ${color}; padding-left: ${indent ? '20px' : '0'};">${label}</td>`;
			// Distribute tasks across the days evenly
			const distributedTasks = [];
			const totalDays = weekDays.length;
			tasksToRender.forEach((task, index) => {
				const dayIndex = index % totalDays;
				const slot = index % 2 === 0 ? 'AM' : 'PM';  // Alternate between AM and PM
				distributedTasks.push({ task, dayIndex, slot });
			});

			// For each day and slot, find assigned task (if any)
			weekDays.forEach((day, dayIndex) => {
				['AM', 'PM'].forEach(slot => {
					const match = distributedTasks.find(t => t.dayIndex === dayIndex && t.slot === slot);
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
			
			// Show customer header if there are main tasks OR sub tasks
			if (grouped.main.length > 0 || grouped.sub.length > 0) {
				// Only render main tasks row if there are actual main tasks
				if (grouped.main.length > 0) {
					renderTaskRow(`<strong>${customer}</strong>`, grouped.main, color);
				} else if (grouped.sub.length > 0) {
					// Show customer header even if only sub tasks exist
					renderTaskRow(`<strong>${customer}</strong>`, [], color);
				}
				
				// Render grouped tasks with proper indentation
				grouped.sub.forEach(groupTask => {
					const groupName = groupTask.custom_group_name || 'Unknown Group';
					renderTaskRow(`&nbsp;&nbsp;&nbsp;&nbsp;↳ ${groupName}`, [groupTask], color, true);
				});
			}
		}

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

	// Drag and Drop functionality
	function initializeDragAndDrop() {
		// Handle drag start
		$('#calendar-container').on('dragstart', '.draggable-task', function(e) {
			draggedTask = {
				element: $(this),
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
				
				// Check if the task can be moved to this day
				const canMove = Methods.canTaskBeMoved({
					exp_start_date: draggedTask.expStart,
					exp_end_date: draggedTask.expEnd
				}, targetDay);
				
				// Remove previous classes
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
		$('#calendar-container').on('drop', '.drop-zone', async function(e) {
			e.preventDefault();
			
			if (!draggedTask) return;
			
			const targetDayIndex = parseInt($(this).data('day-index'));
			const targetSlot = $(this).data('slot') || draggedTask.originalSlot;
			const targetDay = moment(currentWeekStart).add(targetDayIndex, 'days');
			
			// Clean up visual indicators
			$('.drop-zone').removeClass('drag-over drag-valid drag-invalid');
			
			// Check if the task can be moved to this day
			const canMove = Methods.canTaskBeMoved({
				exp_start_date: draggedTask.expStart,
				exp_end_date: draggedTask.expEnd
			}, targetDay);
			
			if (!canMove) {
				frappe.show_alert(`Task cannot be moved to ${targetDay.format('MMM D')}. It's outside the allowed date range (${moment(draggedTask.expStart).format('MMM D')} - ${moment(draggedTask.expEnd).format('MMM D')})`, 5);
				draggedTask = null;
				return;
			}
			
			// Check if it's the same position
			if (targetDayIndex === draggedTask.originalDayIndex && targetSlot === draggedTask.originalSlot) {
				draggedTask = null;
				return;
			}
			
			try {
				// Show loading state
				const originalContent = $(this).html();
				$(this).html('<small>Moving...</small>');
				
				// Update the task schedule in the backend
				const newDate = targetDay.format('YYYY-MM-DD');
				await Methods.updateTaskSchedule(draggedTask.taskName, newDate, targetSlot);
				
				frappe.show_alert(`Moved ${draggedTask.taskSubject} to ${targetDay.format('MMM D')} ${targetSlot}`, 3);
				
				// Reload the calendar to reflect changes
				await loadAndRenderCalendar();
				
			} catch (error) {
				console.error('Error moving task:', error);
				frappe.show_alert('Error moving task: ' + (error.message || 'Unknown error'), 5);
				
				// Restore original content
				$(this).html(originalContent);
			} finally {
				draggedTask = null;
			}
		});
	}

	// Event handlers - Moved outside renderCalendar and using event delegation
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

	$('#create-groups').on('click', function () {
		const currentData = weekData[currentWeekStart.format('YYYY-MM-DD')];
		if (currentData && currentData.tasks) {
			populateCustomerDropdown(currentData.tasks);
			$('#groupCreationModal').modal('show');
		} else {
			frappe.show_alert('Please wait for data to load', 3);
		}
	});

	// Replace the create groups button click handler with this simplified version:

$('#createGroupsBtn').off('click').on('click', async function () {
    const customerName = $('#customerSelect').val();
    const numberOfGroups = parseInt($('#numberOfGroups').val());
    const totalPeople = parseInt($('#totalPeople').val());
    
    if (!customerName) {
        frappe.show_alert('Please select a customer', 5);
        return;
    }
    
    if (!numberOfGroups || numberOfGroups < 1) {
        frappe.show_alert('Please enter a valid number of groups (minimum 1)', 5);
        return;
    }
    
    if (!totalPeople || totalPeople < 1) {
        frappe.show_alert('No people count available. Please check the project or customer settings.', 5);
        return;
    }
    
    if (numberOfGroups > totalPeople) {
        frappe.show_alert('Number of groups cannot exceed number of people', 5);
        return;
    }
    
    try {
        $(this).prop('disabled', true).text('Creating Groups...');
        
        console.log('Creating groups with:', {
            customer_name: customerName,
            number_of_groups: numberOfGroups,
            total_people: totalPeople
        });
        
        // Call the server function which now handles both group creation and field updates
        const res = await frappe.call({
            method: 'tours_and_safaris.tours_and_safaris.page.guide_allocation.guide_allocation.create_customer_groups_from_project',
            args: {
                customer_name: customerName,
                number_of_groups: numberOfGroups,
                total_people: totalPeople
            }
        });
        
        console.log('Create groups response:', res);
        
        if (res.message && res.message.success) {
            const message = res.message.message || 'Groups created successfully';
            const groupsCreated = res.message.groups ? res.message.groups.length : numberOfGroups;
            const tasksUpdated = res.message.updated_tasks || 0;
            
            frappe.show_alert(`${message}. Created ${groupsCreated} group tasks and updated ${tasksUpdated} original tasks.`, 4);
            $('#groupCreationModal').modal('hide');
            
            // Reset form
            $('#customerSelect').val('');
            $('#totalPeople').val('');
            $('#numberOfGroups').val('');
            $('#groupPreview').empty();
            
            await loadAndRenderCalendar();
        } else {
            throw new Error(res.message?.message || 'Failed to create groups');
        }
    } catch (error) {
        console.error('Error creating groups:', error);
        frappe.show_alert('Failed to create groups: ' + (error.message || 'Unknown error'), 5);
    } finally {
        $(this).prop('disabled', false).text('Create Groups');
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

	function populateCustomerDropdown(tasks) {
		// Filter tasks for the current week only
		const weekStart = currentWeekStart.clone();
		const weekEnd = currentWeekStart.clone().add(6, 'days');
		
		const weekTasks = tasks.filter(task => {
			const taskStart = moment(task.exp_start_date);
			const taskEnd = moment(task.exp_end_date || task.exp_start_date);
			
			// Check if task overlaps with current week
			return taskStart.isSameOrBefore(weekEnd, 'day') && taskEnd.isSameOrAfter(weekStart, 'day');
		});
		
		console.log('Week tasks filtered:', weekTasks.length, 'out of', tasks.length);
		
		// Get unique customers from week tasks
		const customers = [...new Set(weekTasks.map(t => t.custom_customer_name).filter(Boolean))];
		
		console.log('Unique customers for this week:', customers);
		
		const select = $('#customerSelect');
		select.empty().append('<option value="">Choose a customer...</option>');
		
		customers.forEach(customerName => {
			// Store customer tasks data for later use
			const customerTasks = weekTasks.filter(t => t.custom_customer_name === customerName);
			select.append(`<option value="${customerName}" data-task-count="${customerTasks.length}">${customerName}</option>`);
		});
	}
	

	$('#customerSelect').on('change', async function () {
		const customerName = $(this).val();
		
		if (!customerName) {
			$('#totalPeople').val('');
			$('#groupPreview').empty();
			return;
		}
		
		try {
			// Show loading state
			$('#totalPeople').val('Loading...');
			$('#groupPreview').html('<p>Loading customer details...</p>');
			
			// Get current week data
			const currentData = weekData[currentWeekStart.format('YYYY-MM-DD')];
			
			if (!currentData || !currentData.tasks) {
				throw new Error('Week data not available');
			}
			
			// Filter tasks for the current week and selected customer
			const weekStart = currentWeekStart.clone();
			const weekEnd = currentWeekStart.clone().add(6, 'days');
			
			const customerWeekTasks = currentData.tasks.filter(task => {
				if (task.custom_customer_name !== customerName) return false;
				
				const taskStart = moment(task.exp_start_date);
				const taskEnd = moment(task.exp_end_date || task.exp_start_date);
				
				// Check if task overlaps with current week
				return taskStart.isSameOrBefore(weekEnd, 'day') && taskEnd.isSameOrAfter(weekStart, 'day');
			});
			
			console.log('Customer week tasks:', customerWeekTasks);
			
			if (customerWeekTasks.length === 0) {
				$('#totalPeople').val('0');
				$('#groupPreview').html('<p class="text-warning">No tasks found for this customer in the current week.</p>');
				return;
			}
			
			// Try to get people count from multiple sources
			let peopleCount = 0;
			let foundSource = '';
			
			// Method 1: Check if any task has direct people count
			for (const task of customerWeekTasks) {
				if (task.custom_no_of_people && task.custom_no_of_people > 0) {
					peopleCount = task.custom_no_of_people;
					foundSource = 'task';
					break;
				}
			}
			
			// Method 2: If no direct count, try to get from project
			if (peopleCount === 0) {
				for (const task of customerWeekTasks) {
					if (task.project) {
						try {
							console.log('Fetching project details for:', task.project);
							
							const response = await frappe.call({
								method: "frappe.client.get_value",
								args: {
									doctype: "Project",
									filters: { name: task.project },
									fieldname: ["custom_no_of_people", "name"]
								}
							});
							
							console.log('Project response:', response);
							
							if (response.message && response.message.custom_no_of_people) {
								peopleCount = parseInt(response.message.custom_no_of_people);
								foundSource = 'project';
								break;
							}
						} catch (projectError) {
							console.warn('Error fetching project:', task.project, projectError);
							continue; // Try next task
						}
					}
				}
			}
			
			// Method 3: Try to get from customer record directly
			if (peopleCount === 0) {
				try {
					console.log('Trying to fetch customer details for:', customerName);
					
					const customerResponse = await frappe.call({
						method: "frappe.client.get_list",
						args: {
							doctype: "Customer",
							filters: { name: customerName },
							fields: ["name", "custom_no_of_people"]
						}
					});
					
					if (customerResponse.message && customerResponse.message.length > 0) {
						const customer = customerResponse.message[0];
						if (customer.custom_no_of_people) {
							peopleCount = parseInt(customer.custom_no_of_people);
							foundSource = 'customer';
						}
					}
				} catch (customerError) {
					console.warn('Error fetching customer details:', customerError);
				}
			}
			
			// Set the people count
			$('#totalPeople').val(peopleCount || 0);
			
			// Show debug information
			const debugInfo = `
				<div class="alert alert-info">
					<strong>Debug Info:</strong><br>
					Customer: ${customerName}<br>
					Tasks found: ${customerWeekTasks.length}<br>
					People count: ${peopleCount} (from ${foundSource || 'none'})<br>
					Week: ${weekStart.format('MMM D')} - ${weekEnd.format('MMM D, YYYY')}
				</div>
			`;
			
			if (peopleCount > 0) {
				$('#groupPreview').html(debugInfo + '<p class="text-success">People count loaded successfully!</p>');
			} else {
				$('#groupPreview').html(debugInfo + '<p class="text-warning">No people count found. Please check the project or customer settings.</p>');
			}
			
		} catch (error) {
			console.error('Error fetching customer details:', error);
			$('#totalPeople').val('0');
			$('#groupPreview').html(`<p class="text-danger">Error: ${error.message}</p>`);
			frappe.show_alert('Error fetching customer details: ' + error.message, 5);
		}
	});
	
	$('#numberOfGroups').on('input', function () {
		const totalPeople = parseInt($('#totalPeople').val()) || 0;
		const groups = parseInt($(this).val()) || 0;
		if (groups > 0 && totalPeople > 0) {
			const perGroup = Math.ceil(totalPeople / groups);
			let html = '<ul>';
			for (let i = 0; i < groups; i++) {
				const start = i * perGroup + 1;
				const end = Math.min((i + 1) * perGroup, totalPeople);
				html += `<li>Group ${i + 1}: ${end - start + 1} people</li>`;
			}
			html += '</ul>';
			$('#groupPreview').html(html);
		} else {
			$('#groupPreview').empty();
		}
	});

	// Add some CSS for visual feedback
	$('<style>').prop('type', 'text/css').html(`
		.selected-task {
			border: 3px solid #007bff !important;
			box-shadow: 0 0 5px rgba(0,123,255,0.5);
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
	`).appendTo('head');

	// Initialize
	loadAndRenderCalendar();
}