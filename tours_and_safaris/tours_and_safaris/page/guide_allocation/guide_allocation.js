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
        <div id="calendar-container" class="table-responsive"></div>
    `);
	
	let currentWeekStart = moment().startOf('week');
	let instructorAssignments = {};
	let selectedTask = null;

	// Helper Methods
	const Methods = {
		async fetchExistingAllocations(weekStart) {
			const weekEnd = moment(weekStart).add(6, 'days');
			
			return new Promise((resolve, reject) => {
				// First get all Activity Allocation documents
				frappe.call({
					method: "frappe.client.get_list",
					args: {
						doctype: "Activity Allocation",
						fields: ["name", "customer", "activity_name", "start_date", "end_date"],
						filters: {
							start_date: ["<=", weekEnd.format("YYYY-MM-DD")],
							end_date: [">=", weekStart.format("YYYY-MM-DD")]
						}
					},
					callback: function(res) {
						if (res.message && res.message.length > 0) {
							// Fetch full documents to get child table data
							Promise.all(res.message.map(allocation => 
								Methods.fetchFullAllocation(allocation.name)
							)).then(fullAllocations => {
								resolve(fullAllocations.filter(doc => doc !== null));
							}).catch(err => {
								console.error("Error fetching full allocations:", err);
								resolve([]);
							});
						} else {
							resolve([]);
						}
					},
					error: function(err) {
						console.error("Error fetching existing allocations:", err);
						resolve([]);
					}
				});
			});
		},

		async fetchFullAllocation(allocationName) {
			return new Promise((resolve, reject) => {
				frappe.call({
					method: "frappe.client.get",
					args: {
						doctype: "Activity Allocation",
						name: allocationName
					},
					callback: function(res) {
						resolve(res.message || null);
					},
					error: function(err) {
						console.error("Error fetching full allocation:", err);
						resolve(null);
					}
				});
			});
		},

		populateInMemoryAssignments(allocations, weekStart) {
			// Clear existing assignments for this week
			instructorAssignments = {};
			
			allocations.forEach(allocation => {
				if (allocation.activity_allocation_details) {
					allocation.activity_allocation_details.forEach(detail => {
						const instructor = detail.instructor;
						const activityDate = moment(detail.activity_date);
						const dayIndex = activityDate.diff(weekStart, 'days');
						
						// Only process if within current week
						if (dayIndex >= 0 && dayIndex < 7) {
							const slot = this.getSlotFromSession(detail.session);
							
							if (!instructorAssignments[instructor]) {
								instructorAssignments[instructor] = [];
							}
							
							// Create a task-like object for display
							const taskObj = {
								name: allocation.name,
								subject: detail.activity_name || allocation.activity_name,
								custom_customer_name: allocation.customer,
								exp_start_date: allocation.start_date,
								exp_end_date: allocation.end_date
							};
							
							instructorAssignments[instructor].push({
								task: taskObj,
								dayIndex: dayIndex,
								slot: slot,
								allocationId: allocation.name
							});
						}
					});
				}
			});
		},

		getSlotFromSession(session) {
			// Map session values back to AM/PM
			const sessionToSlot = {
				"HALF DAY": "AM",
				"HALF DAY": "PM",
				"AM": "AM",
				"PM": "PM"
			};
			return sessionToSlot[session] || "AM";
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

		async fetchTasks() {
			return new Promise((resolve, reject) => {
				frappe.call({
					method: "frappe.client.get_list",
					args: {
						doctype: "Task",
						filters: {
							status: "Open",
							custom_is_activity: 1
						},
						fields: ["name", "subject", "custom_customer_name", "parent_task", "exp_start_date", "exp_end_date"]
					},
					callback: function(res) {
						resolve(res.message || []);
					},
					error: reject
				});
			});
		},

		async fetchInstructors() {
			return new Promise((resolve, reject) => {
				frappe.call({
					method: "frappe.client.get_list",
					args: {
						doctype: "Instructor",
						filters: { enabled: 1 },
						fields: ["name"]
					},
					callback: function(res) {
						resolve(res.message || []);
					},
					error: reject
				});
			});
		},

		async fetchInstructorQualification(instructorName, activityName) {
			return new Promise((resolve, reject) => {
				console.log(`Fetching qualification for instructor: ${instructorName}, activity: ${activityName}`);
				
				frappe.call({
					method: "frappe.client.get",
					args: {
						doctype: "Instructor",
						name: instructorName
					},
					callback: function(res) {
						const instructorDoc = res.message;
						let qualification = "";

						console.log("Full Instructor Doc:", instructorDoc); // Debug log

						if (instructorDoc) {
							// Check different possible field names for activity levels
							const activityLevels = instructorDoc.activity_levels || 
													instructorDoc.instructor_activity_levels || 
													instructorDoc.activities || 
													[];

							console.log("Activity Levels found:", activityLevels); // Debug log

							if (activityLevels && activityLevels.length > 0) {
								const activityRow = activityLevels.find(row => {
									// More flexible matching
									const rowActivity = row.activity_name || row.activity || row.name;
									console.log(`Comparing: "${rowActivity}" with "${activityName}"`);
									return rowActivity === activityName;
								});

								if (activityRow) {
									qualification = activityRow.qualification || 
													activityRow.level || 
													activityRow.qualification_level || 
													"";
									console.log("Found qualification:", qualification); // Debug log
								} else {
									console.log("No matching activity found. Available activities:", 
										activityLevels.map(row => row.activity_name || row.activity || row.name));
								}
							} else {
								console.log("No activity levels found. Available fields:", Object.keys(instructorDoc));
							}
						} else {
							console.log("No instructor document found");
						}
						
						resolve(qualification);
					},
					error: function(err) {
						console.error("Error fetching instructor:", err);
						resolve(""); // Return empty string on error rather than rejecting
					}
				});
			});
		},

		async checkExistingAllocation(task, activityDate, fullStart, instructorName) {
			return new Promise((resolve, reject) => {
				// Get all Activity Allocation documents and check their child tables
				frappe.call({
					method: "frappe.client.get_list",
					args: {
						doctype: "Activity Allocation",
						fields: ["name"]
					},
					callback: async function(res) {
						if (res.message && res.message.length > 0) {
							// Check each allocation's child table
							for (let allocation of res.message) {
								try {
									const fullDoc = await Methods.fetchFullAllocation(allocation.name);
									if (fullDoc && fullDoc.activity_allocation_details) {
										const existing = fullDoc.activity_allocation_details.find(detail =>
											detail.activity_date === activityDate &&
											detail.start_time === fullStart &&
											detail.instructor === instructorName
										);
										if (existing) {
											resolve(fullDoc);
											return;
										}
									}
								} catch (err) {
									console.error("Error checking allocation:", err);
								}
							}
							resolve(null);
						} else {
							resolve(null);
						}
					},
					error: function(err) {
						console.error("Error checking existing allocation:", err);
						resolve(null);
					}
				});
			});
		},

		async createActivityAllocation(task, activityDate, slot, instructorName, qualification) {
			const startTime = slot === "AM" ? "08:00:00" : "13:30:00";
			const endTime = slot === "AM" ? "12:30:00" : "17:30:00";
			
			// Map slot to proper session values (check your DocType for exact values)
			const sessionMapping = {
				"AM": "Morning",  // or whatever the exact value is in your DocType
				"PM": "Afternoon" // or whatever the exact value is in your DocType
			};

			return new Promise((resolve, reject) => {
				frappe.call({
					method: "frappe.client.insert",
					args: {
						doc: {
							doctype: "Activity Allocation",
							customer: task.custom_customer_name,
							activity_name: task.subject,
							start_date: task.exp_start_date,
							end_date: task.exp_end_date,
							activity_allocation_details: [
								{
									activity_name: task.subject,  // Added this field
									activity_date: activityDate,
									session: sessionMapping[slot] || slot,
									start_time: `${activityDate} ${startTime}`,
									end_time: `${activityDate} ${endTime}`,
									qualification: qualification || "",
									instructor: instructorName
								}
							]
						}
					},
					callback: function(res) {
						if (res.message) {
							resolve(res.message);
						} else {
							reject(new Error("Failed to create Activity Allocation"));
						}
					},
					error: function(err) {
						console.error("Frappe call error:", err);
						reject(err);
					}
				});
			});
		},

		async deleteActivityAllocation(instructor, activityDate, fullStart) {
			return new Promise((resolve, reject) => {
				// Get all Activity Allocation documents and find the one to delete
				frappe.call({
					method: "frappe.client.get_list",
					args: {
						doctype: "Activity Allocation",
						fields: ["name"]
					},
					callback: async function(res) {
						if (res.message && res.message.length > 0) {
							// Check each allocation's child table
							for (let allocation of res.message) {
								try {
									const fullDoc = await Methods.fetchFullAllocation(allocation.name);
									if (fullDoc && fullDoc.activity_allocation_details) {
										const hasMatchingDetail = fullDoc.activity_allocation_details.some(detail =>
											detail.instructor === instructor &&
											detail.activity_date === activityDate &&
											detail.start_time === fullStart
										);
										
										if (hasMatchingDetail) {
											// Delete the entire Activity Allocation document
											frappe.call({
												method: "frappe.client.delete",
												args: {
													doctype: "Activity Allocation",
													name: fullDoc.name
												},
												callback: function() {
													resolve(true);
												},
												error: function(err) {
													console.error("Error deleting allocation:", err);
													resolve(false);
												}
											});
											return;
										}
									}
								} catch (err) {
									console.error("Error checking allocation for deletion:", err);
								}
							}
							resolve(false); // No matching allocation found
						} else {
							resolve(false);
						}
					},
					error: function(err) {
						console.error("Error finding allocation to delete:", err);
						resolve(false);
					}
				});
			});
		},

		getWeekDays() {
			const weekDays = [];
			for (let i = 0; i < 7; i++) {
				weekDays.push(moment(currentWeekStart).add(i, 'days'));
			}
			return weekDays;
		},

		getTaskForSlot(tasksToRender, day, slot) {
			const amStart = day.clone().hour(8).minute(0);
			const amEnd = day.clone().hour(12).minute(30);
			const pmStart = day.clone().hour(13).minute(30);
			const pmEnd = day.clone().hour(17).minute(30);

			const startRange = slot === "AM" ? amStart : pmStart;
			const endRange = slot === "AM" ? amEnd : pmEnd;

			return tasksToRender.find(task => {
				const start = moment(task.exp_start_date);
				const end = moment(task.exp_end_date || task.exp_start_date);
				return endRange.isSameOrAfter(start) && startRange.isSameOrBefore(end);
			});
		},

		makeTaskCellClickable(task, dayIndex, slot, color) {
			return `<td class="assignable-cell" 
						data-task='${JSON.stringify(task)}'
						data-day-index="${dayIndex}" 
						data-slot="${slot}" 
						style="background-color: ${color}; cursor: pointer;">
						${task.subject}
					</td>`;
		}
	};

	// Main Functions
	async function loadTasksAndRenderCalendar() {
		try {
			const [tasks, instructors, existingAllocations] = await Promise.all([
				Methods.fetchTasks(),
				Methods.fetchInstructors(),
				Methods.fetchExistingAllocations(currentWeekStart)
			]);
			
			// Populate in-memory assignments from existing data
			Methods.populateInMemoryAssignments.call(Methods, existingAllocations, currentWeekStart);
			
			renderCalendar(tasks, instructors);
		} catch (error) {
			console.error('Error loading data:', error);
			frappe.show_alert("Error loading data", 5);
		}
	}
	
	function renderCalendar(tasks, instructors) {
		const weekDays = Methods.getWeekDays();
		$('#week-range-title').text(`${weekDays[0].format('MMM D')} - ${weekDays[6].format('MMM D, YYYY')}`);

		const customerMap = {};
		const taskMap = {};

		// Group tasks by customer and map by name
		tasks.forEach(task => {
			const customer = task.custom_customer_name || "Unknown";
			if (!customerMap[customer]) customerMap[customer] = [];
			customerMap[customer].push(task);
			taskMap[task.name] = task;
		});

		let html = '<div style="overflow-x: auto;"><table class="table table-bordered"><thead><tr><th>Customer / Instructor</th>';
		weekDays.forEach(day => {
			html += `<th>${day.format('ddd D')}<br>AM</th><th>${day.format('ddd D')}<br>PM</th>`;
		});
		html += '</tr></thead><tbody>';

		function renderTaskRow(nameLabel, tasksToRender, color, indent = false) {
			html += `<tr><td style="background-color: ${color}; padding-left: ${indent ? '20px' : '0'};">${nameLabel}</td>`;
			weekDays.forEach((day, dayIndex) => {
				const taskAM = Methods.getTaskForSlot(tasksToRender, day, "AM");
				const taskPM = Methods.getTaskForSlot(tasksToRender, day, "PM");

				html += taskAM ? Methods.makeTaskCellClickable(taskAM, dayIndex, "AM", color) : `<td></td>`;
				html += taskPM ? Methods.makeTaskCellClickable(taskPM, dayIndex, "PM", color) : `<td></td>`;
			});
			html += '</tr>';
		}

		// Add styles
		if (!document.getElementById('calendar-styles')) {
			const style = document.createElement('style');
			style.id = 'calendar-styles';
			style.innerHTML = `
				#calendar-container {
					overflow-x: auto;
					white-space: nowrap;
				}
				.table thead th, .table tbody td {
					white-space: nowrap;
					min-width: 120px;
					text-align: center;
				}
			`;
			document.head.appendChild(style);
		}

		// Render customer rows
		for (const [customer, custTasks] of Object.entries(customerMap)) {
			const color = Methods.getColorForCustomer(customer);
			const mainTasks = custTasks.filter(t => !t.parent_task);
			const subTasks = custTasks.filter(t => t.parent_task);

			renderTaskRow(`<strong>${customer}</strong>`, mainTasks, color);

			subTasks.forEach(sub => {
				if (!sub.subject && sub.parent_task && taskMap[sub.parent_task]) {
					sub.subject = taskMap[sub.parent_task].subject;
				}
				const parent = taskMap[sub.parent_task];
				const parentCustomer = parent?.custom_customer_name || sub.custom_customer_name;
				const colorForSub = Methods.getColorForCustomer(parentCustomer);
				renderTaskRow(`↳ ${sub.custom_customer_name}`, [sub], colorForSub, true);
			});
		}

		// Render instructor rows
		instructors.forEach(instr => {
			html += `<tr><td><span class="text-primary">— ${instr.name}</span></td>`;
			for (let i = 0; i < 7; i++) {
				["AM", "PM"].forEach(slot => {
					const assignedTask = (instructorAssignments[instr.name] || []).find(a => a.dayIndex === i && a.slot === slot);
					if (assignedTask) {
						html += `<td class="assigned-task" data-instructor="${instr.name}" data-day-index="${i}" data-slot="${slot}" style="background-color: ${Methods.getColorForCustomer(assignedTask.task.custom_customer_name)}; cursor: pointer;">
									${assignedTask.task.subject} <span style="color:red;cursor:pointer;">&times;</span>
								 </td>`;
					} else {
						html += `<td></td>`;
					}
				});
			}
			html += '</tr>';
		});

		html += '</tbody></table></div>';
		$('#calendar-container').html(html);
	}

	// Event Handlers
	async function handleTaskAssignment(cell) {
		if (!selectedTask) return;

		const parentRow = cell.closest('tr');
		const isInstructorRow = parentRow.find('td:first').text().trim().startsWith("—");

		if (isInstructorRow && cell.is(':empty')) {
			const instructorName = parentRow.find('td:first').text().replace("—", "").trim();
			const dayIndex = Math.floor(cell.index() / 2 - 0.5);
			const slot = cell.index() % 2 === 1 ? "AM" : "PM";
			const activityDate = moment(currentWeekStart).add(dayIndex, 'days').format("YYYY-MM-DD");
			const startTime = slot === "AM" ? "08:00:00" : "13:30:00";
			const fullStart = `${activityDate} ${startTime}`;

			try {
				// Check if allocation already exists
				const existing = await Methods.checkExistingAllocation(selectedTask, activityDate, fullStart, instructorName);
				if (existing) {
					frappe.show_alert("Activity Allocation already exists", 3);
					return;
				}

				// Fetch instructor qualification
				const qualification = await Methods.fetchInstructorQualification(instructorName, selectedTask.subject);

				// Create activity allocation
				await Methods.createActivityAllocation(selectedTask, activityDate, slot, instructorName, qualification);

				// Update in-memory assignments
				if (!instructorAssignments[instructorName]) {
					instructorAssignments[instructorName] = [];
				}
				instructorAssignments[instructorName].push({
					task: selectedTask,
					dayIndex: dayIndex,
					slot: slot
				});

				frappe.show_alert(`Activity Allocation created for ${instructorName}`, 3);
				console.log(`Created activity for: ${selectedTask.subject}`);
				loadTasksAndRenderCalendar();

			} catch (error) {
				console.error('Error creating assignment:', error);
				frappe.show_alert("Error creating assignment", 5);
			}

			selectedTask = null;
		}
	}

	async function handleTaskRemoval(element) {
		const instructor = element.data('instructor');
		const dayIndex = parseInt(element.data('dayIndex'));
		const slot = element.data('slot');
		const activityDate = moment(currentWeekStart).add(dayIndex, 'days').format("YYYY-MM-DD");
		const startTime = slot === "AM" ? "08:00:00" : "13:30:00";
		const fullStart = `${activityDate} ${startTime}`;

		try {
			// Remove from in-memory
			if (instructorAssignments[instructor]) {
				instructorAssignments[instructor] = instructorAssignments[instructor].filter(a =>
					!(a.dayIndex === dayIndex && a.slot === slot)
				);
			}

			// Delete from backend
			const deleted = await Methods.deleteActivityAllocation(instructor, activityDate, fullStart);
			if (deleted) {
				frappe.show_alert("Activity Allocation deleted", 3);
			}
			loadTasksAndRenderCalendar();

		} catch (error) {
			console.error('Error removing assignment:', error);
			frappe.show_alert("Error removing assignment", 5);
		}
	}

	// Event Listeners
	$('#calendar-container').on('click', '.assignable-cell', function () {
		const task = JSON.parse($(this).attr('data-task'));
		selectedTask = task;
		frappe.show_alert(`Selected: ${task.subject}`, 2);
	});

	$('#calendar-container').on('click', 'td', function () {
		handleTaskAssignment($(this));
	});

	$('#calendar-container').on('click', '.assigned-task', function () {
		handleTaskRemoval($(this));
	});

	$('#prev-week').on('click', function() {
		currentWeekStart.subtract(1, 'week');
		loadTasksAndRenderCalendar();
	});

	$('#next-week').on('click', function() {
		currentWeekStart.add(1, 'week');
		loadTasksAndRenderCalendar();
	});

	// Initialize
	loadTasksAndRenderCalendar();
}