import frappe
from frappe import _
from frappe.utils import get_fiscal_year, getdate

@frappe.whitelist()
def get_quarterly_pl_data(company=None):
    """
    Get Quarterly Profit and Loss data for the current fiscal year
    """
    if not company:
        company = frappe.defaults.get_user_default("Company")
    
    # Get current fiscal year
    fiscal_year = get_fiscal_year(getdate(), company=company)
    year_start_date = fiscal_year[1]  # Fiscal year start date
    year_end_date = fiscal_year[2]    # Fiscal year end date
    
    from erpnext.accounts.report.profit_and_loss_statement.profit_and_loss_statement import execute
    
    # Calculate quarters based on fiscal year
    from dateutil.relativedelta import relativedelta
    
    quarters_data = []
    current_date = year_start_date
    
    for q in range(1, 5):
        from_date = current_date
        to_date = current_date + relativedelta(months=3) - relativedelta(days=1)
        
        # Make sure we don't exceed fiscal year end
        if to_date > year_end_date:
            to_date = year_end_date
        
        filters = frappe._dict({
            'company': company,
            'from_date': from_date,
            'to_date': to_date,
            'periodicity': 'Monthly',
            'include_default_book_entries': 1
        })
        
        try:
            columns, data = execute(filters)
            quarters_data.append({
                'quarter': f'Q{q}',
                'from_date': str(from_date),
                'to_date': str(to_date),
                'columns': columns,
                'data': data
            })
        except Exception as e:
            frappe.log_error(f"Error fetching Q{q} data: {str(e)}")
        
        current_date = to_date + relativedelta(days=1)
        
        # Stop if we've reached the end of fiscal year
        if current_date > year_end_date:
            break
    
    return {
        'fiscal_year': fiscal_year[0],
        'year_start': str(year_start_date),
        'year_end': str(year_end_date),
        'quarters': quarters_data
    }