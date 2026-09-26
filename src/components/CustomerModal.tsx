import React, { useState } from 'react';
import { X, Building2, Save, Sparkles, Check, Loader2, AlertCircle, AlertTriangle, ShieldCheck } from 'lucide-react';
import { apiRequest } from '../services/api.js';
import { lookupGSTIN, lookupPincode, isValidGSTINFormat, GSTLookupResult } from '../utils/gstLookup.js';

interface CustomerModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export const CustomerModal: React.FC<CustomerModalProps> = ({ onClose, onSuccess }) => {
  const [name, setName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [address, setAddress] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [city, setCity] = useState('Ahmedabad');
  const [state, setState] = useState('Gujarat');
  const [pin, setPin] = useState('');
  const [gstin, setGstin] = useState('');
  const [pan, setPan] = useState('');
  const [gstStatus, setGstStatus] = useState('');
  const [constitution, setConstitution] = useState('');
  const [taxpayerType, setTaxpayerType] = useState('Regular');
  const [natureOfBusiness, setNatureOfBusiness] = useState<string[]>([]);
  const [paymentTerms, setPaymentTerms] = useState('Net 15 Days');
  const [creditDays, setCreditDays] = useState(15);
  const [creditLimit, setCreditLimit] = useState(100000);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [fetchingGst, setFetchingGst] = useState(false);
  const [fetchingPin, setFetchingPin] = useState(false);
  const [lookupFeedback, setLookupFeedback] = useState<{
    type: 'verified' | 'unavailable' | 'invalid';
    text: string;
    subText?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchGST = async (gstNumber: string, isExplicitClick = false) => {
    const clean = gstNumber.toUpperCase().trim();
    if (clean.length !== 15 || !isValidGSTINFormat(clean)) {
      if (isExplicitClick) {
        setLookupFeedback({
          type: 'invalid',
          text: 'Please enter a valid 15-character Indian GSTIN.',
        });
      }
      return;
    }

    setFetchingGst(true);
    setLookupFeedback(null);

    try {
      const res = await lookupGSTIN(clean);
      if (!res) {
        setLookupFeedback({
          type: 'unavailable',
          text: 'Live verification unavailable. Derived PAN & State from GSTIN structure.',
        });
        return;
      }

      if (res.verification_status === 'verified') {
        // Live verified via GSTVerify
        if (res.pan) setPan(res.pan);
        if (res.state) setState(res.state);
        if (res.legal_name) setLegalName(res.legal_name);
        if (res.trade_name) setTradeName(res.trade_name);
        if (res.gst_status) setGstStatus(res.gst_status);
        if (res.constitution) setConstitution(res.constitution);
        if (res.taxpayer_type) setTaxpayerType(res.taxpayer_type);
        if (res.nature_of_business && res.nature_of_business.length > 0) {
          setNatureOfBusiness(res.nature_of_business);
        }

        // Fill customer name if empty or explicit click
        const bestName = res.customer_name || res.trade_name || res.legal_name || '';
        if (bestName && (!name || isExplicitClick)) {
          setName(bestName);
        }

        // Fill address details if empty or explicit click
        if (res.address && (!address || isExplicitClick)) setAddress(res.address);
        if (res.city && (!city || isExplicitClick || city === 'Ahmedabad')) setCity(res.city);
        if (res.pin && (!pin || isExplicitClick)) setPin(res.pin);

        setLookupFeedback({
          type: 'verified',
          text: `GSTVerify Live Verified: ${bestName || 'Taxpayer Registered'}`,
          subText: `Status: ${res.gst_status || 'Active'} · Constitution: ${res.constitution || 'Regular'} · State: ${res.state}`,
        });
      } else if (res.verification_status === 'invalid') {
        setLookupFeedback({
          type: 'invalid',
          text: res.message || 'GSTIN is invalid or was not found in official GST registry.',
        });
      } else {
        // Unavailable / Offline fallback
        if (res.pan && !pan) setPan(res.pan);
        if (res.state && (!state || state === 'Gujarat')) setState(res.state);
        if (res.constitution && !constitution) setConstitution(res.constitution);

        setLookupFeedback({
          type: 'unavailable',
          text: res.message || 'Live GSTVerify service unavailable.',
          subText: `Derived from GSTIN: State ${res.state} · PAN ${res.pan} (${res.constitution || 'Taxpayer'})`,
        });
      }
    } catch (e: any) {
      console.warn('GST fetch error:', e);
      setLookupFeedback({
        type: 'unavailable',
        text: 'Live verification error. Extracted basic PAN & State from GSTIN format.',
      });
    } finally {
      setFetchingGst(false);
    }
  };

  const handleGSTINChange = (val: string) => {
    const clean = val.toUpperCase().trim();
    setGstin(clean);
    // Automatically trigger lookup only when full 15 characters are entered and valid
    if (clean.length === 15 && isValidGSTINFormat(clean)) {
      setPan(clean.substring(2, 12));
      fetchGST(clean, false);
    } else if (clean.length === 0) {
      setLookupFeedback(null);
    }
  };

  const fetchPIN = async (pincodeVal: string) => {
    const clean = pincodeVal.trim();
    if (!/^[1-9][0-9]{5}$/.test(clean)) return;
    setFetchingPin(true);
    try {
      const res = await lookupPincode(clean);
      if (res && res.valid) {
        if (res.city) setCity(res.city);
        if (res.state) setState(res.state);
      }
    } catch (e) {
      console.warn('PIN fetch error:', e);
    } finally {
      setFetchingPin(false);
    }
  };

  const handlePinChange = (val: string) => {
    const clean = val.trim();
    setPin(clean);
    if (clean.length === 6) {
      fetchPIN(clean);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiRequest('/customers', {
        method: 'POST',
        body: JSON.stringify({
          name,
          contact_person: contactPerson,
          email,
          phone,
          whatsapp,
          address,
          shipping_address: shippingAddress || address,
          city,
          state,
          pin,
          gstin,
          pan,
          payment_terms: paymentTerms,
          credit_days: Number(creditDays) || 0,
          credit_limit: Number(creditLimit) || 0,
          notes: [
            notes,
            legalName && legalName !== name ? `Legal Name: ${legalName}` : '',
            constitution ? `Constitution: ${constitution}` : '',
            gstStatus ? `GST Status: ${gstStatus}` : '',
            taxpayerType ? `Taxpayer: ${taxpayerType}` : '',
            natureOfBusiness.length > 0 ? `Activities: ${natureOfBusiness.join(', ')}` : '',
          ].filter(Boolean).join('\n'),
        }),
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to add customer');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-scrim backdrop-blur-[6px] flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="sheet border border-line rounded-overlay max-w-2xl w-full max-h-[92vh] flex flex-col shadow-overlay text-ink my-auto">
        {/* Header */}
        <div className="p-4 border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-card bg-accent-soft border border-accent-line flex items-center justify-center text-accent-ink">
              <Building2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-ink">Register Consignee / Customer</h2>
              <p className="text-[11px] text-ink-faint">Authoritative GSTVerify Integration & PIN Lookup</p>
            </div>
          </div>

          <button onClick={onClose} className="p-1 text-ink-faint hover:text-ink rounded-control transition cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
          {error && (
            <div className="p-3 bg-danger-soft border border-danger-line rounded-card text-danger-ink flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Dynamic Verification Badge */}
          {lookupFeedback && (
            <div
              className={`p-3 rounded-card border flex items-start gap-2.5 text-xs transition ${
                lookupFeedback.type === 'verified'
                  ? 'bg-positive-soft border-positive-line text-positive-ink'
                  : lookupFeedback.type === 'unavailable'
                  ? 'bg-warning-soft border-warning-line text-warning-ink'
                  : 'bg-danger-soft border-danger-line text-danger-ink'
              }`}
            >
              {lookupFeedback.type === 'verified' ? (
                <ShieldCheck className="w-4 h-4 text-positive-ink shrink-0 mt-0.5" />
              ) : lookupFeedback.type === 'unavailable' ? (
                <AlertTriangle className="w-4 h-4 text-warning-ink shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-danger-ink shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <div className="font-semibold">{lookupFeedback.text}</div>
                {lookupFeedback.subText && (
                  <div className="text-[11px] opacity-85 mt-0.5">{lookupFeedback.subText}</div>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-ink-soft font-semibold">GSTIN (15 chars)</label>
                <button
                  type="button"
                  disabled={fetchingGst || gstin.length !== 15}
                  onClick={() => fetchGST(gstin, true)}
                  className="text-[11px] text-accent-ink hover:text-accent-ink font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-40"
                >
                  {fetchingGst ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>Verifying...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3 h-3 text-accent" />
                      <span>Auto Fetch</span>
                    </>
                  )}
                </button>
              </div>
              <input
                type="text"
                maxLength={15}
                value={gstin}
                onChange={(e) => handleGSTINChange(e.target.value)}
                className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 font-mono text-ink text-xs uppercase focus:outline-none focus:border-accent"
                placeholder="24AABCS1429B1Z8"
              />
            </div>

            <div>
              <label className="block text-ink-soft font-semibold mb-1">PAN Number</label>
              <input
                type="text"
                maxLength={10}
                value={pan}
                onChange={(e) => setPan(e.target.value.toUpperCase())}
                className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 font-mono text-ink text-xs uppercase focus:outline-none focus:border-accent"
                placeholder="AABCS1429B"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-ink-soft font-semibold mb-1">Company / Customer Name *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 text-ink text-xs focus:outline-none focus:border-accent font-medium"
                placeholder="e.g. Reliance Logistics Hub"
              />
            </div>

            {legalName && legalName !== name && (
              <div className="sm:col-span-2">
                <label className="block text-ink-faint font-medium mb-1">Registered Legal Name (from GSTVerify)</label>
                <input
                  type="text"
                  readOnly
                  value={legalName}
                  className="w-full bg-surface-sunken border border-line rounded-card px-3 py-2 text-ink-soft text-xs focus:outline-none cursor-default"
                />
              </div>
            )}

            <div>
              <label className="block text-ink-soft font-semibold mb-1">Contact Person</label>
              <input
                type="text"
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
                className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 text-ink text-xs focus:outline-none focus:border-accent"
                placeholder="e.g. Ramesh Patel"
              />
            </div>

            <div>
              <label className="block text-ink-soft font-semibold mb-1">Phone Number</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 text-ink text-xs focus:outline-none focus:border-accent"
                placeholder="+91 98765 43210"
              />
            </div>

            <div>
              <label className="block text-ink-soft font-semibold mb-1">WhatsApp for Invoices</label>
              <input
                type="text"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 text-ink text-xs focus:outline-none focus:border-accent"
                placeholder="+91 98765 43210"
              />
            </div>

            <div>
              <label className="block text-ink-soft font-semibold mb-1">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 text-ink text-xs focus:outline-none focus:border-accent"
                placeholder="accounts@customer.com"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-ink-soft font-semibold mb-1">Billing Address (Principal Place of Business)</label>
              <textarea
                rows={2}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 text-ink text-xs focus:outline-none focus:border-accent"
                placeholder="Plot No. 42, GIDC Industrial Estate..."
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-ink-soft font-semibold mb-1">Shipping / Delivery Address (Optional, if different from billing)</label>
              <textarea
                rows={2}
                value={shippingAddress}
                onChange={(e) => setShippingAddress(e.target.value)}
                className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 text-ink text-xs focus:outline-none focus:border-accent"
                placeholder="Warehouse / Plant delivery location (leave blank if same as billing)"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-ink-soft font-semibold">PIN Code (6 digits)</label>
                <button
                  type="button"
                  disabled={fetchingPin || pin.length !== 6}
                  onClick={() => fetchPIN(pin)}
                  className="text-[11px] text-accent-ink hover:text-accent-ink font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-40"
                >
                  {fetchingPin ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>Fetching...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3 h-3 text-accent" />
                      <span>Fetch City/State</span>
                    </>
                  )}
                </button>
              </div>
              <input
                type="text"
                maxLength={6}
                value={pin}
                onChange={(e) => handlePinChange(e.target.value)}
                className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 text-ink text-xs focus:outline-none focus:border-accent"
                placeholder="382443"
              />
            </div>

            <div>
              <label className="block text-ink-soft font-semibold mb-1">City / District</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 text-ink text-xs focus:outline-none focus:border-accent"
                placeholder="Ahmedabad"
              />
            </div>

            <div>
              <label className="block text-ink-soft font-semibold mb-1">State</label>
              <input
                type="text"
                value={state}
                onChange={(e) => setState(e.target.value)}
                className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 text-ink text-xs focus:outline-none focus:border-accent"
                placeholder="Gujarat"
              />
            </div>

            <div>
              <label className="block text-ink-soft font-semibold mb-1">Credit Days</label>
              <input
                type="number"
                value={creditDays}
                onChange={(e) => setCreditDays(parseInt(e.target.value) || 0)}
                className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 text-ink text-xs focus:outline-none focus:border-accent"
              />
            </div>

            <div>
              <label className="block text-ink-soft font-semibold mb-1">Payment Terms</label>
              <input
                type="text"
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 text-ink text-xs focus:outline-none focus:border-accent"
                placeholder="Net 15 Days"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-line">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-surface-sunken hover:bg-surface-sunken text-ink-soft rounded-card text-xs font-medium transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 bg-accent-strong hover:bg-accent-strong-hover text-on-accent rounded-card text-xs font-semibold shadow-card transition flex items-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? 'Saving...' : 'Register Customer'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
