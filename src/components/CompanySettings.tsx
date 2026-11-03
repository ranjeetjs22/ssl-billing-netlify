import React, { useState, useEffect, useRef } from 'react';
import { Save, Plus, Trash2, Download, Upload, RotateCcw } from 'lucide-react';
import { apiRequest } from '../services/api.js';
import { CompanySettings, BankAccount } from '../types.js';
import { SslLogo } from './SslLogo.js';
import { Button, IconButton, Card, Badge, Field, Input, Textarea, Toast, EmptyState, cx } from './ui.js';

/** Card title row with a wrapping hint. */
const SectionHead: React.FC<{ title: string; hint?: React.ReactNode; actions?: React.ReactNode }> = ({ title, hint, actions }) => (
  <div className="flex items-start justify-between gap-3 px-3 sm:px-4 py-2.5 border-b border-line">
    <div className="min-w-0">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {hint && <p className="text-xs text-ink-faint mt-0.5">{hint}</p>}
    </div>
    {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
  </div>
);

/** Quiet secondary-button look for the file label and the download link. */
const btnLike = 'inline-flex items-center justify-center gap-1.5 h-9 sm:h-8 px-2.5 rounded-control text-sm font-medium whitespace-nowrap cursor-pointer ' +
  'transition-colors duration-[var(--duration-fast)] [&_svg]:w-4 [&_svg]:h-4';

interface CompanySettingsProps {
  onRefreshSettings: () => void;
}

export const CompanySettingsView: React.FC<CompanySettingsProps> = ({ onRefreshSettings }) => {
  const [settings, setSettings] = useState<CompanySettings>({
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

  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const saveLogoToBackend = async (logoUrl: string) => {
    try {
      const updated = { ...settings, logo_url: logoUrl };
      setSettings(updated);
      await apiRequest('/settings/company', {
        method: 'POST',
        body: JSON.stringify(updated),
      });
      onRefreshSettings();
      setMsg(logoUrl ? 'Logo updated.' : 'Default logo restored.');
      setTimeout(() => setMsg(null), 4000);
    } catch (err: any) {
      console.error('Failed to auto-save logo', err);
    }
  };

  const handleLogoFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      alert('File size exceeds 10MB. Please choose a smaller image.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (!dataUrl) return;

      // Optimize image dimensions for smooth PDF and UI rendering
      const img = new Image();
      img.onload = () => {
        const maxWidth = 1200;
        const maxHeight = 800;
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const mimeType = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
          const optimizedDataUrl = canvas.toDataURL(mimeType, 0.95);
          saveLogoToBackend(optimizedDataUrl);
        } else {
          saveLogoToBackend(dataUrl);
        }
      };
      img.onerror = () => {
        saveLogoToBackend(dataUrl);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleResetLogo = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    saveLogoToBackend('');
  };

  // New Bank Account fields
  const [newBank, setNewBank] = useState<Partial<BankAccount>>({
    bank_name: '',
    account_number: '',
    account_holder: 'SHREE SANWARIYA LOGISTICS',
    ifsc: '',
    branch: '',
    upi_id: '',
    is_default: false,
  });

  useEffect(() => {
    const load = async () => {
      try {
        const sRes = await apiRequest<CompanySettings>('/settings/company');
        if (sRes) setSettings(sRes);

        const bRes = await apiRequest<any>('/settings/banks');
        const list: BankAccount[] = Array.isArray(bRes) ? bRes : (bRes?.accounts || bRes?.items || []);
        setBankAccounts(list);
      } catch (err) {
        console.error('Failed to load settings', err);
      }
    };
    load();
  }, []);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      await apiRequest('/settings/company', {
        method: 'POST',
        body: JSON.stringify(settings),
      });
      setMsg('Company settings saved.');
      onRefreshSettings();
      setTimeout(() => setMsg(null), 3000);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddBankAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBank.bank_name || !newBank.account_number) {
      alert('Bank name and account number are required');
      return;
    }
    try {
      const res = await apiRequest<BankAccount>('/settings/banks', {
        method: 'POST',
        body: JSON.stringify(newBank),
      });
      setBankAccounts([...bankAccounts, res]);
      setNewBank({
        bank_name: '',
        account_number: '',
        account_holder: settings.name || 'SHREE SANWARIYA LOGISTICS',
        ifsc: '',
        branch: '',
        upi_id: '',
        is_default: false,
      });
      onRefreshSettings();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDeleteBank = async (id: string) => {
    if (!window.confirm('Delete this bank account?')) return;
    try {
      await apiRequest(`/settings/banks/${id}`, { method: 'DELETE' });
      setBankAccounts(bankAccounts.filter(b => b.id !== id));
      onRefreshSettings();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const set = (patch: Partial<CompanySettings>) => setSettings({ ...settings, ...patch });
  const banks = Array.isArray(bankAccounts) ? bankAccounts : [];

  return (
    <div className="space-y-3 sm:space-y-4 max-w-5xl">
      {msg && <Toast message={msg} tone="success" onDismiss={() => setMsg(null)} />}

      {/* ---------------------------------------------------------- logo */}
      <Card padded={false}>
        <SectionHead title="Logo" hint="Shown in the app and printed on tax invoices and statements." />
        <div className="px-3 sm:px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-28 h-16 shrink-0 rounded-control border border-line bg-surface flex items-center justify-center p-2">
              <SslLogo className="max-h-12 w-auto max-w-full" customLogoUrl={settings.logo_url} />
            </div>
            <div className="min-w-0">
              <div className="text-sm text-ink">{settings.logo_url ? 'Custom logo' : 'Default SSL logo'}</div>
              <div className="text-xs text-ink-faint">PNG, JPG, SVG or WebP, up to 10 MB.</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="file"
              ref={fileInputRef}
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              onChange={handleLogoFileUpload}
              className="sr-only"
              id="company-logo-upload-input"
            />
            <label
              htmlFor="company-logo-upload-input"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
              className={cx(btnLike, 'bg-surface text-ink border border-line hover:bg-surface-muted hover:border-line-strong')}
            >
              <Upload aria-hidden="true" />
              {settings.logo_url ? 'Replace' : 'Upload logo'}
            </label>

            {settings.logo_url && (
              <Button type="button" variant="ghost" size="sm" icon={<RotateCcw />} onClick={handleResetLogo}
                title="Go back to the built-in SSL logo">
                Use default
              </Button>
            )}

            <a
              href="/logo.svg"
              download="SHREE_SANWARIYA_LOGISTICS_LOGO.svg"
              className={cx(btnLike, 'text-ink-soft border border-transparent hover:text-ink hover:bg-surface-sunken')}
            >
              <Download aria-hidden="true" />
              Download SVG
            </a>
          </div>
        </div>
      </Card>

      {/* ------------------------------------------------- company profile */}
      <form onSubmit={handleSaveSettings}>
        <Card padded={false}>
          <SectionHead title="Company profile" hint="Printed on every invoice. GSTIN and PAN must match your registration." />

          <div className="px-3 sm:px-4 py-3 sm:py-4 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Field label="Trade name" htmlFor="cs-name" required className="sm:col-span-2">
                <Input id="cs-name" type="text" required value={settings.name}
                  onChange={(e) => set({ name: e.target.value })} />
              </Field>
              <Field label="GSTIN" htmlFor="cs-gstin" required>
                <Input id="cs-gstin" type="text" required maxLength={15} value={settings.gstin}
                  onChange={(e) => set({ gstin: e.target.value.toUpperCase() })}
                  className="font-mono text-[13px] uppercase" />
              </Field>
              <Field label="PAN" htmlFor="cs-pan" required>
                <Input id="cs-pan" type="text" required maxLength={10} value={settings.pan}
                  onChange={(e) => set({ pan: e.target.value.toUpperCase() })}
                  className="font-mono text-[13px] uppercase" />
              </Field>
              <Field label="Billing email" htmlFor="cs-email" className="sm:col-span-2">
                <Input id="cs-email" type="email" value={settings.email || ''}
                  onChange={(e) => set({ email: e.target.value })} />
              </Field>
              <Field label="Phone" htmlFor="cs-phone">
                <Input id="cs-phone" type="tel" value={settings.phone || ''}
                  onChange={(e) => set({ phone: e.target.value })} />
              </Field>
              <Field label="WhatsApp for invoices" htmlFor="cs-wa">
                <Input id="cs-wa" type="tel" value={settings.whatsapp || ''}
                  onChange={(e) => set({ whatsapp: e.target.value })} />
              </Field>
            </div>

            <div className="pt-4 border-t border-line">
              <h3 className="text-sm font-semibold text-ink mb-3">Registered address</h3>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                <Field label="Address" htmlFor="cs-addr" className="col-span-2 lg:col-span-3">
                  <Input id="cs-addr" type="text" value={settings.address || ''}
                    onChange={(e) => set({ address: e.target.value })} />
                </Field>
                <Field label="City" htmlFor="cs-city">
                  <Input id="cs-city" type="text" value={settings.city || ''}
                    onChange={(e) => set({ city: e.target.value })} />
                </Field>
                <Field label="State" htmlFor="cs-state">
                  <Input id="cs-state" type="text" value={settings.state || ''}
                    onChange={(e) => set({ state: e.target.value })} />
                </Field>
                <Field label="PIN code" htmlFor="cs-pin">
                  <Input id="cs-pin" type="text" inputMode="numeric" value={settings.pin || ''}
                    onChange={(e) => set({ pin: e.target.value })} className="tabular-nums" />
                </Field>
              </div>
            </div>

            <div className="pt-4 border-t border-line">
              <h3 className="text-sm font-semibold text-ink mb-3">Invoices</h3>
              <div className="grid grid-cols-1 sm:grid-cols-[10rem_minmax(0,1fr)] gap-3">
                <Field label="Invoice number prefix" htmlFor="cs-prefix">
                  <Input id="cs-prefix" type="text" required value={settings.invoice_prefix || 'SSL'}
                    onChange={(e) => set({ invoice_prefix: e.target.value })}
                    className="font-mono text-[13px] uppercase" placeholder="SSL" />
                </Field>
                <Field label="Terms and conditions" htmlFor="cs-terms" hint="One per line. Printed at the foot of each invoice.">
                  <Textarea id="cs-terms" rows={4} value={settings.terms || ''}
                    onChange={(e) => set({ terms: e.target.value })} className="sm:h-auto!" />
                </Field>
              </div>
            </div>
          </div>

          <div className="px-3 sm:px-4 py-2.5 border-t border-line flex items-center justify-end gap-2">
            <Button type="submit" variant="primary" icon={<Save />} loading={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </Card>
      </form>

      {/* ---------------------------------------------- GSTIN verification */}
      <Card padded={false}>
        <SectionHead
          title="GSTIN verification"
          hint={<>Customer GSTINs are looked up through the GSTVerify API (<span className="font-mono">gstverify.co.in/api/v1/verify/:gstin</span>).</>}
          actions={<Badge tone="positive" dot>Active</Badge>}
        />
        <p className="px-3 sm:px-4 py-3 text-sm text-ink-soft">
          The API key lives only in the server environment as <code className="font-mono text-[13px] text-ink">GSTVERIFY_API_KEY</code>.
          Lookups run and are cleaned up on the server; the key never reaches the browser.
        </p>
      </Card>

      {/* ---------------------------------------------------- bank accounts */}
      <Card padded={false}>
        <SectionHead title="Bank accounts" hint="Printed on tax invoices for payment. The default account is shown first." />

        {banks.length === 0 ? (
          <EmptyState title="No bank account yet" message="Add one below so customers know where to pay." />
        ) : (
          <ul className="divide-y divide-line">
            {banks.map((b) => (
              <li key={b.id} className="px-3 sm:px-4 py-2.5 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-ink truncate">{b.bank_name}</span>
                    {b.is_default && <Badge tone="neutral">Default</Badge>}
                  </div>
                  <div className="mt-0.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-0.5 text-xs text-ink-faint">
                    <span className="truncate">A/c <span className="font-mono text-[13px] text-ink-soft">{b.account_number}</span></span>
                    <span className="truncate">IFSC <span className="font-mono text-[13px] text-ink-soft">{b.ifsc || '-'}</span></span>
                    <span className="truncate">Branch <span className="text-ink-soft">{b.branch || '-'}</span></span>
                    <span className="truncate">Holder <span className="text-ink-soft">{b.account_holder}</span></span>
                    {b.upi_id && <span className="truncate">UPI <span className="font-mono text-[13px] text-ink-soft">{b.upi_id}</span></span>}
                  </div>
                </div>
                <IconButton label={`Remove ${b.bank_name} account`} onClick={() => handleDeleteBank(b.id)}
                  className="hover:text-danger-ink hover:bg-danger-soft">
                  <Trash2 />
                </IconButton>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleAddBankAccount} className="px-3 sm:px-4 py-3 sm:py-4 border-t border-line space-y-3">
          <h3 className="text-sm font-semibold text-ink">Add bank account</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Field label="Bank name" htmlFor="nb-name" required>
              <Input id="nb-name" type="text" required value={newBank.bank_name}
                onChange={(e) => setNewBank({ ...newBank, bank_name: e.target.value })} placeholder="e.g. HDFC Bank" />
            </Field>
            <Field label="Account number" htmlFor="nb-acc" required>
              <Input id="nb-acc" type="text" required inputMode="numeric" value={newBank.account_number}
                onChange={(e) => setNewBank({ ...newBank, account_number: e.target.value })}
                className="font-mono text-[13px]" placeholder="50200012345678" />
            </Field>
            <Field label="IFSC" htmlFor="nb-ifsc">
              <Input id="nb-ifsc" type="text" value={newBank.ifsc}
                onChange={(e) => setNewBank({ ...newBank, ifsc: e.target.value.toUpperCase() })}
                className="font-mono text-[13px] uppercase" placeholder="HDFC0001234" />
            </Field>
            <Field label="Branch" htmlFor="nb-branch">
              <Input id="nb-branch" type="text" value={newBank.branch}
                onChange={(e) => setNewBank({ ...newBank, branch: e.target.value })} placeholder="Transport Nagar" />
            </Field>
            <Field label="UPI ID" htmlFor="nb-upi">
              <Input id="nb-upi" type="text" value={newBank.upi_id}
                onChange={(e) => setNewBank({ ...newBank, upi_id: e.target.value })}
                className="font-mono text-[13px]" placeholder="name@hdfcbank" />
            </Field>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-ink-soft cursor-pointer h-10 sm:h-9">
                <input
                  type="checkbox"
                  checked={newBank.is_default}
                  onChange={(e) => setNewBank({ ...newBank, is_default: e.target.checked })}
                  className="w-4 h-4 cursor-pointer"
                />
                Make this the default account
              </label>
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="secondary" icon={<Plus />}>Add account</Button>
          </div>
        </form>
      </Card>
    </div>
  );
};
