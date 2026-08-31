import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { Sidebar, MobileNav } from './components/Sidebar.js';
import { TopHeader } from './components/TopHeader.js';
import { LoginView } from './components/LoginView.js';
import { InvoiceList } from './components/InvoiceList.js';
import { InvoiceModal } from './components/InvoiceModal.js';
import { InvoiceDetailModal } from './components/InvoiceDetailModal.js';
import { OverdueModal } from './components/OverdueModal.js';
import { CustomerList } from './components/CustomerList.js';
import { CustomerModal } from './components/CustomerModal.js';
import { CustomerDetailModal } from './components/CustomerDetailModal.js';
import { PaymentList } from './components/PaymentList.js';
import { PaymentModal } from './components/PaymentModal.js';
import { CompanySettingsView } from './components/CompanySettings.js';
import { UserManagementView } from './components/UserManagement.js';
import { AuditLogsModal } from './components/AuditLogsModal.js';
import { Invoice, Customer, CompanySettings, BankAccount } from './types.js';
import { apiRequest } from './services/api.js';

// The dashboard (charts) is the heaviest screen — load it on demand.
const Dashboard = React.lazy(() => import('./components/Dashboard.js').then(m => ({ default: m.Dashboard })));
const ScreenLoader = () => (
  <div className="py-16 flex items-center justify-center" role="status" aria-live="polite">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent" />
    <span className="sr-only">Loading…</span>
  </div>
);

