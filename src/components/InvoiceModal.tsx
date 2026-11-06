import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, Save, UserPlus, Check, Loader2 } from 'lucide-react';
import { apiRequest } from '../services/api.js';
import { Customer, ChargeItem, CostItem, InvoiceTotals, Invoice } from '../types.js';
import { formatINR } from '../utils/format.js';
import { lookupGSTIN, lookupPincode, isValidGSTINFormat } from '../utils/gstLookup.js';
import { compute, r2, splitInclusive, VENDOR_GST_RATE } from '../utils/calc.js';
import { resolveRate, placeFromName } from '../utils/rates.js';
import type { SpecialRate, MatrixRow, PlaceLookup } from '../utils/rates.js';
import {
  Modal, Button, IconButton, Badge, Field, Input, Select, Textarea, Segmented, FormError, cx,
} from './ui.js';

/** The slice of GET /rates/card the invoice form needs to suggest Rate / Kg. */
interface InvoiceRateCard extends PlaceLookup {
  matrix: MatrixRow[];
  specials: SpecialRate[];
  source: 'global' | 'customer';
  customer_card?: { exists: boolean; use_custom: boolean };
}

interface InvoiceModalProps {
  invoiceToEdit?: Invoice | null;
  /** Pre-select this customer when creating a new invoice (e.g. from the customer statement). */
  initialCustomerId?: string;
  onClose: () => void;
  onSuccess: (savedInvoice?: Invoice) => void;
}

/** One LR / bilty row in the form. A single bill may carry many LRs. */
interface LrLine {
  key: string;
  lr_no: string;
  lr_date: string;
  origin: string;
  destination: string;
  /** Actual (dead) weight in kg. Recorded and printed; freight does not use it. */
  actual_weight: number;
  /** Chargeable weight in kg: this one drives freight. */
  weight: number;
  /** true while chargeable weight copies actual weight; typing a chargeable weight turns it off. Never saved. */
  weight_auto: boolean;
  rate_kg: number;
  amount: number;
  /** What we paid for this trip INCLUDING the vendor's GST. null = not entered yet (not the same as zero). */
  cost_incl_gst: number | null;
  /** Does that amount include 18% GST? false for a truck owner who charged no GST. */
  gst_included: boolean;
  vendor: string;
  /** Can that GST be claimed back? false for unregistered truck owners. */
  itc: boolean;
  /** true while Rate / Kg follows the rate chart; typing a rate turns it off. Never saved. */
  rate_auto: boolean;
}

let lrKeySeq = 0;
const newLrLine = (partial: Partial<LrLine> = {}): LrLine => ({
  key: `lr-${Date.now()}-${lrKeySeq++}`,
  lr_no: '',
  lr_date: '',
  origin: 'Ahmedabad',
  destination: '',
  actual_weight: 0,
  weight: 0,
  weight_auto: true,
  rate_kg: 0,
  amount: 0,
  cost_incl_gst: null,
  gst_included: true,
  vendor: '',
  itc: true,
  rate_auto: true,
  ...partial,
});

function buildInitialLrLines(inv?: Invoice | null): LrLine[] {
  if (inv?.lr_items && inv.lr_items.length > 0) {
    return inv.lr_items.map(l => newLrLine({
      lr_no: l.lr_no || '',
      lr_date: l.lr_date || '',
      origin: l.origin || '',
      destination: l.destination || '',
      actual_weight: Number(l.actual_weight) || 0,
      weight: Number(l.weight) || 0,
      // A saved bill keeps the weight it was billed at
      weight_auto: false,
      rate_kg: Number(l.rate_kg) || 0,
      amount: Number(l.amount) || 0,
      // Bills saved before the combined entry stored cost and GST apart: add them back together.
      cost_incl_gst: l.cost_incl_gst !== undefined && l.cost_incl_gst !== null
        ? Number(l.cost_incl_gst)
        : l.cost === null || l.cost === undefined ? null : Number(l.cost) + (Number(l.cost_gst) || 0),
      gst_included: l.gst_included !== undefined ? l.gst_included !== false : (Number(l.cost_gst) || 0) > 0 || l.cost === null || l.cost === undefined,
      vendor: l.vendor || '',
      itc: l.itc !== false,
      // A saved bill keeps the rates it was billed at
      rate_auto: false,
    }));
  }
  if (inv && inv.id) {
    // Legacy single-LR invoice → one line built from the scalar fields
    return [newLrLine({
      lr_no: inv.lr_no || '',
      lr_date: inv.shipment_date || '',
      origin: inv.origin || '',
      destination: inv.destination || '',
      weight: Number(inv.weight) || 0,
      weight_auto: false,
      rate_kg: Number(inv.rate_kg) || 0,
      amount: Number(inv.freight) || 0,
      rate_auto: false,
    })];
  }
  return [newLrLine()];
}

/** Compact cell input for the LR grid: same look as `inputCls`, 32px tall at every width. */
const lrInputCls =
  'w-full h-8 bg-surface border border-line rounded-control px-2 text-sm text-ink tabular-nums ' +
  'placeholder:text-ink-faint transition-[border-color,box-shadow] duration-[var(--duration-fast)] ' +
  'hover:border-line-strong focus:border-accent focus:outline-none focus:ring-focus';

