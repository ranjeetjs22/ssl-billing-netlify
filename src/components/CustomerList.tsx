import React, { useState, useEffect, useCallback } from 'react';
import { Users, Plus, Search, Pencil } from 'lucide-react';
import { apiRequest } from '../services/api.js';
import { Customer, CompanySettings } from '../types.js';
import { formatINR } from '../utils/format.js';
import {
  Button, IconButton, Card, Metric, AvatarChip, Segmented, DataTable, Column, EmptyState, ErrorState, Input, cx,
} from './ui.js';

interface CustomerListProps {
  onNewCustomer: () => void;
  onSelectCustomer: (cust: Customer) => void;
  onEditCustomer?: (cust: Customer) => void;
  companySettings: CompanySettings;
}

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'outstanding', label: 'With balance' },
  { key: 'overdue', label: 'Overdue' },
] as const;

type FilterKey = (typeof TABS)[number]['key'];

export const CustomerList: React.FC<CustomerListProps> = ({ onNewCustomer, onSelectCustomer, onEditCustomer }) => {
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

  const counts: Record<FilterKey, number> = {
    all: customers.length,
    outstanding: customers.filter((c) => ((c.outstanding ?? c.balance) || 0) > 0.01).length,
    overdue: customers.filter((c) => (c.overdue_amount || 0) > 0.01).length,
  };
  const filterOptions = TABS.map((t) => ({ value: t.key, label: t.label, count: counts[t.key] }));

  const columns: Column<Customer>[] = [
    {
      key: 'name',
      header: 'Customer',
      cell: (c) => (
        <div className="flex items-center gap-2.5 min-w-0">
          <AvatarChip name={c.name} square />
          <span className="min-w-0">
            <span className="block font-medium text-ink truncate max-w-[260px]">{c.name}</span>
            <span className="block text-xs text-ink-faint truncate max-w-[260px]">
              {c.contact_person || (c.gstin ? <span className="font-mono">{c.gstin}</span> : 'Consignee')}
            </span>
          </span>
        </div>
      ),
    },
    {
      key: 'location',
      header: 'Location',
      hideBelow: 'md',
      cell: (c) => (
        <span className="text-ink-soft truncate block max-w-[180px]">
          {[c.city, c.state].filter(Boolean).join(', ') || '-'}
        </span>
      ),
    },
    {
      key: 'phone',
      header: 'Phone',
      hideBelow: 'lg',
      cell: (c) => <span className="tabular-nums text-ink-soft whitespace-nowrap">{c.phone || '-'}</span>,
    },
    {
      key: 'invoices',
      header: 'Bills',
      align: 'right',
      hideBelow: 'lg',
      cell: (c) => <span className="tabular-nums text-ink-soft">{c.invoice_count ?? 0}</span>,
    },
    {
      key: 'outstanding',
      header: 'Outstanding',
      align: 'right',
      cell: (c) => {
        const bal = (c.outstanding ?? c.balance) || 0;
        return (
          <span className={cx('tabular-nums font-medium whitespace-nowrap', bal > 0.01 ? 'text-warning-ink' : 'text-ink-faint')}>
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
          <span className="tabular-nums font-medium text-danger-ink whitespace-nowrap">₹{formatINR(c.overdue_amount)}</span>
        ) : (
          <span className="text-ink-faint">-</span>
        ),
    },
    ...(onEditCustomer ? [{
      key: 'edit',
      header: '',
      align: 'right' as const,
      className: 'w-12',
      cell: (c: Customer) => (
        <div onClick={(e) => e.stopPropagation()}>
          <IconButton label={`Edit ${c.name}`} onClick={() => onEditCustomer(c)}>
            <Pencil />
          </IconButton>
        </div>
      ),
    }] : []),
  ];

  const mobileCard = (c: Customer) => {
    const bal = (c.outstanding ?? c.balance) || 0;
    const place = [c.city, c.state].filter(Boolean).join(', ');
    return (
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-sm text-ink truncate">{c.name}</div>
          <div className="text-xs text-ink-faint truncate mt-0.5">
            {[c.contact_person, place, c.phone].filter(Boolean).join(' · ') || 'Consignee'}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className={cx('tabular-nums font-medium text-sm', bal > 0.01 ? 'text-warning-ink' : 'text-ink-faint')}>
            ₹{formatINR(bal)}
          </div>
          {(c.overdue_amount || 0) > 0.01 ? (
            <div className="text-xs tabular-nums text-danger-ink mt-0.5">₹{formatINR(c.overdue_amount)} overdue</div>
          ) : (
            <div className="text-xs text-ink-faint mt-0.5">{c.invoice_count ?? 0} bill{(c.invoice_count ?? 0) === 1 ? '' : 's'}</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* KPI band: count stays narrow, the two money figures share the rest */}
      <div className="panel overflow-hidden grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.1fr)_minmax(0,1.1fr)] lg:grid-cols-3 divide-x divide-line">
        <Metric label="Customers" value={<span className="tabular-nums">{total}</span>} loading={loading} />
        <Metric label="Outstanding" value={`₹${formatINR(summary.total_outstanding)}`} tone="warning" loading={loading} />
        <Metric label="Overdue" value={`₹${formatINR(summary.total_overdue)}`} tone="danger" loading={loading} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented<FilterKey> label="Filter customers" options={filterOptions} value={filterType} onChange={setFilterType} />

        <Button
          variant="primary"
          icon={<Plus />}
          onClick={onNewCustomer}
          className="ml-auto lg:order-last"
          id="new-customer-btn"
        >
          <span className="sm:hidden">Add</span>
          <span className="hidden sm:inline">Add customer</span>
        </Button>

        <div className="relative w-full lg:w-auto lg:flex-1 lg:max-w-sm">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none z-10" aria-hidden="true" />
          <Input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name, city, GSTIN or phone"
            aria-label="Search customers"
            className="pl-8"
          />
        </div>
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
                icon={<Users />}
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
                    <Button variant="secondary" icon={<Plus />} onClick={onNewCustomer}>
                      Add customer
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
