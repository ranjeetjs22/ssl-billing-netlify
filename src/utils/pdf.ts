/**
 * Lazy entry points for PDF generation. jsPDF + autotable are only downloaded the
 * first time a user actually prints something, keeping the initial page load small.
 */
import type { Invoice, CompanySettings, BankAccount, Customer, Payment } from '../types.js';

const load = () => import('./pdfGenerator.js');

export async function printInvoicePDF(inv: Invoice, company: CompanySettings, bank?: BankAccount) {
  return (await load()).printInvoicePDF(inv, company, bank);
}

export async function printReceiptPDF(payment: Payment, company: CompanySettings) {
  return (await load()).printReceiptPDF(payment, company);
}

export async function printStatementPDF(
  customer: Customer,
  ledger: any[],
  summary: any,
  company: CompanySettings,
  periodLabel?: string,
  invoices?: Invoice[],
  bank?: BankAccount
) {
  return (await load()).printStatementPDF(customer, ledger, summary, company, periodLabel, invoices, bank);
}
