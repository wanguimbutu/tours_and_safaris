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
                            <label for="parentTaskSelect">Select Activity:</label>
                            <select id="parentTaskSelect" class="form-control">
                                <option value="">Choose an activity...</option>
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
				const start = moment(task.exp_start_date);
				const end = moment(task.exp_end_date || task.exp_start_date);
				return endRange.isSameOrAfter(start) && startRange.isSameOrBefore(end);
			});
		},

		makeTaskCellClickable(task, dayIndex, slot, color, inline = false) {
			const peopleInfo = task.custom_no_of_people ? ` (${task.custom_no_of_people} people)` : '';
			const content = `${task.subject}${peopleInfo}`;
		
			const style = `
				display: inline-block;
				background-color: ${color};
				padding: 2px 6px;
				margin: 2px 0;
				border-radius: 4px;
				font-size: 90%;
				line-height: 1.2;
			`;
		
			if (inline) {
				return `<div class="assignable-cell" 
					data-task-name="${task.name}"
					data-task-subject="${task.subject}"
					data-task-customer="${task.custom_customer_name || ''}"
					data-day-index="${dayIndex}" 
					data-slot="${slot}" 
					style="${style}; cursor: pointer;">
					${content}
				</div>`;
			}
		
			return `<td class="assignable-cell" 
				data-task-name="${task.name}"
				data-task-subject="${task.subject}"
				data-task-customer="${task.custom_customer_name || ''}"
				data-day-index="${dayIndex}" 
				data-slot="${slot}" 
				style="background-color: ${color}; cursor: pointer;">
				${content}
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

			if (!task.parent_task) {
				if (!customerMap[customer].main.some(t => t.name === task.name)) {
					customerMap[customer].main.push(task);
				}
			} else {
				if (!customerMap[customer].sub.some(t => t.name === task.name)) {
					customerMap[customer].sub.push(task);
				}
			}
		});

		let html = '<div style="overflow-x: auto;"><table class="table table-bordered"><thead><tr><th>Customer / Instructor</th>';
		weekDays.forEach(day => {
			html += `<th>${day.format('ddd D')}<br>AM</th><th>${day.format('ddd D')}<br>PM</th>`;
		});
		html += '</tr></thead><tbody>';

		function renderTaskRow(label, tasksToRender, color, indent = false) {
			html += `<tr><td style="background-color: ${color}; padding-left: ${indent ? '20px' : '0'};">${label}</td>`;
			weekDays.forEach((day, dayIndex) => {
				const tasksAM = Methods.getTasksForSlot(tasksToRender, day, 'AM');
				const tasksPM = Methods.getTasksForSlot(tasksToRender, day, 'PM');

				html += `<td style="vertical-align: top;">${
					tasksAM.map(task => Methods.makeTaskCellClickable(task, dayIndex, 'AM', color, true)).join('')
				}</td>`;

				html += `<td style="vertical-align: top;">${
					tasksPM.map(task => Methods.makeTaskCellClickable(task, dayIndex, 'PM', color, true)).join('')
				}</td>`;
			});
			html += '</tr>';
		}

		for (const [customer, grouped] of Object.entries(customerMap)) {
			const color = Methods.getColorForCustomer(customer);
			renderTaskRow(`<strong>${customer}</strong>`, grouped.main, color);
			grouped.sub.forEach(sub => {
				renderTaskRow(`↳ ${sub.subject}`, [sub], color, true);
			});
		}

		instructors.forEach(instr => {
			html += `<tr><td><span class="text-primary">— ${instr.instructor_name}</span></td>`;
			for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
				['AM', 'PM'].forEach(slot => {
					const assigned = (instructorAssignments[instr.name] || []).find(
						a => a.dayIndex === dayIndex && a.slot === slot
					);
					if (assigned) {
						html += `<td class="assigned-task" 
							data-instructor="${instr.name}" 
							data-day-index="${dayIndex}" 
							data-slot="${slot}" 
							data-task-name="${assigned.task.name}" 
							data-subject="${assigned.task.subject}" 
							style="background:${Methods.getColorForCustomer(assigned.task.custom_customer_name)}; cursor:pointer; position: relative;">
							${assigned.task.subject} 
							<span class="remove-assignment" style="color:red; cursor:pointer; font-weight:bold; position: absolute; top: 2px; right: 5px;">&times;</span>
						</td>`;
					} else {
						html += `<td class="assignable-slot" 
							data-instructor="${instr.name}" 
							data-day-index="${dayIndex}" 
							data-slot="${slot}" 
							style="cursor:pointer; border:2px dashed #ccc; text-align:center;">
							<small>${slot}</small>
						</td>`;
					}
				});
			}
			html += '</tr>';
		});

		html += '</tbody></table></div>';
		$('#calendar-container').html(html);
	}

	// Event handlers - Moved outside renderCalendar and using event delegation
	$('#calendar-container').on('click', '.assignable-cell', function (e) {
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

	// Prevent assignment when clicking on assigned tasks (not the remove button)
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

	$('#createGroupsBtn').on('click', async function () {
		const parentTaskName = $('#parentTaskSelect').val();
		const numberOfGroups = parseInt($('#numberOfGroups').val());
		if (!parentTaskName || !numberOfGroups) {
			frappe.show_alert('Please select activity and number of groups', 5);
			return;
		}
		try {
			$(this).prop('disabled', true);
			const res = await frappe.call({
				method: 'tours_and_safaris.tours_and_safaris.page.guide_allocation.guide_allocation.create_customer_groups_optimized',
				args: {
					parent_task_name: parentTaskName,
					number_of_groups: numberOfGroups
				}
			});
			frappe.show_alert(res.message.message);
			$('#groupCreationModal').modal('hide');
			await loadAndRenderCalendar();
		} catch (error) {
			frappe.show_alert('Failed to create groups', 5);
		} finally {
			$(this).prop('disabled', false);
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
		const customers = [...new Set(tasks.map(t => t.custom_customer_name).filter(Boolean))];
		const select = $('#customerSelect');
		select.empty().append('<option value="">Choose a customer...</option>');
		customers.forEach(c => {
			select.append(`<option value="${c}">${c}</option>`);
		});
	}

	$('#customerSelect').on('change', function () {
		const customer = $(this).val();
		const currentData = weekData[currentWeekStart.format('YYYY-MM-DD')];
		if (currentData && currentData.tasks) {
			const filtered = currentData.tasks.filter(t => t.custom_customer_name === customer && !t.parent_task);
			const select = $('#parentTaskSelect');
			select.empty().append('<option value="">Choose an activity...</option>');
			filtered.forEach(task => {
				select.append(`<option value="${task.name}" data-people="${task.custom_no_of_people}">${task.subject}</option>`);
			});
		}
	});

	$('#parentTaskSelect').on('change', function () {
		const people = $(this).find(':selected').data('people') || 0;
		$('#totalPeople').val(people);
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