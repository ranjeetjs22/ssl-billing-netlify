import React from 'react';
import { Plus, Wallet, UserPlus, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { CompanySettings } from '../types.js';
import { hardRefresh } from '../services/api.js';
import { cx, IconButton, Button } from './ui.js';
import { BrandMark } from './Sidebar.js';

interface TopHeaderProps {
  activeTab: string;
  onToggleSidebar: () => void;
  onNewInvoice: () => void;
  onReceivePayment: () => void;
  onNewCustomer: () => void;
  companySettings?: CompanySettings;
}

const STROKE = 1.75;

const TAB_TITLES: Record<string, { title: string; hint: string }> = {
  dashboard: { title: 'Overview', hint: 'Sales, collections and dues at a glance' },
  invoices: { title: 'Invoices', hint: 'GST tax invoices and non-GST bills' },
  customers: { title: 'Customers', hint: 'Parties, statements and balances' },
  payments: { title: 'Payments', hint: 'Receipts recorded against invoices' },
  rates: { title: 'Rate calculator', hint: 'Freight quotes and rate charts' },
  expenses: { title: 'Expenses', hint: 'Rent, salaries and other overheads' },
  reports: { title: 'Reports', hint: 'Sales, GST, collections and dues' },
  settings: { title: 'Settings', hint: 'Company profile, GST and bank details' },
  users: { title: 'Users', hint: 'Staff accounts and permissions' },
};

/**
 * Page header. Desktop: title + hint on the left, quick actions on the right.
 * Phone: brand mark + title, one primary action - navigation lives in the tab bar.
 */
export const TopHeader: React.FC<TopHeaderProps> = ({
  activeTab,
  onNewInvoice,
  onReceivePayment,
  onNewCustomer,
}) => {
  const { user } = useAuth();
  const meta = TAB_TITLES[activeTab] || { title: activeTab, hint: '' };
  const [refreshing, setRefreshing] = React.useState(false);

  const hasModule = (mod: string) => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return Boolean(user.modules?.includes(mod));
  };

  return (
    <header className="sticky top-0 z-30 pt-safe bg-canvas border-b border-line">
      <div className="h-12 px-3 sm:px-6 flex items-center justify-between gap-3 max-w-[1440px] mx-auto">
        <div className="flex items-center gap-2.5 min-w-0">
          <BrandMark className="w-6 h-6 text-xs lg:hidden" />
          <div className="min-w-0 flex items-baseline gap-3">
            <h1 className="text-base font-semibold text-ink leading-tight truncate">{meta.title}</h1>
            <p className="hidden md:block text-xs text-ink-faint truncate">{meta.hint}</p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* IconButton sets its own display, so responsive hiding goes on a wrapper */}
          <div className="hidden md:flex items-center gap-1">
            {hasModule('customers') && (
              <Button variant="ghost" size="sm" icon={<UserPlus strokeWidth={STROKE} />} onClick={onNewCustomer}>
                Customer
              </Button>
            )}
            {hasModule('payments') && (
              <Button variant="ghost" size="sm" icon={<Wallet strokeWidth={STROKE} />} onClick={onReceivePayment}>
                Receive payment
              </Button>
            )}
            <span className="w-px h-5 bg-line mx-1" aria-hidden="true" />
          </div>

          <IconButton label="Reload latest data" onClick={() => { setRefreshing(true); void hardRefresh(); }} disabled={refreshing}>
            <RefreshCw className={cx(refreshing && 'animate-spin')} strokeWidth={STROKE} />
          </IconButton>

          {/* The rail carries this on desktop */}
          {hasModule('invoices') && (
            <Button variant="primary" size="sm" icon={<Plus strokeWidth={2} />} onClick={onNewInvoice} className="lg:hidden ml-1">
              New invoice
            </Button>
          )}
        </div>
      </div>
    </header>
  );
};
