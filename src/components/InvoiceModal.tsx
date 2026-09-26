import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, 
  Calculator, 
  Plus, 
  Trash2, 
  Save, 
  Truck, 
  CheckCircle,
  Building2,
  MapPin,
  FileText,
  UserPlus,
  ArrowRight,
  Sparkles,
  Phone,
  ShieldCheck,
  Check,
  Loader2,
  Navigation
} from 'lucide-react';
import { apiRequest } from '../services/api.js';
import { Customer, ChargeItem, CostItem, InvoiceTotals, Invoice } from '../types.js';
import { formatINR } from '../utils/format.js';
import { lookupGSTIN, lookupPincode, isValidGSTINFormat } from '../utils/gstLookup.js';
import { compute, r2, splitInclusive, VENDOR_GST_RATE } from '../utils/calc.js';

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
  weight: number;
  rate_kg: number;
  amount: number;
  /** What we paid for this trip INCLUDING the vendor's GST. null = not entered yet (not the same as zero). */
  cost_incl_gst: number | null;
  /** Does that amount include 18% GST? false for a truck owner who charged no GST. */
  gst_included: boolean;
  vendor: string;
  /** Can that GST be claimed back? false for unregistered truck owners. */
  itc: boolean;
}

let lrKeySeq = 0;
const newLrLine = (partial: Partial<LrLine> = {}): LrLine => ({
  key: `lr-${Date.now()}-${lrKeySeq++}`,
  lr_no: '',
  lr_date: '',
  origin: 'Ahmedabad',
  destination: '',
  weight: 0,
  rate_kg: 0,
  amount: 0,
  cost_incl_gst: null,
  gst_included: true,
  vendor: '',
  itc: true,
  ...partial,
});

function buildInitialLrLines(inv?: Invoice | null): LrLine[] {
  if (inv?.lr_items && inv.lr_items.length > 0) {
    return inv.lr_items.map(l => newLrLine({
      lr_no: l.lr_no || '',
      lr_date: l.lr_date || '',
      origin: l.origin || '',
      destination: l.destination || '',
      weight: Number(l.weight) || 0,
      rate_kg: Number(l.rate_kg) || 0,
      amount: Number(l.amount) || 0,
      // Bills saved before the combined entry stored cost and GST apart: add them back together.
      cost_incl_gst: l.cost_incl_gst !== undefined && l.cost_incl_gst !== null
        ? Number(l.cost_incl_gst)
        : l.cost === null || l.cost === undefined ? null : Number(l.cost) + (Number(l.cost_gst) || 0),
      gst_included: l.gst_included !== undefined ? l.gst_included !== false : (Number(l.cost_gst) || 0) > 0 || l.cost === null || l.cost === undefined,
      vendor: l.vendor || '',
      itc: l.itc !== false,
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
      rate_kg: Number(inv.rate_kg) || 0,
      amount: Number(inv.freight) || 0,
    })];
  }
  return [newLrLine()];
}

const lrInputCls = 'w-full bg-surface border border-line rounded-control px-2.5 py-1.5 text-ink text-xs focus:outline-none focus:border-accent';

