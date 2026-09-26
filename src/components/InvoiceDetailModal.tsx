import React, { useState, useEffect } from 'react';
import { 
  X, 
  Printer, 
  CreditCard, 
  FileText, 
  MapPin, 
  Calendar, 
  Truck, 
  Building,
  CheckCircle,
  Clock,
  Trash2,
  Edit3
} from 'lucide-react';
import { Invoice, CompanySettings, BankAccount } from '../types.js';
import { formatINR, numberToWords } from '../utils/format.js';
import { printInvoicePDF } from '../utils/pdf.js';
import { apiRequest } from '../services/api.js';
import { SslLogo } from './SslLogo.js';
import { DeleteInvoiceModal } from './DeleteInvoiceModal.js';

interface InvoiceDetailModalProps {
  invoice: Invoice;
  onClose: () => void;
  onEditInvoice?: (inv: Invoice) => void;
  onRecordPayment: (inv: Invoice) => void;
  onRefresh: () => void;
  companySettings: CompanySettings;
  defaultBank?: BankAccount;
}

export const InvoiceDetailModal: React.FC<InvoiceDetailModalProps> = ({
  invoice: initialInvoice,
  onClose,
  onEditInvoice,
  onRecordPayment,
  onRefresh,
  companySettings,
  defaultBank,
}) => {
  const [inv, setInv] = useState<Invoice>(initialInvoice);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  useEffect(() => {
    const loadDetails = async () => {
      try {
        const fullInv = await apiRequest<Invoice>(`/invoices/${initialInvoice.id}`);
        setInv(fullInv);
        const payRes = await apiRequest<{ items: any[] }>(`/payments?invoice_id=${initialInvoice.id}`);
        setPayments(payRes.items || []);
      } catch (err) {
        console.error('Failed to load invoice details', err);
      } finally {
        setLoading(false);
      }
    };
    loadDetails();
  }, [initialInvoice.id]);

  const lrItems = Array.isArray(inv.lr_items)
    ? inv.lr_items.filter(l => l && (l.lr_no || Number(l.amount) > 0 || Number(l.weight) > 0))
    : [];

  const internal = inv.doc_type === 'internal';
  const totals = inv.totals || {
    freight: inv.freight || 0,
    additional_total: inv.additional_total || 0,
    discount_amount: inv.discount_amount || 0,
    taxable_amount: inv.taxable_amount || 0,
    gst_amount: inv.gst_amount || 0,
    cgst: inv.cgst || 0,
    sgst: inv.sgst || 0,
    igst: inv.igst || 0,
    round_off: inv.round_off || 0,
    grand_total: inv.grand_total || 0,
    gst_type: inv.gst_type === 'igst' ? 'igst' : 'intra',
    gst_rate: inv.gst_rate || 18,
    discount_type: inv.discount_type || 'percent',
    discount_value: inv.discount_value || 0,
  };

  return (
    <div className="fixed inset-0 bg-scrim backdrop-blur-[6px] flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="sheet border border-line rounded-overlay max-w-3xl w-full max-h-[92vh] flex flex-col shadow-overlay text-ink my-auto">
        {/* Top Header */}
        <div className="p-4 border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-card bg-accent-soft border border-accent-line flex items-center justify-center text-accent-ink font-bold">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold font-mono text-ink">{inv.invoice_no}</h2>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                  inv.display_status === 'paid'
                    ? 'bg-positive-soft text-positive-ink border border-positive-line'
                    : inv.display_status === 'overdue'
                    ? 'bg-danger-soft text-danger-ink border border-danger-line'
                    : inv.display_status === 'partially_paid'
                    ? 'bg-warning-soft text-warning-ink border border-warning-line'
                    : 'bg-info-soft text-info-ink border border-info-line'
                }`}>
                  {inv.display_status}
                </span>
              </div>
              <p className="text-[11px] text-ink-faint">Date: {inv.invoice_date} · SAC {inv.sac || '996511'}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {inv.display_status !== 'cancelled' && onEditInvoice && (
              <button
                onClick={() => {
                  onClose();
                  onEditInvoice(inv);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-sunken hover:bg-surface-sunken text-ink border border-line-strong rounded-card text-xs font-semibold shadow-card transition"
              >
                <Edit3 className="w-3.5 h-3.5 text-accent-ink" />
                <span>Edit Invoice</span>
              </button>
            )}

            <button
              onClick={() => printInvoicePDF(inv, companySettings, defaultBank)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-strong hover:bg-accent-strong-hover text-on-accent rounded-card text-xs font-semibold shadow-card transition"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print A4 PDF</span>
            </button>

            {inv.display_status !== 'paid' && inv.display_status !== 'cancelled' && (
              <button
                onClick={() => {
                  onClose();
                  onRecordPayment(inv);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-surface text-positive-ink border border-positive-line hover:bg-positive-soft hover:border-positive rounded-card text-xs font-semibold shadow-card transition"
              >
                <CreditCard className="w-3.5 h-3.5" />
                <span>Receive Payment</span>
              </button>
            )}

            <button onClick={onClose} className="p-1 text-ink-faint hover:text-ink rounded-control transition ml-1">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
          {/* Company Branding & Tax Header */}
          <div className="p-4 rounded-card border border-line bg-surface-muted flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="bg-surface p-2 rounded-card border border-line shadow-card shrink-0">
                <SslLogo className="h-12 w-auto" />
              </div>
              <div>
                <h3 className="font-extrabold text-ink text-sm tracking-wide">
                  {companySettings?.name || 'SHREE SANWARIYA LOGISTICS'}
                </h3>
                <p className="text-ink-faint text-[11px]">
                  {[companySettings?.address, companySettings?.city, companySettings?.state, companySettings?.pin].filter(Boolean).join(', ') || 'Opp. Transport Nagar, Ring Road, Ahmedabad, Gujarat'}
                </p>
                {!internal && <p className="text-ink-soft text-[11px] font-mono mt-0.5">
                  <span className="font-bold text-ink">GSTIN:</span> {companySettings?.gstin || '24AABCS1429B1Z8'} &nbsp;|&nbsp; <span className="font-bold text-ink">PAN:</span> {companySettings?.pan || 'AABCS1429B'}
                </p>}
              </div>
            </div>
            <div className="text-left sm:text-right shrink-0">
              <span className="inline-block px-2.5 py-1 bg-surface text-ink-soft border border-line font-medium rounded-control text-[10px] uppercase tracking-wider">
                {internal ? 'Non-GST bill' : 'Original Tax Invoice'}
              </span>
              <p className="text-ink-faint text-[10px] mt-1">Goods Transport Agency (GTA)</p>
            </div>
          </div>

          {/* Parties & Route Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Bill To */}
            <div className="bg-surface-muted p-4 rounded-card border border-line">
              <div className="text-[11px] font-bold text-accent-ink uppercase tracking-wider mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Building className="w-3.5 h-3.5" />
                  Bill To (Buyer)
                </span>
                <span className="text-[10px] text-ink-faint font-medium">Billed Party</span>
              </div>
              <div className="font-bold text-sm text-ink">{inv.buyer?.name || '-'}</div>
              <div className="text-ink-soft mt-1">{inv.buyer?.address || ''}</div>
              <div className="text-ink-soft">{[inv.buyer?.city, inv.buyer?.state, inv.buyer?.pin].filter(Boolean).join(', ')}</div>
              <div className="text-ink mt-2 font-mono font-medium text-[11px]">
                GSTIN: {inv.buyer?.gstin || 'Unregistered'}
                {inv.buyer?.phone && <span className="ml-2 font-sans text-ink-soft">· Ph: {inv.buyer.phone}</span>}
              </div>
            </div>

            {/* Ship To */}
            <div className="bg-surface-muted p-4 rounded-card border border-line">
              <div className="text-[11px] font-bold text-accent-ink uppercase tracking-wider mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" />
                  Ship To (Consignee / Delivery)
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                  inv.same_as_buyer ? 'bg-surface-sunken/60 text-ink-soft' : 'bg-accent-soft text-accent-ink'
                }`}>
                  {inv.same_as_buyer ? 'Same as Buyer' : 'Custom Site'}
                </span>
              </div>
              <div className="font-bold text-sm text-ink">
                {inv.ship_to?.name || inv.buyer?.name || '-'}
              </div>
              <div className="text-ink-soft mt-1">
                {inv.ship_to?.address || inv.buyer?.address || '-'}
              </div>
              <div className="text-ink-soft">
                {[
                  inv.ship_to?.city || inv.buyer?.city,
                  inv.ship_to?.state || inv.buyer?.state,
                  inv.ship_to?.pin || inv.buyer?.pin
                ].filter(Boolean).join(', ')}
              </div>
              {inv.ship_to?.gstin && (
                <div className="text-ink mt-2 font-mono font-medium text-[11px]">
                  GSTIN: {inv.ship_to.gstin}
                </div>
              )}
            </div>
          </div>

          {/* Consignment Logistics */}
          <div className="bg-surface-muted p-4 rounded-card border border-line">
            <div className="text-[11px] font-bold text-accent-ink uppercase tracking-wider mb-2 flex items-center justify-between gap-1.5">
              <span className="flex items-center gap-1.5">
                <Truck className="w-3.5 h-3.5" />
                Consignment & LR Tracking Details
              </span>
              {lrItems.length > 1 && (
                <span className="px-1.5 py-0.5 rounded-md bg-accent-soft text-accent-ink text-[10px] font-bold normal-case tracking-normal">
                  {lrItems.length} LRs on this bill
                </span>
              )}
            </div>

            {lrItems.length > 1 && (
              <div className="overflow-x-auto mb-3 bg-surface rounded-control border border-line">
                <table className="w-full text-xs text-left min-w-[560px]">
                  <thead className="bg-surface-sunken text-ink-faint uppercase text-[10px] border-b border-line">
                    <tr>
                      <th className="py-2 px-2.5">#</th>
                      <th className="py-2 px-2.5">LR / Bilty No</th>
                      <th className="py-2 px-2.5">LR Date</th>
                      <th className="py-2 px-2.5">Route</th>
                      <th className="py-2 px-2.5 text-right">Weight (Kg)</th>
                      <th className="py-2 px-2.5 text-right">Rate / Kg</th>
                      <th className="py-2 px-2.5 text-right">Freight (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {lrItems.map((l, i) => (
                      <tr key={i}>
                        <td className="py-1.5 px-2.5 text-ink-faint font-mono">{i + 1}</td>
                        <td className="py-1.5 px-2.5 font-mono font-bold text-ink">{l.lr_no || '-'}</td>
                        <td className="py-1.5 px-2.5 text-ink-soft font-mono">{l.lr_date || '-'}</td>
                        <td className="py-1.5 px-2.5 text-ink-soft">{[l.origin, l.destination].filter(Boolean).join(' → ') || '-'}</td>
                        <td className="py-1.5 px-2.5 text-right font-mono">{l.weight ? formatINR(l.weight) : '-'}</td>
                        <td className="py-1.5 px-2.5 text-right font-mono">{l.rate_kg ? formatINR(l.rate_kg) : '-'}</td>
                        <td className="py-1.5 px-2.5 text-right font-mono font-bold text-ink">₹{formatINR(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-surface-muted border-t border-line font-semibold">
                    <tr>
                      <td colSpan={4} className="py-1.5 px-2.5 text-right text-ink-soft">Total ({lrItems.length} LRs)</td>
                      <td className="py-1.5 px-2.5 text-right font-mono">{formatINR(lrItems.reduce((a, l) => a + (Number(l.weight) || 0), 0))}</td>
                      <td></td>
                      <td className="py-1.5 px-2.5 text-right font-mono text-accent-ink">₹{formatINR(totals.freight)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-ink-faint">{lrItems.length > 1 ? 'LR Numbers:' : 'LR / Bilty No:'}</span>
                <div className="font-mono font-bold text-ink break-words">{inv.lr_no || '-'}</div>
              </div>
              <div>
                <span className="text-ink-faint">Route:</span>
                <div className="text-ink font-medium">{inv.origin && inv.destination ? `${inv.origin} → ${inv.destination}` : 'Local'}</div>
              </div>
              <div>
                <span className="text-ink-faint">Charged Weight:</span>
                <div className="text-ink font-medium">{inv.weight ? `${inv.weight} Kg` : '-'}</div>
              </div>
              <div>
                <span className="text-ink-faint">Place of Supply:</span>
                <div className="text-ink font-medium">{inv.place_of_supply || '-'}</div>
              </div>
            </div>
          </div>

          {/* Charges Breakdown */}
          <div className="bg-surface rounded-card border border-line overflow-hidden shadow-card">
            <div className="p-3 bg-surface-muted font-semibold text-ink border-b border-line">
              Line Items & Charge Calculation
            </div>
            <table className="w-full text-left text-xs">
              <thead className="bg-surface-muted text-ink-faint uppercase text-[10px] border-b border-line">
                <tr>
                  <th className="py-2.5 px-3">Particulars</th>
                  <th className="py-2.5 px-3">SAC</th>
                  <th className="py-2.5 px-3 text-right">Amount (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                <tr>
                  <td className="py-2 px-3 text-ink">
                    Freight Charges (Logistics / Transportation)
                    {lrItems.length > 1 && <span className="text-ink-faint"> - {lrItems.length} LRs as per consignment details</span>}
                  </td>
                  <td className="py-2 px-3 text-ink-faint font-mono">{inv.sac || '996511'}</td>
                  <td className="py-2 px-3 text-right font-mono font-bold text-ink">₹{formatINR(totals.freight)}</td>
                </tr>
                {inv.extra_charges && inv.extra_charges.map((ec, i) => (
                  <tr key={i}>
                    <td className="py-2 px-3 text-ink-soft">{ec.label}</td>
                    <td className="py-2 px-3 text-ink-faint font-mono">{inv.sac || '996511'}</td>
                    <td className="py-2 px-3 text-right font-mono font-bold text-ink">₹{formatINR(ec.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Totals Table */}
            <div className="p-3.5 border-t border-line bg-surface-muted space-y-1.5 text-xs">
              <div className="flex justify-between text-ink-soft">
                <span>Gross Amount:</span>
                <span className="font-mono">₹{formatINR((totals as any).gross_amount || (totals.freight + (totals.additional_total || 0)))}</span>
              </div>
              {totals.discount_amount > 0 && (
                <div className="flex justify-between text-danger-ink">
                  <span>Discount ({totals.discount_type}):</span>
                  <span className="font-mono">-₹{formatINR(totals.discount_amount)}</span>
                </div>
              )}
              <div className="flex justify-between text-ink font-semibold pt-1 border-t border-line">
                <span>{internal ? 'Sub Total:' : 'Taxable Value:'}</span>
                <span className="font-mono">₹{formatINR(totals.taxable_amount)}</span>
              </div>
              {internal ? null : totals.gst_type === 'igst' ? (
                <div className="flex justify-between text-info-ink">
                  <span>IGST @ {totals.gst_rate}%:</span>
                  <span className="font-mono">₹{formatINR(totals.igst)}</span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between text-info-ink">
                    <span>CGST @ {totals.gst_rate / 2}%:</span>
                    <span className="font-mono">₹{formatINR(totals.cgst)}</span>
                  </div>
                  <div className="flex justify-between text-info-ink">
                    <span>SGST @ {totals.gst_rate / 2}%:</span>
                    <span className="font-mono">₹{formatINR(totals.sgst)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between text-ink-faint">
                <span>Round Off:</span>
                <span className="font-mono">₹{formatINR(totals.round_off)}</span>
              </div>
              <div className="flex justify-between text-sm font-bold text-ink pt-2 border-t border-line">
                <span>GRAND TOTAL:</span>
                <span className="font-mono text-accent-ink text-base">₹{formatINR(totals.grand_total)}</span>
              </div>
              {/* Internal figures: shown on screen only, never printed. */}
              {(totals as any).total_cost !== null && (totals as any).total_cost !== undefined && (
                <div className="mt-2 pt-2 border-t border-dashed border-line space-y-0.5 text-[11px]">
                  <div className="flex justify-between text-ink-faint">
                    <span>Our cost:</span><span className="font-mono">₹{formatINR((totals as any).total_cost)}</span>
                  </div>
                  {((totals as any).input_gst || 0) > 0 && (
                    <div className="flex justify-between text-ink-faint">
                      <span>Input GST credit:</span><span className="font-mono">₹{formatINR((totals as any).input_gst)}</span>
                    </div>
                  )}
                  {((totals as any).blocked_gst || 0) > 0 && (
                    <div className="flex justify-between text-ink-faint">
                      <span>Vendor GST in cost:</span><span className="font-mono">₹{formatINR((totals as any).blocked_gst)}</span>
                    </div>
                  )}
                  <div className={`flex justify-between font-semibold ${((totals as any).gross_profit ?? 0) < 0 ? 'text-danger-ink' : 'text-positive-ink'}`}>
                    <span>Gross profit ({(totals as any).margin_pct ?? 0}%):</span>
                    <span className="font-mono">₹{formatINR((totals as any).gross_profit)}</span>
                  </div>
                </div>
              )}
              <div className="text-[11px] text-ink-faint italic pt-1">
                {numberToWords(totals.grand_total)}
              </div>
            </div>
          </div>

          {/* Payment History on this Invoice */}
          <div className="bg-surface p-4 rounded-card border border-line shadow-card">
            <div className="flex items-center justify-between mb-3 border-b border-line pb-2">
              <span className="font-bold text-ink">Payment Collections</span>
              <div className="flex gap-3 text-xs">
                <span>Paid: <strong className="text-positive-ink font-mono">₹{formatINR(inv.paid || 0)}</strong></span>
                <span>Balance: <strong className="text-accent-ink font-mono">₹{formatINR(inv.balance ?? totals.grand_total)}</strong></span>
              </div>
            </div>

            {payments.length > 0 ? (
              <div className="space-y-2">
                {payments.map((p) => (
                  <div key={p.id} className="p-2.5 bg-surface-muted rounded-card border border-line flex items-center justify-between text-xs">
                    <div>
                      <div className="font-semibold text-ink">{p.method} {p.reference ? `· ${p.reference}` : ''}</div>
                      <div className="text-[11px] text-ink-faint">Date: {p.payment_date}</div>
                    </div>
                    <div className="font-mono font-bold text-positive-ink text-sm">
                      +₹{formatINR(p.amount)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-ink-faint text-xs text-center py-2">
                No payment receipts recorded for this invoice yet.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-line flex items-center justify-between">
          <div>
            <button
              onClick={() => setShowDeleteModal(true)}
              className="text-xs text-danger-ink hover:text-danger-ink hover:bg-danger-soft px-2.5 py-1.5 rounded-control font-medium flex items-center gap-1.5 transition cursor-pointer border border-danger-line"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Cancel or Delete Invoice</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {inv.display_status !== 'cancelled' && onEditInvoice && (
              <button
                onClick={() => {
                  onClose();
                  onEditInvoice(inv);
                }}
                className="px-4 py-2 bg-accent-soft hover:bg-accent-soft text-accent-ink border border-accent-line rounded-card text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Edit Invoice</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="px-4 py-2 bg-surface-sunken hover:bg-surface-sunken text-ink-soft rounded-card text-xs font-medium transition cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {/* Delete / Cancel Confirmation Modal */}
      {showDeleteModal && (
        <DeleteInvoiceModal
          invoice={inv}
          onClose={() => setShowDeleteModal(false)}
          onSuccess={() => {
            setShowDeleteModal(false);
            onRefresh();
            onClose();
          }}
        />
      )}
    </div>
  );
};
