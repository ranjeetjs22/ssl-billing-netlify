import React, { useState } from 'react';
import { Trash2, XCircle } from 'lucide-react';
import { Invoice } from '../types.js';
import { formatINR } from '../utils/format.js';
import { apiRequest } from '../services/api.js';
import { Modal, Button, Badge, FormError, cx } from './ui.js';

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
  // <Modal> registers the phone Back button, so it closes this instead of leaving the app
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

  const options = [
    {
      key: 'cancel' as const,
      title: 'Cancel invoice',
      tag: <Badge tone="neutral">Recommended</Badge>,
      body: 'Voids the invoice and zeroes the balance, but keeps its number in your series for GST audit.',
    },
    {
      key: 'delete' as const,
      title: 'Delete permanently',
      tag: <Badge tone="danger">Irreversible</Badge>,
      body: 'Removes the invoice and any payments recorded against it from the database.',
    },
  ];

  return (
    <Modal
      onClose={() => { if (!loading) onClose(); }}
      title="Cancel or delete invoice"
      subtitle={invoice.invoice_no}
      size="md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={loading}>Go back</Button>
          <Button
            variant={actionType === 'delete' ? 'danger' : 'primary'}
            onClick={handleExecute}
            loading={loading}
            icon={actionType === 'delete' ? <Trash2 /> : <XCircle />}
          >
            {loading ? 'Working…' : actionType === 'delete' ? 'Delete permanently' : 'Cancel invoice'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <FormError message={error} />

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          <div className="col-span-2 min-w-0">
            <dt className="text-xs text-ink-faint">Customer</dt>
            <dd className="text-sm text-ink truncate">{(invoice.buyer as any)?.name || 'Customer'}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">Invoice date</dt>
            <dd className="text-sm text-ink tabular-nums">{invoice.invoice_date}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">Invoice value</dt>
            <dd className="text-sm text-ink tabular-nums font-medium">₹{formatINR(grandTotal)}</dd>
          </div>
          {hasPayments && (
            <div>
              <dt className="text-xs text-ink-faint">Payments received</dt>
              <dd className="text-sm text-positive-ink tabular-nums font-medium">₹{formatINR(paidAmount)}</dd>
            </div>
          )}
        </dl>

        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-ink-soft mb-1.5">What should happen to it?</legend>
          {options.map(o => {
            const on = actionType === o.key;
            return (
              <label
                key={o.key}
                className={cx(
                  'flex items-start gap-2.5 p-3 rounded-control border cursor-pointer transition-colors duration-[var(--duration-fast)]',
                  on
                    ? (o.key === 'delete' ? 'border-danger-line bg-danger-soft' : 'border-accent-line bg-accent-soft')
                    : 'border-line hover:border-line-strong'
                )}
              >
                <input
                  type="radio"
                  name="action_choice"
                  checked={on}
                  onChange={() => setActionType(o.key)}
                  className="mt-0.5 w-4 h-4 shrink-0"
                />
                <span className="flex-1 min-w-0">
                  <span className="flex items-center justify-between gap-2">
                    <span className={cx('text-sm font-medium', o.key === 'delete' ? 'text-danger-ink' : 'text-ink')}>{o.title}</span>
                    {o.tag}
                  </span>
                  <span className="block text-xs text-ink-faint mt-0.5">{o.body}</span>
                </span>
              </label>
            );
          })}
        </fieldset>

        {hasPayments && (
          <p className="px-3 py-2 rounded-control border border-warning-line bg-warning-soft text-sm text-warning-ink">
            ₹{formatINR(paidAmount)} has been received against this invoice.
            {actionType === 'delete'
              ? ' Deleting it also deletes those payment receipts, so no orphaned records remain.'
              : ' Cancelling voids the remaining dues and records an audit entry.'}
          </p>
        )}
      </div>
    </Modal>
  );
};
