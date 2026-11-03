import React, { useState, useEffect } from 'react';
import { Printer, CreditCard, Trash2, Edit3 } from 'lucide-react';
import { Invoice, CompanySettings, BankAccount } from '../types.js';
import { formatINR, numberToWords } from '../utils/format.js';
import { printInvoicePDF } from '../utils/pdf.js';
import { apiRequest } from '../services/api.js';
import { DeleteInvoiceModal } from './DeleteInvoiceModal.js';
import { Modal, Button, StatusBadge, Badge, SkeletonRows, cx } from './ui.js';

interface InvoiceDetailModalProps {
  invoice: Invoice;
  onClose: () => void;
  onEditInvoice?: (inv: Invoice) => void;
  onRecordPayment: (inv: Invoice) => void;
  onRefresh: () => void;
  companySettings: CompanySettings;
  defaultBank?: BankAccount;
}

export const InvoiceDetailModal: React.FC<InvoiceDetailModalProps> = ({
  invoice: initialInvoice,
  onClose,
  onEditInvoice,
  onRecordPayment,
  onRefresh,
  companySettings,
  defaultBank,
}) => {
  // <Modal> registers the phone Back button, so it closes this instead of leaving the app
  const [inv, setInv] = useState<Invoice>(initialInvoice);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  useEffect(() => {
    const loadDetails = async () => {
      try {
        const fullInv = await apiRequest<Invoice>(`/invoices/${initialInvoice.id}`);
        setInv(fullInv);
        const payRes = await apiRequest<{ items: any[] }>(`/payments?invoice_id=${initialInvoice.id}`);
        setPayments(payRes.items || []);
      } catch (err) {
        console.error('Failed to load invoice details', err);
      } finally {
        setLoading(false);
      }
    };
    loadDetails();
  }, [initialInvoice.id]);

  const lrItems = Array.isArray(inv.lr_items)
    ? inv.lr_items.filter(l => l && (l.lr_no || Number(l.amount) > 0 || Number(l.weight) > 0))
    : [];

  const internal = inv.doc_type === 'internal';
  const totals = inv.totals || {
    freight: inv.freight || 0,
    additional_total: inv.additional_total || 0,
    discount_amount: inv.discount_amount || 0,
    taxable_amount: inv.taxable_amount || 0,
    gst_amount: inv.gst_amount || 0,
    cgst: inv.cgst || 0,
    sgst: inv.sgst || 0,
    igst: inv.igst || 0,
    round_off: inv.round_off || 0,
    grand_total: inv.grand_total || 0,
    gst_type: inv.gst_type === 'igst' ? 'igst' : 'intra',
    gst_rate: inv.gst_rate || 18,
    discount_type: inv.discount_type || 'percent',
    discount_value: inv.discount_value || 0,
  };

  const t = totals as any;
  const canPay = inv.display_status !== 'paid' && inv.display_status !== 'cancelled';
  const canEdit = inv.display_status !== 'cancelled' && Boolean(onEditInvoice);
  const balance = inv.balance ?? totals.grand_total;
  const route = inv.origin && inv.destination ? `${inv.origin} → ${inv.destination}` : 'Local';
  const shipCityLine = [
    inv.ship_to?.city || inv.buyer?.city,
    inv.ship_to?.state || inv.buyer?.state,
    inv.ship_to?.pin || inv.buyer?.pin,
  ].filter(Boolean).join(', ');

  return (
    <>
      <Modal
        onClose={onClose}
        title={`${internal ? 'Non-GST bill' : 'Tax invoice'} ${inv.invoice_no}`}
        subtitle={`${inv.invoice_date} · ${inv.buyer?.name || 'Customer'}`}
        size="xl"
        headerActions={<span className="mr-1"><StatusBadge status={inv.display_status} /></span>}
        footer={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" icon={<Trash2 />} onClick={() => setShowDeleteModal(true)}
              className="text-danger-ink hover:text-danger-ink hover:bg-danger-soft">
              <span className="hidden sm:inline">Cancel or delete</span>
              <span className="sm:hidden">Delete</span>
            </Button>
            <div className="ml-auto flex items-center gap-2">
              {canEdit && (
                <Button variant="secondary" icon={<Edit3 />} onClick={() => { onClose(); onEditInvoice!(inv); }}>
                  Edit
                </Button>
              )}
              <Button variant={canPay ? 'secondary' : 'primary'} icon={<Printer />}
                onClick={() => printInvoicePDF(inv, companySettings, defaultBank)}>
                <span className="sm:hidden">Print</span><span className="hidden sm:inline">Print PDF</span>
              </Button>
              {canPay && (
                <Button variant="primary" icon={<CreditCard />} onClick={() => { onClose(); onRecordPayment(inv); }}>
                  <span className="hidden sm:inline">Record payment</span>
                  <span className="sm:hidden">Payment</span>
                </Button>
              )}
            </div>
          </div>
        }
      >
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-6">
          {/* ---------------------------------------------------------------- main */}
          <div className="min-w-0 space-y-5">
            {/* Key facts */}
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
              <KV label={lrItems.length > 1 ? 'LR numbers' : 'LR / bilty no'}>
                <span className="font-mono text-[13px] break-words">{inv.lr_no || '-'}</span>
              </KV>
              <KV label="Route">{route}</KV>
              <KV label="Charged weight"><span className="tabular-nums">{inv.weight ? `${inv.weight} kg` : '-'}</span></KV>
              <KV label="Place of supply">{inv.place_of_supply || '-'}</KV>
              <KV label="Bill type">{internal ? 'Non-GST bill' : 'Original tax invoice'}</KV>
              <KV label="SAC"><span className="font-mono text-[13px]">{inv.sac || '996511'}</span></KV>
              {inv.due_date && <KV label="Due date"><span className="tabular-nums">{inv.due_date}</span></KV>}
              {inv.payment_terms && <KV label="Terms">{inv.payment_terms}</KV>}
            </dl>

            {/* Parties */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-line">
              <Party title="From">
                <div className="text-sm font-medium text-ink">{companySettings?.name || 'SHREE SANWARIYA LOGISTICS'}</div>
                <div className="text-xs text-ink-soft">
                  {[companySettings?.address, companySettings?.city, companySettings?.state, companySettings?.pin].filter(Boolean).join(', ') || 'Opp. Transport Nagar, Ring Road, Ahmedabad, Gujarat'}
                </div>
                {!internal && (
                  <div className="text-xs text-ink-faint mt-1">
                    GSTIN <span className="font-mono text-ink-soft">{companySettings?.gstin || '24AABCS1429B1Z8'}</span>
                    <span className="mx-1">·</span>
                    PAN <span className="font-mono text-ink-soft">{companySettings?.pan || 'AABCS1429B'}</span>
                  </div>
                )}
              </Party>
              <Party title="Bill to">
                <div className="text-sm font-medium text-ink">{inv.buyer?.name || '-'}</div>
                {inv.buyer?.address && <div className="text-xs text-ink-soft">{inv.buyer.address}</div>}
                <div className="text-xs text-ink-soft">{[inv.buyer?.city, inv.buyer?.state, inv.buyer?.pin].filter(Boolean).join(', ')}</div>
                <div className="text-xs text-ink-faint mt-1">
                  GSTIN <span className="font-mono text-ink-soft">{inv.buyer?.gstin || 'Unregistered'}</span>
                  {inv.buyer?.phone && <><span className="mx-1">·</span>{inv.buyer.phone}</>}
                </div>
              </Party>
              <Party title="Ship to" tag={inv.same_as_buyer ? 'Same as bill to' : undefined}>
                <div className="text-sm font-medium text-ink">{inv.ship_to?.name || inv.buyer?.name || '-'}</div>
                {(inv.ship_to?.address || inv.buyer?.address) && (
                  <div className="text-xs text-ink-soft">{inv.ship_to?.address || inv.buyer?.address}</div>
                )}
                {shipCityLine && <div className="text-xs text-ink-soft">{shipCityLine}</div>}
                {inv.ship_to?.gstin && (
                  <div className="text-xs text-ink-faint mt-1">GSTIN <span className="font-mono text-ink-soft">{inv.ship_to.gstin}</span></div>
                )}
              </Party>
            </div>

            {/* Consignments */}
            {lrItems.length > 0 && (
              <section>
                <SectionTitle title="Consignments" hint={`${lrItems.length} LR${lrItems.length === 1 ? '' : 's'} on this bill`} />
                {/* Phone: one row per LR */}
                <ul className="sm:hidden divide-y divide-line border-y border-line">
                  {lrItems.map((l, i) => (
                    <li key={i} className="py-2">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-mono text-[13px] text-ink truncate">{l.lr_no || '-'}</span>
                        <span className="tabular-nums font-medium text-ink shrink-0">₹{formatINR(l.amount)}</span>
                      </div>
                      <div className="flex items-baseline justify-between gap-3 text-xs text-ink-faint">
                        <span className="truncate">{[l.origin, l.destination].filter(Boolean).join(' → ') || '-'}{l.lr_date ? ` · ${l.lr_date}` : ''}</span>
                        <span className="tabular-nums shrink-0">
                          {l.weight ? `${formatINR(l.weight)} kg` : '-'}{l.rate_kg ? ` × ₹${formatINR(l.rate_kg)}` : ''}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
                {/* Desktop table */}
                <div className="hidden sm:block border border-line rounded-card overflow-hidden">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-surface-muted border-b border-line">
                      <tr className="text-xs text-ink-faint">
                        <th className="h-8 px-3 font-medium w-8">#</th>
                        <th className="h-8 px-3 font-medium">LR / bilty no</th>
                        <th className="h-8 px-3 font-medium">LR date</th>
                        <th className="h-8 px-3 font-medium">Route</th>
                        <th className="h-8 px-3 font-medium text-right">Weight (kg)</th>
                        <th className="h-8 px-3 font-medium text-right">Rate / kg</th>
                        <th className="h-8 px-3 font-medium text-right">Freight</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {lrItems.map((l, i) => (
                        <tr key={i}>
                          <td className="py-1.5 px-3 text-ink-faint tabular-nums">{i + 1}</td>
                          <td className="py-1.5 px-3 font-mono text-[13px] text-ink">{l.lr_no || '-'}</td>
                          <td className="py-1.5 px-3 text-ink-soft tabular-nums">{l.lr_date || '-'}</td>
                          <td className="py-1.5 px-3 text-ink-soft">{[l.origin, l.destination].filter(Boolean).join(' → ') || '-'}</td>
                          <td className="py-1.5 px-3 text-right tabular-nums text-ink-soft">{l.weight ? formatINR(l.weight) : '-'}</td>
                          <td className="py-1.5 px-3 text-right tabular-nums text-ink-soft">{l.rate_kg ? formatINR(l.rate_kg) : '-'}</td>
                          <td className="py-1.5 px-3 text-right tabular-nums font-medium text-ink">₹{formatINR(l.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    {lrItems.length > 1 && (
                      <tfoot className="border-t border-line">
                        <tr>
                          <td colSpan={4} className="py-1.5 px-3 text-right text-xs text-ink-faint">Total ({lrItems.length} LRs)</td>
                          <td className="py-1.5 px-3 text-right tabular-nums text-ink">{formatINR(lrItems.reduce((a, l) => a + (Number(l.weight) || 0), 0))}</td>
                          <td></td>
                          <td className="py-1.5 px-3 text-right tabular-nums font-semibold text-ink">₹{formatINR(totals.freight)}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </section>
            )}

            {/* Charges */}
            <section>
              <SectionTitle title="Charges" />
              <table className="w-full text-sm text-left">
                <thead className="border-y border-line">
                  <tr className="text-xs text-ink-faint">
                    <th className="h-8 pr-3 font-medium">Particulars</th>
                    <th className="h-8 px-3 font-medium hidden sm:table-cell">SAC</th>
                    <th className="h-8 pl-3 font-medium text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line border-b border-line">
                  <tr>
                    <td className="py-2 pr-3 text-ink">
                      Freight charges
                      {lrItems.length > 1 && <span className="text-ink-faint"> · {lrItems.length} LRs as per consignments</span>}
                    </td>
                    <td className="py-2 px-3 text-ink-faint font-mono text-[13px] hidden sm:table-cell">{inv.sac || '996511'}</td>
                    <td className="py-2 pl-3 text-right tabular-nums font-medium text-ink">₹{formatINR(totals.freight)}</td>
                  </tr>
                  {inv.extra_charges && inv.extra_charges.map((ec, i) => (
                    <tr key={i}>
                      <td className="py-2 pr-3 text-ink-soft">{ec.label}</td>
                      <td className="py-2 px-3 text-ink-faint font-mono text-[13px] hidden sm:table-cell">{inv.sac || '996511'}</td>
                      <td className="py-2 pl-3 text-right tabular-nums font-medium text-ink">₹{formatINR(ec.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            {/* Payments */}
            <section>
              <SectionTitle title="Payments" />
              {loading ? (
                <SkeletonRows rows={1} />
              ) : payments.length > 0 ? (
                <ul className="divide-y divide-line border-y border-line">
                  {payments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm text-ink truncate">
                          {p.method}
                          {p.reference && <span className="font-mono text-[13px] text-ink-soft"> · {p.reference}</span>}
                        </div>
                        <div className="text-xs text-ink-faint tabular-nums">{p.payment_date}</div>
                      </div>
                      <div className="tabular-nums font-medium text-positive-ink shrink-0">₹{formatINR(p.amount)}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-faint py-2 border-y border-line">No payments recorded against this invoice yet.</p>
              )}
            </section>
          </div>

          {/* ------------------------------------------------------------- summary */}
          <aside className="mt-5 lg:mt-0 pt-4 lg:pt-0 border-t lg:border-t-0 lg:border-l border-line lg:pl-6 min-w-0">
            <h3 className="text-sm font-semibold text-ink mb-2">Summary</h3>
            <div className="space-y-1.5 text-sm">
              <Row label="Gross amount" value={`₹${formatINR(t.gross_amount || (totals.freight + (totals.additional_total || 0)))}`} />
              {totals.discount_amount > 0 && (
                <Row label={`Discount (${totals.discount_type})`} value={`−₹${formatINR(totals.discount_amount)}`} />
              )}
              <Row label={internal ? 'Sub total' : 'Taxable value'} value={`₹${formatINR(totals.taxable_amount)}`} strong />
              {internal ? null : totals.gst_type === 'igst' ? (
                <Row label={`IGST ${totals.gst_rate}%`} value={`₹${formatINR(totals.igst)}`} />
              ) : (
                <>
                  <Row label={`CGST ${totals.gst_rate / 2}%`} value={`₹${formatINR(totals.cgst)}`} />
                  <Row label={`SGST ${totals.gst_rate / 2}%`} value={`₹${formatINR(totals.sgst)}`} />
                </>
              )}
              <Row label="Round off" value={`₹${formatINR(totals.round_off)}`} faint />
            </div>
            <div className="flex items-baseline justify-between gap-3 mt-3 pt-3 border-t border-line">
              <span className="text-sm text-ink-soft">Grand total</span>
              <span className="numeral text-xl text-ink">₹{formatINR(totals.grand_total)}</span>
            </div>
            <p className="text-xs text-ink-faint mt-1">{numberToWords(totals.grand_total)}</p>

            <div className="space-y-1.5 text-sm mt-3 pt-3 border-t border-line">
              <Row label="Received" value={`₹${formatINR(inv.paid || 0)}`} tone={(inv.paid || 0) > 0 ? 'text-positive-ink' : undefined} />
              <Row label="Balance due" value={`₹${formatINR(balance)}`} strong
                tone={balance > 0.5 ? (inv.display_status === 'overdue' ? 'text-danger-ink' : 'text-warning-ink') : undefined} />
            </div>

            {/* Internal figures: shown on screen only, never printed. */}
            {t.total_cost !== null && t.total_cost !== undefined && (
              <div className="mt-3 pt-3 border-t border-line">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-ink-soft">Profit</span>
                  <Badge>Not printed</Badge>
                </div>
                <div className="space-y-1 text-sm">
                  <Row label="Our cost" value={`₹${formatINR(t.total_cost)}`} />
                  {(t.input_gst || 0) > 0 && <Row label="Input GST credit" value={`₹${formatINR(t.input_gst)}`} />}
                  {(t.blocked_gst || 0) > 0 && <Row label="Vendor GST in cost" value={`₹${formatINR(t.blocked_gst)}`} />}
                  <Row label={`Gross profit (${t.margin_pct ?? 0}%)`} value={`₹${formatINR(t.gross_profit)}`} strong
                    tone={(t.gross_profit ?? 0) < 0 ? 'text-danger-ink' : undefined} />
                </div>
              </div>
            )}
          </aside>
        </div>
      </Modal>

      {/* Delete / cancel confirmation, stacked above this dialog */}
      {showDeleteModal && (
        <DeleteInvoiceModal
          invoice={inv}
          onClose={() => setShowDeleteModal(false)}
          onSuccess={() => {
            setShowDeleteModal(false);
            onRefresh();
            onClose();
          }}
        />
      )}
    </>
  );
};

/* ------------------------------------------------------------ local pieces */
const KV: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="min-w-0">
    <dt className="text-xs text-ink-faint">{label}</dt>
    <dd className="text-sm text-ink mt-0.5">{children}</dd>
  </div>
);

const Party: React.FC<{ title: string; tag?: string; children: React.ReactNode }> = ({ title, tag, children }) => (
  <div className="min-w-0">
    <div className="flex items-center gap-2 mb-1">
      <span className="text-xs text-ink-faint">{title}</span>
      {tag && <span className="text-[11px] text-ink-faint">· {tag}</span>}
    </div>
    {children}
  </div>
);

const SectionTitle: React.FC<{ title: string; hint?: string }> = ({ title, hint }) => (
  <div className="flex items-baseline justify-between gap-2 mb-2">
    <h3 className="text-sm font-semibold text-ink">{title}</h3>
    {hint && <span className="text-xs text-ink-faint">{hint}</span>}
  </div>
);

const Row: React.FC<{ label: string; value: string; strong?: boolean; faint?: boolean; tone?: string }> = ({
  label, value, strong, faint, tone,
}) => (
  <div className="flex items-baseline justify-between gap-3">
    <span className={faint ? 'text-ink-faint' : 'text-ink-soft'}>{label}</span>
    <span className={cx('tabular-nums', strong ? 'font-medium' : '', tone || (faint ? 'text-ink-faint' : 'text-ink'))}>{value}</span>
  </div>
);