export const InvoiceModal: React.FC<InvoiceModalProps> = ({ invoiceToEdit, initialCustomerId, onClose, onSuccess }) => {
  // <Modal> registers the phone Back button, so it closes this instead of leaving the app
  const formId = React.useId();
  const isEditMode = Boolean(invoiceToEdit && invoiceToEdit.id);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(invoiceToEdit?.customer_id || '');
  const [invoiceDate, setInvoiceDate] = useState(invoiceToEdit?.invoice_date || new Date().toISOString().slice(0, 10));
  const [invoiceNo, setInvoiceNo] = useState(invoiceToEdit?.invoice_no || '');
  // GST tax invoice or internal (non-GST) bill. Fixed once the bill exists,
  // because its number belongs to that series.
  const [docType, setDocType] = useState<'tax_invoice' | 'internal'>(
    invoiceToEdit?.doc_type === 'internal' ? 'internal' : 'tax_invoice'
  );
  const isInternal = docType === 'internal';
  const [otherCosts, setOtherCosts] = useState<CostItem[]>(
    (invoiceToEdit?.other_costs || []).map(c => ({
      label: c.label,
      amount_incl_gst: c.amount_incl_gst ?? (Number(c.amount) || 0) + (Number(c.gst) || 0),
      gst_included: c.gst_included ?? (Number(c.gst) || 0) > 0,
      amount: c.amount, gst: c.gst || 0, itc: c.itc !== false,
    }))
  );

  // Bill To & Ship To State
  const [sameAsBuyer, setSameAsBuyer] = useState(invoiceToEdit?.same_as_buyer ?? true);
  const [shipToName, setShipToName] = useState(invoiceToEdit?.ship_to?.name || '');
  const [shipToAddress, setShipToAddress] = useState(invoiceToEdit?.ship_to?.address || '');
  const [shipToCity, setShipToCity] = useState(invoiceToEdit?.ship_to?.city || '');
  const [shipToState, setShipToState] = useState(invoiceToEdit?.ship_to?.state || 'Gujarat');
  const [shipToPin, setShipToPin] = useState(invoiceToEdit?.ship_to?.pin || '');
  const [shipToGstin, setShipToGstin] = useState(invoiceToEdit?.ship_to?.gstin || '');
  const [shipToPhone, setShipToPhone] = useState(invoiceToEdit?.ship_to?.phone || '');

  // Consignment & Transport - one row per LR / bilty; freight is the sum of all lines
  const [lrLines, setLrLines] = useState<LrLine[]>(() => buildInitialLrLines(invoiceToEdit));
  const freight = useMemo(() => r2(lrLines.reduce((acc, l) => acc + (Number(l.amount) || 0), 0)), [lrLines]);
  const totalWeight = useMemo(() => r2(lrLines.reduce((acc, l) => acc + (Number(l.weight) || 0), 0)), [lrLines]);
  const totalActualWeight = useMemo(() => r2(lrLines.reduce((acc, l) => acc + (Number(l.actual_weight) || 0), 0)), [lrLines]);
  const [extraCharges, setExtraCharges] = useState<ChargeItem[]>(
    invoiceToEdit?.extra_charges && invoiceToEdit.extra_charges.length > 0
      ? invoiceToEdit.extra_charges
      : [{ label: 'Loading / Unloading', amount: 0 }]
  );
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>(invoiceToEdit?.discount_type || 'percent');
  const [discountValue, setDiscountValue] = useState<number>(invoiceToEdit?.discount_value || 0);
  const [gstType, setGstType] = useState<'intra' | 'igst' | 'exempt'>(
    invoiceToEdit?.gst_type === 'igst' || invoiceToEdit?.gst_type === 'inter'
      ? 'igst'
      : invoiceToEdit?.gst_type === 'exempt'
      ? 'exempt'
      : 'intra'
  );
  const [gstRate, setGstRate] = useState<number>(invoiceToEdit?.gst_rate ?? 18);
  const [sac, setSac] = useState(invoiceToEdit?.sac || '996511');
  const [placeOfSupply, setPlaceOfSupply] = useState(invoiceToEdit?.place_of_supply || 'Gujarat');
  const [paymentTerms, setPaymentTerms] = useState(invoiceToEdit?.payment_terms || 'Net 15 Days');
  const [dueDate, setDueDate] = useState(invoiceToEdit?.due_date || '');
  const [notes, setNotes] = useState(invoiceToEdit?.notes || '');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ship To Auto-Fetch state
  const [fetchingGstShipTo, setFetchingGstShipTo] = useState(false);
  const [fetchingPinShipTo, setFetchingPinShipTo] = useState(false);
  const [shipToLookupMsg, setShipToLookupMsg] = useState<string | null>(null);

  // Quick Customer Registration Sub-Modal
  const [showQuickAddCust, setShowQuickAddCust] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPerson, setNewCustPerson] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustEmail, setNewCustEmail] = useState('');
  const [newCustGstin, setNewCustGstin] = useState('');
  const [newCustPan, setNewCustPan] = useState('');
  const [newCustAddress, setNewCustAddress] = useState('');
  const [newCustCity, setNewCustCity] = useState('Ahmedabad');
  const [newCustState, setNewCustState] = useState('Gujarat');
  const [newCustPin, setNewCustPin] = useState('');
  const [newCustPaymentTerms, setNewCustPaymentTerms] = useState('Net 15 Days');
  const [newCustCreditDays, setNewCustCreditDays] = useState(15);
  const [savingCust, setSavingCust] = useState(false);
  const [custError, setCustError] = useState<string | null>(null);
  const [quickAddSuccessMsg, setQuickAddSuccessMsg] = useState<string | null>(null);
  const [fetchingGstQuick, setFetchingGstQuick] = useState(false);
  const [fetchingPinQuick, setFetchingPinQuick] = useState(false);
  const [quickLookupMsg, setQuickLookupMsg] = useState<string | null>(null);
  // The quick-add dialog is its own <Modal>, which handles the phone Back button

  // Load Customers and Next Invoice Number
  useEffect(() => {
    const init = async () => {
      try {
        const custRes = await apiRequest<{ items: Customer[] }>('/customers?page=1&page_size=500');
        const list = custRes.items || [];
        setCustomers(list);
        if (!isEditMode) {
          if (list.length > 0) {
            const preferred = (initialCustomerId && list.find(c => c.id === initialCustomerId)) || list[0];
            setSelectedCustomerId(preferred.id);
            applyCustomerDefaults(preferred);
          }

          const numRes = await apiRequest<{ invoice_no: string }>(
            `/invoices/next-number?invoice_date=${invoiceDate}&doc_type=${docType}`);
          setInvoiceNo(numRes.invoice_no);
        }
      } catch (err) {
        console.error('Init error', err);
      }
    };
    init();
  }, []);

  // Switching between GST and non-GST pulls the next number from that series.
  const firstDocRender = React.useRef(true);
  useEffect(() => {
    if (firstDocRender.current) { firstDocRender.current = false; return; }
    if (isEditMode) return;
    let alive = true;
    apiRequest<{ invoice_no: string }>(`/invoices/next-number?invoice_date=${invoiceDate}&doc_type=${docType}`)
      .then(r => { if (alive) setInvoiceNo(r.invoice_no); })
      .catch(() => {});
    return () => { alive = false; };
  }, [docType]);

  // Keep Place of Supply automatically synced with Ship To State
  useEffect(() => {
    const buyer = customers.find(c => c.id === selectedCustomerId);
    const effectiveShipState = sameAsBuyer ? (buyer?.state || 'Gujarat') : (shipToState || 'Gujarat');
    if (effectiveShipState) {
      setPlaceOfSupply(effectiveShipState);
      // An explicit "GST Exempt" choice must not be overridden by the state sync
      if (gstType === 'exempt') return;
      if (effectiveShipState.toLowerCase() !== 'gujarat') {
        setGstType('igst');
      } else {
        setGstType('intra');
      }
    }
  }, [sameAsBuyer, shipToState, selectedCustomerId, customers]);

  const applyCustomerDefaults = (cust: Customer) => {
    const effectiveState = cust.state || 'Gujarat';
    setPlaceOfSupply(effectiveState);
    if (effectiveState.toLowerCase() !== 'gujarat') {
      setGstType('igst');
    } else {
      setGstType('intra');
    }
    if (cust.payment_terms) {
      setPaymentTerms(cust.payment_terms);
    }
    if (cust.credit_days) {
      const d = new Date(invoiceDate);
      d.setDate(d.getDate() + Number(cust.credit_days));
      setDueDate(d.toISOString().slice(0, 10));
    }
    // Default Ship To details when same as buyer
    setShipToName(cust.name);
    setShipToAddress(cust.shipping_address || cust.address || '');
    setShipToCity(cust.city || '');
    setShipToState(cust.state || 'Gujarat');
    setShipToPin(cust.pin || '');
    setShipToGstin(cust.gstin || '');
    setShipToPhone(cust.phone || '');
  };

  const handleCustomerChange = (custId: string) => {
    setSelectedCustomerId(custId);
    const selected = customers.find(c => c.id === custId);
    if (selected) {
      applyCustomerDefaults(selected);
    }
  };

  // ---- LR line helpers ----
  const updateLrLine = (key: string, patch: Partial<LrLine>) => {
    setLrLines(prev => prev.map(l => {
      if (l.key !== key) return l;
      const next = { ...l, ...patch };
      // Typing a rate or an amount by hand stops the chart from overwriting it
      if (('rate_kg' in patch || 'amount' in patch) && !('rate_auto' in patch)) next.rate_auto = false;
      // Chargeable weight copies actual weight until someone types a different one
      const weightFollowed = 'actual_weight' in patch && next.weight_auto;
      if (weightFollowed) next.weight = next.actual_weight;
      // Chargeable weight × Rate drives the line freight whenever both are known; a direct amount is also allowed
      if (('weight' in patch || 'rate_kg' in patch || weightFollowed) && next.weight > 0 && next.rate_kg > 0) {
        next.amount = Math.round(next.weight * next.rate_kg * 100) / 100;
      }
      return next;
    }));
  };

  const addLrLine = () => {
    setLrLines(prev => {
      const last = prev[prev.length - 1];
      return [...prev, newLrLine({
        origin: last?.origin || companyCity, destination: last?.destination || consigneeCity,
        rate_kg: last?.rate_kg || 0, rate_auto: last ? last.rate_auto : true,
      })];
    });
  };

  const removeLrLine = (key: string) => {
    setLrLines(prev => (prev.length <= 1 ? prev : prev.filter(l => l.key !== key)));
  };

  /** Switching to a separate consignee starts from the buyer's details instead of a blank form. */
  const toggleSameAsBuyer = (same: boolean) => {
    if (!same && !shipToName.trim()) {
      const buyer = customers.find(c => c.id === selectedCustomerId);
      if (buyer) {
        setShipToName(buyer.name);
        setShipToAddress(buyer.shipping_address || buyer.address || '');
        setShipToCity(buyer.city || '');
        setShipToState(buyer.state || 'Gujarat');
        setShipToPin(buyer.pin || '');
        setShipToGstin(buyer.gstin || '');
        setShipToPhone(buyer.phone || '');
      }
    }
    setSameAsBuyer(same);
  };

  // ---- LR From / To follow the parties ----
  // To = the consignee's city: the buyer's when Ship To is "same as Bill To", otherwise the
  // Ship To city. Every line whose To is blank or still shows the previous consignee city
  // follows along; a To typed by hand is left alone.
  const consigneeCity = (sameAsBuyer
    ? customers.find(c => c.id === selectedCustomerId)?.city
    : shipToCity) || '';
  const prevConsigneeCity = React.useRef<string | null>(null);
  useEffect(() => {
    const prev = prevConsigneeCity.current;
    prevConsigneeCity.current = consigneeCity;
    // Opening a saved bill must not rewrite its routes
    if (prev === null && isEditMode) return;
    const next = consigneeCity.trim();
    if (!next) return;
    const was = (prev || '').trim().toLowerCase();
    setLrLines(lines => lines.map(l => {
      const cur = l.destination.trim().toLowerCase();
      return !cur || (was && cur === was) ? { ...l, destination: next } : l;
    }));
  }, [consigneeCity]);

  // From = our own city (company settings), on lines still showing the built-in default
  const [companyCity, setCompanyCity] = useState('Ahmedabad');
  useEffect(() => {
    if (isEditMode) return;
    apiRequest<{ city?: string }>('/settings/company')
      .then(c => {
        const city = (c?.city || '').trim();
        if (!city || city === 'Ahmedabad') return;
        setCompanyCity(city);
        setLrLines(lines => lines.map(l => (l.origin === 'Ahmedabad' ? { ...l, origin: city } : l)));
      })
      .catch(() => {});
  }, []);

  // ---- Rate / Kg from the rate chart (the customer's personal one when they have it) ----
  // 'auto' = whatever the customer is set to; the user can flip to the other chart per bill.
  const [rateMode, setRateMode] = useState<'auto' | 'custom' | 'global'>('auto');
  const [rateCard, setRateCard] = useState<InvoiceRateCard | null>(null);
  useEffect(() => { setRateMode('auto'); }, [selectedCustomerId]);
  useEffect(() => {
    let alive = true;
    const q = new URLSearchParams({ mode: rateMode });
    if (selectedCustomerId) q.set('customer_id', selectedCustomerId);
    apiRequest<InvoiceRateCard>(`/rates/card?${q.toString()}`)
      .then(c => { if (alive) setRateCard(c); })
      .catch(() => { if (alive) setRateCard(null); });   // no rate access: rates stay manual
    return () => { alive = false; };
  }, [selectedCustomerId, rateMode]);

  /** Suggested rate per LR line, keyed by line. */
  const rateSuggestions = useMemo(() => {
    const out: Record<string, { rate: number; label: string } | null> = {};
    if (!rateCard) return out;
    const buyer = customers.find(c => c.id === selectedCustomerId);
    const consigneeCity = (sameAsBuyer ? buyer?.city : shipToCity) || '';
    const consigneeState = (sameAsBuyer ? buyer?.state : shipToState) || '';
    for (const l of lrLines) {
      const origin = placeFromName(l.origin, rateCard, 'Gujarat');
      // An unlisted delivery town takes the consignee's state when it is the consignee's town
      const destFallback = l.destination.trim().toLowerCase() === consigneeCity.trim().toLowerCase() ? consigneeState : undefined;
      const dest = placeFromName(l.destination, rateCard, destFallback);
      if (!origin || !dest) { out[l.key] = null; continue; }
      const r = resolveRate(origin, dest, rateCard.specials, rateCard.matrix);
      out[l.key] = r.rate_per_kg > 0
        ? { rate: r.rate_per_kg, label: `${rateCard.source === 'customer' ? 'Personal' : 'Global'} · ${r.source === 'special' ? 'special' : `${origin.zone}→${dest.zone}`}` }
        : null;
    }
    return out;
  }, [rateCard, lrLines, customers, selectedCustomerId, sameAsBuyer, shipToCity, shipToState]);

  // Apply suggestions to lines still following the chart
  useEffect(() => {
    if (!lrLines.some(l => l.rate_auto && rateSuggestions[l.key] && rateSuggestions[l.key]!.rate !== l.rate_kg)) return;
    setLrLines(prev => prev.map(l => {
      const sug = rateSuggestions[l.key];
      if (!l.rate_auto || !sug || sug.rate === l.rate_kg) return l;
      return { ...l, rate_kg: sug.rate, amount: l.weight > 0 ? Math.round(l.weight * sug.rate * 100) / 100 : l.amount };
    }));
  }, [rateSuggestions]);

  // Live calculations - same pure engine the server uses to persist totals (no network round-trip,
  // so rapidly typed values can never be overwritten by a slower, stale response).
  const calcResult = useMemo<InvoiceTotals>(() => compute({
    doc_type: docType,
    freight,
    lr_items: lrLines,
    extra_charges: extraCharges.filter(c => c.amount > 0),
    other_costs: otherCosts.filter(c => (c.amount_incl_gst || 0) > 0),
    discount_type: discountType,
    discount_value: discountValue,
    gst_type: gstType,
    gst_rate: gstRate,
  }) as unknown as InvoiceTotals, [docType, freight, lrLines, extraCharges, otherCosts, discountType, discountValue, gstType, gstRate]);

  const updateOtherCost = (index: number, field: keyof CostItem, value: any) => {
    setOtherCosts(prev => prev.map((c, i) => i === index
      ? { ...c, [field]: field === 'amount_incl_gst' ? parseFloat(value) || 0 : value } : c));
  };

  const addChargeItem = () => {
    setExtraCharges([...extraCharges, { label: 'Additional Charge', amount: 0 }]);
  };

  const updateChargeItem = (index: number, field: 'label' | 'amount', value: any) => {
    const updated = [...extraCharges];
    updated[index] = { ...updated[index], [field]: field === 'amount' ? parseFloat(value) || 0 : value };
    setExtraCharges(updated);
  };

  const removeChargeItem = (index: number) => {
    setExtraCharges(extraCharges.filter((_, i) => i !== index));
  };

  // Ship To Auto-Fetch
  const fetchShipToGST = async (gstNumber: string, isExplicitClick = false) => {
    const clean = gstNumber.toUpperCase().trim();
    if (clean.length !== 15 || !isValidGSTINFormat(clean)) {
      if (isExplicitClick) {
        setShipToLookupMsg('Please enter a valid 15-character GSTIN');
      }
      return;
    }
    setFetchingGstShipTo(true);
    setShipToLookupMsg(null);
    try {
      const res = await lookupGSTIN(clean);
      if (res && res.verification_status === 'verified') {
        if (res.state) {
          setShipToState(res.state);
          setPlaceOfSupply(res.state);
        }
        if (res.city) {
          setShipToCity(res.city);
        }
        if (res.pin && (!shipToPin || isExplicitClick)) setShipToPin(res.pin);
        if (res.address && (!shipToAddress || isExplicitClick)) setShipToAddress(res.address);
        const nameVal = res.customer_name || res.trade_name || res.legal_name || '';
        if (nameVal && (!shipToName || isExplicitClick)) {
          setShipToName(nameVal);
        }
        setShipToLookupMsg(`✓ GSTVerify Live Verified (${res.state}) · Status: ${res.gst_status || 'Active'}`);
      } else if (res && res.verification_status === 'unavailable') {
        if (res.state) {
          setShipToState(res.state);
          setPlaceOfSupply(res.state);
        }
        setShipToLookupMsg(`⚠️ Live verification unavailable (Derived: ${res.state})`);
      } else {
        setShipToLookupMsg('✕ GSTIN invalid or not found');
      }
    } catch (e) {
      console.warn('Ship-to GST fetch error', e);
      setShipToLookupMsg('⚠️ GST verification offline');
    } finally {
      setFetchingGstShipTo(false);
    }
  };

  const handleShipToGstinChange = (val: string) => {
    const clean = val.toUpperCase().trim();
    setShipToGstin(clean);
    if (clean.length === 15 && isValidGSTINFormat(clean)) {
      fetchShipToGST(clean, false);
    }
  };

  const fetchShipToPIN = async (pincodeVal: string) => {
    const clean = pincodeVal.trim();
    if (!/^[1-9][0-9]{5}$/.test(clean)) return;
    setFetchingPinShipTo(true);
    try {
      const res = await lookupPincode(clean);
      if (res && res.valid) {
        if (res.city) {
          setShipToCity(res.city);
        }
        if (res.state) {
          setShipToState(res.state);
          setPlaceOfSupply(res.state);
        }
        setShipToLookupMsg(`PIN Verified: ${res.city}, ${res.state}`);
      }
    } catch (e) {
      console.warn('Ship-to PIN fetch error', e);
    } finally {
      setFetchingPinShipTo(false);
    }
  };

  const handleShipToPinChange = (val: string) => {
    const clean = val.trim();
    setShipToPin(clean);
    if (clean.length === 6) {
      fetchShipToPIN(clean);
    }
  };

  // Quick Customer GSTIN & PIN Auto-Fetch
  const fetchQuickGST = async (gstNumber: string, isExplicitClick = false) => {
    const clean = gstNumber.toUpperCase().trim();
    if (clean.length !== 15 || !isValidGSTINFormat(clean)) {
      if (isExplicitClick) {
        setQuickLookupMsg('Please enter a valid 15-character GSTIN');
      }
      return;
    }
    setFetchingGstQuick(true);
    setQuickLookupMsg(null);
    try {
      const res = await lookupGSTIN(clean);
      if (res && res.verification_status === 'verified') {
        if (res.pan) setNewCustPan(res.pan);
        if (res.state) setNewCustState(res.state);
        if (res.city && (!newCustCity || isExplicitClick || newCustCity === 'Ahmedabad')) setNewCustCity(res.city);
        if (res.pin && (!newCustPin || isExplicitClick)) setNewCustPin(res.pin);
        if (res.address && (!newCustAddress || isExplicitClick)) setNewCustAddress(res.address);
        const bestName = res.customer_name || res.trade_name || res.legal_name || '';
        if (bestName && (!newCustName || isExplicitClick)) {
          setNewCustName(bestName);
        }
        setQuickLookupMsg(`✓ GSTVerify Live Verified: ${bestName} (${res.state})`);
      } else if (res && res.verification_status === 'unavailable') {
        if (res.pan && !newCustPan) setNewCustPan(res.pan);
        if (res.state && (!newCustState || newCustState === 'Gujarat')) setNewCustState(res.state);
        setQuickLookupMsg(`⚠️ Live verification unavailable (Derived: ${res.state} · PAN ${res.pan})`);
      } else {
        setQuickLookupMsg('✕ GSTIN invalid or not found in registry');
      }
    } catch (e) {
      console.warn('Quick GST fetch error', e);
      setQuickLookupMsg('⚠️ GST verification offline');
    } finally {
      setFetchingGstQuick(false);
    }
  };

  const handleNewCustGSTIN = (val: string) => {
    const clean = val.toUpperCase().trim();
    setNewCustGstin(clean);
    if (clean.length === 15 && isValidGSTINFormat(clean)) {
      setNewCustPan(clean.substring(2, 12));
      fetchQuickGST(clean, false);
    }
  };

  const fetchQuickPIN = async (pincodeVal: string) => {
    const clean = pincodeVal.trim();
    if (!/^[1-9][0-9]{5}$/.test(clean)) return;
    setFetchingPinQuick(true);
    try {
      const res = await lookupPincode(clean);
      if (res && res.valid) {
        if (res.city) setNewCustCity(res.city);
        if (res.state) setNewCustState(res.state);
        setQuickLookupMsg(`Location: ${res.city}, ${res.state}`);
      }
    } catch (e) {
      console.warn('Quick PIN fetch error', e);
    } finally {
      setFetchingPinQuick(false);
    }
  };

  const handleNewCustPinChange = (val: string) => {
    const clean = val.trim();
    setNewCustPin(clean);
    if (clean.length === 6) {
      fetchQuickPIN(clean);
    }
  };

  // Handle Quick Add Customer submit
  const handleCreateQuickCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName.trim()) {
      setCustError('Customer name is required.');
      return;
    }
    setSavingCust(true);
    setCustError(null);

    try {
      const created = await apiRequest<Customer>('/customers', {
        method: 'POST',
        body: JSON.stringify({
          name: newCustName.trim(),
          contact_person: newCustPerson,
          phone: newCustPhone,
          email: newCustEmail,
          gstin: newCustGstin,
          pan: newCustPan,
          address: newCustAddress,
          city: newCustCity,
          state: newCustState,
          pin: newCustPin,
          payment_terms: newCustPaymentTerms,
          credit_days: Number(newCustCreditDays) || 0,
        }),
      });

      // Add to list and auto-select
      setCustomers(prev => [created, ...prev]);
      setSelectedCustomerId(created.id);
      applyCustomerDefaults(created);

      // Reset Quick Add Form
      setNewCustName('');
      setNewCustPerson('');
      setNewCustPhone('');
      setNewCustEmail('');
      setNewCustGstin('');
      setNewCustPan('');
      setNewCustAddress('');
      setNewCustCity('Ahmedabad');
      setNewCustState('Gujarat');
      setNewCustPin('');
      setShowQuickAddCust(false);
      setQuickAddSuccessMsg(`Customer "${created.name}" created and selected!`);
      setTimeout(() => setQuickAddSuccessMsg(null), 4000);
    } catch (err: any) {
      setCustError(err.message || 'Failed to create customer');
    } finally {
      setSavingCust(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomerId) {
      setError('Please select or add a customer.');
      return;
    }
    if (freight <= 0) {
      setError('Please enter freight for at least one LR line (Chargeable weight × Rate, or type the amount directly).');
      return;
    }
    setSaving(true);
    setError(null);

    try {
      const cleanLines = lrLines.map(({ key: _key, rate_auto: _auto, weight_auto: _weightAuto, ...rest }) => ({
        ...rest,
        lr_no: rest.lr_no.trim(),
        origin: rest.origin.trim(),
        destination: rest.destination.trim(),
        vendor: rest.vendor.trim(),
      }));
      const distinctRates = Array.from(new Set(cleanLines.map(l => l.rate_kg).filter(r => r > 0)));
      const payload = {
        doc_type: docType,
        other_costs: otherCosts.filter(c => (c.amount_incl_gst || 0) > 0 && c.label.trim()),
        customer_id: selectedCustomerId,
        invoice_date: invoiceDate,
        invoice_no: invoiceNo || undefined,
        same_as_buyer: sameAsBuyer,
        ship_to: sameAsBuyer ? undefined : {
          name: shipToName,
          address: shipToAddress,
          city: shipToCity,
          state: shipToState,
          pin: shipToPin,
          gstin: shipToGstin,
          phone: shipToPhone,
        },
        lr_items: cleanLines,
        lr_no: cleanLines.map(l => l.lr_no).filter(Boolean).join(', '),
        shipment_date: cleanLines[0]?.lr_date || undefined,
        origin: cleanLines[0]?.origin || '',
        destination: cleanLines[cleanLines.length - 1]?.destination || cleanLines[0]?.destination || '',
        weight: totalWeight,
        rate_kg: distinctRates.length === 1 ? distinctRates[0] : 0,
        sac,
        place_of_supply: placeOfSupply,
        freight,
        extra_charges: extraCharges.filter(c => c.amount > 0),
        discount_type: discountType,
        discount_value: discountValue,
        gst_type: gstType,
        gst_rate: gstRate,
        payment_terms: paymentTerms,
        due_date: dueDate || undefined,
        notes,
        status: 'pending',
      };

      let saved: Invoice;
      if (isEditMode && invoiceToEdit) {
        saved = await apiRequest<Invoice>(`/invoices/${invoiceToEdit.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        saved = await apiRequest<Invoice>('/invoices', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }

      onSuccess(saved);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save invoice');
    } finally {
      setSaving(false);
    }
  };

  const curBuyer = customers.find(c => c.id === selectedCustomerId);
  const lrCount = calcResult?.lr_count || lrLines.length;

  return (
    <>
      <Modal
        onClose={onClose}
        title={isEditMode
          ? `Edit ${isInternal ? 'non-GST bill' : 'tax invoice'}`
          : isInternal ? 'New non-GST bill' : 'New GST tax invoice'}
        subtitle={isEditMode ? (invoiceNo || invoiceToEdit?.invoice_no) : 'Bill to, ship to, consignments and tax'}
        size="2xl"
        footer={
          <div className="flex items-center gap-3">
            <div className="min-w-0 mr-auto leading-tight">
              <div className="text-xs text-ink-faint">Grand total</div>
              <div className="numeral text-base text-ink truncate">₹{formatINR(calcResult?.grand_total || 0)}</div>
            </div>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" form={formId} loading={saving} icon={<Save />}>
              {saving
                ? isEditMode ? 'Updating…' : 'Saving…'
                : isEditMode
                ? (isInternal ? 'Update bill' : 'Update invoice')
                : (isInternal ? 'Save bill' : 'Save invoice')}
            </Button>
          </div>
        }
      >
        <form id={formId} onSubmit={handleSave} className="min-w-0">
          {error && <div className="mb-4"><FormError message={error} /></div>}

          {isEditMode && (invoiceToEdit?.paid || 0) > 0 && (
            <div className="mb-4 px-3 py-2 rounded-control border border-warning-line bg-warning-soft text-sm text-warning-ink flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <span>₹{formatINR(invoiceToEdit?.paid || 0)} already received; the balance adjusts automatically.</span>
              {calcResult && (
                <span className="tabular-nums font-medium">
                  New balance ₹{formatINR(Math.max(0, calcResult.grand_total - (invoiceToEdit?.paid || 0)))}
                </span>
              )}
            </div>
          )}

          {/* ============================================================ Bill details */}
          <FormSection title="Bill details" first>
            <div className="grid grid-cols-1 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] gap-3 sm:gap-4 items-start">
              <Field label="Bill type" hint={isEditMode
                ? 'Fixed once created: the number belongs to that series.'
                : isInternal
                  ? 'Own series, no GST, never in GSTR-1.'
                  : 'GST series, reported in GSTR-1.'}>
                {isEditMode ? (
                  <div className="h-10 sm:h-9 flex items-center">
                    <Badge>{isInternal ? 'Non-GST bill' : 'GST tax invoice'}</Badge>
                  </div>
                ) : (
                  <Segmented
                    label="Bill type"
                    options={[
                      { value: 'tax_invoice', label: 'GST tax invoice' },
                      { value: 'internal', label: 'Non-GST bill' },
                    ] as const}
                    value={docType}
                    onChange={(v) => setDocType(v as 'tax_invoice' | 'internal')}
                  />
                )}
              </Field>
              <Field label={isInternal ? 'Bill number' : 'Invoice number'} htmlFor={`${formId}-no`} required>
                <Input
                  id={`${formId}-no`}
                  type="text"
                  required
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  className="font-mono"
                  placeholder={isInternal ? 'TRP/2026-27/0001' : 'SSL/2026-27/0001'}
                />
              </Field>
              <Field label={isInternal ? 'Bill date' : 'Invoice date'} htmlFor={`${formId}-date`} required>
                <Input
                  id={`${formId}-date`}
                  type="date"
                  required
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                />
              </Field>
            </div>
          </FormSection>

          {/* ================================================================ Parties */}
          <FormSection title="Parties">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
              {/* Bill to */}
              <div className="min-w-0 space-y-2">
                <Field
                  label="Bill to"
                  htmlFor={`${formId}-cust`}
                  required
                  action={
                    <button type="button" onClick={() => setShowQuickAddCust(true)}
                      className="tap-44 inline-flex items-center gap-1 text-xs font-medium text-accent-ink hover:underline cursor-pointer">
                      <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                      New customer
                    </button>
                  }
                >
                  <Select
                    id={`${formId}-cust`}
                    required
                    value={selectedCustomerId}
                    onChange={(e) => handleCustomerChange(e.target.value)}
                  >
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}{c.city ? ` · ${c.city}` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>

                {quickAddSuccessMsg && (
                  <p className="flex items-center gap-1.5 text-xs text-positive-ink">
                    <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    {quickAddSuccessMsg}
                  </p>
                )}

                {curBuyer && (
                  <div className="text-xs text-ink-soft space-y-0.5 pl-0.5">
                    <div>{curBuyer.address || 'Address not specified'}</div>
                    <div>{[curBuyer.city, curBuyer.state, curBuyer.pin].filter(Boolean).join(', ')}</div>
                    <div className="text-ink-faint">
                      GSTIN <span className="font-mono text-ink-soft">{curBuyer.gstin || 'Unregistered'}</span>
                      <span className="mx-1">·</span>
                      {curBuyer.payment_terms || 'Net 15 Days'}
                    </div>
                  </div>
                )}
              </div>

              {/* Ship to */}
              <div className="min-w-0 space-y-2">
                <div className="flex items-center justify-between gap-2 min-h-4">
                  <span className="text-xs font-medium text-ink-soft">Ship to</span>
                  <label className="tap-44 inline-flex items-center gap-1.5 text-xs text-ink-soft cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={sameAsBuyer}
                      onChange={(e) => toggleSameAsBuyer(e.target.checked)}
                      className="w-4 h-4"
                    />
                    Same as bill to
                  </label>
                </div>

                {sameAsBuyer ? (
                  <div className="rounded-control border border-line px-3 py-2.5 text-sm text-ink-soft">
                    <div>
                      Delivering to <span className="text-ink">{curBuyer?.name || 'the buyer'}</span>
                      {curBuyer?.city ? `, ${curBuyer.city}` : ''}
                    </div>
                    <div className="text-xs text-ink-faint mt-0.5">
                      Place of supply: <span className="text-ink-soft">{curBuyer?.state || 'Gujarat'}</span>
                    </div>
                    <button type="button" onClick={() => toggleSameAsBuyer(false)}
                      className="mt-1.5 text-xs font-medium text-accent-ink hover:underline cursor-pointer">
                      Ship to a different site or consignee
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-6 gap-x-3 gap-y-2.5">
                    {shipToLookupMsg && <LookupNote msg={shipToLookupMsg} className="col-span-6" />}
                    <Field label="Consignee GSTIN" htmlFor={`${formId}-sg`} className="col-span-6 sm:col-span-3"
                      action={<FetchLink busy={fetchingGstShipTo} disabled={shipToGstin.length !== 15}
                        onClick={() => fetchShipToGST(shipToGstin, true)} />}>
                      <Input id={`${formId}-sg`} type="text" maxLength={15} value={shipToGstin}
                        onChange={(e) => handleShipToGstinChange(e.target.value)}
                        className="font-mono uppercase" placeholder="Optional" />
                    </Field>
                    <Field label="Phone" htmlFor={`${formId}-sph`} className="col-span-6 sm:col-span-3">
                      <Input id={`${formId}-sph`} type="text" value={shipToPhone}
                        onChange={(e) => setShipToPhone(e.target.value)} placeholder="+91 98765 43210" />
                    </Field>
                    <Field label="Consignee / site name" htmlFor={`${formId}-sn`} required className="col-span-6">
                      <Input id={`${formId}-sn`} type="text" required={!sameAsBuyer} value={shipToName}
                        onChange={(e) => setShipToName(e.target.value)} placeholder="e.g. Warehouse 3" />
                    </Field>
                    <Field label="Delivery address" htmlFor={`${formId}-sa`} className="col-span-6">
                      <Input id={`${formId}-sa`} type="text" value={shipToAddress}
                        onChange={(e) => setShipToAddress(e.target.value)} placeholder="Plot no, road" />
                    </Field>
                    <Field label="PIN" htmlFor={`${formId}-sp`} className="col-span-3 sm:col-span-2"
                      action={<FetchLink busy={fetchingPinShipTo} disabled={shipToPin.length !== 6}
                        onClick={() => fetchShipToPIN(shipToPin)} />}>
                      <Input id={`${formId}-sp`} type="text" inputMode="numeric" maxLength={6} value={shipToPin}
                        onChange={(e) => handleShipToPinChange(e.target.value)} className="font-mono" placeholder="395003" />
                    </Field>
                    <Field label="City" htmlFor={`${formId}-sc`} className="col-span-3 sm:col-span-2">
                      {/* LR "To" follows this city (see the consignee sync effect) */}
                      <Input id={`${formId}-sc`} type="text" value={shipToCity}
                        onChange={(e) => setShipToCity(e.target.value)} placeholder="Surat" />
                    </Field>
                    <Field label="State (place of supply)" htmlFor={`${formId}-ss`} className="col-span-6 sm:col-span-2">
                      <Input id={`${formId}-ss`} type="text" value={shipToState}
                        onChange={(e) => { setShipToState(e.target.value); setPlaceOfSupply(e.target.value); }}
                        placeholder="Gujarat" />
                    </Field>
                  </div>
                )}
              </div>
            </div>
          </FormSection>

          {/* =========================================================== Consignments */}
          <FormSection
            title="Consignments"
            hint="Every LR / bilty on this bill. Freight = chargeable weight × rate, or type the amount."
            actions={
              <Button type="button" variant="secondary" size="sm" icon={<Plus />} onClick={addLrLine}>
                Add LR
              </Button>
            }
          >
            {rateCard && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mb-3">
                <span className="text-xs font-medium text-ink-soft">Rate / kg from</span>
                {rateCard.customer_card?.exists ? (
                  <Segmented
                    size="sm"
                    label="Rate chart for this bill"
                    options={[
                      { value: 'custom', label: 'Personal chart' },
                      { value: 'global', label: 'Global chart' },
                    ] as const}
                    value={rateCard.source === 'customer' ? 'custom' : 'global'}
                    onChange={(v) => {
                      setRateMode(v);
                      // Switching charts re-prices every line, including ones typed by hand
                      setLrLines(prev => prev.map(l => ({ ...l, rate_auto: true })));
                    }}
                  />
                ) : (
                  <Badge>Global chart</Badge>
                )}
                <span className="text-xs text-ink-faint">Filled from From / To; type a rate to override.</span>
              </div>
            )}

            <div className="border border-line rounded-card overflow-x-auto overscroll-x-contain">
              <table className="w-full min-w-[1060px] table-fixed text-sm">
                <colgroup>
                  <col className="w-7" />
                  <col className="w-[100px]" />
                  <col className="w-[120px]" />
                  <col className="w-[84px]" />
                  <col className="w-[84px]" />
                  <col className="w-[64px]" />
                  <col className="w-[88px]" />
                  <col className="w-[72px]" />
                  <col className="w-[88px]" />
                  <col className="w-[88px]" />
                  <col className="w-[96px]" />
                  <col className="w-9" />
                  <col />
                  <col className="w-9" />
                </colgroup>
                <thead className="bg-surface-muted border-b border-line">
                  <tr className="text-xs text-ink-faint">
                    <th className="h-8 pl-2.5 text-left font-medium">#</th>
                    <th className="h-8 px-1 text-left font-medium">LR no</th>
                    <th className="h-8 px-1 text-left font-medium">LR date</th>
                    <th className="h-8 px-1 text-left font-medium">From</th>
                    <th className="h-8 px-1 text-left font-medium">To</th>
                    <th className="h-8 px-1 text-right font-medium" title="Actual (dead) weight as weighed. Not used for freight.">Actual kg</th>
                    <th className="h-8 px-1 text-right font-medium" title="The weight billed: freight = chargeable weight × rate. Follows actual weight until you type a different one.">Chargeable kg</th>
                    <th className="h-8 px-1 text-right font-medium">Rate / kg</th>
                    <th className="h-8 px-1 text-right font-medium">Freight ₹</th>
                    <th className="h-8 px-1 text-right font-medium border-l border-line" title="What we paid for this trip, including the vendor's GST">Our cost ₹</th>
                    <th className="h-8 px-1 text-right font-medium" title={`Tick when the amount includes ${VENDOR_GST_RATE}% GST; the GST inside it is worked out as amount × ${VENDOR_GST_RATE}/${100 + VENDOR_GST_RATE}`}>GST in it</th>
                    <th className="h-8 px-1 text-center font-medium" title={isInternal
                      ? 'Non-GST bill: vendor GST is counted as cost, not claimed as credit'
                      : 'Tick if you can claim this GST back as input credit'}>ITC</th>
                    <th className="h-8 px-1 text-left font-medium">Vendor</th>
                    <th className="h-8" aria-label="Remove"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line [&_td]:align-top [&_td]:py-1.5">
                  {lrLines.map((line, idx) => {
                    const sug = rateSuggestions[line.key];
                    // The split shown here is the same one the server saves (server/calc.ts).
                    const split = line.cost_incl_gst !== null && line.gst_included
                      ? splitInclusive(line.cost_incl_gst) : null;
                    return (
                      <tr key={line.key}>
                        <td className="pl-2.5 pt-3! text-xs text-ink-faint tabular-nums">{idx + 1}</td>
                        <td className="px-1">
                          <input type="text" value={line.lr_no}
                            onChange={(e) => updateLrLine(line.key, { lr_no: e.target.value })}
                            className={cx(lrInputCls, 'font-mono')} placeholder="LR-88910"
                            aria-label={`LR number, line ${idx + 1}`} />
                        </td>
                        <td className="px-1">
                          <input type="date" value={line.lr_date}
                            onChange={(e) => updateLrLine(line.key, { lr_date: e.target.value })}
                            className={cx(lrInputCls, 'px-1.5')} aria-label={`LR date, line ${idx + 1}`} />
                        </td>
                        <td className="px-1">
                          <input type="text" value={line.origin}
                            onChange={(e) => updateLrLine(line.key, { origin: e.target.value })}
                            className={lrInputCls} placeholder="Ahmedabad" aria-label={`From, line ${idx + 1}`} />
                        </td>
                        <td className="px-1">
                          <input type="text" value={line.destination}
                            onChange={(e) => updateLrLine(line.key, { destination: e.target.value })}
                            className={lrInputCls} placeholder="Surat" aria-label={`To, line ${idx + 1}`} />
                        </td>
                        <td className="px-1">
                          <input type="number" min="0" step="any" value={line.actual_weight || ''}
                            onChange={(e) => updateLrLine(line.key, { actual_weight: parseFloat(e.target.value) || 0 })}
                            className={cx(lrInputCls, 'text-right')} placeholder="0" aria-label={`Actual weight in kg, line ${idx + 1}`} />
                        </td>
                        <td className="px-1">
                          <input type="number" min="0" step="any" value={line.weight || ''}
                            onChange={(e) => updateLrLine(line.key, {
                              weight: parseFloat(e.target.value) || 0,
                              // Emptying the box hands it back to actual weight
                              weight_auto: e.target.value === '',
                            })}
                            className={cx(lrInputCls, 'text-right')} placeholder="0" aria-label={`Chargeable weight in kg, line ${idx + 1}`} />
                        </td>
                        <td className="px-1">
                          <input type="number" min="0" step="any" value={line.rate_kg || ''}
                            onChange={(e) => updateLrLine(line.key, { rate_kg: parseFloat(e.target.value) || 0 })}
                            className={cx(lrInputCls, 'text-right')} placeholder="0.00" aria-label={`Rate per kg, line ${idx + 1}`} />
                          {sug && (
                            // Right-aligned and allowed to run left under the weight cell
                            <div className="flex justify-end mt-0.5">
                              {line.rate_auto || line.rate_kg === sug.rate ? (
                                <span className="text-[11px] text-ink-faint whitespace-nowrap">{sug.label}</span>
                              ) : (
                                <button type="button"
                                  onClick={() => updateLrLine(line.key, { rate_kg: sug.rate, rate_auto: true })}
                                  className="text-[11px] text-accent-ink whitespace-nowrap hover:underline cursor-pointer"
                                  title={sug.label}>
                                  Use chart ₹{sug.rate}
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-1">
                          <input type="number" min="0" step="any" value={line.amount || ''}
                            onChange={(e) => updateLrLine(line.key, { amount: parseFloat(e.target.value) || 0 })}
                            className={cx(lrInputCls, 'text-right font-medium')} placeholder="0.00"
                            aria-label={`Freight amount, line ${idx + 1}`} />
                        </td>
                        <td className="px-1 border-l border-line">
                          <input type="number" min="0" step="any" value={line.cost_incl_gst ?? ''}
                            onChange={(e) => updateLrLine(line.key, {
                              cost_incl_gst: e.target.value === '' ? null : parseFloat(e.target.value) || 0,
                            })}
                            className={cx(lrInputCls, 'text-right')} placeholder="Not costed"
                            aria-label={`Our cost including GST for LR ${idx + 1}`} />
                        </td>
                        <td className="px-1">
                          <label className="flex items-center justify-end gap-1.5 h-8 cursor-pointer whitespace-nowrap"
                            title={split ? `Cost ₹${formatINR(split.base)} + GST ₹${formatINR(split.gst)}` : 'No GST charged by this vendor'}>
                            <span className="text-xs text-ink-soft tabular-nums truncate">
                              {split ? `₹${formatINR(split.gst)}` : '-'}
                            </span>
                            <input type="checkbox" checked={line.gst_included}
                              onChange={(e) => updateLrLine(line.key, { gst_included: e.target.checked })}
                              className="w-4 h-4 shrink-0 cursor-pointer"
                              aria-label={`Amount for LR ${idx + 1} includes ${VENDOR_GST_RATE}% GST`} />
                          </label>
                        </td>
                        <td className="px-1">
                          <div className="h-8 flex items-center justify-center">
                            {isInternal ? (
                              <span className="text-[11px] text-ink-faint" title="On non-GST bills vendor GST is part of the cost">cost</span>
                            ) : (
                              <input type="checkbox" checked={line.itc}
                                disabled={!line.gst_included || !line.cost_incl_gst}
                                onChange={(e) => updateLrLine(line.key, { itc: e.target.checked })}
                                className="w-4 h-4 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                                aria-label={`Claim vendor GST as credit for LR ${idx + 1}`} />
                            )}
                          </div>
                        </td>
                        <td className="px-1">
                          <input type="text" value={line.vendor}
                            onChange={(e) => updateLrLine(line.key, { vendor: e.target.value })}
                            className={lrInputCls} placeholder="Lorry owner" aria-label={`Vendor for LR ${idx + 1}`} />
                        </td>
                        <td className="pr-1 text-center">
                          <IconButton label={`Remove LR ${idx + 1}`} type="button"
                            onClick={() => removeLrLine(line.key)} disabled={lrLines.length <= 1}
                            className="hover:text-danger-ink">
                            <Trash2 />
                          </IconButton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t border-line bg-surface-muted">
                  <tr className="text-xs">
                    <td colSpan={5} className="h-8 pl-2.5 text-ink-faint">
                      {lrLines.length} LR{lrLines.length === 1 ? '' : 's'}
                    </td>
                    <td className="px-2 text-right tabular-nums text-ink-soft">{formatINR(totalActualWeight)}</td>
                    <td className="px-2 text-right tabular-nums text-ink-soft">{formatINR(totalWeight)}</td>
                    <td className="px-1 text-right text-ink-faint">Total</td>
                    <td className="px-2 text-right tabular-nums font-semibold text-ink text-sm">₹{formatINR(freight)}</td>
                    <td colSpan={5} className="border-l border-line"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </FormSection>

          {/* ================================================ Charges & tax + Totals */}
          <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_288px] lg:gap-8 border-t border-line">
            <div className="min-w-0">
              <FormSection title="Charges and tax" flush
                hint="Printed on the bill"
                actions={
                  <Button type="button" variant="ghost" size="sm" icon={<Plus />} onClick={addChargeItem}>
                    Add charge
                  </Button>
                }
              >
                <div className="space-y-2">
                  {extraCharges.length === 0 && <p className="text-xs text-ink-faint">No additional charges.</p>}
                  {extraCharges.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Input type="text" value={item.label}
                        onChange={(e) => updateChargeItem(idx, 'label', e.target.value)}
                        className="flex-1 min-w-0" placeholder="Loading / detention / insurance"
                        aria-label={`Charge ${idx + 1} description`} />
                      <AmountInput value={item.amount || ''} onChange={(v) => updateChargeItem(idx, 'amount', v)}
                        className="w-28 sm:w-36" placeholder="0.00" label={`Charge ${idx + 1} amount`} />
                      <IconButton type="button" label={`Remove charge ${idx + 1}`} onClick={() => removeChargeItem(idx)}
                        className="hover:text-danger-ink">
                        <Trash2 />
                      </IconButton>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                  <Field label="Discount" htmlFor={`${formId}-disc`} className="col-span-2 sm:col-span-2">
                    <div className="flex items-center gap-2">
                      <Segmented
                        label="Discount type"
                        options={[
                          { value: 'percent', label: '%' },
                          { value: 'fixed', label: '₹' },
                        ] as const}
                        value={discountType}
                        onChange={(v) => setDiscountType(v as 'percent' | 'fixed')}
                        className="shrink-0"
                      />
                      <Input id={`${formId}-disc`} type="number" min="0" step="any"
                        value={discountValue || ''}
                        onChange={(e) => setDiscountValue(parseFloat(e.target.value) || 0)}
                        className="text-right tabular-nums"
                        placeholder={discountType === 'percent' ? '0 %' : '0.00'} />
                    </div>
                  </Field>
                  {!isInternal && (<>
                    <Field label="GST type" htmlFor={`${formId}-gt`}>
                      <Select id={`${formId}-gt`} value={gstType} onChange={(e) => setGstType(e.target.value as any)}>
                        <option value="intra">Intra-state (CGST + SGST)</option>
                        <option value="igst">Inter-state (IGST)</option>
                        <option value="exempt">Exempt / nil</option>
                      </Select>
                    </Field>
                    <Field label="GST rate %" htmlFor={`${formId}-gr`}>
                      <Input id={`${formId}-gr`} type="number"
                        disabled={gstType === 'exempt'}
                        value={gstType === 'exempt' ? 0 : gstRate}
                        onChange={(e) => setGstRate(parseFloat(e.target.value) || 18)}
                        className="text-right tabular-nums" />
                    </Field>
                  </>)}
                </div>
              </FormSection>

              {/* Our costs beyond lorry hire: commission, POD, detention paid out.
                  Never printed on the bill; used only for profit. */}
              <FormSection title="Other costs" hint="Internal, not printed"
                actions={
                  <Button type="button" variant="ghost" size="sm" icon={<Plus />}
                    onClick={() => setOtherCosts(prev => [...prev, { label: 'Commission', amount_incl_gst: 0, gst_included: true, amount: 0, gst: 0, itc: true }])}>
                    Add cost
                  </Button>
                }
              >
                {otherCosts.length === 0 ? (
                  <p className="text-xs text-ink-faint">Commission, POD or detention you paid out. Used for profit only.</p>
                ) : (
                  <div className="divide-y divide-line">
                    {otherCosts.map((item, idx) => (
                      <div key={idx} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2 first:pt-0 last:pb-0">
                        <Input type="text" value={item.label}
                          onChange={(e) => updateOtherCost(idx, 'label', e.target.value)}
                          className="flex-1 min-w-[140px]" placeholder="Commission / POD / detention"
                          aria-label={`Cost ${idx + 1} description`} />
                        <AmountInput value={item.amount_incl_gst || ''}
                          onChange={(v) => updateOtherCost(idx, 'amount_incl_gst', v)}
                          className="w-32" placeholder="Paid incl. GST" label="Amount paid including GST" />
                        <div className="flex items-center gap-3 ml-auto sm:ml-0">
                          <label className="inline-flex items-center gap-1.5 text-xs text-ink-soft whitespace-nowrap cursor-pointer"
                            title={`Tick when the amount includes ${VENDOR_GST_RATE}% GST`}>
                            <input type="checkbox" checked={item.gst_included !== false}
                              onChange={(e) => updateOtherCost(idx, 'gst_included', e.target.checked)} className="w-4 h-4" />
                            {item.gst_included !== false && (item.amount_incl_gst || 0) > 0
                              ? <span className="tabular-nums">GST ₹{formatINR(splitInclusive(item.amount_incl_gst || 0).gst)}</span>
                              : <span>{VENDOR_GST_RATE}% GST in it</span>}
                          </label>
                          {!isInternal && (
                            <label className="inline-flex items-center gap-1.5 text-xs text-ink-soft whitespace-nowrap cursor-pointer" title="Claim this GST back as input credit">
                              <input type="checkbox" checked={item.itc !== false} disabled={item.gst_included === false || !item.amount_incl_gst}
                                onChange={(e) => updateOtherCost(idx, 'itc', e.target.checked)} className="w-4 h-4 disabled:opacity-30" />
                              ITC
                            </label>
                          )}
                          <IconButton type="button" label={`Remove cost ${idx + 1}`}
                            onClick={() => setOtherCosts(prev => prev.filter((_, i) => i !== idx))}
                            className="hover:text-danger-ink">
                            <Trash2 />
                          </IconButton>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </FormSection>

              <FormSection title="Notes">
                <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional note for this bill" aria-label="Notes" />
              </FormSection>
            </div>

            {/* Totals: right-hand column on desktop, last section on phones */}
            {calcResult && (
              <aside className="min-w-0 pt-4 lg:pt-4 border-t border-line lg:border-t-0 lg:border-l lg:pl-6 pb-1">
                <div className="lg:sticky lg:top-0">
                  <div className="flex items-baseline justify-between gap-2 mb-2">
                    <h3 className="text-sm font-semibold text-ink">Totals</h3>
                    {!isInternal && <span className="text-xs text-ink-faint">SAC <span className="font-mono">{sac}</span></span>}
                  </div>
                  <div className="space-y-1.5 text-sm">
                    <SumRow label={`Freight · ${lrCount} LR${lrCount === 1 ? '' : 's'}`} value={`₹${formatINR(calcResult.freight)}`} />
                    <SumRow label="Additional charges" value={`₹${formatINR(calcResult.additional_total)}`} />
                    <SumRow label="Gross amount" value={`₹${formatINR(calcResult.gross_amount)}`} />
                    {calcResult.discount_amount > 0 && (
                      <SumRow label={`Discount (${calcResult.discount_type})`} value={`−₹${formatINR(calcResult.discount_amount)}`} />
                    )}
                    <SumRow label={isInternal ? 'Sub total' : 'Taxable value'} value={`₹${formatINR(calcResult.taxable_amount)}`} strong />
                    {!isInternal && (
                      <SumRow
                        label={calcResult.gst_type === 'igst'
                          ? `IGST ${calcResult.gst_rate}%`
                          : calcResult.gst_type === 'intra'
                          ? `CGST + SGST ${calcResult.gst_rate}%`
                          : 'GST exempt'}
                        value={`₹${formatINR(calcResult.gst_amount)}`} />
                    )}
                    <SumRow label="Round off" value={`₹${formatINR(calcResult.round_off)}`} faint />
                  </div>
                  <div className="flex items-baseline justify-between gap-3 mt-3 pt-3 border-t border-line">
                    <span className="text-sm text-ink-soft">Grand total</span>
                    <span className="numeral text-xl text-ink">₹{formatINR(calcResult.grand_total)}</span>
                  </div>
                  <div className="text-xs text-ink-faint mt-0.5">Place of supply: {placeOfSupply || '-'}</div>

                  {/* Profit, on the taxable value: GST collected is not income. */}
                  <div className="mt-4 pt-3 border-t border-line">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium text-ink-soft">Profit</span>
                      <Badge>Not printed</Badge>
                    </div>
                    <div className="space-y-1 text-sm">
                      <SumRow label="Our cost"
                        value={calcResult.total_cost === null || calcResult.total_cost === undefined ? 'Not costed' : `₹${formatINR(calcResult.total_cost)}`}
                        faint={calcResult.total_cost === null || calcResult.total_cost === undefined} />
                      <SumRow label="Gross profit"
                        value={calcResult.gross_profit === null || calcResult.gross_profit === undefined ? '-' : `₹${formatINR(calcResult.gross_profit)}`}
                        strong tone={(calcResult.gross_profit ?? 0) < 0 ? 'text-danger-ink' : undefined} />
                      <SumRow label="Margin"
                        value={calcResult.margin_pct === null || calcResult.margin_pct === undefined ? '-' : `${calcResult.margin_pct}%`} />
                      {calcResult.partly_costed && <p className="text-xs text-warning-ink">Some LRs are not costed yet.</p>}
                      <SumRow label={isInternal ? 'Vendor GST (in cost)' : 'Input GST credit'}
                        value={`₹${formatINR(isInternal ? (calcResult.blocked_gst || 0) : (calcResult.input_gst || 0))}`} />
                      {!isInternal && (
                        <SumRow label="Net GST to pay"
                          value={`₹${formatINR((calcResult.gst_amount || 0) - (calcResult.input_gst || 0))}`} />
                      )}
                    </div>
                  </div>
                </div>
              </aside>
            )}
          </div>
        </form>
      </Modal>

      {/* ================================================ Quick add customer */}
      {showQuickAddCust && (
        <Modal
          onClose={() => setShowQuickAddCust(false)}
          title="New customer"
          subtitle="Selected for this invoice once saved"
          size="md"
          footer={
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" type="button" onClick={() => setShowQuickAddCust(false)}>Cancel</Button>
              <Button variant="primary" type="submit" form={`${formId}-qc`} loading={savingCust} icon={<Check />}>
                {savingCust ? 'Saving…' : 'Save and select'}
              </Button>
            </div>
          }
        >
          <form id={`${formId}-qc`} onSubmit={handleCreateQuickCustomer} className="space-y-3">
            <FormError message={custError} />
            {quickLookupMsg && <LookupNote msg={quickLookupMsg} />}

            <div className="grid grid-cols-2 gap-3">
              <Field label="GSTIN" htmlFor={`${formId}-qg`}
                action={<FetchLink busy={fetchingGstQuick} disabled={newCustGstin.length !== 15}
                  onClick={() => fetchQuickGST(newCustGstin, true)} />}>
                <Input id={`${formId}-qg`} type="text" maxLength={15} value={newCustGstin}
                  onChange={(e) => handleNewCustGSTIN(e.target.value)}
                  className="font-mono uppercase" placeholder="24AABCS1429B1Z8" />
              </Field>
              <Field label="PAN" htmlFor={`${formId}-qp`}>
                <Input id={`${formId}-qp`} type="text" maxLength={10} value={newCustPan}
                  onChange={(e) => setNewCustPan(e.target.value.toUpperCase())}
                  className="font-mono uppercase" placeholder="AABCS1429B" />
              </Field>
            </div>

            <Field label="Company / customer name" htmlFor={`${formId}-qn`} required>
              <Input id={`${formId}-qn`} type="text" required value={newCustName}
                onChange={(e) => setNewCustName(e.target.value)} placeholder="e.g. Maruti Freight Express Ltd" />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Contact person" htmlFor={`${formId}-qcp`}>
                <Input id={`${formId}-qcp`} type="text" value={newCustPerson}
                  onChange={(e) => setNewCustPerson(e.target.value)} placeholder="e.g. Sanjay Sharma" />
              </Field>
              <Field label="Phone" htmlFor={`${formId}-qph`}>
                <Input id={`${formId}-qph`} type="text" value={newCustPhone}
                  onChange={(e) => setNewCustPhone(e.target.value)} placeholder="+91 98765 43210" />
              </Field>
            </div>

            <Field label="Billing address" htmlFor={`${formId}-qa`}>
              <Textarea id={`${formId}-qa`} rows={2} value={newCustAddress}
                onChange={(e) => setNewCustAddress(e.target.value)} placeholder="Plot 10, GIDC Logistics Park…" />
            </Field>

            <div className="grid grid-cols-3 gap-3">
              <Field label="PIN" htmlFor={`${formId}-qpin`}
                action={<FetchLink busy={fetchingPinQuick} disabled={newCustPin.length !== 6}
                  onClick={() => fetchQuickPIN(newCustPin)} />}>
                <Input id={`${formId}-qpin`} type="text" inputMode="numeric" maxLength={6} value={newCustPin}
                  onChange={(e) => handleNewCustPinChange(e.target.value)} className="font-mono" placeholder="380001" />
              </Field>
              <Field label="City" htmlFor={`${formId}-qcity`}>
                <Input id={`${formId}-qcity`} type="text" value={newCustCity} onChange={(e) => setNewCustCity(e.target.value)} />
              </Field>
              <Field label="State" htmlFor={`${formId}-qst`}>
                <Input id={`${formId}-qst`} type="text" value={newCustState} onChange={(e) => setNewCustState(e.target.value)} />
              </Field>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
};

/* ------------------------------------------------------------ local pieces */

/** A form section: semibold heading and a hairline above, never a tinted box. */
const FormSection: React.FC<{
  title: string;
  hint?: string;
  actions?: React.ReactNode;
  first?: boolean;
  /** Skip the top hairline (the parent already draws one). */
  flush?: boolean;
  children: React.ReactNode;
}> = ({ title, hint, actions, first, flush, children }) => (
  <section className={cx('py-4', first ? 'pt-0' : !flush && 'border-t border-line')}>
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-3 min-h-8">
      <div className="min-w-0 flex items-baseline gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {hint && <span className="text-xs text-ink-faint">{hint}</span>}
      </div>
      {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
    </div>
    {children}
  </section>
);

/** Rupee-prefixed number input. */
const AmountInput: React.FC<{
  value: number | string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
  label: string;
}> = ({ value, onChange, className, placeholder, label }) => (
  <div className={cx('relative shrink-0', className)}>
    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-ink-faint pointer-events-none" aria-hidden="true">₹</span>
    <Input type="number" min="0" step="any" value={value} onChange={(e) => onChange(e.target.value)}
      className="pl-6 text-right tabular-nums" placeholder={placeholder} aria-label={label} />
  </div>
);

/** Small "Fetch" link that sits in a field's label row (GSTIN / PIN lookups). */
const FetchLink: React.FC<{ busy: boolean; disabled: boolean; onClick: () => void }> = ({ busy, disabled, onClick }) => (
  <button type="button" disabled={busy || disabled} onClick={onClick}
    className="inline-flex items-center gap-1 text-xs font-medium text-accent-ink hover:underline cursor-pointer disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed">
    {busy ? <><Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />Fetching</> : 'Fetch'}
  </button>
);

/** Result of a GSTIN / PIN lookup: one quiet line, coloured only by outcome. */
const LookupNote: React.FC<{ msg: string; className?: string }> = ({ msg, className }) => {
  const bad = msg.startsWith('✕') || /valid 15/.test(msg);
  const warn = msg.startsWith('⚠');
  const text = msg.replace(/^(✓|✕|⚠️|⚠)\s*/, '');
  return (
    <p role="status" className={cx('flex items-start gap-1.5 text-xs',
      bad ? 'text-danger-ink' : warn ? 'text-warning-ink' : 'text-positive-ink', className)}>
      {!bad && !warn && <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
      <span>{text}</span>
    </p>
  );
};

const SumRow: React.FC<{ label: string; value: string; strong?: boolean; faint?: boolean; tone?: string }> = ({
  label, value, strong, faint, tone,
}) => (
  <div className="flex items-baseline justify-between gap-3">
    <span className={faint ? 'text-ink-faint' : 'text-ink-soft'}>{label}</span>
    <span className={cx('tabular-nums text-right', strong && 'font-medium', tone || (faint ? 'text-ink-faint' : 'text-ink'))}>{value}</span>
  </div>
);
