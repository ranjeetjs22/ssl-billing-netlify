import React, { useState, useEffect } from 'react';
import { MessageSquare, Copy, Check, CircleCheck } from 'lucide-react';
import { apiRequest } from '../services/api.js';
import { formatINR } from '../utils/format.js';
import { Modal, Button, Badge, Spinner, EmptyState } from './ui.js';

interface OverdueModalProps {
  onClose: () => void;
}

export const OverdueModal: React.FC<OverdueModalProps> = ({ onClose }) => {
  // <Modal> registers the phone Back button, so it closes this instead of leaving the app
  const [items, setItems] = useState<any[]>([]);
  const [totalOverdue, setTotalOverdue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    const fetchOverdue = async () => {
      try {
        const res = await apiRequest<{ items: any[]; total_overdue: number }>('/invoices/overdue');
        setItems(res.items || []);
        setTotalOverdue(res.total_overdue || 0);
      } catch (err) {
        console.error('Failed to load overdue invoices', err);
      } finally {
        setLoading(false);
      }
    };
    fetchOverdue();
  }, []);

  const copyMessage = (item: any) => {
    navigator.clipboard.writeText(item.message);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const openWhatsApp = (item: any) => {
    const phone = (item.whatsapp || item.phone || '').replace(/[^0-9]/g, '');
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(item.message)}`;
    window.open(url, '_blank');
  };

  return (
    <Modal
      onClose={onClose}
      size="lg"
      title="Overdue bills and reminders"
      subtitle={loading ? 'Loading…' : `₹${formatINR(totalOverdue)} overdue across ${items.length} bill${items.length === 1 ? '' : 's'}`}
      footer={
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      }
    >
      {loading ? (
        <Spinner label="Loading overdue bills" />
      ) : items.length === 0 ? (
        <EmptyState icon={<CircleCheck />} title="Nothing overdue" message="All collections are up to date." />
      ) : (
        <ul className="-mx-4 sm:-mx-5 -my-4 divide-y divide-line">
          {items.map((item) => (
            <li key={item.id} className="px-4 sm:px-5 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink truncate">{item.customer_name}</div>
                  <div className="text-xs text-ink-faint mt-0.5 flex flex-wrap items-center gap-x-1.5">
                    <span className="font-mono text-[13px] text-ink-soft">{item.invoice_no}</span>
                    <span aria-hidden="true">·</span>
                    <span>Due <span className="tabular-nums">{item.due_date}</span></span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm tabular-nums font-medium text-ink">₹{formatINR(item.balance)}</div>
                  <div className="mt-1">
                    <Badge tone="danger" dot>{item.days_overdue} days overdue</Badge>
                  </div>
                </div>
              </div>

              {/* Ready-made WhatsApp / SMS reminder */}
              <p className="mt-2.5 px-2.5 py-2 rounded-control bg-surface-muted border border-line text-xs text-ink-soft leading-relaxed">
                {item.message}
              </p>

              <div className="mt-2 flex items-center justify-end gap-1.5">
                <Button variant="ghost" size="sm" onClick={() => copyMessage(item)}
                  icon={copiedId === item.id ? <Check className="text-positive" /> : <Copy />}>
                  {copiedId === item.id ? 'Copied' : 'Copy text'}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => openWhatsApp(item)} icon={<MessageSquare />}>
                  Send on WhatsApp
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
};
