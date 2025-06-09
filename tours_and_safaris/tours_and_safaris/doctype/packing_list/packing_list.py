# Copyright (c) 2025, wanguimbutu and contributors
# For license information, please see license.txt
import frappe
import math
from frappe.model.document import Document

class PackingList(Document):
	pass

@frappe.whitelist()
def calculate_and_insert_equipment(docname, no_of_adults, no_of_children, no_of_guides):

    doc = frappe.get_doc('Packing List', docname)

    no_of_adults = int(no_of_adults or 0)
    no_of_children = int(no_of_children or 0)
    no_of_guides = int(no_of_guides or 0)

    # Calculate equipment
    equipment_list = calculate_equipment_quantities(doc, no_of_adults, no_of_children, no_of_guides)

    # Clear existing equipment entries
    doc.set("general_equipment", [])

    # Add calculated equipment to the child table
    for equipment in equipment_list:
        doc.append("general_equipment", {
            "equipment_name": equipment["equipment_name"],
            "quantity": equipment["quantity"]
        })

    # Save the document
    doc.save()

    return equipment_list

def calculate_equipment_quantities(doc, no_of_adults, no_of_children, no_of_guides):
    """
    Calculate equipment quantities based on customer group and participant counts
    """
    # Total pax (adults + children)
    total_pax = int(no_of_adults) + int(no_of_children)
    total_pax_with_guides = total_pax + int(no_of_guides)

    # Get equipment category based on customer group
    customer_group = doc.get("customer_group", "")
    category = get_equipment_category(customer_group)

    # Equipment rules
    equipment_rules = {
        "Washing Basins": {
            "schools": lambda pax: max(3, 4 if pax > 40 else 3),
            "adults": lambda pax: max(3, 4 if pax > 40 else 3)
        },
        "Tray": {
            "schools": lambda pax: max(3, 4 if pax > 40 else 3),
            "adults": lambda pax: max(3, 4 if pax > 40 else 3)
        },
        "Spatula": {
            "schools": lambda pax: 2,
            "adults": lambda pax: 2
        },
        "Grater": {
            "schools": lambda pax: 1,
            "adults": lambda pax: 1
        },
        "Complete Burners": {
            "schools": lambda pax: 3 + (pax // 10) + (1 if pax > 10 else 0) + 1,
            "adults": lambda pax: 3 + (pax // 10) + (1 if pax > 10 else 0) + 1
        },
        "Gas": {
            "schools": lambda pax: 2 + (pax // 10) + (1 if pax > 10 else 0),
            "adults": lambda pax: 2 + (pax // 10) + (1 if pax > 10 else 0)
        },
        "Tongs": {
            "schools": lambda pax: 2,
            "adults": lambda pax: 2
        },
        "Chopping Board": {
            "schools": lambda pax: 2,
            "adults": lambda pax: 4
        },
        "Potato Peeler": {
            "schools": lambda pax: 1,
            "adults": lambda pax: 1
        },
        "Serving Spoons": {
            "schools": lambda pax: min(4 + (pax // 10), 20),
            "adults": lambda pax: min(4 + (pax // 10), 20)
        },
        "Kettle with lid": {
            "schools": lambda pax: 1 + (pax // 10),
            "adults": lambda pax: 1 + (pax // 10)
        },
        "Sufuria (pots)": {
            "schools": lambda pax: min(3 + (pax // 10), 20),
            "adults": lambda pax: min(3 + (pax // 10), 20)
        },
        "Buffet trays": {
            "schools": lambda pax: "To be selected if needed",
            "adults": lambda pax: "To be selected if needed"
        },
        "BBQ Grill": {
            "schools": lambda pax: 1,
            "adults": lambda pax: 1
        }
    }

    shared_rules = {
        "Food Warmer (hot pot)": lambda pax: 3 if pax <= 20 else 3 + math.ceil((pax - 20) / 10),
        "Funnel": lambda pax: 1,
        "Tea Strainer": lambda pax: 1,
        "Sharp Knife": lambda pax: 2 if pax <= 20 else 2 + math.ceil((pax - 20) / 10),
        "Thermos": lambda pax: 2 + math.ceil(pax / 10),
        "Bowls": lambda pax: pax + 5,
        "Spoons": lambda pax: pax + 5,
        "Forks": lambda pax: pax + 5,
        "Knives": lambda pax: pax + 5,
        "Plates": lambda pax: pax + 5,
        "Cups": lambda pax: pax + 5,
        "Wooden Spoons": lambda pax: 2,
        "Ladle": lambda pax: 2,
        "Frying Pans": lambda pax: 1,
        "Water Pump": lambda pax: 2 if pax <= 40 else 2 + math.ceil((pax - 40) / 20),
        "Gas Grill": lambda pax: math.ceil(pax / 10) * 2,
        "Tea Urns": lambda pax: 2 if pax > 50 else 0,
        "Guide Tents": lambda pax: math.ceil(no_of_guides / 2),
        "Toilet & Toilet Tent": lambda pax: math.ceil(pax / 10),
        "Kitchen Tents": lambda pax: 1,
        "First Aid Box": lambda pax: 1,
        "Sat Phone": lambda pax: 1,
        "Solar Lights": lambda pax: 2,
        "bin-big": lambda pax: 1 if 15 < pax <= 40 else (2 if pax > 40 else 0),
        "bin small": lambda pax: 1 if pax <= 15 else 0,
        "Handwash bucket": lambda pax: math.ceil(pax / 10),
        "Wipe clothe": lambda pax: 2 if pax <= 20 else 2 + math.ceil((pax - 20) / 10)
    }

    for item, rule in shared_rules.items():
        equipment_rules[item] = {
            "schools": rule,
            "adults": rule
        }

    # Calculate results
    equipment_list = []

    for item, rule in equipment_rules.items():
        if category in rule:
            qty = rule[category](total_pax_with_guides)
            if isinstance(qty, str):
                description = qty
                qty = 0
            else:
                description = f"Calculated for {total_pax_with_guides} pax including guides ({category})"

            equipment_list.append({
                "equipment_name": item,
                "quantity": qty,
                "description": description
            })

    return equipment_list

def get_equipment_category(customer_group):
    """
    Determine equipment category based on customer group
    Schools customer group uses schools_mt_kenya/kids_safari logic
    All other customer groups use adults_safari/adults_mt_kenya logic
    """
    customer_group_lower = customer_group.lower()

    if "schools" in customer_group_lower or "school" in customer_group_lower:
        return "schools"
    else:
        return "adults"
