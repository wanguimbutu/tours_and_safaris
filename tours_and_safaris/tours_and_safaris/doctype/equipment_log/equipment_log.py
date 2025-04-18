# Copyright (c) 2025, wanguimbutu and contributors
# For license information, please see license.txt

from frappe.model.document import Document
import frappe

class EquipmentLog(Document):
    def on_submit(self):
        frappe.logger().info(f"Submitting Equipment Log: {self.name}")

        # --- Handle Itemized Equipment ---
        for row in self.itemized_equipment_issue:
            if row.select and row.serial_number and row.equipment_name:
                equipment_doc = frappe.get_doc("Equipment", row.equipment_name)
                for detail in equipment_doc.equipment_details:
                    if detail.serial_number == row.serial_number:
                        detail.status = "Issued" if self.equipment_state == "Issued" else "Available"
                        break
                equipment_doc.save(ignore_permissions=True)
                frappe.logger().info(f"{row.serial_number} of {row.equipment_name} marked as '{detail.status}'")

        # --- Handle Unitemized Equipment ---
        for row in self.unitemized_equipment_issue:
            if row.equipment_name and row.quantity_issued:
                equipment_doc = frappe.get_doc("Equipment", row.equipment_name)
                current_available = equipment_doc.number_available or 0
                if self.equipment_state == "Issued":
                    new_available = max(current_available - row.quantity_issued, 0)
                else:  # Returned
                    new_available = current_available + row.quantity_issued
                equipment_doc.number_available = new_available
                equipment_doc.save(ignore_permissions=True)
                frappe.logger().info(f"Updated available count of {row.equipment_name} to {new_available}")

        # --- Update Task Status ---
        if self.task_name:
            try:
                task = frappe.get_doc("Task", self.task_name)

                if self.equipment_state == "Issued":
                    if task.status != "Working":
                        task.status = "Working"
                        task.save(ignore_permissions=True)
                        frappe.logger().info(f"Task {self.task_name} marked as 'Working'")

                elif self.equipment_state == "Returned":
                    # Check if all logs for this task are returned
                    logs = frappe.get_all(
                        "Equipment Log",
                        filters={"task_name": self.task_name},
                        fields=["name", "equipment_state"]
                    )

                    all_returned = all(log.equipment_state == "Returned" for log in logs)
                    if all_returned:
                        task.status = "Completed"  # or "Returned"
                        task.save(ignore_permissions=True)
                        frappe.logger().info(f"All equipment returned. Task {self.task_name} marked as 'Completed'")

            except Exception as e:
                frappe.log_error(frappe.get_traceback(), "Failed to update Task status")
                frappe.throw(f"Could not update Task {self.task_name}: {e}")
        
        if not self.packing_list:
            return

        # Fetch the linked Packing List document
        packing_list = frappe.get_doc("Packing List", self.packing_list)

        for item in self.itemized_equipment_issue:
            packing_list.append("trip_equipment", {
                "equipment_name": item.equipment_name,
                "serial_number": item.serial_number,
                "equipment_log": self.name
            })
        
        for item in self.unitemized_equipment_issue:
            packing_list.append("general_equipment",{
                "equipment_name": item.equipment_name,
                "quantity": item.quantity_issued,
            })

        packing_list.save(ignore_permissions=True)
        frappe.msgprint(f"Packing List '{packing_list.name}' updated with equipment from Equipment Log '{self.name}'.")

