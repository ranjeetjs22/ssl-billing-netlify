import React from 'react';
import { Menu, Plus, Wallet, Building2, Sun, Moon, Monitor, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { CompanySettings } from '../types.js';
import { hardRefresh } from '../services/api.js';
import { cx, IconButton, Button, useTheme, ThemeChoice } from './ui.js';

interface TopHeaderProps {
  activeTab: string;
  onToggleSidebar: () => void;
  onNewInvoice: () => void;
  onReceivePayment: () => void;
  onNewCustomer: () => void;
  companySettings?: CompanySettings;
}

const STROKE = 1.6;

const TAB_TITLES: Record<string, { title: string; hint: string }> = {
  dashboard: { title: 'Overview', hint: 'Sales, collections and outstanding at a glance' },
  invoices: { title: 'Invoices', hint: 'GST tax invoices and consignment billing' },
  customers: { title: 'Customers', hint: 'Consignees, statements and outstanding balances' },
  payments: { title: 'Payments', hint: 'Receipts recorded against invoices' },
  rates: { title: 'Rate calculator', hint: 'Zone-wise freight pricing from the SSL rate card' },
  expenses: { title: 'Expenses', hint: 'Rent, salaries and other overheads' },
  reports: { title: 'Reports and GST', hint: 'Download sales, GST, payment and outstanding reports' },
  settings: { title: 'Settings', hint: 'Company profile, GST and bank details' },
  users: { title: 'Users', hint: 'Staff accounts and permissions' },
};

const THEMES: { value: ThemeChoice; label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Match system', icon: Monitor },
];

/**
 * Three explicit choices in a segmented control. The old control cycled through
 * the modes on each press, which meant you could not tell what was selected or
 * reach a mode without stepping through the others.
 */
const ThemeSwitch: React.FC = () => {
  const [theme, setTheme] = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="flex items-center gap-0.5 p-0.5 rounded-control bg-surface-sunken border border-line"
    >
      {THEMES.map(({ value, label, icon: Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={cx(
              'tap-44 w-7 h-7 inline-flex items-center justify-center rounded-[6px] cursor-pointer',
              'transition-[background-color,color] duration-[140ms] ease-out',
              active
                ? 'bg-surface-muted text-accent shadow-card'
                : 'text-ink-faint hover:text-ink'
            )}
          >
            <Icon className="w-[15px] h-[15px]" strokeWidth={STROKE} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
};

export const TopHeader: React.FC<TopHeaderProps> = ({
  activeTab,
  onToggleSidebar,
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
    return user.modules?.includes(mod);
  };

  return (
    <header
      className={cx(
        'h-14 sm:h-[60px] px-3 sm:px-6 sticky top-0 z-30 pt-safe',
        'flex items-center justify-between gap-2 sm:gap-3',
        'bg-canvas/70 backdrop-blur-xl'
      )}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <IconButton label="Open navigation" onClick={onToggleSidebar} className="lg:hidden -ml-1">
          <Menu className="w-[18px] h-[18px]" strokeWidth={STROKE} />
        </IconButton>

        <div className="min-w-0">
          <h1 className="text-[17px] sm:text-[19px] font-semibold text-ink leading-tight truncate tracking-[-0.02em]">
            {meta.title}
          </h1>
          <p className="hidden md:block text-[11.5px] text-ink-faint truncate">{meta.hint}</p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* `hidden md:inline-flex` on the button itself does not work: IconButton
            already sets `inline-flex`, and which of the two display utilities wins
            depends on stylesheet order, not on class order. Hide via a wrapper. */}
        <div className="hidden md:flex items-center gap-1.5">
          {hasModule('customers') && (
            <IconButton label="Add customer" onClick={onNewCustomer}>
              <Building2 className="w-[17px] h-[17px]" strokeWidth={STROKE} />
            </IconButton>
          )}

          {hasModule('payments') && (
            <IconButton label="Record payment" onClick={onReceivePayment}>
              <Wallet className="w-[17px] h-[17px]" strokeWidth={STROKE} />
            </IconButton>
          )}
        </div>

        <IconButton
          label="Clear cache and reload"
          onClick={() => { setRefreshing(true); void hardRefresh(); }}
          disabled={refreshing}
        >
          <RefreshCw className={cx('w-[17px] h-[17px]', refreshing && 'animate-spin')} strokeWidth={STROKE} />
        </IconButton>

        <ThemeSwitch />

        {/* The rail carries this action on desktop, so it appears here only at
            widths where the rail is hidden. */}
        {hasModule('invoices') && (
          <Button variant="primary" size="sm" icon={<Plus className="w-4 h-4" />}
            onClick={onNewInvoice} className="lg:hidden">
            New
          </Button>
        )}
      </div>
    </header>
  );
};
