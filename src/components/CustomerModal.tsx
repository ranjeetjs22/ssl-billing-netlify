import React, { useState } from 'react';
import { Check, Loader2, AlertCircle, AlertTriangle, ShieldCheck } from 'lucide-react';
import { apiRequest } from '../services/api.js';
import { lookupGSTIN, lookupPincode, isValidGSTINFormat, GSTLookupResult } from '../utils/gstLookup.js';
import { Customer } from '../types.js';
import { Modal, Button, Field, Input, Textarea, FormError, cx } from './ui.js';

interface CustomerModalProps {
  /** When given, the form edits this customer instead of registering a new one. */
  customerToEdit?: Customer | null;
  onClose: () => void;
  onSuccess: (saved?: Customer) => void;
}

export const CustomerModal: React.FC<CustomerModalProps> = ({ customerToEdit, onClose, onSuccess }) => {
  const isEdit = Boolean(customerToEdit?.id);
  const c0 = customerToEdit || ({} as Partial<Customer>);
  const [name, setName] = useState(c0.name || '');
  const [legalName, setLegalName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [contactPerson, setContactPerson] = useState(c0.contact_person || '');
  const [email, setEmail] = useState(c0.email || '');
  const [phone, setPhone] = useState(c0.phone || '');
  const [whatsapp, setWhatsapp] = useState(c0.whatsapp || '');
  const [address, setAddress] = useState(c0.address || '');
  // Blank when it simply repeats the billing address, so it stays "same as billing"
  const [shippingAddress, setShippingAddress] = useState(
    c0.shipping_address && c0.shipping_address !== c0.address ? c0.shipping_address : ''
  );
  const [city, setCity] = useState(isEdit ? (c0.city || '') : 'Ahmedabad');
  const [state, setState] = useState(isEdit ? (c0.state || '') : 'Gujarat');
  const [pin, setPin] = useState(c0.pin || '');
  const [gstin, setGstin] = useState(c0.gstin || '');
  const [pan, setPan] = useState(c0.pan || '');
  const [gstStatus, setGstStatus] = useState('');
  const [constitution, setConstitution] = useState('');
  const [taxpayerType, setTaxpayerType] = useState('Regular');
  const [natureOfBusiness, setNatureOfBusiness] = useState<string[]>([]);
  const [paymentTerms, setPaymentTerms] = useState(c0.payment_terms || 'Net 15 Days');
  const [creditDays, setCreditDays] = useState(isEdit ? Number(c0.credit_days) || 0 : 15);
  const [creditLimit, setCreditLimit] = useState(isEdit ? Number(c0.credit_limit) || 0 : 100000);
  const [notes, setNotes] = useState(c0.notes || '');
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
      const saved = await apiRequest<Customer>(isEdit ? `/customers/${customerToEdit!.id}` : '/customers', {
        method: isEdit ? 'PUT' : 'POST',
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
            // Only the default taxpayer line on a new record; on edit it is noise unless looked up
            taxpayerType && (!isEdit || lookupFeedback?.type === 'verified') ? `Taxpayer: ${taxpayerType}` : '',
            natureOfBusiness.length > 0 ? `Activities: ${natureOfBusiness.join(', ')}` : '',
          ]
            // Editing keeps the existing notes; never append a line that is already there
            .filter((line, i) => Boolean(line) && (i === 0 || !notes.includes(line)))
            .join('\n'),
        }),
      });
      onSuccess(saved);
      onClose();
    } catch (err: any) {
      setError(err.message || (isEdit ? 'Failed to save customer' : 'Failed to add customer'));
    } finally {
      setSaving(false);
    }
  };

  const fetchAction = (busy: boolean, disabled: boolean, onClick: () => void, idle: string, busyText: string) => (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="text-xs font-medium text-accent-ink hover:underline inline-flex items-center gap-1 cursor-pointer
                 disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
    >
      {busy ? <><Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />{busyText}</> : idle}
    </button>
  );

  const feedbackTone = lookupFeedback?.type === 'verified'
    ? 'bg-positive-soft border-positive-line text-positive-ink'
    : lookupFeedback?.type === 'unavailable'
    ? 'bg-warning-soft border-warning-line text-warning-ink'
    : 'bg-danger-soft border-danger-line text-danger-ink';

  return (
    <Modal
      onClose={onClose}
      title={isEdit ? 'Edit customer' : 'New customer'}
      subtitle={isEdit ? customerToEdit!.name : 'Enter the GSTIN or PIN to fill in the rest'}
      size="lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="customer-form" loading={saving} icon={<Check />}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add customer'}
          </Button>
        </div>
      }
    >
      <form id="customer-form" onSubmit={handleSave} className="space-y-5">
        <FormError message={error} />

        {/* Tax registration */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-ink pb-1.5 border-b border-line">Tax registration</h3>

          {lookupFeedback && (
            <div role="status" className={cx('px-3 py-2 rounded-control border flex items-start gap-2 text-sm', feedbackTone)}>
              {lookupFeedback.type === 'verified' ? (
                <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              ) : lookupFeedback.type === 'unavailable' ? (
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              )}
              <div className="min-w-0">
                <div className="font-medium">{lookupFeedback.text}</div>
                {lookupFeedback.subText && <div className="text-xs opacity-90 mt-0.5">{lookupFeedback.subText}</div>}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field
              label="GSTIN"
              htmlFor="cust-gstin"
              hint="15 characters. Details are fetched automatically."
              action={fetchAction(fetchingGst, fetchingGst || gstin.length !== 15, () => fetchGST(gstin, true), 'Fetch details', 'Verifying…')}
            >
              <Input
                id="cust-gstin"
                type="text"
                maxLength={15}
                value={gstin}
                onChange={(e) => handleGSTINChange(e.target.value)}
                className="font-mono uppercase"
                placeholder="24AABCS1429B1Z8"
                autoComplete="off"
              />
            </Field>

            <Field label="PAN" htmlFor="cust-pan">
              <Input
                id="cust-pan"
                type="text"
                maxLength={10}
                value={pan}
                onChange={(e) => setPan(e.target.value.toUpperCase())}
                className="font-mono uppercase"
                placeholder="AABCS1429B"
                autoComplete="off"
              />
            </Field>
          </div>
        </section>

        {/* Business and contact */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-ink pb-1.5 border-b border-line">Business and contact</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Customer name" htmlFor="cust-name" required className="sm:col-span-2">
              <Input
                id="cust-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Reliance Logistics Hub"
              />
            </Field>

            {legalName && legalName !== name && (
              <Field label="Registered legal name (from GST)" htmlFor="cust-legal" className="sm:col-span-2">
                <Input id="cust-legal" type="text" readOnly value={legalName} />
              </Field>
            )}

            <Field label="Contact person" htmlFor="cust-contact">
              <Input id="cust-contact" type="text" value={contactPerson} onChange={(e) => setContactPerson(e.target.value)}
                placeholder="e.g. Ramesh Patel" />
            </Field>

            <Field label="Phone" htmlFor="cust-phone">
              <Input id="cust-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98765 43210" />
            </Field>

            <Field label="WhatsApp for invoices" htmlFor="cust-wa">
              <Input id="cust-wa" type="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="+91 98765 43210" />
            </Field>

            <Field label="Email" htmlFor="cust-email">
              <Input id="cust-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="accounts@customer.com" />
            </Field>
          </div>
        </section>

        {/* Address */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-ink pb-1.5 border-b border-line">Address</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Billing address" htmlFor="cust-addr" hint="Principal place of business" className="sm:col-span-2">
              <Textarea id="cust-addr" rows={2} className="min-h-16" value={address} onChange={(e) => setAddress(e.target.value)}
                placeholder="Plot No. 42, GIDC Industrial Estate…" />
            </Field>

            <Field label="Shipping address" htmlFor="cust-ship" hint="Leave blank if same as billing" className="sm:col-span-2">
              <Textarea id="cust-ship" rows={2} className="min-h-16" value={shippingAddress} onChange={(e) => setShippingAddress(e.target.value)}
                placeholder="Warehouse or plant delivery location" />
            </Field>

            <Field
              label="PIN code"
              htmlFor="cust-pin"
              action={fetchAction(fetchingPin, fetchingPin || pin.length !== 6, () => fetchPIN(pin), 'Fetch city', 'Fetching…')}
            >
              <Input id="cust-pin" type="text" inputMode="numeric" maxLength={6} value={pin}
                onChange={(e) => handlePinChange(e.target.value)} className="tabular-nums" placeholder="382443" />
            </Field>

            <Field label="City / district" htmlFor="cust-city">
              <Input id="cust-city" type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ahmedabad" />
            </Field>

            <Field label="State" htmlFor="cust-state">
              <Input id="cust-state" type="text" value={state} onChange={(e) => setState(e.target.value)} placeholder="Gujarat" />
            </Field>
          </div>
        </section>

        {/* Billing terms */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-ink pb-1.5 border-b border-line">Billing terms</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Payment terms" htmlFor="cust-terms">
              <Input id="cust-terms" type="text" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)}
                placeholder="Net 15 Days" />
            </Field>

            <Field label="Credit days" htmlFor="cust-days">
              <Input id="cust-days" type="number" value={creditDays}
                onChange={(e) => setCreditDays(parseInt(e.target.value) || 0)} />
            </Field>

            <Field label="Credit limit (₹)" htmlFor="cust-limit">
              <Input id="cust-limit" type="number" min="0" value={creditLimit}
                onChange={(e) => setCreditLimit(parseFloat(e.target.value) || 0)} />
            </Field>

            <Field label="Notes" htmlFor="cust-notes" className="sm:col-span-2">
              <Textarea id="cust-notes" rows={3} className="min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Internal notes about this customer" />
            </Field>
          </div>
        </section>
      </form>
    </Modal>
  );
};
