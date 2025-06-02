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
			
			// Process tasks to use custom_assigned_date if available
			const processedTasks = tasks.map(task => {
				if (task.custom_assigned_date) {
					// Use the assigned date instead of expected dates for positioning
					const assignedMoment = moment(task.custom_assigned_date);
					return {
						...task,
						// Keep original dates for validation
						original_exp_start_date: task.exp_start_date,
						original_exp_end_date: task.exp_end_date,
						// Override for positioning
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
				// Check if task has custom assigned date first
				if (task.custom_assigned_date) {
					const assignedMoment = moment(task.custom_assigned_date);
					const taskDay = assignedMoment.clone().startOf('day');
					const currentDay = day.clone().startOf('day');
					const taskSlot = assignedMoment.hour() < 13 ? 'AM' : 'PM';
					
					return taskDay.isSame(currentDay) && taskSlot === slot;
				}
				
				// Otherwise use expected dates
				const taskStart = moment(task.exp_start_date).startOf('day');
				const taskEnd = moment(task.exp_end_date || task.exp_start_date).startOf('day');
				const currentDay = day.clone().startOf('day');
				
				return currentDay.isBetween(taskStart, taskEnd, null, '[]');
			});
		},

		// Check if a task can be moved to a specific day
		canTaskBeMoved(task, targetDay) {
			// Use original dates for validation, not the assigned dates
			const taskStart = moment(task.original_exp_start_date || task.exp_start_date);
			const taskEnd = moment(task.original_exp_end_date || task.exp_end_date || taskStart);
			
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

		// New method to update task dates
		// Replace the existing updateTaskSchedule method in your Methods object with this debug version:

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
        
        // Check if it's a network error
        if (error.name === 'NetworkError' || error.message.includes('fetch')) {
            throw new Error('Network error - please check your connection');
        }
        
        // Check if it's a permission error
        if (error.message && error.message.includes('permission')) {
            throw new Error('Permission denied - please check your user permissions');
        }
        
        // Check if the method doesn't exist
        if (error.message && error.message.includes('method not found')) {
            throw new Error('Backend method not found - please ensure update_task_schedule method exists');
        }
        
        throw error;
    }
}
,
// Also add a helper method to test the backend connection
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

        // Initialize customer bucket
        if (!customerMap[customer]) {
            customerMap[customer] = { main: [], sub: [] };
        }

        // Check if task has groups defined and is not already a group task
        if (task.custom_customer_groups && !task.custom_group_name) {
			let groups = [];

			try {
				if (Array.isArray(task.custom_customer_groups)) {
					groups = task.custom_customer_groups;
				} else if (typeof task.custom_customer_groups === 'string') {
					// Try parsing JSON or fallback to comma-split
					try {
						groups = JSON.parse(task.custom_customer_groups);
					} catch (e) {
						groups = task.custom_customer_groups
							.split(/[\n,]/)
							.map(g => g.trim())
							.filter(g => g);
					}
				}
			} catch (e) {
				console.warn('Failed to parse groups for task:', task.name, e);
			}

			if (groups.length > 0) {
				const totalPeople = parseInt(task.custom_no_of_people) || 0;
				const peoplePerGroup = Math.ceil(totalPeople / groups.length);

				groups.forEach((groupName, index) => {
					const groupTask = {
						...task,
						name: `${task.name}_group_${index + 1}`,
						subject: `${task.subject} - ${groupName}`,
						custom_group_name: groupName,
						custom_no_of_people: peoplePerGroup,
						original_task_name: task.name,
						is_group_task: true
					};

			customerMap[task.custom_customer_name || 'Unknown'].sub.push(groupTask);

                    customerMap[customer].sub.push(groupTask);
                });
            } else {
                // No valid groups, add to main
                customerMap[customer].main.push(task);
            }
        } else if (!task.is_group_task) {
            // Regular task or already processed group task
            customerMap[customer].main.push(task);
        }
    });

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
					// Task has been manually assigned to a specific date/time
					const assignedMoment = moment(task.custom_assigned_date);
					const dayIndex = assignedMoment.diff(moment(currentWeekStart), 'days');
					const slot = assignedMoment.hour() < 13 ? 'AM' : 'PM';
					
					if (dayIndex >= 0 && dayIndex < 7) {
						taskPlacements.push({ task, dayIndex, slot });
					}
				} else {
					// Use expected start date for positioning
					const taskStart = moment(task.exp_start_date);
					const dayIndex = taskStart.diff(moment(currentWeekStart), 'days');
					
					// Default to AM slot unless specified otherwise
					const slot = task.assigned_slot || 'AM';
					
					if (dayIndex >= 0 && dayIndex < 7) {
						taskPlacements.push({ task, dayIndex, slot });
					}
				}
			});

			// For each day and slot, find assigned task (if any)
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
		$('#calendar-container').on('drop', '.drop-zone', async function (e) {
			e.preventDefault();

			const originalContent = $(this).html(); // Always defined for fallback

			// ✅ Safety check: ensure dragged data exists
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

				// ✅ Recreate the dragged element safely from HTML
				const $newElement = $(draggedTask.elementHTML).css('opacity', '1');
				$newElement.data('day-index', targetDayIndex);
				$newElement.data('slot', targetSlot);

				$(this).html('').append($newElement);

				frappe.show_alert(`Moved ${draggedTask.taskSubject} to ${targetDay.format('MMM D')} ${targetSlot}`, 3);
			} catch (error) {
				console.error('Error moving task:', error);
				frappe.show_alert('Error moving task: ' + (error.message || 'Unknown error'), 5);
				$(this).html(originalContent); // fallback UI
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

	if (!customerName || !numberOfGroups || numberOfGroups < 1 || !totalPeople || totalPeople < 1) {
		frappe.show_alert('Please fill all required fields with valid values', 5);
		return;
	}

	if (numberOfGroups > totalPeople) {
		frappe.show_alert('Number of groups cannot exceed number of people', 5);
		return;
	}

	try {
		$(this).prop('disabled', true).text('Creating Groups...');

		const groupNames = [];
		for (let i = 1; i <= numberOfGroups; i++) {
			groupNames.push(`Group ${i}`);
		}

		const weekKey = currentWeekStart.format('YYYY-MM-DD');
		const tasks = weekData[weekKey]?.tasks || [];

		const customerTasks = tasks.filter(t => t.custom_customer_name === customerName);

		for (const task of customerTasks) {
			// Save to the task
			frappe.call({
				method: 'tours_and_safaris.tours_and_safaris.page.guide_allocation.guide_allocation.create_customer_groups',
				args: {
					customer_name: customerName,
					total_people: totalPeople,
					group_names: groupNames,
					week_start_date: currentWeekStart.format('YYYY-MM-DD')
				}
			});

		}

		frappe.show_alert('Groups saved successfully!', 3);

		// Refresh calendar
		delete weekData[weekKey];
		const freshData = await Methods.loadWeekData(currentWeekStart, true);
		if (freshData) renderCalendar(freshData);

		// Reset modal
		$('#groupCreationModal').modal('hide');
		$('#customerSelect').val('');
		$('#totalPeople').val('');
		$('#numberOfGroups').val('');
		$('#groupPreview').empty();

	} catch (error) {
		console.error('Error creating groups:', error);
		frappe.show_alert('Failed to save groups: ' + (error.message || 'Unknown error'), 5);
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
        
        // Filter tasks for selected customer in current week
        const customerTasks = currentData.tasks.filter(task => 
            task.custom_customer_name === customerName
        );
        
        console.log('Customer tasks found:', customerTasks);
        
        if (customerTasks.length === 0) {
            $('#totalPeople').val('0');
            $('#groupPreview').html('<p class="text-warning">No tasks found for this customer.</p>');
            return;
        }
        
        let peopleCount = 0;
        let foundSource = '';
        
        // Method 1: Check task's custom_no_of_people field
        for (const task of customerTasks) {
            if (task.custom_no_of_people && task.custom_no_of_people > 0) {
                peopleCount = parseInt(task.custom_no_of_people);
                foundSource = 'task';
                break;
            }
        }
        
        // Method 2: Get from project if task doesn't have it
        if (peopleCount === 0) {
            for (const task of customerTasks) {
                if (task.project) {
                    try {
                        const response = await frappe.call({
                            method: "frappe.client.get_value",
                            args: {
                                doctype: "Project",
                                filters: { name: task.project },
                                fieldname: ["custom_no_of_people"]
                            }
                        });
                        
                        if (response.message && response.message.custom_no_of_people) {
                            peopleCount = parseInt(response.message.custom_no_of_people);
                            foundSource = 'project';
                            break;
                        }
                    } catch (error) {
                        console.warn('Error fetching project:', error);
                        continue;
                    }
                }
            }
        }
        
        // Method 3: Get from customer record
        if (peopleCount === 0) {
            try {
                const response = await frappe.call({
                    method: "frappe.client.get_value", 
                    args: {
                        doctype: "Customer",
                        filters: { name: customerName },
                        fieldname: ["custom_no_of_people"]
                    }
                });
                
                if (response.message && response.message.custom_no_of_people) {
                    peopleCount = parseInt(response.message.custom_no_of_people);
                    foundSource = 'customer';
                }
            } catch (error) {
                console.warn('Error fetching customer:', error);
            }
        }
        
        $('#totalPeople').val(peopleCount || 0);
        
        if (peopleCount > 0) {
            $('#groupPreview').html(`<p class="text-success">Found ${peopleCount} people (from ${foundSource})</p>`);
        } else {
            $('#groupPreview').html('<p class="text-warning">No people count found. Please check customer/project settings.</p>');
        }
        
    } catch (error) {
        console.error('Error:', error);
        $('#totalPeople').val('0');
        $('#groupPreview').html(`<p class="text-danger">Error: ${error.message}</p>`);
    }
});

	$('#numberOfGroups').on('input', function () {
    const totalPeople = parseInt($('#totalPeople').val()) || 0;
    const numberOfGroups = parseInt($(this).val()) || 0;
    
    if (numberOfGroups > 0 && totalPeople > 0) {
        const peoplePerGroup = Math.ceil(totalPeople / numberOfGroups);
        let html = '<div class="mt-3"><h6>Group Preview:</h6><ul class="list-group">';
        
        for (let i = 1; i <= numberOfGroups; i++) {
            const groupPeople = Math.min(peoplePerGroup, totalPeople - (i - 1) * peoplePerGroup);
            if (groupPeople > 0) {
                html += `<li class="list-group-item d-flex justify-content-between">
                    <span>Group ${i}</span>
                    <span class="badge badge-primary">${groupPeople} people</span>
                </li>`;
            }
        }
        
        html += '</ul></div>';
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