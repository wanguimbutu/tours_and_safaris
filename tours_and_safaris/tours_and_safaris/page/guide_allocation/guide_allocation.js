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
	let instructorAssignments = {};
	let selectedTask = null;
	let customerTasks = {};

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

		async fetchTasks(weekStart) {
			const weekEnd = moment(weekStart).add(6, 'days');
			const isPastWeek = moment(weekStart).isBefore(moment().startOf('week'));
			const isFutureWeek = moment(weekStart).isAfter(moment().endOf('week'));
		
			const taskFilters = {
				custom_is_activity: 1,
			};
		
			if (isPastWeek) {
				// Show all statuses (no status filter)
			} else if (isFutureWeek) {
				taskFilters.status = "Open"; // Future = only upcoming Open
			} else {
				taskFilters.status = ["in", ["Open", "Working"]]; // Current = Open + Working
			}
		
			// Add date overlap filters
			taskFilters.exp_start_date = ["<=", weekEnd.format("YYYY-MM-DD")];
			taskFilters.exp_end_date = [">=", weekStart.format("YYYY-MM-DD")];
		
			// Fetch tasks
			const parentTasks = await frappe.call('frappe.client.get_list', {
				doctype: "Task",
				filters: taskFilters,
				fields: [
					"name", "subject", "custom_customer_name", "custom_customer",
					"parent_task", "exp_start_date", "exp_end_date", "custom_no_of_people"
				]
			}).then(res => res.message || []);
		
			// Fetch full tasks to inspect dependencies
			const fullParentTasks = await Promise.all(parentTasks.map(task => {
				return frappe.call('frappe.client.get', {
					doctype: "Task",
					name: task.name
				}).then(res => res.message || task).catch(() => task);
			}));
		
			// Add subtasks from depends_on
			const allTasks = [...parentTasks];
			for (const parent of fullParentTasks) {
				if (parent.depends_on && Array.isArray(parent.depends_on)) {
					for (const dep of parent.depends_on) {
						if (dep.task) {
							const subtask = await frappe.call('frappe.client.get', {
								doctype: "Task",
								name: dep.task
							}).then(res => {
								const st = res.message;
								if (st) {
									st.parent_task = parent.name;
									st.custom_customer_name = st.custom_customer_name || parent.custom_customer_name;
									st.exp_start_date = st.exp_start_date || parent.exp_start_date;
									st.exp_end_date = st.exp_end_date || parent.exp_end_date;
								}
								return st;
							}).catch(() => null);
							if (subtask) {
								allTasks.push(subtask);
							}
						}
					}
				}
			}
		
			return allTasks;
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
							// Check all possible field names for activity levels in child table
							const possibleFieldNames = [
								'activity_levels', 
								'instructor_activity_levels', 
								'activities',
								'activity_qualifications',
								'qualifications'
							];
		
							let activityLevels = null;
							
							// Find the correct field name
							for (const fieldName of possibleFieldNames) {
								if (instructorDoc[fieldName] && Array.isArray(instructorDoc[fieldName])) {
									activityLevels = instructorDoc[fieldName];
									console.log(`Found activity levels in field: ${fieldName}`, activityLevels);
									break;
								}
							}
		
							if (activityLevels && activityLevels.length > 0) {
								console.log("Available activities in instructor doc:", 
									activityLevels.map(row => {
										// Log all possible activity name fields
										return {
											activity_name: row.activity_name,
											activity: row.activity,
											name: row.name,
											activity_type: row.activity_type
										};
									})
								);
		
								// Try different matching strategies
								let activityRow = null;
		
								// Strategy 1: Exact match on activity_name
								activityRow = activityLevels.find(row => {
									const rowActivity = row.activity_name || row.activity || row.name || row.activity_type;
									return rowActivity === activityName;
								});
		
								// Strategy 2: Case insensitive match
								if (!activityRow) {
									activityRow = activityLevels.find(row => {
										const rowActivity = (row.activity_name || row.activity || row.name || row.activity_type || '').toLowerCase();
										return rowActivity === activityName.toLowerCase();
									});
								}
		
								// Strategy 3: Partial match (contains)
								if (!activityRow) {
									activityRow = activityLevels.find(row => {
										const rowActivity = (row.activity_name || row.activity || row.name || row.activity_type || '').toLowerCase();
										return rowActivity.includes(activityName.toLowerCase()) || 
											   activityName.toLowerCase().includes(rowActivity);
									});
								}
		
								// Strategy 4: Match base activity name (remove "- Group X" suffix)
								if (!activityRow) {
									const baseActivityName = activityName.split(' - Group')[0].trim();
									console.log(`Trying base activity name: ${baseActivityName}`);
									
									activityRow = activityLevels.find(row => {
										const rowActivity = row.activity_name || row.activity || row.name || row.activity_type;
										return rowActivity === baseActivityName || 
											   (rowActivity && rowActivity.toLowerCase() === baseActivityName.toLowerCase());
									});
								}
		
								if (activityRow) {
									// Try different qualification field names
									qualification = activityRow.qualification || 
													activityRow.level || 
													activityRow.qualification_level ||
													activityRow.instructor_level ||
													activityRow.competency_level ||
													"";
									console.log("Found qualification:", qualification);
								} else {
									console.log("No matching activity found. Available activities:", 
										activityLevels.map(row => ({
											activity_name: row.activity_name,
											activity: row.activity,
											name: row.name,
											activity_type: row.activity_type
										}))
									);
								}
							} else {
								console.log("No activity levels found. Available fields:", Object.keys(instructorDoc));
								
								// Check if there are any fields that might contain activity data
								const potentialFields = Object.keys(instructorDoc).filter(key => 
									key.toLowerCase().includes('activity') || 
									key.toLowerCase().includes('qualification') ||
									key.toLowerCase().includes('level')
								);
								console.log("Potential activity/qualification fields:", potentialFields);
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
		
		// Enhanced version that also checks the DocType structure
		async fetchInstructorQualificationEnhanced(instructorName, activityName) {
			return new Promise((resolve, reject) => {
				console.log(`Fetching qualification for instructor: ${instructorName}, activity: ${activityName}`);
				
				// First, let's get the DocType structure to understand the fields
				frappe.call({
					method: "frappe.client.get_meta",
					args: {
						doctype: "Instructor"
					},
					callback: function(metaRes) {
						console.log("Instructor DocType Meta:", metaRes.message);
						
						// Now get the actual instructor document
						frappe.call({
							method: "frappe.client.get",
							args: {
								doctype: "Instructor",
								name: instructorName
							},
							callback: function(res) {
								const instructorDoc = res.message;
								let qualification = "";
		
								if (instructorDoc) {
									console.log("Full Instructor Doc:", instructorDoc);
									
									// If we have meta information, use it to find child table fields
									if (metaRes.message && metaRes.message.fields) {
										const childTableFields = metaRes.message.fields.filter(field => 
											field.fieldtype === 'Table'
										);
										console.log("Child table fields found:", childTableFields.map(f => f.fieldname));
										
										// Check each child table field
										for (const field of childTableFields) {
											const childData = instructorDoc[field.fieldname];
											if (childData && Array.isArray(childData)) {
												console.log(`Checking child table: ${field.fieldname}`, childData);
												
												const activityRow = childData.find(row => {
													const baseActivityName = activityName.split(' - Group')[0].trim();
													const rowActivity = row.activity_name || row.activity || row.name;
													return rowActivity === activityName || rowActivity === baseActivityName;
												});
												
												if (activityRow) {
													qualification = activityRow.qualification || 
																	activityRow.level || 
																	activityRow.qualification_level ||
																	"";
													console.log(`Found qualification in ${field.fieldname}:`, qualification);
													break;
												}
											}
										}
									}
								}
								
								resolve(qualification);
							},
							error: function(err) {
								console.error("Error fetching instructor:", err);
								resolve("");
							}
						});
					},
					error: function(err) {
						console.error("Error fetching instructor meta:", err);
						// Fallback to original method
						resolve("");
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
			const fullSubject = task.subject || "";
			const baseActivityName = fullSubject.split(" - Group")[0].trim() || fullSubject;

			// Map slot to proper session values (check your DocType for exact values)
			const sessionMapping = {
				"AM": "HALF DAY",  // or whatever the exact value is in your DocType
				"PM": "HALF DAY" // or whatever the exact value is in your DocType
			};
			
			return new Promise((resolve, reject) => {
				frappe.call({
					method: "frappe.client.insert",
					args: {
						doc: {
							doctype: "Activity Allocation",
							customer: task.custom_customer,
							activity_name: baseActivityName,	
							start_date: task.exp_start_date,
							end_date: task.exp_end_date,
							activity_allocation_details: [
								{
									activity_name: baseActivityName,  // Added this field
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

		async createSubtasks(parentTask, numberOfGroups) {
			const totalPeople = parentTask.custom_no_of_people || 0;
			const peoplePerGroup = Math.ceil(totalPeople / numberOfGroups);
			const subtasks = [];

			for (let i = 0; i < numberOfGroups; i++) {
				const startPerson = i * peoplePerGroup + 1;
				const endPerson = Math.min((i + 1) * peoplePerGroup, totalPeople);
				const groupSize = endPerson - startPerson + 1;

				const subtaskData = {
					doctype: "Task",
					subject: `${parentTask.subject} - Group ${i + 1}`,
					parent_task: parentTask.name,
					custom_customer_name: parentTask.custom_customer_name,
					custom_customer: parentTask.custom_customer,	
					custom_is_activity: 1,
					custom_no_of_people: groupSize,
					exp_start_date: parentTask.exp_start_date,
					exp_end_date: parentTask.exp_end_date,
					status: "Open"
				};

				try {
					const result = await new Promise((resolve, reject) => {
						frappe.call({
							method: "frappe.client.insert",
							args: { doc: subtaskData },
							callback: function(res) {
								if (res.message) {
									resolve(res.message);
								} else {
									reject(new Error("Failed to create subtask"));
								}
							},
							error: reject
						});
					});
					subtasks.push(result);
				} catch (error) {
					console.error(`Error creating subtask ${i + 1}:`, error);
					frappe.show_alert(`Error creating Group ${i + 1}`, 5);
				}
			}

			return subtasks;
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
			const peopleInfo = task.custom_no_of_people ? ` (${task.custom_no_of_people} people)` : '';
			return `<td class="assignable-cell" 
						data-task='${JSON.stringify(task)}'
						data-day-index="${dayIndex}" 
						data-slot="${slot}" 
						style="background-color: ${color}; cursor: pointer;">
						${task.subject}${peopleInfo}
					</td>`;
		},

		filterTasksForCurrentWeek(tasks, weekStart) {
			const weekEnd = moment(weekStart).add(6, 'days');
			return tasks.filter(task => {
				// Ensure the task has a start date; if not, skip it.
				if (!task.exp_start_date) return false;
				const taskStart = moment(task.exp_start_date);
				const taskEnd = moment(task.exp_end_date || task.exp_start_date);
				// Use inclusive boundaries to catch tasks that start or end on the week's edges.
				return taskStart.isBetween(weekStart, weekEnd, 'day', '[]') ||
					   taskEnd.isBetween(weekStart, weekEnd, 'day', '[]') ||
					   (taskStart.isBefore(weekStart) && taskEnd.isAfter(weekEnd));
			});
		},
		

		// New method to fetch and submit draft allocations
		async fetchDraftAllocations(weekStart) {
			const weekEnd = moment(weekStart).add(6, 'days');
			
			return new Promise((resolve, reject) => {
				frappe.call({
					method: "frappe.client.get_list",
					args: {
						doctype: "Activity Allocation",
						fields: ["name", "docstatus"],
						filters: {
							start_date: ["<=", weekEnd.format("YYYY-MM-DD")],
							end_date: [">=", weekStart.format("YYYY-MM-DD")],
							docstatus: 0  // Draft status
						}
					},
					callback: function(res) {
						resolve(res.message || []);
					},
					error: function(err) {
						console.error("Error fetching draft allocations:", err);
						resolve([]);
					}
				});
			});
		},

		async submitAllocation(docName) {
			return new Promise((resolve, reject) => {
				frappe.call({
					method: "frappe.client.submit",
					args: {
						doctype: "Activity Allocation",
						name: docName
					},
					callback: function(res) {
						resolve(res.message);
					},
					error: function(err) {
						console.error(`Error submitting ${docName}:`, err);
						reject(err);
					}
				});
			});
		}
	};

	// Modal Functions
	function populateCustomerDropdown(tasks) {
		const customers = [...new Set(tasks.map(t => t.custom_customer_name).filter(c => c))];
		const customerSelect = $('#customerSelect');
		customerSelect.empty().append('<option value="">Choose a customer...</option>');
		
		customers.forEach(customer => {
			customerSelect.append(`<option value="${customer}">${customer}</option>`);
		});
	}

	function populateParentTaskDropdown(customer, tasks) {
		const customerTasks = tasks.filter(t => 
			t.custom_customer_name === customer && 
			(!t.parent_task || t.parent_task === "" || t.parent_task === null) && 
			t.custom_no_of_people > 0
		);
		
		const taskSelect = $('#parentTaskSelect');
		taskSelect.empty().append('<option value="">Choose an activity...</option>');
		
		customerTasks.forEach(task => {
			taskSelect.append(`<option value="${task.name}" data-people="${task.custom_no_of_people}">${task.subject} (${task.custom_no_of_people} people)</option>`);
		});
	}

	function updateGroupPreview() {
		const numberOfGroups = parseInt($('#numberOfGroups').val()) || 0;
		const totalPeople = parseInt($('#totalPeople').val()) || 0;
		
		if (numberOfGroups > 0 && totalPeople > 0) {
			const peoplePerGroup = Math.ceil(totalPeople / numberOfGroups);
			let previewHtml = '<h6>Group Preview:</h6><ul>';
			
			for (let i = 0; i < numberOfGroups; i++) {
				const startPerson = i * peoplePerGroup + 1;
				const endPerson = Math.min((i + 1) * peoplePerGroup, totalPeople);
				const groupSize = endPerson - startPerson + 1;
				previewHtml += `<li>Group ${i + 1}: ${groupSize} people</li>`;
			}
			
			previewHtml += '</ul>';
			$('#groupPreview').html(previewHtml);
		} else {
			$('#groupPreview').empty();
		}
	}

	// Main Functions
	async function loadTasksAndRenderCalendar() {
		try {
			// Pass the current week start so fetchTasks can adjust its filter
			const [allTasks, instructors, existingAllocations] = await Promise.all([
				Methods.fetchTasks(currentWeekStart),
				Methods.fetchInstructors(),
				Methods.fetchExistingAllocations(currentWeekStart)
			]);
			
			// Filter the tasks for display by the current week dates.
			//const tasksForWeek = Methods.filterTasksForCurrentWeek(allTasks, currentWeekStart);
			const tasksForWeek = allTasks;

			// Populate the in-memory assignments (for instructor rows)
			Methods.populateInMemoryAssignments.call(Methods, existingAllocations, currentWeekStart);
			
			// Store all customer tasks for the modal (even if they have no assignments)
			customerTasks = allTasks;
			
			// Render the calendar passing the tasks for this week and the instructors
			renderCalendar(tasksForWeek, instructors);
		} catch (error) {
			console.error('Error loading data:', error);
			frappe.show_alert("Error loading data", 5);
		}
	}
	
	
	function renderCalendar(tasks, instructors) {
		const weekDays = Methods.getWeekDays();
		$('#week-range-title').text(`${weekDays[0].format('MMM D')} - ${weekDays[6].format('MMM D, YYYY')}`);
	
		// Group tasks by customer and split into main and sub tasks
		const customerMap = {};
		const taskMap = {}; // For easy access to parent task names
	
		tasks.forEach(task => {
			const customer = task.custom_customer_name || "Unknown";
			if (!customerMap[customer]) {
				customerMap[customer] = { main: [], sub: [] };
			}
			
			if (!task.parent_task || !taskMap[task.parent_task]) {
				// Only add if not already added
				if (!customerMap[customer].main.some(t => t.name === task.name)) {
					customerMap[customer].main.push(task);
				}
			} else {
				// Only add if not already added
				if (!customerMap[customer].sub.some(t => t.name === task.name)) {
					customerMap[customer].sub.push(task);
				}
			}
			
			
	
			taskMap[task.name] = task;
		});
	
		let html = '<div style="overflow-x: auto;"><table class="table table-bordered"><thead><tr><th>Customer / Instructor</th>';
		weekDays.forEach(day => {
			html += `<th>${day.format('ddd D')}<br>AM</th><th>${day.format('ddd D')}<br>PM</th>`;
		});
		html += '</tr></thead><tbody>';
	
		// Helper to render a row for tasks (main, parent, sub)
		function renderTaskRow(label, tasksToRender, color, indent = false) {
			html += `<tr><td style="background-color: ${color}; padding-left: ${indent ? '20px' : '0'};">${label}</td>`;
			weekDays.forEach((day, dayIndex) => {
				const taskAM = Methods.getTaskForSlot(tasksToRender, day, "AM");
				const taskPM = Methods.getTaskForSlot(tasksToRender, day, "PM");
	
				html += taskAM ? Methods.makeTaskCellClickable(taskAM, dayIndex, "AM", color) : `<td></td>`;
				html += taskPM ? Methods.makeTaskCellClickable(taskPM, dayIndex, "PM", color) : `<td></td>`;
			});
			html += '</tr>';
		}
	
		// Render customers
		for (const [customer, grouped] of Object.entries(customerMap)) {
			const color = Methods.getColorForCustomer(customer);
	
			// Always render the customer header row
			renderTaskRow(`<strong>${customer}</strong>`, grouped.main, color);
	
			// Group subtasks by parent
			const subtasksByParent = {};
			grouped.sub.forEach(sub => {
				const parentId = sub.parent_task;
				if (!subtasksByParent[parentId]) {
					subtasksByParent[parentId] = [];
				}
				subtasksByParent[parentId].push(sub);
			});
	
			const renderedParents = new Set();  // Track which parents are already rendered

			Object.entries(subtasksByParent).forEach(([parentId, subList]) => {
				// Avoid rendering parent again if it's already in the main list
				if (renderedParents.has(parentId)) return;

				const parent = taskMap[parentId];
				const parentLabel = parent ? parent.subject : `Parent (${parentId})`;

				if (parent) {
					renderTaskRow(`&nbsp;&nbsp;➤ ${parentLabel}`, [parent], color, true);
					renderedParents.add(parentId);
				}

				subList.forEach(sub => {
					renderTaskRow(`&nbsp;&nbsp;&nbsp;&nbsp;↳ ${sub.subject || 'Unnamed Subtask'}`, [sub], color, true);
				});
			});

		}
	
		// Render instructor rows from existing allocations
		instructors.forEach(instr => {
			html += `<tr><td><span class="text-primary">— ${instr.name}</span></td>`;
			for (let i = 0; i < 7; i++) {
				["AM", "PM"].forEach(slot => {
					const assignedTask = (instructorAssignments[instr.name] || []).find(
						a => a.dayIndex === i && a.slot === slot
					);
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
		const dayIndex = parseInt(element.data('day-index'));
		const slot = element.data('slot');
	
		// Get the date from the calendar cell
		const activityDate = moment(currentWeekStart).add(dayIndex, 'days').format("YYYY-MM-DD");
	
		// Get activity_name from the assigned task
		const assignment = (instructorAssignments[instructor] || []).find(
			a => a.dayIndex === dayIndex && a.slot === slot
		);
	
		if (!assignment || !assignment.task || !assignment.task.subject) {
			frappe.show_alert("Assignment info not found", 5);
			return;
		}
	
		// Clean base activity name (remove group label if present)
		const activityName = assignment.task.subject.split(" - Group")[0].trim();
	
		console.log("Removing via backend:", { instructor, activityDate, activityName });
	
		try {
			const res = await frappe.call({
				method: "tours_and_safaris.tours_and_safaris.page.guide_allocation.guide_allocation.remove_activity_allocation",  // replace with your actual method or Server Script name
				args: {
					instructor: instructor,
					activity_date: activityDate,
					activity_name: activityName
				}
			});
	
			const deleted = res.message;
	
			if (deleted.status === "deleted" || deleted.status === "updated") {
				frappe.show_alert("Activity Allocation removed", 3);
	
				// Remove from memory only after successful backend removal
				instructorAssignments[instructor] = instructorAssignments[instructor].filter(a =>
					!(a.dayIndex === dayIndex && a.slot === slot)
				);
	
				loadTasksAndRenderCalendar();
			} else {
				frappe.show_alert("Could not find matching allocation", 5);
			}
		} catch (error) {
			console.error("Error removing allocation:", error);
			frappe.show_alert("Error removing allocation", 5);
		}
	}
	
	

	// Event Listeners
	$('#create-groups').on('click', function() {
		populateCustomerDropdown(customerTasks);
		$('#groupCreationModal').modal('show');
	});

	$('#customerSelect').on('change', function() {
		const selectedCustomer = $(this).val();
		if (selectedCustomer) {
			populateParentTaskDropdown(selectedCustomer, customerTasks);
		} else {
			$('#parentTaskSelect').empty().append('<option value="">Choose an activity...</option>');
			$('#totalPeople').val('');
		}
		$('#groupPreview').empty();
	});

	$('#parentTaskSelect').on('change', function() {
		const selectedOption = $(this).find('option:selected');
		const people = selectedOption.data('people') || 0;
		$('#totalPeople').val(people);
		updateGroupPreview();
	});

	$('#numberOfGroups').on('input', function() {
		updateGroupPreview();
	});

	$('#createGroupsBtn').off('click').on('click', async function() {
		const customerName = $('#customerSelect').val();
		const parentTaskName = $('#parentTaskSelect').val();
		const numberOfGroups = parseInt($('#numberOfGroups').val());

		if (!customerName || !parentTaskName || !numberOfGroups || numberOfGroups < 1) {
			frappe.show_alert("Please fill all required fields", 5);
			return;
		}

		const parentTask = customerTasks.find(t => t.name === parentTaskName);
		if (!parentTask) {
			frappe.show_alert("Parent task not found", 5);
			return;
		}

		try {
			$(this).prop('disabled', true).text('Creating Groups...');
			
			const createdSubtasks = await Methods.createSubtasks(parentTask, numberOfGroups);
			
			if (createdSubtasks.length > 0) {
				frappe.show_alert(`Successfully created ${createdSubtasks.length} groups`, 3);
				$('#groupCreationModal').modal('hide');
				
				// Clear form
				$('#customerSelect').val('');
				$('#parentTaskSelect').empty().append('<option value="">Choose an activity...</option>');
				$('#totalPeople').val('');
				$('#numberOfGroups').val('');
				$('#groupPreview').empty();
				
				// Reload calendar to show new subtasks
				loadTasksAndRenderCalendar();
			} else {
				frappe.show_alert("No groups were created", 5);
			}
		} catch (error) {
			console.error('Error creating groups:', error);
			frappe.show_alert("Error creating groups", 5);
		} finally {
			$(this).prop('disabled', false).text('Create Groups');
		}
	});

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