function MainApp() {
  const { user, loading } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpenMobile, setSidebarOpenMobile] = useState(false);

  // Modals state
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showOverdueModal, setShowOverdueModal] = useState(false);
  const [showAuditLogs, setShowAuditLogs] = useState(false);

  // Selected Entities & Editing State
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [targetCustomerForInvoice, setTargetCustomerForInvoice] = useState<string | undefined>(undefined);
  const [targetInvoiceForPayment, setTargetInvoiceForPayment] = useState<Invoice | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [highlightInvoiceId, setHighlightInvoiceId] = useState<string | null>(null);
  const [invoiceToastMessage, setInvoiceToastMessage] = useState<string | null>(null);

  // Company Settings & Default Bank
  const [companySettings, setCompanySettings] = useState<CompanySettings>({
    name: 'SHREE SANWARIYA LOGISTICS',
    gstin: '24AABCS1429B1Z8',
    pan: 'AABCS1429B',
    phone: '+91 98765 43210',
    whatsapp: '+91 98765 43210',
    email: 'billing@shreesanwariya.com',
    address: 'Opp. Transport Nagar, Ring Road',
    city: 'Ahmedabad',
    state: 'Gujarat',
    pin: '382405',
    invoice_prefix: 'SSL',
    terms: "1. Goods are carried at owner's risk.\n2. All disputes subject to Ahmedabad jurisdiction only.\n3. Payment to be made within credit period.",
  });
  const [defaultBank, setDefaultBank] = useState<BankAccount | undefined>(undefined);

  const fetchSettingsAndBank = async () => {
    try {
      const compRes = await apiRequest<CompanySettings>('/settings/company');
      if (compRes) setCompanySettings(compRes);

      const bankRes = await apiRequest<any>('/settings/banks');
      const list: BankAccount[] = Array.isArray(bankRes) ? bankRes : (bankRes?.accounts || bankRes?.items || []);
      if (list.length > 0) {
        const def = list.find(b => b.is_default) || list[0];
        setDefaultBank(def);
      }
    } catch (err) {
      console.error('Failed to load global company settings', err);
    }
  };

  useEffect(() => {
    if (user) {
      fetchSettingsAndBank();
    }
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-dvh bg-canvas flex items-center justify-center" role="status" aria-live="polite">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-accent" />
        <span className="sr-only">Loading…</span>
      </div>
    );
  }

  if (!user) {
    return <LoginView />;
  }

  return (
    <div className="min-h-dvh bg-canvas text-ink flex selection:bg-accent selection:text-white">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[100]
                   focus:px-4 focus:py-2 focus:rounded-xl focus:bg-accent focus:text-white focus:font-semibold"
      >
        Skip to main content
      </a>

      {/* Left Dark Sidebar */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onNewInvoice={() => {
          setEditingInvoice(null);
          setShowInvoiceModal(true);
        }}
        onNewCustomer={() => setShowCustomerModal(true)}
        onReceivePayment={() => {
          setTargetInvoiceForPayment(null);
          setShowPaymentModal(true);
        }}
        onViewOverdue={() => setShowOverdueModal(true)}
        onOpenAuditLogs={() => setShowAuditLogs(true)}
        isOpenMobile={sidebarOpenMobile}
        setIsOpenMobile={setSidebarOpenMobile}
        companySettings={companySettings}
      />

      {/* Main Content Area on the right */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-[17rem]">
        {/* Top Header */}
        <TopHeader
          activeTab={activeTab}
          onToggleSidebar={() => setSidebarOpenMobile(true)}
          onNewInvoice={() => {
            setEditingInvoice(null);
            setShowInvoiceModal(true);
          }}
          onReceivePayment={() => {
            setTargetInvoiceForPayment(null);
            setShowPaymentModal(true);
          }}
          onNewCustomer={() => setShowCustomerModal(true)}
          onOpenAuditLogs={() => setShowAuditLogs(true)}
          companySettings={companySettings}
        />

        {/* Main Body View */}
        <main
          id="main-content"
          className="flex-1 px-3 py-4 sm:px-6 sm:py-6 max-w-[1600px] w-full mx-auto pb-24 lg:pb-6"
        >
          {activeTab === 'dashboard' && (
            <React.Suspense fallback={<ScreenLoader />}>
            <Dashboard
              key={refreshKey}
              onNewInvoice={() => {
                setEditingInvoice(null);
                setShowInvoiceModal(true);
              }}
              onNewCustomer={() => setShowCustomerModal(true)}
              onReceivePayment={() => {
                setTargetInvoiceForPayment(null);
                setShowPaymentModal(true);
              }}
              onViewOverdue={() => setShowOverdueModal(true)}
              onSelectInvoice={(inv) => setSelectedInvoice(inv)}
              companySettings={companySettings}
            />
            </React.Suspense>
          )}

          {activeTab === 'invoices' && (
            <InvoiceList
              key={refreshKey}
              onNewInvoice={() => {
                setEditingInvoice(null);
                setShowInvoiceModal(true);
              }}
              onSelectInvoice={(inv) => setSelectedInvoice(inv)}
              onEditInvoice={(inv) => {
                setEditingInvoice(inv);
                setShowInvoiceModal(true);
              }}
              onRecordPayment={(inv) => {
                setTargetInvoiceForPayment(inv);
                setShowPaymentModal(true);
              }}
              companySettings={companySettings}
              defaultBank={defaultBank}
              highlightInvoiceId={highlightInvoiceId}
              initialToastMessage={invoiceToastMessage}
            />
          )}

          {activeTab === 'customers' && (
            <CustomerList
              key={refreshKey}
              onNewCustomer={() => setShowCustomerModal(true)}
              onSelectCustomer={(cust) => setSelectedCustomer(cust)}
              companySettings={companySettings}
            />
          )}

          {activeTab === 'payments' && (
            <PaymentList
              key={refreshKey}
              onNewPayment={() => {
                setTargetInvoiceForPayment(null);
                setShowPaymentModal(true);
              }}
              companySettings={companySettings}
            />
          )}

          {activeTab === 'settings' && (
            <CompanySettingsView onRefreshSettings={fetchSettingsAndBank} />
          )}

          {activeTab === 'users' && <UserManagementView />}
        </main>

        {/* Footer */}
        <footer className="hidden lg:block border-t border-line bg-surface py-4 text-center text-xs text-ink-faint mt-auto">
          <div className="max-w-[1600px] mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-2">
            <span className="font-medium">
              &copy; {new Date().getFullYear()} {companySettings.name} · GST Transport &amp; Freight Billing
            </span>
            <span className="font-mono text-[11px] text-ink-soft bg-surface-sunken px-2.5 py-0.5 rounded border border-line">
              GSTIN: {companySettings.gstin} · SAC 996511
            </span>
          </div>
        </footer>

        <MobileNav
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onMore={() => setSidebarOpenMobile(true)}
        />
      </div>

      {/* Modals */}
      {showInvoiceModal && (
        <InvoiceModal
          invoiceToEdit={editingInvoice}
          initialCustomerId={targetCustomerForInvoice}
          onClose={() => {
            setShowInvoiceModal(false);
            setEditingInvoice(null);
            setTargetCustomerForInvoice(undefined);
          }}
          onSuccess={(savedInvoice) => {
            setShowInvoiceModal(false);
            setEditingInvoice(null);
            setTargetCustomerForInvoice(undefined);
            setRefreshKey(k => k + 1);
            setActiveTab('invoices');
            if (savedInvoice) {
              setHighlightInvoiceId(savedInvoice.id);
              setInvoiceToastMessage(
                `Invoice ${savedInvoice.invoice_no || ''} ${editingInvoice ? 'updated' : 'created'} successfully!`
              );
              setTimeout(() => {
                setHighlightInvoiceId(null);
              }, 4000);
            }
          }}
        />
      )}

      {selectedInvoice && (
        <InvoiceDetailModal
          invoice={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
          onEditInvoice={(inv) => {
            setSelectedInvoice(null);
            setEditingInvoice(inv);
            setTargetCustomerForInvoice(undefined);
            setShowInvoiceModal(true);
          }}
          onRecordPayment={(inv) => {
            setSelectedInvoice(null);
            setTargetInvoiceForPayment(inv);
            setShowPaymentModal(true);
          }}
          onRefresh={() => {
            setRefreshKey(k => k + 1);
          }}
          companySettings={companySettings}
          defaultBank={defaultBank}
        />
      )}

      {showCustomerModal && (
        <CustomerModal
          onClose={() => setShowCustomerModal(false)}
          onSuccess={() => {
            setRefreshKey(k => k + 1);
          }}
        />
      )}

      {selectedCustomer && (
        <CustomerDetailModal
          customer={selectedCustomer}
          onClose={() => setSelectedCustomer(null)}
          onNewInvoice={(cust) => {
            setSelectedCustomer(null);
            setTargetCustomerForInvoice(cust.id);
            setShowInvoiceModal(true);
          }}
          companySettings={companySettings}
        />
      )}

      {showPaymentModal && (
        <PaymentModal
          initialInvoice={targetInvoiceForPayment}
          onClose={() => {
            setShowPaymentModal(false);
            setTargetInvoiceForPayment(null);
          }}
          onSuccess={() => {
            setRefreshKey(k => k + 1);
          }}
        />
      )}

      {showOverdueModal && (
        <OverdueModal onClose={() => setShowOverdueModal(false)} />
      )}

      {showAuditLogs && (
        <AuditLogsModal onClose={() => setShowAuditLogs(false)} />
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}
