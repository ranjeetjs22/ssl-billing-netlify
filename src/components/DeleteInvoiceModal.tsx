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
      className="fixed inset-0 bg-scrim backdrop-blur-[6px] flex items-center justify-center p-4 z-50 overflow-y-auto animate-fade-in"
      onClick={onClose}
    >
      <div 
        className="sheet border border-line rounded-overlay max-w-lg w-full shadow-overlay overflow-hidden my-auto text-ink"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-line flex items-start justify-between bg-surface-muted">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-card bg-danger-soft border border-danger-line flex items-center justify-center text-danger-ink">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-ink">Manage / Remove Invoice</h2>
              <p className="text-xs text-ink-faint font-mono mt-0.5">{invoice.invoice_no}</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 text-ink-faint hover:text-ink hover:bg-surface-sunken rounded-control transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 text-xs">
          {/* Invoice Summary Pill */}
          <div className="p-3.5 bg-surface-muted rounded-card border border-line space-y-2">
            <div className="flex items-center justify-between text-ink-soft">
              <span>Customer Name:</span>
              <strong className="text-ink text-right">{(invoice.buyer as any)?.name || 'Customer'}</strong>
            </div>
            <div className="flex items-center justify-between text-ink-soft">
              <span>Invoice Date:</span>
              <span className="font-mono text-ink">{invoice.invoice_date}</span>
            </div>
            <div className="flex items-center justify-between text-ink-soft">
              <span>Invoice Value:</span>
              <strong className="font-mono text-ink">₹{formatINR(grandTotal)}</strong>
            </div>
            {hasPayments && (
              <div className="flex items-center justify-between text-positive-ink pt-1 border-t border-line">
                <span>Recorded Payments:</span>
                <strong className="font-mono">₹{formatINR(paidAmount)}</strong>
              </div>
            )}
          </div>

          {/* Action Choice Tabs */}
          <div className="space-y-2">
            <label className="font-semibold text-ink block">Select Action:</label>
            
            <div className="grid grid-cols-1 gap-2.5">
              {/* Option 1: Cancel */}
              <label 
                className={`p-3.5 rounded-card border flex items-start gap-3 cursor-pointer transition ${
                  actionType === 'cancel'
                    ? 'border-accent bg-accent-soft shadow-card ring-1 ring-accent'
                    : 'border-line hover:bg-surface-muted'
                }`}
              >
                <input
                  type="radio"
                  name="action_choice"
                  checked={actionType === 'cancel'}
                  onChange={() => setActionType('cancel')}
                  className="mt-0.5 text-accent-ink focus:ring-accent"
                />
                <div className="flex-1">
                  <div className="font-bold text-ink flex items-center justify-between">
                    <span>Cancel Invoice (Recommended)</span>
                    <span className="text-[10px] bg-surface-sunken text-ink-soft px-2 py-0.5 rounded font-medium">GST Compliant</span>
                  </div>
                  <p className="text-ink-faint text-[11px] mt-1 leading-relaxed">
                    Voids the invoice, zeroes out the balance, but preserves the invoice number in your sequence for tax auditing.
                  </p>
                </div>
              </label>

              {/* Option 2: Permanent Delete */}
              <label 
                className={`p-3.5 rounded-card border flex items-start gap-3 cursor-pointer transition ${
                  actionType === 'delete'
                    ? 'border-danger bg-danger-soft shadow-card ring-1 ring-danger'
                    : 'border-line hover:bg-surface-muted'
                }`}
              >
                <input
                  type="radio"
                  name="action_choice"
                  checked={actionType === 'delete'}
                  onChange={() => setActionType('delete')}
                  className="mt-0.5 text-danger-ink focus:ring-danger"
                />
                <div className="flex-1">
                  <div className="font-bold text-danger-ink flex items-center justify-between">
                    <span>Permanently Delete Invoice</span>
                    <span className="text-[10px] bg-danger-soft text-danger-ink px-2 py-0.5 rounded font-medium">Irreversible</span>
                  </div>
                  <p className="text-ink-faint text-[11px] mt-1 leading-relaxed">
                    Completely removes the invoice record and any associated payment transactions from the database.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Payment Warning if applicable */}
          {hasPayments && (
            <div className="p-3 bg-warning-soft rounded-card border border-warning-line text-warning-ink flex items-start gap-2.5">
              <Info className="w-4 h-4 text-warning-ink shrink-0 mt-0.5" />
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
            <div className="p-3 bg-danger-soft border border-danger-line text-danger-ink rounded-card flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="text-xs">{error}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-line bg-surface-muted flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 bg-surface hover:bg-surface-sunken text-ink-soft border border-line rounded-card font-semibold transition cursor-pointer"
          >
            Go Back
          </button>

          <button
            type="button"
            onClick={handleExecute}
            disabled={loading}
            className={`px-4 py-2.5 min-h-[42px] rounded-control border font-medium flex items-center gap-1.5 transition cursor-pointer ${
              actionType === 'delete'
                ? 'bg-surface text-danger-ink border-danger-line hover:bg-danger-soft hover:border-danger'
                : 'bg-accent-soft text-accent-ink border-accent-line hover:border-accent'
            } ${loading ? 'opacity-70 cursor-not-allowed' : ''}`}
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
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
