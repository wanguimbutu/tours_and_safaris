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
					data-task='${JSON.stringify(task)}'
					data-day-index="${dayIndex}" 
					data-slot="${slot}" 
					style="${style}; cursor: pointer;">
					${content}
				</div>`;
			}
		
			return `<td class="assignable-cell" 
				data-task='${JSON.stringify(task)}'
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
		}
	};

	// Main Functions
	async function loadAndRenderCalendar() {
		try {
			const data = await Methods.loadWeekData(currentWeekStart);
			if (data) {
				renderCalendar(data);
			}
		} catch (error) {
			console.error('Error loading calendar:', error);
			frappe.show_alert("Error loading calendar data", 5);
		}
	}
	
	// CONTINUED: Complete client-side based on optimized server

	function renderCalendar(data) {
		const { tasks, instructors, instructorAssignments } = data;
		const weekDays = Methods.getWeekDays();
		const customerMap = {}; // <- FIXED: Define customerMap before use

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
						html += `<td class="assigned-task" data-instructor="${instr.name}" data-day-index="${dayIndex}" data-slot="${slot}" data-task-name="${assigned.task.name}" data-subject="${assigned.task.subject}" style="background:${Methods.getColorForCustomer(assigned.task.custom_customer_name)}; cursor:pointer;">${assigned.task.subject} <span style="color:red; cursor:pointer;">&times;</span></td>`;
					} else {
						html += `<td class="assignable-slot" data-instructor="${instr.name}" data-day-index="${dayIndex}" data-slot="${slot}" style="cursor:pointer; border:2px dashed #ccc; text-align:center;"><small>${slot}</small></td>`;
					}
				});
			}
			html += '</tr>';
		});

		html += '</tbody></table></div>';
		$('#calendar-container').html(html);
	}


// Event handlers
$('#calendar-container').on('click', '.assignable-cell[data-task]', function () {
	const taskData = $(this).data('task');
	if (taskData) {
		selectedTask = JSON.parse(taskData);
		frappe.show_alert(`Selected: ${selectedTask.subject}`, 2);
	}
});

$('#calendar-container').on('click', '.assignable-slot', async function () {
	if (!selectedTask) return frappe.show_alert('Select a task first', 5);
	const instructor = $(this).data('instructor');
	const dayIndex = parseInt($(this).data('day-index'));
	const slot = $(this).data('slot');
	try {
		await Methods.createAllocation(selectedTask.name, dayIndex, slot, instructor);
		await loadAndRenderCalendar();
	} catch (error) {
		frappe.show_alert(error.message || 'Error assigning task', 5);
	}
});

$('#calendar-container').on('click', '.assigned-task span', async function (e) {
	e.stopPropagation();
	const cell = $(this).closest('.assigned-task');
	const instructor = cell.data('instructor');
	const dayIndex = parseInt(cell.data('day-index'));
	const slot = cell.data('slot');
	const subject = cell.data('subject');
	try {
		await Methods.removeAllocation(instructor, dayIndex, slot, subject);
		await loadAndRenderCalendar();
	} catch (error) {
		frappe.show_alert(error.message || 'Error removing allocation', 5);
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
	populateCustomerDropdown(weekData[currentWeekStart.format('YYYY-MM-DD')].tasks);
	$('#groupCreationModal').modal('show');
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
	const tasks = weekData[currentWeekStart.format('YYYY-MM-DD')].tasks;
	const filtered = tasks.filter(t => t.custom_customer_name === customer && !t.parent_task);
	const select = $('#parentTaskSelect');
	select.empty().append('<option value="">Choose an activity...</option>');
	filtered.forEach(task => {
		select.append(`<option value="${task.name}" data-people="${task.custom_no_of_people}">${task.subject}</option>`);
	});
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

// Initialize
loadAndRenderCalendar();
}