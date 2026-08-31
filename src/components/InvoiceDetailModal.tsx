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
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-3xl w-full max-h-[92vh] flex flex-col shadow-2xl text-slate-800 my-auto">
        {/* Top Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center text-orange-600 font-bold">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold font-mono text-slate-900">{inv.invoice_no}</h2>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                  inv.display_status === 'paid'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : inv.display_status === 'overdue'
                    ? 'bg-rose-50 text-rose-700 border border-rose-200'
                    : inv.display_status === 'partially_paid'
                    ? 'bg-amber-50 text-amber-700 border border-amber-200'
                    : 'bg-blue-50 text-blue-700 border border-blue-200'
                }`}>
                  {inv.display_status}
                </span>
              </div>
              <p className="text-[11px] text-slate-500">Date: {inv.invoice_date} · SAC {inv.sac || '996511'}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {inv.display_status !== 'cancelled' && onEditInvoice && (
              <button
                onClick={() => {
                  onClose();
                  onEditInvoice(inv);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 rounded-xl text-xs font-semibold shadow-xs transition"
              >
                <Edit3 className="w-3.5 h-3.5 text-orange-600" />
                <span>Edit Invoice</span>
              </button>
            )}

            <button
              onClick={() => printInvoicePDF(inv, companySettings, defaultBank)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-xs font-semibold shadow-xs transition"
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
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-xs transition"
              >
                <CreditCard className="w-3.5 h-3.5" />
                <span>Receive Payment</span>
              </button>
            )}

            <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 rounded-lg transition ml-1">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
          {/* Company Branding & Tax Header */}
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="bg-white p-2 rounded-xl border border-slate-200 shadow-xs shrink-0">
                <SslLogo className="h-12 w-auto" />
              </div>
              <div>
                <h3 className="font-extrabold text-slate-900 text-sm tracking-wide">
                  {companySettings?.name || 'SHREE SANWARIYA LOGISTICS'}
                </h3>
                <p className="text-slate-500 text-[11px]">
                  {[companySettings?.address, companySettings?.city, companySettings?.state, companySettings?.pin].filter(Boolean).join(', ') || 'Opp. Transport Nagar, Ring Road, Ahmedabad, Gujarat'}
                </p>
                <p className="text-slate-600 text-[11px] font-mono mt-0.5">
                  <span className="font-bold text-slate-800">GSTIN:</span> {companySettings?.gstin || '24AABCS1429B1Z8'} &nbsp;|&nbsp; <span className="font-bold text-slate-800">PAN:</span> {companySettings?.pan || 'AABCS1429B'}
                </p>
              </div>
            </div>
            <div className="text-left sm:text-right shrink-0">
              <span className="inline-block px-2.5 py-1 bg-slate-900 text-white font-bold rounded-lg text-[10px] uppercase tracking-wider">
                Original Tax Invoice
              </span>
              <p className="text-slate-500 text-[10px] mt-1">Goods Transport Agency (GTA)</p>
            </div>
          </div>

          {/* Parties & Route Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Bill To */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div className="text-[11px] font-bold text-orange-600 uppercase tracking-wider mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Building className="w-3.5 h-3.5" />
                  Bill To (Buyer)
                </span>
                <span className="text-[10px] text-slate-500 font-medium">Billed Party</span>
              </div>
              <div className="font-bold text-sm text-slate-900">{inv.buyer?.name || '—'}</div>
              <div className="text-slate-600 mt-1">{inv.buyer?.address || ''}</div>
              <div className="text-slate-600">{[inv.buyer?.city, inv.buyer?.state, inv.buyer?.pin].filter(Boolean).join(', ')}</div>
              <div className="text-slate-800 mt-2 font-mono font-medium text-[11px]">
                GSTIN: {inv.buyer?.gstin || 'Unregistered'}
                {inv.buyer?.phone && <span className="ml-2 font-sans text-slate-600">· Ph: {inv.buyer.phone}</span>}
              </div>
            </div>

            {/* Ship To */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div className="text-[11px] font-bold text-orange-600 uppercase tracking-wider mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" />
                  Ship To (Consignee / Delivery)
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                  inv.same_as_buyer ? 'bg-slate-200/60 text-slate-600' : 'bg-orange-100 text-orange-700'
                }`}>
                  {inv.same_as_buyer ? 'Same as Buyer' : 'Custom Site'}
                </span>
              </div>
              <div className="font-bold text-sm text-slate-900">
                {inv.ship_to?.name || inv.buyer?.name || '—'}
              </div>
              <div className="text-slate-600 mt-1">
                {inv.ship_to?.address || inv.buyer?.address || '—'}
              </div>
              <div className="text-slate-600">
                {[
                  inv.ship_to?.city || inv.buyer?.city,
                  inv.ship_to?.state || inv.buyer?.state,
                  inv.ship_to?.pin || inv.buyer?.pin
                ].filter(Boolean).join(', ')}
              </div>
              {inv.ship_to?.gstin && (
                <div className="text-slate-800 mt-2 font-mono font-medium text-[11px]">
                  GSTIN: {inv.ship_to.gstin}
                </div>
              )}
            </div>
          </div>

          {/* Consignment Logistics */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div className="text-[11px] font-bold text-orange-600 uppercase tracking-wider mb-2 flex items-center justify-between gap-1.5">
              <span className="flex items-center gap-1.5">
                <Truck className="w-3.5 h-3.5" />
                Consignment & LR Tracking Details
              </span>
              {lrItems.length > 1 && (
                <span className="px-1.5 py-0.5 rounded-md bg-orange-100 text-orange-700 text-[10px] font-bold normal-case tracking-normal">
                  {lrItems.length} LRs on this bill
                </span>
              )}
            </div>

            {lrItems.length > 1 && (
              <div className="overflow-x-auto mb-3 bg-white rounded-lg border border-slate-200">
                <table className="w-full text-xs text-left min-w-[560px]">
                  <thead className="bg-slate-100 text-slate-500 uppercase text-[10px] border-b border-slate-200">
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
                  <tbody className="divide-y divide-slate-100">
                    {lrItems.map((l, i) => (
                      <tr key={i}>
                        <td className="py-1.5 px-2.5 text-slate-400 font-mono">{i + 1}</td>
                        <td className="py-1.5 px-2.5 font-mono font-bold text-slate-900">{l.lr_no || '—'}</td>
                        <td className="py-1.5 px-2.5 text-slate-600 font-mono">{l.lr_date || '—'}</td>
                        <td className="py-1.5 px-2.5 text-slate-700">{[l.origin, l.destination].filter(Boolean).join(' → ') || '—'}</td>
                        <td className="py-1.5 px-2.5 text-right font-mono">{l.weight ? formatINR(l.weight) : '—'}</td>
                        <td className="py-1.5 px-2.5 text-right font-mono">{l.rate_kg ? formatINR(l.rate_kg) : '—'}</td>
                        <td className="py-1.5 px-2.5 text-right font-mono font-bold text-slate-900">₹{formatINR(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 border-t border-slate-200 font-semibold">
                    <tr>
                      <td colSpan={4} className="py-1.5 px-2.5 text-right text-slate-600">Total ({lrItems.length} LRs)</td>
                      <td className="py-1.5 px-2.5 text-right font-mono">{formatINR(lrItems.reduce((a, l) => a + (Number(l.weight) || 0), 0))}</td>
                      <td></td>
                      <td className="py-1.5 px-2.5 text-right font-mono text-orange-600">₹{formatINR(totals.freight)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-slate-500">{lrItems.length > 1 ? 'LR Numbers:' : 'LR / Bilty No:'}</span>
                <div className="font-mono font-bold text-slate-900 break-words">{inv.lr_no || '—'}</div>
              </div>
              <div>
                <span className="text-slate-500">Route:</span>
                <div className="text-slate-900 font-medium">{inv.origin && inv.destination ? `${inv.origin} → ${inv.destination}` : 'Local'}</div>
              </div>
              <div>
                <span className="text-slate-500">Charged Weight:</span>
                <div className="text-slate-900 font-medium">{inv.weight ? `${inv.weight} Kg` : '—'}</div>
              </div>
              <div>
                <span className="text-slate-500">Place of Supply:</span>
                <div className="text-slate-900 font-medium">{inv.place_of_supply || '—'}</div>
              </div>
            </div>
          </div>

          {/* Charges Breakdown */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="p-3 bg-slate-50 font-semibold text-slate-800 border-b border-slate-200">
              Line Items & Charge Calculation
            </div>
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3">Particulars</th>
                  <th className="py-2.5 px-3">SAC</th>
                  <th className="py-2.5 px-3 text-right">Amount (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="py-2 px-3 text-slate-800">
                    Freight Charges (Logistics / Transportation)
                    {lrItems.length > 1 && <span className="text-slate-500"> — {lrItems.length} LRs as per consignment details</span>}
                  </td>
                  <td className="py-2 px-3 text-slate-500 font-mono">{inv.sac || '996511'}</td>
                  <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">₹{formatINR(totals.freight)}</td>
                </tr>
                {inv.extra_charges && inv.extra_charges.map((ec, i) => (
                  <tr key={i}>
                    <td className="py-2 px-3 text-slate-700">{ec.label}</td>
                    <td className="py-2 px-3 text-slate-500 font-mono">{inv.sac || '996511'}</td>
                    <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">₹{formatINR(ec.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Totals Table */}
            <div className="p-3.5 border-t border-slate-200 bg-slate-50/50 space-y-1.5 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Gross Amount:</span>
                <span className="font-mono">₹{formatINR((totals as any).gross_amount || (totals.freight + (totals.additional_total || 0)))}</span>
              </div>
              {totals.discount_amount > 0 && (
                <div className="flex justify-between text-rose-600">
                  <span>Discount ({totals.discount_type}):</span>
                  <span className="font-mono">-₹{formatINR(totals.discount_amount)}</span>
                </div>
              )}
              <div className="flex justify-between text-slate-900 font-semibold pt-1 border-t border-slate-200">
                <span>Taxable Value:</span>
                <span className="font-mono">₹{formatINR(totals.taxable_amount)}</span>
              </div>
              {totals.gst_type === 'igst' ? (
                <div className="flex justify-between text-purple-600">
                  <span>IGST @ {totals.gst_rate}%:</span>
                  <span className="font-mono">₹{formatINR(totals.igst)}</span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between text-purple-600">
                    <span>CGST @ {totals.gst_rate / 2}%:</span>
                    <span className="font-mono">₹{formatINR(totals.cgst)}</span>
                  </div>
                  <div className="flex justify-between text-purple-600">
                    <span>SGST @ {totals.gst_rate / 2}%:</span>
                    <span className="font-mono">₹{formatINR(totals.sgst)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between text-slate-500">
                <span>Round Off:</span>
                <span className="font-mono">₹{formatINR(totals.round_off)}</span>
              </div>
              <div className="flex justify-between text-sm font-bold text-slate-900 pt-2 border-t border-slate-200">
                <span>GRAND TOTAL:</span>
                <span className="font-mono text-orange-600 text-base">₹{formatINR(totals.grand_total)}</span>
              </div>
              <div className="text-[11px] text-slate-500 italic pt-1">
                {numberToWords(totals.grand_total)}
              </div>
            </div>
          </div>

          {/* Payment History on this Invoice */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2">
              <span className="font-bold text-slate-900">Payment Collections</span>
              <div className="flex gap-3 text-xs">
                <span>Paid: <strong className="text-emerald-600 font-mono">₹{formatINR(inv.paid || 0)}</strong></span>
                <span>Balance: <strong className="text-orange-600 font-mono">₹{formatINR(inv.balance ?? totals.grand_total)}</strong></span>
              </div>
            </div>

            {payments.length > 0 ? (
              <div className="space-y-2">
                {payments.map((p) => (
                  <div key={p.id} className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-semibold text-slate-900">{p.method} {p.reference ? `· ${p.reference}` : ''}</div>
                      <div className="text-[11px] text-slate-500">Date: {p.payment_date}</div>
                    </div>
                    <div className="font-mono font-bold text-emerald-600 text-sm">
                      +₹{formatINR(p.amount)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-slate-400 text-xs text-center py-2">
                No payment receipts recorded for this invoice yet.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 flex items-center justify-between">
          <div>
            <button
              onClick={() => setShowDeleteModal(true)}
              className="text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 px-2.5 py-1.5 rounded-lg font-medium flex items-center gap-1.5 transition cursor-pointer border border-rose-200"
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
                className="px-4 py-2 bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Edit Invoice</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-medium transition cursor-pointer"
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
