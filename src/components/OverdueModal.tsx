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
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl text-slate-800 my-auto">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Overdue Invoices & Reminders</h2>
              <p className="text-[11px] text-slate-500">Total Overdue: <strong className="text-rose-600 font-mono">₹{formatINR(totalOverdue)}</strong> ({items.length} accounts)</p>
            </div>
          </div>

          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 rounded-lg transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3.5 text-xs">
          {loading ? (
            <div className="py-12 text-center text-slate-400">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-rose-600 mx-auto"></div>
            </div>
          ) : items.length > 0 ? (
            items.map((item) => (
              <div key={item.id} className="bg-slate-50 p-4 rounded-xl border border-slate-200 hover:border-slate-300 transition space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
                  <div>
                    <div className="font-bold text-sm text-slate-900">{item.customer_name}</div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                      <span>Invoice: <strong className="text-slate-800 font-mono">{item.invoice_no}</strong></span>
                      <span>·</span>
                      <span>Due Date: <strong className="text-rose-600 font-medium">{item.due_date}</strong></span>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] bg-rose-50 text-rose-700 font-semibold px-2 py-0.5 rounded-full border border-rose-200">
                      {item.days_overdue} Days Overdue
                    </span>
                    <div className="font-mono font-bold text-orange-600 text-sm mt-1">
                      ₹{formatINR(item.balance)} Due
                    </div>
                  </div>
                </div>

                {/* Pre-crafted WhatsApp / SMS reminder */}
                <div className="p-3 bg-white rounded-xl border border-slate-200 text-[11px] text-slate-700 italic">
                  "{item.message}"
                </div>

                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => copyMessage(item)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-medium transition shadow-xs"
                  >
                    {copiedId === item.id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedId === item.id ? 'Copied' : 'Copy Text'}</span>
                  </button>

                  <button
                    onClick={() => openWhatsApp(item)}
                    className="flex items-center gap-1 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-xs transition"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Send WhatsApp</span>
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-12 text-slate-500 text-xs">
              No accounts are currently overdue. All collections are up to date.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-medium transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
