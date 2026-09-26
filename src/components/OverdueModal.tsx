import React, { useState, useEffect } from 'react';
import { X, AlertTriangle, MessageSquare, Copy, Check, ExternalLink } from 'lucide-react';
import { apiRequest } from '../services/api.js';
import { formatINR } from '../utils/format.js';

interface OverdueModalProps {
  onClose: () => void;
}

export const OverdueModal: React.FC<OverdueModalProps> = ({ onClose }) => {
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
    <div className="fixed inset-0 bg-scrim backdrop-blur-[6px] flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="sheet border border-line rounded-overlay max-w-3xl w-full max-h-[90vh] flex flex-col shadow-overlay text-ink my-auto">
        {/* Header */}
        <div className="p-4 border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-card bg-danger-soft border border-danger-line flex items-center justify-center text-danger-ink">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-ink">Overdue Invoices & Reminders</h2>
              <p className="text-[11px] text-ink-faint">Total Overdue: <strong className="text-danger-ink font-mono">₹{formatINR(totalOverdue)}</strong> ({items.length} accounts)</p>
            </div>
          </div>

          <button onClick={onClose} className="p-1 text-ink-faint hover:text-ink rounded-control transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3.5 text-xs">
          {loading ? (
            <div className="py-12 text-center text-ink-faint">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-danger mx-auto"></div>
            </div>
          ) : items.length > 0 ? (
            items.map((item) => (
              <div key={item.id} className="bg-surface-muted p-4 rounded-card border border-line hover:border-line-strong transition space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-line pb-2.5">
                  <div>
                    <div className="font-bold text-sm text-ink">{item.customer_name}</div>
                    <div className="text-[11px] text-ink-faint flex items-center gap-2 mt-0.5">
                      <span>Invoice: <strong className="text-ink font-mono">{item.invoice_no}</strong></span>
                      <span>·</span>
                      <span>Due Date: <strong className="text-danger-ink font-medium">{item.due_date}</strong></span>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] bg-danger-soft text-danger-ink font-semibold px-2 py-0.5 rounded-full border border-danger-line">
                      {item.days_overdue} Days Overdue
                    </span>
                    <div className="font-mono font-bold text-accent-ink text-sm mt-1">
                      ₹{formatINR(item.balance)} Due
                    </div>
                  </div>
                </div>

                {/* Pre-crafted WhatsApp / SMS reminder */}
                <div className="p-3 bg-surface rounded-card border border-line text-[11px] text-ink-soft italic">
                  "{item.message}"
                </div>

                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => copyMessage(item)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-surface hover:bg-surface-sunken text-ink-soft border border-line rounded-card text-xs font-medium transition shadow-card"
                  >
                    {copiedId === item.id ? <Check className="w-3.5 h-3.5 text-positive-ink" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedId === item.id ? 'Copied' : 'Copy Text'}</span>
                  </button>

                  <button
                    onClick={() => openWhatsApp(item)}
                    className="flex items-center gap-1 px-3.5 py-1.5 bg-surface text-positive-ink border border-positive-line hover:bg-positive-soft hover:border-positive rounded-card text-xs font-semibold shadow-card transition"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Send WhatsApp</span>
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-12 text-ink-faint text-xs">
              No accounts are currently overdue. All collections are up to date.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-line flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-surface-sunken hover:bg-surface-sunken text-ink-soft rounded-card text-xs font-medium transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
