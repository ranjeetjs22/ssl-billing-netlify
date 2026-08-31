import React, { useState, useEffect, useCallback } from 'react';
import { Users, Plus, Search, Phone, MapPin, ChevronRight } from 'lucide-react';
import { apiRequest } from '../services/api.js';
import { Customer, CompanySettings } from '../types.js';
import { formatINR } from '../utils/format.js';
import {
  Button, Card, StatCard, DataTable, Column, EmptyState, ErrorState, Badge, Input, cx,
} from './ui.js';

interface CustomerListProps {
  onNewCustomer: () => void;
  onSelectCustomer: (cust: Customer) => void;
  companySettings: CompanySettings;
}

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'outstanding', label: 'With balance' },
  { key: 'overdue', label: 'Overdue' },
] as const;

type FilterKey = (typeof TABS)[number]['key'];

export const CustomerList: React.FC<CustomerListProps> = ({ onNewCustomer, onSelectCustomer }) => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<FilterKey>('all');
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({ total_outstanding: 0, total_overdue: 0 });

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      let url = `/customers?page=1&page_size=200`;
      if (search) url += `&search=${encodeURIComponent(search)}`;
      const res = await apiRequest<{ items: Customer[]; total: number; summary?: any }>(url);
      setCustomers(res.items || []);
      setTotal(res.total || 0);
      if (res.summary) {
        setSummary({
          total_outstanding: res.summary.total_outstanding || 0,
          total_overdue: res.summary.total_overdue || 0,
        });
      }
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  const displayed = customers.filter((c) => {
    const outstanding = (c.outstanding ?? c.balance) || 0;
    if (filterType === 'outstanding') return outstanding > 0.01;
    if (filterType === 'overdue') return (c.overdue_amount || 0) > 0.01;
    return true;
  });

  const columns: Column<Customer>[] = [
    {
      key: 'name',
      header: 'Customer',
      cell: (c) => (
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="w-9 h-9 rounded-xl bg-accent-soft border border-accent-line text-accent-ink font-bold
                       flex items-center justify-center shrink-0 text-sm"
            aria-hidden="true"
          >
            {(c.name || '?').charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block font-semibold text-ink truncate max-w-[220px]">{c.name}</span>
            <span className="block text-xs text-ink-faint truncate">{c.contact_person || c.gstin || 'Consignee'}</span>
          </span>
        </div>
      ),
    },
    {
      key: 'location',
      header: 'Location',
      hideBelow: 'md',
      cell: (c) => (
        <span className="text-ink-soft truncate block max-w-[160px]">
          {[c.city, c.state].filter(Boolean).join(', ') || '—'}
        </span>
      ),
    },
    {
      key: 'phone',
      header: 'Phone',
      hideBelow: 'lg',
      cell: (c) => <span className="font-mono text-xs text-ink-soft">{c.phone || '—'}</span>,
    },
    {
      key: 'invoices',
      header: 'Invoices',
      align: 'center',
      hideBelow: 'lg',
      cell: (c) => <span className="font-mono text-ink-soft">{c.invoice_count ?? 0}</span>,
    },
    {
      key: 'outstanding',
      header: 'Outstanding',
      align: 'right',
      cell: (c) => {
        const bal = (c.outstanding ?? c.balance) || 0;
        return (
          <span className={cx('font-mono font-bold', bal > 0.01 ? 'text-warning-ink' : 'text-ink-faint')}>
            ₹{formatINR(bal)}
          </span>
        );
      },
    },
    {
      key: 'overdue',
      header: 'Overdue',
      align: 'right',
      cell: (c) =>
        (c.overdue_amount || 0) > 0.01 ? (
          <Badge tone="danger">₹{formatINR(c.overdue_amount)}</Badge>
        ) : (
          <span className="text-ink-faint">—</span>
        ),
    },
  ];

  const mobileCard = (c: Customer) => {
    const bal = (c.outstanding ?? c.balance) || 0;
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className="w-9 h-9 rounded-xl bg-accent-soft border border-accent-line text-accent-ink font-bold
                         flex items-center justify-center shrink-0 text-sm"
              aria-hidden="true"
            >
              {(c.name || '?').charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-ink truncate">{c.name}</span>
              <span className="block text-xs text-ink-faint truncate">{c.contact_person || 'Consignee'}</span>
            </span>
          </div>
          <ChevronRight className="w-4 h-4 text-ink-faint shrink-0" aria-hidden="true" />
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
          {c.city && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3 h-3" aria-hidden="true" />
              {[c.city, c.state].filter(Boolean).join(', ')}
            </span>
          )}
          {c.phone && (
            <span className="inline-flex items-center gap-1 font-mono">
              <Phone className="w-3 h-3" aria-hidden="true" />
              {c.phone}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 pt-2 border-t border-line">
          <span className="text-xs text-ink-faint">
            Outstanding{' '}
            <span className={cx('font-mono font-bold', bal > 0.01 ? 'text-warning-ink' : 'text-ink-faint')}>
              ₹{formatINR(bal)}
            </span>
          </span>
          {(c.overdue_amount || 0) > 0.01 && <Badge tone="danger">₹{formatINR(c.overdue_amount)} overdue</Badge>}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        <StatCard label="Customers" value={total} icon={<Users className="w-4 h-4" />} loading={loading} />
        <StatCard label="Outstanding" value={`₹${formatINR(summary.total_outstanding)}`} tone="warning" loading={loading} />
        <StatCard
          label="Overdue"
          value={`₹${formatINR(summary.total_overdue)}`}
          tone="danger"
          loading={loading}
          className="col-span-2 lg:col-span-1"
        />
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div
          role="tablist"
          aria-label="Filter customers"
          className="flex items-center gap-1 bg-surface border border-line rounded-xl p-1 overflow-x-auto shadow-card"
        >
          {TABS.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={filterType === tab.key}
              onClick={() => setFilterType(tab.key)}
              className={cx(
                'px-3 min-h-[38px] rounded-lg text-sm font-medium whitespace-nowrap cursor-pointer transition-colors duration-150',
                filterType === tab.key
                  ? 'bg-accent-strong text-on-accent font-semibold'
                  : 'text-ink-soft hover:bg-surface-sunken hover:text-ink'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative flex-1 lg:max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none z-10" aria-hidden="true" />
          <Input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name, city, GSTIN or phone"
            aria-label="Search customers"
            className="pl-9"
          />
        </div>

        <Button
          variant="primary"
          size="sm"
          icon={<Plus className="w-4 h-4" />}
          onClick={onNewCustomer}
          className="lg:ml-auto"
          id="new-customer-btn"
        >
          Add Customer
        </Button>
      </div>

      <Card padded={false} className="overflow-hidden">
        {loadError ? (
          <ErrorState message={loadError} onRetry={fetchCustomers} />
        ) : (
          <DataTable
            rows={displayed}
            columns={columns}
            loading={loading}
            onRowClick={onSelectCustomer}
            mobileCard={mobileCard}
            caption="Customer directory"
            empty={
              <EmptyState
                icon={<Users className="w-6 h-6" />}
                title={search || filterType !== 'all' ? 'No matching customers' : 'No customers yet'}
                message={
                  search || filterType !== 'all'
                    ? 'Try a different search term or filter.'
                    : 'Add your first consignee to start raising invoices.'
                }
                action={
                  search || filterType !== 'all' ? (
                    <Button variant="secondary" onClick={() => { setSearchInput(''); setFilterType('all'); }}>
                      Clear filters
                    </Button>
                  ) : (
                    <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={onNewCustomer}>
                      Add Customer
                    </Button>
                  )
                }
              />
            }
          />
        )}
      </Card>
    </div>
  );
};
