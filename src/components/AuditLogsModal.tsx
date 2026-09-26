import React, { useState, useEffect } from 'react';
import { X, ShieldAlert, Clock, User, FileText } from 'lucide-react';
import { apiRequest } from '../services/api.js';

interface AuditLogsModalProps {
  onClose: () => void;
}

export const AuditLogsModal: React.FC<AuditLogsModalProps> = ({ onClose }) => {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await apiRequest<{ logs: any[] }>('/settings/audit-logs');
        setLogs(res.logs || []);
      } catch (err) {
        console.error('Failed to load audit logs', err);
      } finally {
        setLoading(false);
      }
    };
    fetchLogs();
  }, []);

  return (
    <div className="fixed inset-0 bg-scrim backdrop-blur-[6px] flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="sheet border border-line rounded-overlay max-w-2xl w-full max-h-[85vh] flex flex-col shadow-overlay text-ink my-auto">
        {/* Header */}
        <div className="p-4 border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-card bg-accent-soft border border-accent-line text-accent-ink flex items-center justify-center">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-ink">System Audit & Compliance Log</h2>
              <p className="text-[11px] text-ink-faint">Chronological security and invoice creation trails</p>
            </div>
          </div>

          <button onClick={onClose} className="p-1 text-ink-faint hover:text-ink rounded-control transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-2 text-xs">
          {loading ? (
            <div className="py-12 text-center text-ink-faint">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent mx-auto"></div>
            </div>
          ) : logs.length > 0 ? (
            logs.map((log) => (
              <div key={log.id} className="p-3.5 bg-surface-muted rounded-card border border-line flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="font-bold text-ink uppercase text-[11px] tracking-wide">
                    {log.action}
                  </div>
                  <div className="text-ink-soft font-mono text-[11px]">
                    {log.details ? JSON.stringify(log.details) : '-'}
                  </div>
                  <div className="text-ink-faint text-[10px] flex items-center gap-2 pt-1">
                    <span className="flex items-center gap-1">
                      <User className="w-3 h-3 text-ink-faint" />
                      {log.user_email || 'System'}
                    </span>
                  </div>
                </div>

                <div className="text-ink-faint text-[10px] whitespace-nowrap flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {new Date(log.created_at).toLocaleString()}
                </div>
              </div>
            ))
          ) : (
            <div className="py-8 text-center text-ink-faint">No audit events recorded yet.</div>
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
