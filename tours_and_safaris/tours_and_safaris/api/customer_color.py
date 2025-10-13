# your_app/utils.py
import random
import colorsys
import frappe

def _generate_pastel_hex():
    """Generate a pastel hex color using HSL with high lightness, low-mid saturation."""
    h = random.random()  # 0..1
    s = random.uniform(0.25, 0.45)  
    l = random.uniform(0.78, 0.92)  
    # convert to rgb 0..255
    r, g, b = colorsys.hls_to_rgb(h, l, s)
    return "#{:02X}{:02X}{:02X}".format(int(r * 255), int(g * 255), int(b * 255))

def assign_unique_light_color(doc, method):
    """
    Hook: before_insert on Customer
    Signature (doc, method) is required by Frappe doc events.
    """
    try:
        # only assign if empty
        if getattr(doc, "custom_color", None):
            frappe.logger("custom_color").debug(f"Customer {doc.name}: custom_color already set; skipping assignment.")
            return

        # fetch existing colors (lowercased) once
        existing = frappe.get_all("Customer", fields=["custom_color"])
        used = { (c.custom_color or "").strip().lower() for c in existing if c.custom_color }

        max_attempts = 1000
        for i in range(max_attempts):
            color = _generate_pastel_hex()
            if color.lower() not in used:
                doc.custom_color = color
                frappe.logger("custom_color").info(f"Assigned color {color} to Customer (temp name: {getattr(doc,'name', '<new>')}).")
                return

        # fallback: deterministic safe color
        doc.custom_color = "#CCCCCC"
        frappe.logger("custom_color").warn(f"Fallback color assigned to Customer {getattr(doc,'name','<new>')} after {max_attempts} attempts.")
    except Exception as e:
        
        frappe.logger("custom_color").error(f"Error assigning custom_color: {repr(e)}")


