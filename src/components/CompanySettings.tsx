import React, { useState, useEffect, useRef } from 'react';
import { 
  Building, 
  CreditCard, 
  Save, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  ShieldAlert,
  FileCheck2,
  FileText,
  Download,
  Upload,
  RotateCcw,
  Image as ImageIcon
} from 'lucide-react';
import { apiRequest } from '../services/api.js';
import { CompanySettings, BankAccount } from '../types.js';
import { SslLogo } from './SslLogo.js';

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
      setMsg(logoUrl ? 'Logo updated and applied across entire system!' : 'Reset to official vector logo!');
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
      setMsg('Company profile and GST configuration updated successfully!');
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-surface border border-line p-5 rounded-card shadow-card">
        <h1 className="text-xl font-bold text-ink flex items-center gap-2">
          <span>Enterprise & GST Billing Settings</span>
          <span className="text-xs bg-accent-soft text-accent-ink font-semibold px-2 py-0.5 rounded-full border border-accent-line">
            SHREE SANWARIYA LOGISTICS
          </span>
        </h1>
        <p className="text-xs text-ink-faint mt-1">
          Configure company identity, GSTIN registration, invoice numbering prefixes, and bank settlement accounts.
        </p>
      </div>

      {msg && (
        <div className="p-3 bg-positive-soft border border-positive-line rounded-card text-positive-ink text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-positive-ink" />
          <span>{msg}</span>
        </div>
      )}

      {/* Main Settings Form */}
      <form onSubmit={handleSaveSettings} className="bg-surface border border-line rounded-card p-6 space-y-6 text-xs shadow-card">
        {/* Brand & Logo Identity Box */}
        <div className="bg-surface-muted border border-line rounded-card p-5 flex flex-col md:flex-row items-center justify-between gap-5">
          <div className="flex items-center gap-4">
            <div className="bg-surface p-3 rounded-card border border-line shadow-card flex items-center justify-center shrink-0 min-w-[120px] max-h-[80px]">
              <SslLogo className="h-16 w-auto max-h-16 max-w-[140px]" customLogoUrl={settings.logo_url} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-extrabold text-sm text-ink">
                  {settings.logo_url ? 'Custom Uploaded Logo' : 'Official Brand Logo (SSL Emblem)'}
                </h3>
                <span className="px-2 py-0.5 bg-positive-soft text-positive-ink border border-positive-line rounded-full text-[10px] font-bold">
                  {settings.logo_url ? 'Active (Custom File)' : 'Active (Official Vector)'}
                </span>
              </div>
              <p className="text-ink-faint text-xs mt-1">
                Used across Dashboard, Top Header, Navigation Sidebar, A4 Tax Invoices, and Statements.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            <input
              type="file"
              ref={fileInputRef}
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              onChange={handleLogoFileUpload}
              className="hidden"
              id="company-logo-upload-input"
            />
            <label
              htmlFor="company-logo-upload-input"
              className="cursor-pointer flex items-center gap-1.5 px-3 py-2 bg-accent-soft text-accent-ink border border-accent-line hover:border-accent rounded-card text-xs font-semibold shadow-card transition"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{settings.logo_url ? 'Change Logo Image' : 'Upload Logo File'}</span>
            </label>

            {settings.logo_url && (
              <button
                type="button"
                onClick={handleResetLogo}
                className="flex items-center gap-1.5 px-3 py-2 bg-surface border border-danger-line text-danger-ink hover:bg-danger-soft rounded-card text-xs font-semibold shadow-card transition"
                title="Reset to official built-in vector logo"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset to Default</span>
              </button>
            )}

            <a
              href="/logo.svg"
              download="SHREE_SANWARIYA_LOGISTICS_LOGO.svg"
              className="flex items-center gap-1.5 px-3 py-2 bg-surface border border-line-strong text-ink-soft hover:bg-surface-muted rounded-card text-xs font-semibold shadow-card transition"
            >
              <Download className="w-3.5 h-3.5 text-ink-faint" />
              <span>Download SVG</span>
            </a>
          </div>
        </div>

        <div className="border-b border-line pb-3 flex items-center gap-2">
          <Building className="w-4 h-4 text-accent-ink" />
          <h2 className="text-sm font-bold text-ink uppercase tracking-wider">Company & Legal Information</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-ink-soft font-semibold mb-1">Company Trade Name *</label>
            <input
              type="text"
              required
              value={settings.name}
              onChange={(e) => setSettings({ ...settings, name: e.target.value })}
              className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 text-ink font-semibold focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-ink-soft font-semibold mb-1">Invoice Prefix</label>
            <input
              type="text"
              required
              value={settings.invoice_prefix || 'SSL'}
              onChange={(e) => setSettings({ ...settings, invoice_prefix: e.target.value })}
              className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 font-mono text-accent-ink font-bold uppercase focus:outline-none focus:border-accent"
              placeholder="SSL"
            />
          </div>

          <div>
            <label className="block text-ink-soft font-semibold mb-1">GSTIN Number (15 Characters) *</label>
            <input
              type="text"
              required
              maxLength={15}
              value={settings.gstin}
              onChange={(e) => setSettings({ ...settings, gstin: e.target.value.toUpperCase() })}
              className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 font-mono text-ink uppercase focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-ink-soft font-semibold mb-1">PAN Number *</label>
            <input
              type="text"
              required
              maxLength={10}
              value={settings.pan}
              onChange={(e) => setSettings({ ...settings, pan: e.target.value.toUpperCase() })}
              className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 font-mono text-ink uppercase focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-ink-soft font-semibold mb-1">Billing Email</label>
            <input
              type="email"
              value={settings.email || ''}
              onChange={(e) => setSettings({ ...settings, email: e.target.value })}
              className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 text-ink focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-ink-soft font-semibold mb-1">Official Phone</label>
            <input
              type="text"
              value={settings.phone || ''}
              onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
              className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 text-ink focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-ink-soft font-semibold mb-1">WhatsApp for Invoices</label>
            <input
              type="text"
              value={settings.whatsapp || ''}
              onChange={(e) => setSettings({ ...settings, whatsapp: e.target.value })}
              className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 text-ink focus:outline-none focus:border-accent"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-ink-soft font-semibold mb-1">Registered Address</label>
            <input
              type="text"
              value={settings.address || ''}
              onChange={(e) => setSettings({ ...settings, address: e.target.value })}
              className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 text-ink focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-ink-soft font-semibold mb-1">City</label>
            <input
              type="text"
              value={settings.city || ''}
              onChange={(e) => setSettings({ ...settings, city: e.target.value })}
              className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 text-ink focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-ink-soft font-semibold mb-1">State</label>
            <input
              type="text"
              value={settings.state || ''}
              onChange={(e) => setSettings({ ...settings, state: e.target.value })}
              className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 text-ink focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-ink-soft font-semibold mb-1">Postal PIN Code</label>
            <input
              type="text"
              value={settings.pin || ''}
              onChange={(e) => setSettings({ ...settings, pin: e.target.value })}
              className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 text-ink focus:outline-none focus:border-accent"
            />
          </div>

          <div className="sm:col-span-3">
            <label className="block text-ink-soft font-semibold mb-1">Standard Invoice Terms & Conditions</label>
            <textarea
              rows={3}
              value={settings.terms || ''}
              onChange={(e) => setSettings({ ...settings, terms: e.target.value })}
              className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 text-ink focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        {/* GSTIN Verification Information */}
        <div className="border-t border-line pt-6 mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-accent-soft text-accent-ink rounded-card font-bold">GST</div>
              <div>
                <h3 className="font-bold text-ink text-sm">Authoritative GSTVerify Integration</h3>
                <p className="text-ink-faint text-[11px]">
                  Powered by official GSTVerify API (<code className="text-accent-ink font-mono">gstverify.co.in/api/v1/verify/:gstin</code>).
                </p>
              </div>
            </div>
            <span className="text-[10px] font-bold px-2.5 py-1 bg-positive-soft text-positive-ink border border-positive-line rounded-full flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-positive animate-pulse"></span>
              <span>GSTVerify Active</span>
            </span>
          </div>

          <div className="bg-surface-muted p-4 rounded-card border border-line text-ink-soft text-xs space-y-2">
            <div className="font-medium text-ink">
              Server-Side API Security:
            </div>
            <p className="text-ink-faint leading-relaxed">
              Live GSTIN verification credentials are stored strictly in backend environment variables (<code className="font-mono text-ink bg-surface-sunken/70 px-1 py-0.5 rounded">GSTVERIFY_API_KEY</code>). All lookups are sanitized and normalized on the server before reaching the client.
            </p>
          </div>
        </div>

        <div className="flex justify-end pt-3 border-t border-line">
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 bg-accent-strong hover:bg-accent-strong-hover text-on-accent rounded-card text-xs font-semibold shadow-card transition flex items-center gap-2 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'Saving...' : 'Update Settings'}</span>
          </button>
        </div>
      </form>

      {/* Bank Accounts Section */}
      <div className="bg-surface border border-line rounded-card p-6 space-y-5 text-xs shadow-card">
        <div className="border-b border-line pb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-positive-ink" />
            <h2 className="text-sm font-bold text-ink uppercase tracking-wider">Settlement Bank Accounts</h2>
          </div>
          <span className="text-[11px] text-ink-faint font-medium">Printed on A4 Tax Invoices</span>
        </div>

        {/* Existing Accounts List */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(Array.isArray(bankAccounts) ? bankAccounts : []).map((b) => (
            <div key={b.id} className="bg-surface-muted p-4 rounded-card border border-line relative">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-bold text-sm text-ink flex items-center gap-2">
                    <span>{b.bank_name}</span>
                    {b.is_default && (
                      <span className="text-[10px] bg-positive-soft text-positive-ink font-semibold px-2 py-0.5 rounded-full border border-positive-line">
                        Default
                      </span>
                    )}
                  </div>
                  <div className="text-ink-faint mt-1">A/C: <span className="font-mono text-ink font-semibold">{b.account_number}</span></div>
                  <div className="text-ink-faint">IFSC: <span className="font-mono text-ink font-semibold">{b.ifsc || '-'}</span> | Branch: {b.branch || '-'}</div>
                  <div className="text-ink-faint">Holder: {b.account_holder}</div>
                  {b.upi_id && <div className="text-ink-faint">UPI: <span className="font-mono text-positive-ink font-semibold">{b.upi_id}</span></div>}
                </div>

                <button
                  onClick={() => handleDeleteBank(b.id)}
                  className="p-1.5 text-ink-faint hover:text-danger-ink hover:bg-danger-soft rounded-control transition"
                  title="Remove account"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Add New Bank Account Form */}
        <form onSubmit={handleAddBankAccount} className="bg-surface-muted p-5 rounded-card border border-line space-y-3">
          <div className="font-bold text-ink">Add New Bank Account</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-ink-soft font-medium mb-1">Bank Name *</label>
              <input
                type="text"
                required
                value={newBank.bank_name}
                onChange={(e) => setNewBank({ ...newBank, bank_name: e.target.value })}
                className="w-full bg-surface border border-line rounded-control px-3 py-2 text-ink focus:outline-none focus:border-accent"
                placeholder="e.g. HDFC Bank"
              />
            </div>
            <div>
              <label className="block text-ink-soft font-medium mb-1">Account Number *</label>
              <input
                type="text"
                required
                value={newBank.account_number}
                onChange={(e) => setNewBank({ ...newBank, account_number: e.target.value })}
                className="w-full bg-surface border border-line rounded-control px-3 py-2 font-mono text-ink focus:outline-none focus:border-accent"
                placeholder="50200012345678"
              />
            </div>
            <div>
              <label className="block text-ink-soft font-medium mb-1">IFSC Code</label>
              <input
                type="text"
                value={newBank.ifsc}
                onChange={(e) => setNewBank({ ...newBank, ifsc: e.target.value.toUpperCase() })}
                className="w-full bg-surface border border-line rounded-control px-3 py-2 font-mono text-ink uppercase focus:outline-none focus:border-accent"
                placeholder="HDFC0001234"
              />
            </div>
            <div>
              <label className="block text-ink-soft font-medium mb-1">Branch</label>
              <input
                type="text"
                value={newBank.branch}
                onChange={(e) => setNewBank({ ...newBank, branch: e.target.value })}
                className="w-full bg-surface border border-line rounded-control px-3 py-2 text-ink focus:outline-none focus:border-accent"
                placeholder="Transport Nagar"
              />
            </div>
            <div>
              <label className="block text-ink-soft font-medium mb-1">UPI ID</label>
              <input
                type="text"
                value={newBank.upi_id}
                onChange={(e) => setNewBank({ ...newBank, upi_id: e.target.value })}
                className="w-full bg-surface border border-line rounded-control px-3 py-2 text-ink font-mono focus:outline-none focus:border-accent"
                placeholder="shreesanwariya@hdfcbank"
              />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <label className="flex items-center gap-2 text-ink-soft cursor-pointer font-medium">
                <input
                  type="checkbox"
                  checked={newBank.is_default}
                  onChange={(e) => setNewBank({ ...newBank, is_default: e.target.checked })}
                  className="rounded border-line-strong text-accent-ink focus:ring-0"
                />
                <span>Set as Default Account</span>
              </label>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className="px-4 py-2 bg-surface text-ink border border-line hover:border-line-strong hover:bg-surface-muted rounded-control text-xs font-medium transition flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Save Bank Account</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