export const InvoiceModal: React.FC<InvoiceModalProps> = ({ invoiceToEdit, initialCustomerId, onClose, onSuccess }) => {
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
    if (cust.city) {
      fillDestinationIfEmpty(cust.city);
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
      // Weight × Rate drives the line freight whenever both are known; a direct amount is also allowed
      if (('weight' in patch || 'rate_kg' in patch) && next.weight > 0 && next.rate_kg > 0) {
        next.amount = Math.round(next.weight * next.rate_kg * 100) / 100;
      }
      return next;
    }));
  };

  const addLrLine = () => {
    setLrLines(prev => {
      const last = prev[prev.length - 1];
      return [...prev, newLrLine({ origin: last?.origin || 'Ahmedabad', destination: last?.destination || '', rate_kg: last?.rate_kg || 0 })];
    });
  };

  const removeLrLine = (key: string) => {
    setLrLines(prev => (prev.length <= 1 ? prev : prev.filter(l => l.key !== key)));
  };

  /** Auto-fill the first LR's destination from the consignee city when it hasn't been typed yet. */
  const fillDestinationIfEmpty = (city: string) => {
    if (!city) return;
    setLrLines(prev => prev.map((l, i) => (i === 0 && !l.destination ? { ...l, destination: city } : l)));
  };

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
          fillDestinationIfEmpty(res.city);
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
          fillDestinationIfEmpty(res.city);
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
      setError('Please enter freight for at least one LR line (Weight × Rate, or type the amount directly).');
      return;
    }
    setSaving(true);
    setError(null);

    try {
      const cleanLines = lrLines.map(({ key: _key, ...rest }) => ({
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

  return (
    <div className="fixed inset-0 bg-scrim backdrop-blur-[6px] flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="sheet border border-line rounded-overlay max-w-6xl w-full max-h-[94vh] flex flex-col shadow-overlay text-ink my-auto">
        {/* Header */}
        <div className="p-4 border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-card bg-accent-soft border border-accent-line flex items-center justify-center text-accent-ink">
              <Truck className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-ink">
                  {isEditMode
                    ? `Edit ${isInternal ? 'non-GST bill' : 'tax invoice'}: ${invoiceNo || invoiceToEdit?.invoice_no}`
                    : isInternal ? 'New non-GST bill' : 'New GST tax invoice'}
                </h2>
                {isEditMode && (
                  <span className="px-2 py-0.5 bg-accent-soft text-accent-ink text-[10px] font-bold rounded-md">
                    EDIT MODE
                  </span>
                )}
              </div>
              <p className="text-[11px] text-ink-faint">
                {isEditMode
                  ? 'Update freight rates, consignee details, tax breakdown, or payment terms'
                  : 'Bill To / Ship To Logistics Billing & Consignment'}
              </p>
            </div>
          </div>

          <button onClick={onClose} className="p-1 text-ink-faint hover:text-ink rounded-control transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
          {error && (
            <div className="p-3 bg-danger-soft border border-danger-line rounded-card text-danger-ink text-xs">
              {error}
            </div>
          )}

          {isEditMode && (invoiceToEdit?.paid || 0) > 0 && (
            <div className="p-3 bg-warning-soft border border-warning-line rounded-card text-warning-ink text-xs flex items-center justify-between">
              <div>
                <strong>Recorded Collections:</strong> ₹{formatINR(invoiceToEdit?.paid || 0)} already collected against this invoice.
                <span className="text-warning-ink ml-1">New calculated balance will adjust automatically.</span>
              </div>
              {calcResult && (
                <div className="font-mono font-bold text-warning-ink text-xs">
                  New Balance: ₹{formatINR(Math.max(0, calcResult.grand_total - (invoiceToEdit?.paid || 0)))}
                </div>
              )}
            </div>
          )}

          {quickAddSuccessMsg && (
            <div className="p-3 bg-positive-soft border border-positive-line rounded-card text-positive-ink text-xs flex items-center gap-2 font-medium">
              <Check className="w-4 h-4 text-positive-ink" />
              <span>{quickAddSuccessMsg}</span>
            </div>
          )}

          {/* Bill type. Decides the number series, whether GST applies, and
              whether this bill can ever appear in a GST return. */}
          <div className="flex flex-wrap items-center gap-3">
            <div role="radiogroup" aria-label="Bill type"
              className="inline-flex p-0.5 rounded-control bg-surface-sunken border border-line">
              {([
                { v: 'tax_invoice', label: 'GST tax invoice' },
                { v: 'internal', label: 'Non-GST bill' },
              ] as const).map(o => (
                <button key={o.v} type="button" role="radio" aria-checked={docType === o.v}
                  disabled={isEditMode && docType !== o.v}
                  onClick={() => setDocType(o.v)}
                  className={`px-3 h-8 rounded-[6px] text-xs whitespace-nowrap transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
                    docType === o.v ? 'bg-surface-muted text-ink font-semibold shadow-card' : 'text-ink-faint hover:text-ink'}`}>
                  {o.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-ink-faint">
              {isEditMode
                ? 'The type is fixed once a bill is created, because its number belongs to that series.'
                : isInternal
                  ? 'Own number series, no GST, never included in GSTR-1 or any GST report.'
                  : 'Numbered in the GST series and reported in GSTR-1.'}
            </p>
          </div>

          {/* Top Bar: Invoice No & Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-surface-muted p-4 rounded-card border border-line">
            <div>
              <label className="block text-ink-soft font-semibold mb-1">{isInternal ? 'Bill number' : 'Invoice number'} (auto or custom) *</label>
              <input
                type="text"
                required
                value={invoiceNo}
                onChange={(e) => setInvoiceNo(e.target.value)}
                className="w-full bg-surface border border-line rounded-control px-3 py-2 font-mono font-bold text-accent-ink focus:outline-none focus:border-accent"
                placeholder={isInternal ? 'TRP/2026-27/0001' : 'SSL/2026-27/0001'}
              />
            </div>

            <div>
              <label className="block text-ink-soft font-semibold mb-1">{isInternal ? 'Bill date' : 'Invoice date'} *</label>
              <input
                type="date"
                required
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className="w-full bg-surface border border-line rounded-control px-3 py-2 text-ink focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          {/* ========================================================================= */}
          {/* BILL TO & SHIP TO SECTION */}
          {/* ========================================================================= */}
          <div className="border border-line rounded-card overflow-hidden shadow-card">
            <div className="bg-surface-sunken px-4 py-2.5 border-b border-line flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-ink text-xs uppercase tracking-wide">
                <Building2 className="w-4 h-4 text-accent-ink" />
                <span>Bill To & Ship To (Parties & Consignment Routing)</span>
              </div>
              <span className="text-[10px] text-ink-faint font-medium">GST Compliant Two-Party Dispatch Model</span>
            </div>

            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-5 bg-surface">
              {/* BILL TO (BUYER) CARD */}
              <div className="space-y-3 p-3.5 bg-surface-muted rounded-card border border-line">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-bold text-accent-ink uppercase tracking-wider flex items-center gap-1.5">
                    <span>1. Bill To (Billed Party / Buyer) *</span>
                  </div>

                  {/* Quick Add Customer Trigger */}
                  <button
                    type="button"
                    onClick={() => setShowQuickAddCust(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-accent-strong hover:bg-accent-strong-hover text-on-accent rounded-control text-[11px] font-semibold transition shadow-card cursor-pointer"
                  >
                    <UserPlus className="w-3 h-3" />
                    <span>+ Quick Add Customer</span>
                  </button>
                </div>

                <div>
                  <label className="block text-ink-soft font-medium mb-1">Select Registered Customer</label>
                  <select
                    required
                    value={selectedCustomerId}
                    onChange={(e) => handleCustomerChange(e.target.value)}
                    className="w-full bg-surface border border-line rounded-control px-3 py-2 text-ink focus:outline-none focus:border-accent font-medium"
                  >
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.city ? `(${c.city})` : ''} {c.gstin ? `· GST: ${c.gstin}` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {curBuyer && (
                  <div className="p-2.5 bg-surface rounded-control border border-line text-[11px] text-ink-soft space-y-1">
                    <div className="font-bold text-ink">{curBuyer.name}</div>
                    <div>{curBuyer.address || 'Address not specified'}</div>
                    <div>{[curBuyer.city, curBuyer.state, curBuyer.pin].filter(Boolean).join(', ')}</div>
                    <div className="flex items-center gap-3 pt-1 text-[10px] text-ink-faint font-mono">
                      <span>GSTIN: <strong className="text-ink">{curBuyer.gstin || 'Unregistered'}</strong></span>
                      <span>·</span>
                      <span>Terms: <strong className="text-ink font-sans">{curBuyer.payment_terms || 'Net 15 Days'}</strong></span>
                    </div>
                  </div>
                )}
              </div>

              {/* SHIP TO (CONSIGNEE / DELIVERY SITE) CARD */}
              <div className="space-y-3 p-3.5 bg-surface-muted rounded-card border border-line">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-bold text-accent-ink uppercase tracking-wider flex items-center gap-1.5">
                    <span>2. Ship To (Consignee / Delivery Site)</span>
                  </div>

                  {/* Toggle Same as Buyer */}
                  <label className="flex items-center gap-1.5 text-xs text-ink-soft cursor-pointer font-semibold select-none">
                    <input
                      type="checkbox"
                      checked={sameAsBuyer}
                      onChange={(e) => setSameAsBuyer(e.target.checked)}
                      className="rounded text-accent-ink focus:ring-accent w-3.5 h-3.5"
                    />
                    <span>Same as Bill To</span>
                  </label>
                </div>

                {sameAsBuyer ? (
                  <div className="p-3 bg-surface rounded-control border border-dashed border-line-strong text-ink-soft text-xs space-y-1.5">
                    <div className="flex items-center gap-1.5 text-positive-ink font-semibold text-[11px]">
                      <CheckCircle className="w-3.5 h-3.5 text-positive-ink" />
                      <span>Shipping to Buyer's Registered Address</span>
                    </div>
                    <p className="text-[11px] text-ink-faint">
                      Deliver to: <strong className="text-ink">{curBuyer?.name || 'Same as Bill To'}</strong> ({curBuyer?.city || ''}, {curBuyer?.state || 'Gujarat'})
                    </p>
                    <div className="text-[11px] text-accent-ink font-medium bg-accent-soft p-2 rounded-control border border-accent-line flex items-center gap-1.5">
                      <Navigation className="w-3.5 h-3.5 text-accent-ink shrink-0" />
                      <span>Place of Supply auto-set to: <strong>{curBuyer?.state || 'Gujarat'}</strong></span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSameAsBuyer(false)}
                      className="text-xs text-accent-ink hover:text-accent-ink font-semibold underline mt-1 cursor-pointer"
                    >
                      Ship to a different branch / site / consignee?
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2 pt-1">
                    {shipToLookupMsg && (
                      <div className="p-2 bg-positive-soft border border-positive-line rounded-control text-positive-ink flex items-center gap-1.5 text-[11px]">
                        <Check className="w-3.5 h-3.5 text-positive-ink shrink-0" />
                        <span>{shipToLookupMsg}</span>
                      </div>
                    )}

                    {/* Consignee GSTIN Auto-fetch */}
                    <div>
                      <div className="flex items-center justify-between mb-0.5">
                        <label className="text-ink-soft font-medium text-[11px]">Consignee GSTIN (Optional)</label>
                        <button
                          type="button"
                          disabled={fetchingGstShipTo || shipToGstin.length !== 15}
                          onClick={() => fetchShipToGST(shipToGstin, true)}
                          className="text-[10px] text-accent-ink hover:text-accent-ink font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-40"
                        >
                          {fetchingGstShipTo ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin" />
                              <span>Fetching...</span>
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
                        value={shipToGstin}
                        onChange={(e) => handleShipToGstinChange(e.target.value)}
                        className="w-full bg-surface border border-line rounded-control px-2.5 py-1.5 font-mono text-ink text-xs uppercase focus:outline-none focus:border-accent"
                        placeholder="24AABCS1429B1Z8"
                      />
                    </div>

                    <div>
                      <label className="block text-ink-soft font-medium mb-0.5 text-[11px]">Consignee / Site Name *</label>
                      <input
                        type="text"
                        required={!sameAsBuyer}
                        value={shipToName}
                        onChange={(e) => setShipToName(e.target.value)}
                        className="w-full bg-surface border border-line rounded-control px-2.5 py-1.5 text-ink text-xs focus:outline-none focus:border-accent font-medium"
                        placeholder="e.g. Warehouse 3 / Consignee Plant"
                      />
                    </div>

                    <div>
                      <label className="block text-ink-soft font-medium mb-0.5 text-[11px]">Delivery Address</label>
                      <input
                        type="text"
                        value={shipToAddress}
                        onChange={(e) => setShipToAddress(e.target.value)}
                        className="w-full bg-surface border border-line rounded-control px-2.5 py-1.5 text-ink text-xs focus:outline-none focus:border-accent"
                        placeholder="Plot No / Industrial Road"
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <div className="flex items-center justify-between mb-0.5">
                          <label className="text-ink-soft font-medium text-[11px]">PIN Code</label>
                          <button
                            type="button"
                            disabled={fetchingPinShipTo || shipToPin.length !== 6}
                            onClick={() => fetchShipToPIN(shipToPin)}
                            className="text-[9px] text-accent-ink font-semibold cursor-pointer disabled:opacity-40"
                          >
                            {fetchingPinShipTo ? '...' : 'Fetch'}
                          </button>
                        </div>
                        <input
                          type="text"
                          maxLength={6}
                          value={shipToPin}
                          onChange={(e) => handleShipToPinChange(e.target.value)}
                          className="w-full bg-surface border border-line rounded-control px-2.5 py-1.5 text-ink text-xs focus:outline-none focus:border-accent font-mono"
                          placeholder="395003"
                        />
                      </div>
                      <div>
                        <label className="block text-ink-soft font-medium mb-0.5 text-[11px]">City</label>
                        <input
                          type="text"
                          value={shipToCity}
                          onChange={(e) => {
                            const prevCity = shipToCity;
                            setShipToCity(e.target.value);
                            // keep the first LR's destination in sync while it is still auto-filled
                            setLrLines(lines => lines.map((l, i) =>
                              i === 0 && (!l.destination || l.destination === prevCity) ? { ...l, destination: e.target.value } : l
                            ));
                          }}
                          className="w-full bg-surface border border-line rounded-control px-2.5 py-1.5 text-ink text-xs focus:outline-none focus:border-accent"
                          placeholder="Surat"
                        />
                      </div>
                      <div>
                        <label className="block text-ink-soft font-medium mb-0.5 text-[11px]">State (Place of Supply)</label>
                        <input
                          type="text"
                          value={shipToState}
                          onChange={(e) => {
                            setShipToState(e.target.value);
                            setPlaceOfSupply(e.target.value);
                          }}
                          className="w-full bg-surface border border-line rounded-control px-2.5 py-1.5 text-ink text-xs focus:outline-none focus:border-accent font-semibold"
                          placeholder="Gujarat"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-ink-soft font-medium mb-0.5 text-[11px]">Consignee Phone</label>
                      <input
                        type="text"
                        value={shipToPhone}
                        onChange={(e) => setShipToPhone(e.target.value)}
                        className="w-full bg-surface border border-line rounded-control px-2.5 py-1.5 text-ink text-xs focus:outline-none focus:border-accent"
                        placeholder="+91 98765 43210"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Consignments / LR Lines - a single bill can cover many LRs */}
          <div className="bg-surface-muted p-4 rounded-card border border-line space-y-3">
            <div className="flex items-center justify-between border-b border-line pb-2">
              <span className="font-bold text-ink uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <Truck className="w-3.5 h-3.5 text-accent-ink" />
                <span>Consignments / LR Details</span>
                <span className="ml-1 px-1.5 py-0.5 rounded-md bg-accent-soft text-accent-ink text-[10px] font-bold normal-case tracking-normal">
                  {lrLines.length} LR{lrLines.length === 1 ? '' : 's'}
                </span>
              </span>
              <button
                type="button"
                onClick={addLrLine}
                className="text-xs text-accent-ink hover:text-accent-ink flex items-center gap-1 font-semibold cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add LR to this bill</span>
              </button>
            </div>
            <p className="text-[11px] text-ink-faint -mt-1">
              Add every LR / bilty covered by this single bill. Freight per LR = Weight × Rate, or type the amount directly.
            </p>

            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full min-w-[1080px] text-xs border-separate border-spacing-y-1.5">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-ink-faint">
                    <th className="text-left font-semibold pl-1 w-6">#</th>
                    <th className="text-left font-semibold">LR / Bilty No</th>
                    <th className="text-left font-semibold">LR Date</th>
                    <th className="text-left font-semibold">From</th>
                    <th className="text-left font-semibold">To</th>
                    <th className="text-right font-semibold">Weight (Kg)</th>
                    <th className="text-right font-semibold">Rate / Kg</th>
                    <th className="text-right font-semibold">Freight (₹)</th>
                    <th className="text-right font-semibold" title="What we paid for this trip, including the vendor's GST">Our cost incl. GST (₹)</th>
                    <th className="text-right font-semibold" title={`Tick when the amount includes ${VENDOR_GST_RATE}% GST; the GST inside it is worked out as amount × ${VENDOR_GST_RATE}/${100 + VENDOR_GST_RATE}`}>{VENDOR_GST_RATE}% GST in it</th>
                    <th className="text-center font-semibold" title={isInternal
                      ? 'Non-GST bill: vendor GST is counted as cost, not claimed as credit'
                      : 'Tick if you can claim this GST back as input credit'}>Credit</th>
                    <th className="text-left font-semibold">Vendor</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {lrLines.map((line, idx) => (
                    <tr key={line.key}>
                      <td className="pl-1 text-ink-faint font-mono">{idx + 1}</td>
                      <td className="pr-1.5">
                        <input
                          type="text"
                          value={line.lr_no}
                          onChange={(e) => updateLrLine(line.key, { lr_no: e.target.value })}
                          className={`${lrInputCls} font-mono`}
                          placeholder="LR-88910"
                        />
                      </td>
                      <td className="pr-1.5">
                        <input
                          type="date"
                          value={line.lr_date}
                          onChange={(e) => updateLrLine(line.key, { lr_date: e.target.value })}
                          className={lrInputCls}
                        />
                      </td>
                      <td className="pr-1.5">
                        <input
                          type="text"
                          value={line.origin}
                          onChange={(e) => updateLrLine(line.key, { origin: e.target.value })}
                          className={lrInputCls}
                          placeholder="Ahmedabad"
                        />
                      </td>
                      <td className="pr-1.5">
                        <input
                          type="text"
                          value={line.destination}
                          onChange={(e) => updateLrLine(line.key, { destination: e.target.value })}
                          className={lrInputCls}
                          placeholder="Surat"
                        />
                      </td>
                      <td className="pr-1.5">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={line.weight || ''}
                          onChange={(e) => updateLrLine(line.key, { weight: parseFloat(e.target.value) || 0 })}
                          className={`${lrInputCls} text-right font-mono`}
                          placeholder="0"
                        />
                      </td>
                      <td className="pr-1.5">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={line.rate_kg || ''}
                          onChange={(e) => updateLrLine(line.key, { rate_kg: parseFloat(e.target.value) || 0 })}
                          className={`${lrInputCls} text-right font-mono`}
                          placeholder="0.00"
                        />
                      </td>
                      <td className="pr-1.5">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={line.amount || ''}
                          onChange={(e) => updateLrLine(line.key, { amount: parseFloat(e.target.value) || 0 })}
                          className={`${lrInputCls} text-right font-mono font-bold text-accent-ink`}
                          placeholder="0.00"
                        />
                      </td>
                      <td className="pr-1.5">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={line.cost_incl_gst ?? ''}
                          onChange={(e) => updateLrLine(line.key, {
                            cost_incl_gst: e.target.value === '' ? null : parseFloat(e.target.value) || 0,
                          })}
                          className={`${lrInputCls} text-right font-mono`}
                          placeholder="Not costed"
                          aria-label={`Our cost including GST for LR ${idx + 1}`}
                        />
                      </td>
                      <td className="pr-1.5">
                        {(() => {
                          // The split shown here is the same one the server saves (server/calc.ts).
                          const split = line.cost_incl_gst !== null && line.gst_included
                            ? splitInclusive(line.cost_incl_gst) : null;
                          return (
                            <label className="flex items-center justify-end gap-1.5 cursor-pointer whitespace-nowrap"
                              title={split ? `Cost ₹${formatINR(split.base)} + GST ₹${formatINR(split.gst)}` : 'No GST charged by this vendor'}>
                              <span className="font-mono text-[11px] text-ink-soft w-[64px] text-right">
                                {split ? `₹${formatINR(split.gst)}` : '-'}
                              </span>
                              <input
                                type="checkbox"
                                checked={line.gst_included}
                                onChange={(e) => updateLrLine(line.key, { gst_included: e.target.checked })}
                                className="w-4 h-4 cursor-pointer"
                                aria-label={`Amount for LR ${idx + 1} includes ${VENDOR_GST_RATE}% GST`}
                              />
                            </label>
                          );
                        })()}
                      </td>
                      <td className="pr-1.5 text-center">
                        {isInternal ? (
                          <span className="text-[10px] text-ink-faint" title="On non-GST bills vendor GST is part of the cost">cost</span>
                        ) : (
                          <input
                            type="checkbox"
                            checked={line.itc}
                            disabled={!line.gst_included || !line.cost_incl_gst}
                            onChange={(e) => updateLrLine(line.key, { itc: e.target.checked })}
                            className="w-4 h-4 cursor-pointer disabled:opacity-30"
                            aria-label={`Claim vendor GST as credit for LR ${idx + 1}`}
                          />
                        )}
                      </td>
                      <td className="pr-1.5">
                        <input
                          type="text"
                          value={line.vendor}
                          onChange={(e) => updateLrLine(line.key, { vendor: e.target.value })}
                          className={lrInputCls}
                          placeholder="Lorry owner"
                          aria-label={`Vendor for LR ${idx + 1}`}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => removeLrLine(line.key)}
                          disabled={lrLines.length <= 1}
                          title="Remove this LR"
                          className="p-1.5 text-ink-faint hover:text-danger-ink disabled:opacity-30 disabled:hover:text-ink-faint transition cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-line text-xs">
              <div className="text-ink-faint">
                Total Weight: <span className="font-mono font-semibold text-ink">{formatINR(totalWeight)} Kg</span>
                <span className="mx-2 text-ink-faint">|</span>
                LRs on this bill: <span className="font-mono font-semibold text-ink">{lrLines.length}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-ink-soft font-semibold">Total Freight (₹)</span>
                <span className="font-mono font-extrabold text-accent-ink text-base">₹{formatINR(freight)}</span>
              </div>
            </div>
          </div>

          {/* Our costs beyond lorry hire: commission, POD, detention paid out.
              Never printed on the bill; used only for profit. */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-ink font-semibold">Other costs <span className="text-ink-faint font-normal">(internal, not printed)</span></label>
              <button type="button"
                onClick={() => setOtherCosts(prev => [...prev, { label: 'Commission', amount_incl_gst: 0, gst_included: true, amount: 0, gst: 0, itc: true }])}
                className="text-xs text-accent-ink flex items-center gap-1 font-semibold cursor-pointer">
                <Plus className="w-3.5 h-3.5" /><span>Add cost</span>
              </button>
            </div>
            {otherCosts.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input type="text" value={item.label}
                  onChange={(e) => updateOtherCost(idx, 'label', e.target.value)}
                  className="flex-1 bg-surface-muted border border-line rounded-control px-3 py-2 text-ink text-xs focus:outline-none focus:border-accent"
                  placeholder="Commission / POD / detention" />
                <div className="relative w-32">
                  <span className="absolute left-2.5 top-2 text-ink-faint font-mono">₹</span>
                  <input type="number" min="0" step="any" value={item.amount_incl_gst || ''}
                    onChange={(e) => updateOtherCost(idx, 'amount_incl_gst', e.target.value)}
                    className="w-full bg-surface-muted border border-line rounded-control pl-6 pr-3 py-2 text-ink font-mono text-xs focus:outline-none focus:border-accent"
                    placeholder="Paid incl. GST" aria-label="Amount paid including GST" />
                </div>
                <label className="flex items-center gap-1.5 text-[11px] text-ink-faint whitespace-nowrap cursor-pointer w-36"
                  title={`Tick when the amount includes ${VENDOR_GST_RATE}% GST`}>
                  <input type="checkbox" checked={item.gst_included !== false}
                    onChange={(e) => updateOtherCost(idx, 'gst_included', e.target.checked)} className="w-4 h-4" />
                  {item.gst_included !== false && (item.amount_incl_gst || 0) > 0
                    ? <span className="font-mono">GST ₹{formatINR(splitInclusive(item.amount_incl_gst || 0).gst)}</span>
                    : <span>{VENDOR_GST_RATE}% GST in it</span>}
                </label>
                {!isInternal && (
                  <label className="flex items-center gap-1 text-[11px] text-ink-faint whitespace-nowrap cursor-pointer" title="Claim this GST back as input credit">
                    <input type="checkbox" checked={item.itc !== false} disabled={item.gst_included === false || !item.amount_incl_gst}
                      onChange={(e) => updateOtherCost(idx, 'itc', e.target.checked)} className="w-4 h-4 disabled:opacity-30" />
                    Credit
                  </label>
                )}
                <button type="button" onClick={() => setOtherCosts(prev => prev.filter((_, i) => i !== idx))}
                  className="p-2 text-ink-faint hover:text-danger-ink transition" aria-label="Remove cost">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          {/* Additional / Surcharge Items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-ink font-semibold">Additional Charges & Surcharges</label>
              <button
                type="button"
                onClick={addChargeItem}
                className="text-xs text-accent-ink hover:text-accent-ink flex items-center gap-1 font-semibold"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add charge item</span>
              </button>
            </div>

            <div className="space-y-2">
              {extraCharges.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={item.label}
                    onChange={(e) => updateChargeItem(idx, 'label', e.target.value)}
                    className="flex-1 bg-surface-muted border border-line rounded-control px-3 py-2 text-ink text-xs focus:outline-none focus:border-accent"
                    placeholder="e.g. Loading / Detention / Insurance"
                  />
                  <div className="relative w-40">
                    <span className="absolute left-2.5 top-2 text-ink-faint font-mono">₹</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={item.amount || ''}
                      onChange={(e) => updateChargeItem(idx, 'amount', e.target.value)}
                      className="w-full bg-surface-muted border border-line rounded-control pl-6 pr-3 py-2 text-ink font-mono text-xs focus:outline-none focus:border-accent"
                      placeholder="0.00"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeChargeItem(idx)}
                    className="p-2 text-ink-faint hover:text-danger-ink transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Discount & GST Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 bg-surface-muted p-4 rounded-card border border-line">
            <div>
              <label className="block text-ink-soft font-medium mb-1">Discount Type</label>
              <select
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as any)}
                className="w-full bg-surface border border-line rounded-control px-3 py-2 text-ink focus:outline-none focus:border-accent"
              >
                <option value="percent">Percentage (%)</option>
                <option value="fixed">Fixed Amount (₹)</option>
              </select>
            </div>

            <div>
              <label className="block text-ink-soft font-medium mb-1">
                {discountType === 'percent' ? 'Discount Rate (%)' : 'Discount Amount (₹)'}
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={discountValue || ''}
                onChange={(e) => setDiscountValue(parseFloat(e.target.value) || 0)}
                className="w-full bg-surface border border-line rounded-control px-3 py-2 font-mono text-ink focus:outline-none focus:border-accent"
                placeholder="0"
              />
            </div>

            {!isInternal && (<>
            <div>
              <label className="block text-ink-soft font-medium mb-1">GST Tax Type</label>
              <select
                value={gstType}
                onChange={(e) => setGstType(e.target.value as any)}
                className="w-full bg-surface border border-line rounded-control px-3 py-2 text-ink focus:outline-none focus:border-accent"
              >
                <option value="intra">Intra-State (CGST 9% + SGST 9%)</option>
                <option value="igst">Inter-State (IGST 18%)</option>
                <option value="exempt">GST Exempt / Nil</option>
              </select>
            </div>

            <div>
              <label className="block text-ink-soft font-medium mb-1">GST Rate (%)</label>
              <input
                type="number"
                disabled={gstType === 'exempt'}
                value={gstType === 'exempt' ? 0 : gstRate}
                onChange={(e) => setGstRate(parseFloat(e.target.value) || 18)}
                className="w-full bg-surface border border-line rounded-control px-3 py-2 font-mono text-ink disabled:opacity-50 focus:outline-none focus:border-accent"
              />
            </div>
            </>)}
          </div>

          {/* Live Calculation Preview Banner */}
          {calcResult && (
            <div className="bg-accent-soft p-4 rounded-card border border-accent-line">
              <div className="flex items-center justify-between text-xs mb-3 border-b border-accent-line pb-2">
                <span className="font-bold text-accent-ink uppercase tracking-wider">{isInternal ? 'Bill summary (no GST)' : 'GST invoice summary'}</span>
                {!isInternal && <span className="text-ink-faint">SAC Code: {sac}</span>}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-xs">
                <div>
                  <div className="text-ink-faint">Freight ({calcResult.lr_count || lrLines.length} LR{(calcResult.lr_count || lrLines.length) === 1 ? '' : 's'})</div>
                  <div className="font-mono font-semibold text-ink mt-0.5">₹{formatINR(calcResult.freight)}</div>
                </div>

                <div>
                  <div className="text-ink-faint">Additional Charges</div>
                  <div className="font-mono font-semibold text-ink mt-0.5">+₹{formatINR(calcResult.additional_total)}</div>
                </div>

                <div>
                  <div className="text-ink-faint">Gross Amount</div>
                  <div className="font-mono font-semibold text-ink mt-0.5">₹{formatINR(calcResult.gross_amount)}</div>
                </div>

                <div>
                  <div className="text-ink-faint">Discount ({calcResult.discount_type})</div>
                  <div className="font-mono font-semibold text-danger-ink mt-0.5">-₹{formatINR(calcResult.discount_amount)}</div>
                </div>

                <div>
                  <div className="text-ink-faint">{isInternal ? 'Sub total' : 'Taxable Value'}</div>
                  <div className="font-mono font-semibold text-ink mt-0.5">₹{formatINR(calcResult.taxable_amount)}</div>
                </div>

                {!isInternal && <div>
                  <div className="text-ink-faint">
                    {calcResult.gst_type === 'igst'
                      ? `IGST ${calcResult.gst_rate}%`
                      : calcResult.gst_type === 'intra'
                      ? `CGST+SGST ${calcResult.gst_rate}%`
                      : 'GST Exempt'}
                  </div>
                  <div className="font-mono font-semibold text-info-ink mt-0.5">₹{formatINR(calcResult.gst_amount)}</div>
                </div>}
              </div>

              {/* Profit, on the taxable value: GST collected is not income. */}
              <div className="mt-3 pt-3 border-t border-accent-line grid grid-cols-2 sm:grid-cols-5 gap-4 text-xs">
                <div>
                  <div className="text-ink-faint">Our cost</div>
                  <div className="font-mono font-semibold text-ink mt-0.5">
                    {calcResult.total_cost === null || calcResult.total_cost === undefined
                      ? <span className="text-ink-faint font-normal">Not costed</span>
                      : `₹${formatINR(calcResult.total_cost)}`}
                  </div>
                </div>
                <div>
                  <div className="text-ink-faint">Gross profit</div>
                  <div className={`font-mono font-semibold mt-0.5 ${(calcResult.gross_profit ?? 0) < 0 ? 'text-danger-ink' : 'text-positive-ink'}`}>
                    {calcResult.gross_profit === null || calcResult.gross_profit === undefined ? '-' : `₹${formatINR(calcResult.gross_profit)}`}
                  </div>
                </div>
                <div>
                  <div className="text-ink-faint">Margin</div>
                  <div className="font-mono font-semibold text-ink mt-0.5">
                    {calcResult.margin_pct === null || calcResult.margin_pct === undefined ? '-' : `${calcResult.margin_pct}%`}
                    {calcResult.partly_costed && <span className="text-warning-ink font-normal"> (some LRs uncosted)</span>}
                  </div>
                </div>
                <div>
                  <div className="text-ink-faint" title={isInternal ? 'Non-GST bill: vendor GST is counted in cost' : 'Vendor GST you can claim back'}>
                    {isInternal ? 'Vendor GST (in cost)' : 'Input GST credit'}
                  </div>
                  <div className="font-mono font-semibold text-ink mt-0.5">
                    ₹{formatINR(isInternal ? (calcResult.blocked_gst || 0) : (calcResult.input_gst || 0))}
                  </div>
                </div>
                {!isInternal && (
                  <div>
                    <div className="text-ink-faint" title="GST on this bill minus the input credit">Net GST to pay</div>
                    <div className="font-mono font-semibold text-info-ink mt-0.5">
                      ₹{formatINR((calcResult.gst_amount || 0) - (calcResult.input_gst || 0))}
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-3 pt-3 border-t border-accent-line flex items-center justify-between">
                <div className="text-xs text-ink-faint">
                  Round Off: <span className="font-mono text-ink-soft">₹{formatINR(calcResult.round_off)}</span>
                </div>
                <div className="text-base font-bold text-ink flex items-center gap-2">
                  <span className="text-ink-faint text-xs font-normal">GRAND TOTAL:</span>
                  <span className="font-mono text-accent-ink text-xl font-extrabold">₹{formatINR(calcResult.grand_total)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-line">
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
              <span>
                {saving
                  ? isEditMode
                    ? 'Updating Invoice...'
                    : 'Creating Invoice...'
                  : isEditMode
                  ? (isInternal ? 'Update bill' : 'Update tax invoice')
                  : (isInternal ? 'Save non-GST bill' : 'Save and issue invoice')}
              </span>
            </button>
          </div>
        </form>
      </div>

      {/* ========================================================================= */}
      {/* QUICK ADD CUSTOMER SUB-MODAL */}
      {/* ========================================================================= */}
      {showQuickAddCust && (
        <div className="fixed inset-0 bg-scrim backdrop-blur-[6px] flex items-center justify-center p-4 z-60 overflow-y-auto">
          <div className="sheet border border-line rounded-overlay max-w-xl w-full p-5 shadow-overlay text-ink my-auto">
            <div className="flex items-center justify-between pb-3 border-b border-line">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-card bg-accent-soft border border-accent-line flex items-center justify-center text-accent-ink font-bold">
                  <UserPlus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-ink">Quick Register New Customer</h3>
                  <p className="text-[11px] text-ink-faint">Will be instantly selected for this invoice</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowQuickAddCust(false)}
                className="p-1 text-ink-faint hover:text-ink rounded-control"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateQuickCustomer} className="space-y-3.5 pt-4 text-xs">
              {custError && (
                <div className="p-2.5 bg-danger-soft border border-danger-line rounded-card text-danger-ink text-xs">
                  {custError}
                </div>
              )}

              {quickLookupMsg && (
                <div className="p-2 bg-positive-soft border border-positive-line rounded-control text-positive-ink flex items-center gap-1.5 text-xs">
                  <Check className="w-3.5 h-3.5 text-positive-ink shrink-0" />
                  <span>{quickLookupMsg}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-ink-soft font-semibold">GSTIN (15 chars)</label>
                    <button
                      type="button"
                      disabled={fetchingGstQuick || newCustGstin.length !== 15}
                      onClick={() => fetchQuickGST(newCustGstin, true)}
                      className="text-[10px] text-accent-ink hover:text-accent-ink font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-40"
                    >
                      {fetchingGstQuick ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span>Fetching...</span>
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
                    value={newCustGstin}
                    onChange={(e) => handleNewCustGSTIN(e.target.value)}
                    className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 font-mono text-ink uppercase focus:outline-none focus:border-accent"
                    placeholder="24AABCS1429B1Z8"
                  />
                </div>

                <div>
                  <label className="block text-ink-soft font-semibold mb-1">PAN Number</label>
                  <input
                    type="text"
                    maxLength={10}
                    value={newCustPan}
                    onChange={(e) => setNewCustPan(e.target.value.toUpperCase())}
                    className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 font-mono text-ink uppercase focus:outline-none focus:border-accent"
                    placeholder="AABCS1429B"
                  />
                </div>
              </div>

              <div>
                <label className="block text-ink-soft font-semibold mb-1">Company / Customer Name *</label>
                <input
                  type="text"
                  required
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 text-ink focus:outline-none focus:border-accent font-medium"
                  placeholder="e.g. Maruti Freight Express Ltd"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-ink-soft font-semibold mb-1">Contact Person</label>
                  <input
                    type="text"
                    value={newCustPerson}
                    onChange={(e) => setNewCustPerson(e.target.value)}
                    className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 text-ink focus:outline-none focus:border-accent"
                    placeholder="e.g. Sanjay Sharma"
                  />
                </div>

                <div>
                  <label className="block text-ink-soft font-semibold mb-1">Phone Number</label>
                  <input
                    type="text"
                    value={newCustPhone}
                    onChange={(e) => setNewCustPhone(e.target.value)}
                    className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 text-ink focus:outline-none focus:border-accent"
                    placeholder="+91 98765 43210"
                  />
                </div>
              </div>

              <div>
                <label className="block text-ink-soft font-semibold mb-1">Billing Address</label>
                <textarea
                  rows={2}
                  value={newCustAddress}
                  onChange={(e) => setNewCustAddress(e.target.value)}
                  className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 text-ink focus:outline-none focus:border-accent"
                  placeholder="Plot 10, GIDC Logistics Park..."
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-ink-soft font-semibold">PIN Code</label>
                    <button
                      type="button"
                      disabled={fetchingPinQuick || newCustPin.length !== 6}
                      onClick={() => fetchQuickPIN(newCustPin)}
                      className="text-[10px] text-accent-ink font-semibold cursor-pointer disabled:opacity-40"
                    >
                      {fetchingPinQuick ? '...' : 'Fetch'}
                    </button>
                  </div>
                  <input
                    type="text"
                    maxLength={6}
                    value={newCustPin}
                    onChange={(e) => handleNewCustPinChange(e.target.value)}
                    className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 text-ink focus:outline-none focus:border-accent font-mono"
                    placeholder="380001"
                  />
                </div>

                <div>
                  <label className="block text-ink-soft font-semibold mb-1">City</label>
                  <input
                    type="text"
                    value={newCustCity}
                    onChange={(e) => setNewCustCity(e.target.value)}
                    className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 text-ink focus:outline-none focus:border-accent"
                  />
                </div>

                <div>
                  <label className="block text-ink-soft font-semibold mb-1">State</label>
                  <input
                    type="text"
                    value={newCustState}
                    onChange={(e) => setNewCustState(e.target.value)}
                    className="w-full bg-surface-muted border border-line rounded-card px-3 py-2 text-ink focus:outline-none focus:border-accent"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-line">
                <button
                  type="button"
                  onClick={() => setShowQuickAddCust(false)}
                  className="px-3.5 py-1.5 bg-surface-sunken hover:bg-surface-sunken text-ink-soft rounded-card text-xs font-medium transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingCust}
                  className="px-4 py-1.5 bg-accent-strong hover:bg-accent-strong-hover text-on-accent rounded-card text-xs font-semibold shadow-card transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{savingCust ? 'Saving...' : 'Save & Select Customer'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
