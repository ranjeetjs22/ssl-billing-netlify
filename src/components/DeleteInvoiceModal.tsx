import React, { useState } from 'react';
import { 
   AlertTriangle, 
   Trash2, 
   XCircle, 
   X, 
   FileText, 
   CheckCircle2,
   AlertCircle,
   Info
 } from 'lucide-react';
import { Invoice } from '../types.js';
import { formatINR } from '../utils/format.js';
import { apiRequest } from '../services/api.js';

interface DeleteInvoiceModalProps {
  invoice: Invoice;
  onClose: () => void;
  onSuccess: (message?: string) => void;
}

export const DeleteInvoiceModal: React.FC<DeleteInvoiceModalProps> = ({
  invoice,
  onClose,
  onSuccess,
}) => {
  const [actionType, setActionType] = useState<'cancel' | 'delete'>('cancel');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forceCancel, setForceCancel] = useState(false);

  const grandTotal = invoice.totals?.grand_total || invoice.grand_total || 0;
  const paidAmount = invoice.paid || 0;
  const hasPayments = paidAmount > 0;

  const handleExecute = async () => {
    setLoading(true);
    setError(null);

    try {
      if (actionType === 'cancel') {
        const res = await apiRequest<{ message?: string }>(`/invoices/${invoice.id}/cancel`, {
          method: 'POST',
          body: JSON.stringify({ force: forceCancel || hasPayments }),
        });
        onSuccess(res.message || `Invoice ${invoice.invoice_no} has been cancelled.`);
      } else {
        // Permanent Delete
        const res = await apiRequest<{ message?: string }>(`/invoices/${invoice.id}`, {
          method: 'DELETE',
        });
        onSuccess(res.message || `Invoice ${invoice.invoice_no} was permanently removed.`);
      }
    } catch (err: any) {
      console.error('Invoice action failed:', err);
      setError(err.message || 'An error occurred while processing the request. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div 
        className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden my-auto text-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-start justify-between bg-slate-50/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Manage / Remove Invoice</h2>
              <p className="text-xs text-slate-500 font-mono mt-0.5">{invoice.invoice_no}</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 text-xs">
          {/* Invoice Summary Pill */}
          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
            <div className="flex items-center justify-between text-slate-600">
              <span>Customer Name:</span>
              <strong className="text-slate-900 text-right">{(invoice.buyer as any)?.name || 'Customer'}</strong>
            </div>
            <div className="flex items-center justify-between text-slate-600">
              <span>Invoice Date:</span>
              <span className="font-mono text-slate-900">{invoice.invoice_date}</span>
            </div>
            <div className="flex items-center justify-between text-slate-600">
              <span>Invoice Value:</span>
              <strong className="font-mono text-slate-900">₹{formatINR(grandTotal)}</strong>
            </div>
            {hasPayments && (
              <div className="flex items-center justify-between text-emerald-700 pt-1 border-t border-slate-200">
                <span>Recorded Payments:</span>
                <strong className="font-mono">₹{formatINR(paidAmount)}</strong>
              </div>
            )}
          </div>

          {/* Action Choice Tabs */}
          <div className="space-y-2">
            <label className="font-semibold text-slate-900 block">Select Action:</label>
            
            <div className="grid grid-cols-1 gap-2.5">
              {/* Option 1: Cancel */}
              <label 
                className={`p-3.5 rounded-xl border flex items-start gap-3 cursor-pointer transition ${
                  actionType === 'cancel'
                    ? 'border-orange-500 bg-orange-50/40 shadow-xs ring-1 ring-orange-500'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="action_choice"
                  checked={actionType === 'cancel'}
                  onChange={() => setActionType('cancel')}
                  className="mt-0.5 text-orange-600 focus:ring-orange-500"
                />
                <div className="flex-1">
                  <div className="font-bold text-slate-900 flex items-center justify-between">
                    <span>Cancel Invoice (Recommended)</span>
                    <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-medium">GST Compliant</span>
                  </div>
                  <p className="text-slate-500 text-[11px] mt-1 leading-relaxed">
                    Voids the invoice, zeroes out the balance, but preserves the invoice number in your sequence for tax auditing.
                  </p>
                </div>
              </label>

              {/* Option 2: Permanent Delete */}
              <label 
                className={`p-3.5 rounded-xl border flex items-start gap-3 cursor-pointer transition ${
                  actionType === 'delete'
                    ? 'border-rose-500 bg-rose-50/40 shadow-xs ring-1 ring-rose-500'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="action_choice"
                  checked={actionType === 'delete'}
                  onChange={() => setActionType('delete')}
                  className="mt-0.5 text-rose-600 focus:ring-rose-500"
                />
                <div className="flex-1">
                  <div className="font-bold text-rose-700 flex items-center justify-between">
                    <span>Permanently Delete Invoice</span>
                    <span className="text-[10px] bg-rose-100 text-rose-700 px-2 py-0.5 rounded font-medium">Irreversible</span>
                  </div>
                  <p className="text-slate-500 text-[11px] mt-1 leading-relaxed">
                    Completely removes the invoice record and any associated payment transactions from the database.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Payment Warning if applicable */}
          {hasPayments && (
            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-800 flex items-start gap-2.5">
              <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-[11px] leading-relaxed">
                <strong>Notice:</strong> This invoice has <strong>₹{formatINR(paidAmount)}</strong> in payment receipts.
                {actionType === 'delete' ? (
                  <span> Deleting this invoice will also delete those payment receipts to prevent orphaned records.</span>
                ) : (
                  <span> Cancelling will void the remaining dues and record an audit log.</span>
                )}
              </div>
            </div>
          )}

          {/* Error Message if any */}
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="text-xs">{error}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/60 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl font-semibold transition cursor-pointer"
          >
            Go Back
          </button>

          <button
            type="button"
            onClick={handleExecute}
            disabled={loading}
            className={`px-4 py-2 rounded-xl text-white font-semibold flex items-center gap-1.5 shadow-xs transition cursor-pointer ${
              actionType === 'delete'
                ? 'bg-rose-600 hover:bg-rose-700'
                : 'bg-orange-600 hover:bg-orange-700'
            } ${loading ? 'opacity-70 cursor-not-allowed' : ''}`}
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : actionType === 'delete' ? (
              <Trash2 className="w-4 h-4" />
            ) : (
              <XCircle className="w-4 h-4" />
            )}
            <span>
              {loading 
                ? 'Processing...' 
                : actionType === 'delete' 
                ? 'Permanently Delete' 
                : 'Confirm Cancellation'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
