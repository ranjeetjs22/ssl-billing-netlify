export type UserRole = 'admin' | 'staff' | 'accountant';

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  last_login?: string;
  created_at?: string;
  modules: string[];
}

export interface CompanySettings {
  id?: string;
  name: string;
  logo_url?: string;
  address?: string;
  city?: string;
  state?: string;
  pin?: string;
  gstin?: string;
  pan?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  website?: string;
  invoice_prefix?: string;
  next_number?: number;
  gst_rate?: number;
  gst_type?: string;
  terms?: string;
  gst_api_key?: string;
  gst_api_provider?: string;
  gst_api_url?: string;
  updated_at?: string;
}

export interface BankAccount {
  id?: string;
  account_holder: string;
  bank_name: string;
  account_number: string;
  ifsc?: string;
  branch?: string;
  upi_id?: string;
  is_default: boolean;
  created_at?: string;
}

export interface Customer {
  id: string;
  name: string;
  address?: string;
  shipping_address?: string;
  city?: string;
  state?: string;
  pin?: string;
  gstin?: string;
  pan?: string;
  contact_person?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  payment_terms?: string;
  credit_days?: number;
  credit_limit?: number;
  is_active: boolean;
  notes?: string;
  balance?: number;
  outstanding?: number;
  total_invoiced?: number;
  total_paid?: number;
  invoice_count?: number;
  pending_invoices_count?: number;
  overdue_amount?: number;
  overdue_invoices_count?: number;
  last_invoice_date?: string;
  last_payment_date?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CustomerLedgerEntry {
  date: string;
  type: 'opening' | 'invoice' | 'payment' | 'credit_note';
  particulars: string;
  reference_no?: string;
  lr_no?: string;
  vehicle_no?: string;
  route?: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface CustomerStatementSummary {
  invoice_count: number;
  opening_balance: number;
  period_invoiced: number;
  period_taxable: number;
  period_gst: number;
  period_received: number;
  closing_balance: number;
  total_overall_outstanding: number;
  overdue_amount: number;
  revenue: number; // legacy alias for period_invoiced
  taxable: number; // legacy alias
  gst: number; // legacy alias
  received: number; // legacy alias
  outstanding: number; // legacy alias for closing_balance
}

export interface CustomerStatementResponse {
  customer: Customer;
  period: {
    month?: string;
    start_date?: string;
    end_date?: string;
    label: string;
  };
  invoices: Invoice[];
  payments: Payment[];
  ledger: CustomerLedgerEntry[];
  summary: CustomerStatementSummary;
}

export interface ChargeItem {
  label: string;
  amount: number;
}

/** One LR / consignment line on a (possibly multi-LR) bill. */
export interface LrItem {
  lr_no: string;
  lr_date?: string;
  origin?: string;
  destination?: string;
  description?: string;
  packages?: number;
  weight: number;
  rate_kg: number;
  amount: number;
}

export interface InvoiceTotals {
  freight: number;
  fuel_surcharge: number;
  fuel_hike: number;
  lr_items?: LrItem[];
  lr_count?: number;
  additional_items: ChargeItem[];
  additional_total: number;
  gross_amount: number;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  discount_amount: number;
  taxable_amount: number;
  gst_type: 'intra' | 'igst' | 'exempt';
  gst_rate: number;
  gst_amount: number;
  cgst: number;
  sgst: number;
  igst: number;
  round_off: number;
  grand_total: number;
}

export interface Invoice {
  id: string;
  invoice_no: string;
  invoice_date: string;
  customer_id: string;
  buyer?: {
    name?: string;
    address?: string;
    city?: string;
    state?: string;
    pin?: string;
    gstin?: string;
    pan?: string;
    phone?: string;
  };
  ship_to?: {
    name?: string;
    address?: string;
    city?: string;
    state?: string;
    pin?: string;
    gstin?: string;
    phone?: string;
  };
  same_as_buyer: boolean;
  lr_no?: string;
  lr_items?: LrItem[];
  vehicle_no?: string;
  shipment_date?: string;
  origin?: string;
  destination?: string;
  weight?: number;
  rate_kg?: number;
  dimensions?: string;
  sac?: string;
  place_of_supply?: string;
  freight?: number;
  processing?: number;
  insurance_amt?: number;
  fuel_surcharge_pct?: number;
  fuel_hike_pct?: number;
  extra_charges?: ChargeItem[];
  additional_total?: number;
  discount_type?: 'percent' | 'fixed';
  discount_value?: number;
  discount_amount?: number;
  taxable_amount?: number;
  gst_type?: string;
  gst_rate?: number;
  gst_amount?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  round_off?: number;
  grand_total?: number;
  payment_terms?: string;
  due_date?: string;
  terms?: string;
  notes?: string;
  status: 'draft' | 'pending' | 'paid' | 'cancelled' | string;
  display_status?: 'draft' | 'issued' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled';
  paid?: number;
  balance?: number;
  totals?: InvoiceTotals;
  created_at?: string;
  updated_at?: string;
  /** Convenience fields added by GET /dashboard for the "recent invoices" list. */
  buyer_name?: string;
  from_city?: string;
  to_city?: string;
}

export interface Payment {
  id: string;
  invoice_id: string;
  payment_date: string;
  amount: number;
  method: string;
  reference?: string;
  notes?: string;
  invoice_no?: string;
  invoice_date?: string;
  invoice_total?: number;
  customer_id?: string;
  customer_name?: string;
  invoice_balance?: number;
  invoice_paid?: number;
  created_at?: string;
}

export interface OpenInvoice {
  id: string;
  invoice_no: string;
  invoice_date: string;
  due_date?: string;
  customer_id: string;
  customer_name?: string;
  grand_total: number;
  paid: number;
  balance: number;
  display_status: string;
}

export interface AuditLog {
  id: string;
  user_email?: string;
  action: string;
  entity?: string;
  entity_id?: string;
  old_value?: any;
  new_value?: any;
  created_at: string;
}

export interface DashboardMetrics {
  total_sales: number;
  taxable_sales: number;
  gst: number;
  cgst: number;
  sgst: number;
  igst: number;
  payments_received: number;
  outstanding: number;
  expenses: number;
  estimated_profit: number;
  profit_margin: number;
  customers: number;
  invoices: number;
  paid: number;
  pending: number;
  overdue: number;
  draft: number;
  cancelled: number;
}

export interface MonthlySeries {
  month: string;
  sales: number;
  payments: number;
  expenses: number;
  profit: number;
  outstanding: number;
}
