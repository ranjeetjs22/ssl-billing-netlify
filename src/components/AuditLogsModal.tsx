import React, { useState, useEffect } from 'react';
import { ShieldCheck } from 'lucide-react';
import { apiRequest } from '../services/api.js';
import { Modal, Button, Spinner, EmptyState } from './ui.js';

interface AuditLogsModalProps {
  onClose: () => void;
}

export const AuditLogsModal: React.FC<AuditLogsModalProps> = ({ onClose }) => {
  // <Modal> registers the phone Back button, so it closes this instead of leaving the app
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
    <Modal
      onClose={onClose}
      size="lg"
      title="Audit log"
      subtitle="Sign-ins, settings and invoice changes, newest first"
      footer={
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      }
    >
      {loading ? (
        <Spinner label="Loading audit log" />
      ) : logs.length === 0 ? (
        <EmptyState icon={<ShieldCheck />} title="No audit events yet" />
      ) : (
        <ul className="-mx-4 sm:-mx-5 -my-4 divide-y divide-line">
          {logs.map((log) => (
            <li key={log.id} className="px-4 sm:px-5 py-2.5 min-w-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-ink truncate">{log.action}</span>
                <time className="text-xs text-ink-faint tabular-nums whitespace-nowrap shrink-0" dateTime={log.created_at}>
                  {new Date(log.created_at).toLocaleString()}
                </time>
              </div>
              <div className="text-xs text-ink-faint mt-0.5 truncate">{log.user_email || 'System'}</div>
              {log.details && (
                <pre className="mt-1.5 px-2 py-1.5 rounded-control bg-surface-muted border border-line font-mono text-[11px] text-ink-soft whitespace-pre-wrap break-all">
                  {JSON.stringify(log.details)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
};
