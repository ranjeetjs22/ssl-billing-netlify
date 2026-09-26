import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Invoice, CompanySettings, BankAccount, Customer, Payment } from '../types.js';
import { prepareLogoForPdf } from './logoAsset.js';
import { formatINR, numberToWords } from './format.js';

// Re-exported for backwards compatibility - prefer importing from './format.js'
export { formatINR, numberToWords };

/**
 * Draws the company logo (uploaded or built-in) at the given position, preserving its
 * aspect ratio, and returns the rendered height in mm (0 when no logo is available).
 */
async function drawLogo(doc: jsPDF, company: CompanySettings, x: number, top: number, width: number): Promise<number> {
  try {
    const logo = await prepareLogoForPdf(company.logo_url);
    if (!logo) return 0;
    const height = Math.round(width * (logo.height / logo.width) * 100) / 100;
    doc.addImage(logo.dataUrl, 'JPEG', x, top, width, height, undefined, 'FAST');
    return height;
  } catch (err) {
    console.warn('Could not render logo in PDF', err);
    return 0;
  }
}

/** Characters Windows, macOS and Android all accept in a file name. */
function safeFileName(raw: string, fallback: string): string {
  const cleaned = String(raw || '')
    .replace(/[\\/:*?"<>|]+/g, '-')   // path separators and reserved characters
    .replace(/\s+/g, '_')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 120);
  return cleaned || fallback;
}

/**
 * Save the PDF straight to the user's downloads under a real name, instead of
 * opening a blob tab. The object URL is released once the browser has taken it.
 */
function downloadPdf(doc: jsPDF, baseName: string) {
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = baseName.toLowerCase().endsWith('.pdf') ? baseName : `${baseName}.pdf`;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Invoice file name is the LR number, as the office files bills by LR.
 * A bill covering several LRs joins them; a bill with no LR falls back to
 * the invoice number.
 */
export function invoiceFileName(inv: Invoice): string {
  const lrs = (Array.isArray(inv.lr_items) ? inv.lr_items : [])
    .map(l => String(l?.lr_no || '').trim()).filter(Boolean);
  const fromLrs = lrs.length ? lrs.join('_') : String(inv.lr_no || '').split(',').map(x => x.trim()).filter(Boolean).join('_');
  return safeFileName(fromLrs, safeFileName(inv.invoice_no, 'invoice'));
}

export async function printInvoicePDF(inv: Invoice, company: CompanySettings, bank?: BankAccount) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  // A non-GST bill must not look like a tax invoice: no "TAX INVOICE" title,
  // no GSTIN, no SAC and no tax lines. It is a plain freight bill.
  const internal = inv.doc_type === 'internal';

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 12;
  const logoWidth = 42;
  const logoTop = 10;
  const leftColWidth = pageWidth - margin * 2 - logoWidth - 5; // ~139mm

  const logoHeight = await drawLogo(doc, company, pageWidth - margin - logoWidth, logoTop, logoWidth);

  // Dynamic Header Rendering (Left Column)
  let curY = 15;

  // Company Name
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42); // Navy
  const compName = (company.name || 'SHREE SANWARIYA LOGISTICS').toUpperCase();
  const compNameLines = doc.splitTextToSize(compName, leftColWidth);
  doc.text(compNameLines, margin, curY);
  curY += compNameLines.length * 5;

  // Address
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  const addr = [company.address, company.city, company.state, company.pin].filter(Boolean).join(', ');
  const addrText = addr || 'Opp. Transport Nagar, Ring Road, Ahmedabad, Gujarat';
  const addrLines = doc.splitTextToSize(addrText, leftColWidth);
  doc.text(addrLines, margin, curY);
  curY += addrLines.length * 3.8;

  // Contact (Phone, WhatsApp, Email)
  const contactParts = [
    company.phone ? `Ph: ${company.phone}` : null,
    company.whatsapp ? `WhatsApp: ${company.whatsapp}` : null,
    company.email,
  ].filter(Boolean);
  const contactText = contactParts.length > 0 ? contactParts.join('  |  ') : 'Ph: +91 98765 43210  |  Email: billing@shreesanwariya.com';
  const contactLines = doc.splitTextToSize(contactText, leftColWidth);
  doc.text(contactLines, margin, curY);
  curY += contactLines.length * 3.8;

  // GSTIN & PAN
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  if (!internal) {
    const taxIdText = `GSTIN: ${company.gstin || '24AABCS1429B1Z8'}  |  PAN: ${company.pan || 'AABCS1429B'}`;
    const taxIdLines = doc.splitTextToSize(taxIdText, leftColWidth);
    doc.text(taxIdLines, margin, curY);
    curY += taxIdLines.length * 3.8;
  }

  // Calculate Band start position to ensure no collision with logo or header text
  const bandY = Math.max(curY + 2, logoTop + logoHeight + 3, 34);

  // TAX INVOICE Band
  doc.setFillColor(15, 23, 42);
  doc.rect(margin, bandY, pageWidth - margin * 2, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text(internal ? 'FREIGHT BILL' : 'TAX INVOICE', margin + 3, bandY + 4.5);
  doc.setFont('helvetica', 'normal');
  doc.text(internal ? 'Goods transport' : `GST Invoice under SAC ${inv.sac || '996511'} (Goods Transport)`,
    pageWidth - margin - 3, bandY + 4.5, { align: 'right' });

  // Multi-LR bills: one line per LR / consignment
  const lrItems = Array.isArray(inv.lr_items)
    ? inv.lr_items.filter(l => l && (l.lr_no || Number(l.amount) > 0 || Number(l.weight) > 0))
    : [];
  const multiLr = lrItems.length > 1;
  const lrTotalWeight = lrItems.reduce((acc, l) => acc + (Number(l.weight) || 0), 0);
  const lrTotalFreight = lrItems.reduce((acc, l) => acc + (Number(l.amount) || 0), 0);
  const lrRates = Array.from(new Set(lrItems.map(l => Number(l.rate_kg) || 0).filter(r => r > 0)));

  // Invoice & LR Meta Box
  autoTable(doc, {
    startY: bandY + 8.5,
    margin: { left: margin, right: margin },
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 2, textColor: [15, 23, 42] },
    columnStyles: {
      0: { fontStyle: 'bold', fillColor: [248, 250, 252], cellWidth: 32 },
      1: { cellWidth: 58 },
      2: { fontStyle: 'bold', fillColor: [248, 250, 252], cellWidth: 36 },
      3: { cellWidth: 60 },
    },
    body: [
      [internal ? 'Bill No.' : 'Invoice No.', inv.invoice_no || '-', internal ? 'Bill Date' : 'Invoice Date', inv.invoice_date || '-'],
      [
        multiLr ? 'LR Nos.' : 'LR No.',
        multiLr ? `${lrItems.length} LRs - see Consignment Details below` : (inv.lr_no || '-'),
        multiLr ? 'First LR Date' : 'Shipment Date',
        (multiLr ? lrItems[0].lr_date : inv.shipment_date) || '-',
      ],
      ['Origin', inv.origin || '-', 'Destination', inv.destination || '-'],
      [
        multiLr ? 'Total Weight (Kg)' : 'Weight (Kg)',
        (multiLr ? lrTotalWeight : inv.weight) ? `${formatINR(multiLr ? lrTotalWeight : inv.weight)} Kg` : '-',
        'Rate per Kg',
        multiLr
          ? (lrRates.length === 1 ? `Rs. ${lrRates[0]}` : (lrRates.length > 1 ? 'As per LR' : '-'))
          : (inv.rate_kg ? `Rs. ${inv.rate_kg}` : '-'),
      ],
      [internal ? 'Delivery State' : 'Place of Supply', inv.place_of_supply || '-', 'Payment Terms', inv.payment_terms || '-'],
    ],
  });

  const metaEndY = (doc as any).lastAutoTable.finalY || 65;

  // Bill To & Ship To
  const buyer = inv.buyer || {};
  const ship = inv.ship_to || buyer;

  autoTable(doc, {
    startY: metaEndY + 3,
    margin: { left: margin, right: margin },
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 2.5, textColor: [15, 23, 42] },
    columnStyles: {
      0: { cellWidth: (pageWidth - margin * 2) / 2 },
      1: { cellWidth: (pageWidth - margin * 2) / 2 },
    },
    body: [
      [
        { content: 'BILL TO (BUYER DETAILS)', styles: { fontStyle: 'bold', fillColor: [241, 245, 249] } },
        { content: 'SHIP TO (DELIVERY DETAILS)', styles: { fontStyle: 'bold', fillColor: [241, 245, 249] } },
      ],
      [
        `${buyer.name || '-'}\n${buyer.address || ''}\n${[buyer.city, buyer.state, buyer.pin].filter(Boolean).join(', ')}${internal ? '' : `\nGSTIN: ${buyer.gstin || '-'}`}\nPhone: ${buyer.phone || '-'}`,
        `${ship.name || buyer.name || '-'}\n${ship.address || buyer.address || ''}\n${[ship.city || buyer.city, ship.state || buyer.state, ship.pin || buyer.pin].filter(Boolean).join(', ')}${ship.gstin && !internal ? `\nGSTIN: ${ship.gstin}` : ''}\nPhone: ${ship.phone || buyer.phone || '-'}`,
      ],
    ],
  });

  let partiesEndY = (doc as any).lastAutoTable.finalY || 95;

  // Consignment / LR details table (only when the bill covers more than one LR)
  if (multiLr) {
    const lrRows: any[] = lrItems.map((l, i) => [
      String(i + 1),
      l.lr_no || '-',
      l.lr_date || '-',
      [l.origin, l.destination].filter(Boolean).join(' -> ') || '-',
      l.weight ? formatINR(l.weight) : '-',
      l.rate_kg ? formatINR(l.rate_kg) : '-',
      formatINR(l.amount),
    ]);
    lrRows.push([
      { content: `Total (${lrItems.length} LRs)`, colSpan: 4, styles: { fontStyle: 'bold', halign: 'right', fillColor: [248, 250, 252] } },
      { content: formatINR(lrTotalWeight), styles: { fontStyle: 'bold', halign: 'right', fillColor: [248, 250, 252] } },
      { content: '', styles: { fillColor: [248, 250, 252] } },
      { content: formatINR(lrTotalFreight), styles: { fontStyle: 'bold', halign: 'right', fillColor: [248, 250, 252] } },
    ]);

    autoTable(doc, {
      startY: partiesEndY + 3,
      margin: { left: margin, right: margin },
      theme: 'grid',
      headStyles: { fillColor: [51, 65, 85], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
      styles: { fontSize: 7.5, cellPadding: 1.8, textColor: [15, 23, 42] },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        1: { cellWidth: 30, fontStyle: 'bold' },
        2: { cellWidth: 22 },
        3: { cellWidth: 52 },
        4: { cellWidth: 24, halign: 'right' },
        5: { cellWidth: 22, halign: 'right' },
        6: { cellWidth: 28, halign: 'right', fontStyle: 'bold' },
      },
      head: [['#', 'LR / Bilty No', 'LR Date', 'From -> To', 'Weight (Kg)', 'Rate / Kg', 'Freight (Rs)']],
      body: lrRows,
    });
    partiesEndY = (doc as any).lastAutoTable.finalY || partiesEndY + 30;
  }

  // Charges Table
  const chargeRows: any[] = [
    [
      '1',
      multiLr
        ? `Freight Charges - ${lrItems.length} LRs (as per Consignment Details above)`
        : 'Freight Charges (Logistics / Transportation)',
      internal ? '' : inv.sac || '996511',
      formatINR(inv.totals?.freight || inv.freight || 0),
    ],
  ];

  let itemIdx = 2;
  if (inv.totals?.additional_items && inv.totals.additional_items.length > 0) {
    for (const item of inv.totals.additional_items) {
      chargeRows.push([String(itemIdx++), item.label, internal ? '' : inv.sac || '996511', formatINR(item.amount)]);
    }
  } else if (inv.extra_charges && inv.extra_charges.length > 0) {
    for (const item of inv.extra_charges) {
      chargeRows.push([String(itemIdx++), item.label, internal ? '' : inv.sac || '996511', formatINR(item.amount)]);
    }
  }

  autoTable(doc, {
    startY: partiesEndY + 3,
    margin: { left: margin, right: margin },
    theme: 'grid',
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    styles: { fontSize: 8, cellPadding: 2, textColor: [15, 23, 42] },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 110 },
      2: { cellWidth: 26, halign: 'center' },
      3: { cellWidth: 40, halign: 'right' },
    },
    head: [['#', 'Particulars & Description', internal ? '' : 'SAC Code', 'Amount (INR)']],
    body: chargeRows,
  });

  const chargesEndY = (doc as any).lastAutoTable.finalY || 135;

  // Totals Breakdown
  const totals = inv.totals || {
    freight: inv.freight || 0,
    additional_total: inv.additional_total || 0,
    discount_amount: inv.discount_amount || 0,
    taxable_amount: inv.taxable_amount || 0,
    gst_type: inv.gst_type === 'igst' || inv.gst_type === 'inter' ? 'igst' : 'intra',
    gst_rate: inv.gst_rate ?? 18,
    cgst: inv.cgst || 0,
    sgst: inv.sgst || 0,
    igst: inv.igst || 0,
    round_off: inv.round_off || 0,
    grand_total: inv.grand_total || 0,
  };

  const totalsBody: any[] = [
    ['Freight Subtotal', formatINR(totals.freight)],
  ];

  if (totals.additional_total > 0) {
    totalsBody.push(['Additional Charges', formatINR(totals.additional_total)]);
  }
  if (totals.discount_amount > 0) {
    totalsBody.push(['Discount', `-${formatINR(totals.discount_amount)}`]);
  }
  totalsBody.push([internal ? 'Sub Total' : 'Taxable Amount', formatINR(totals.taxable_amount)]);

  if (internal) {
    // no tax lines at all on a non-GST bill
  } else if (totals.gst_type === 'igst') {
    totalsBody.push([`IGST @ ${totals.gst_rate}%`, formatINR(totals.igst)]);
  } else if (totals.gst_type === 'intra') {
    const halfRate = totals.gst_rate / 2;
    totalsBody.push([`CGST @ ${halfRate}%`, formatINR(totals.cgst)]);
    totalsBody.push([`SGST @ ${halfRate}%`, formatINR(totals.sgst)]);
  } else {
    totalsBody.push(['GST', 'Exempted']);
  }

  if (totals.round_off !== 0) {
    totalsBody.push(['Round Off', formatINR(totals.round_off)]);
  }
  totalsBody.push([
    { content: 'GRAND TOTAL', styles: { fontStyle: 'bold', fillColor: [234, 88, 12], textColor: [255, 255, 255] } },
    { content: `Rs. ${formatINR(totals.grand_total)}`, styles: { fontStyle: 'bold', fillColor: [234, 88, 12], textColor: [255, 255, 255], halign: 'right' } },
  ]);

  autoTable(doc, {
    startY: chargesEndY + 2,
    margin: { left: pageWidth - margin - 75 },
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 1.8, textColor: [15, 23, 42] },
    columnStyles: {
      0: { cellWidth: 40 },
      1: { cellWidth: 35, halign: 'right' },
    },
    body: totalsBody,
  });

  // Words Box on left side of totals
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Amount in Words:', margin, chargesEndY + 6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text(numberToWords(totals.grand_total), margin, chargesEndY + 11, { maxWidth: pageWidth - margin * 2 - 80 });

  const finalTotalsY = (doc as any).lastAutoTable.finalY || 180;

  // Payment Details & Terms
  autoTable(doc, {
    startY: Math.max(finalTotalsY + 3, chargesEndY + 22),
    margin: { left: margin, right: margin },
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 2, textColor: [15, 23, 42] },
    columnStyles: {
      0: { cellWidth: (pageWidth - margin * 2) * 0.45 },
      1: { cellWidth: (pageWidth - margin * 2) * 0.55 },
    },
    body: [
      [
        { content: 'BANK & PAYMENT DETAILS', styles: { fontStyle: 'bold', fillColor: [241, 245, 249] } },
        { content: 'TERMS & CONDITIONS', styles: { fontStyle: 'bold', fillColor: [241, 245, 249] } },
      ],
      [
        bank
          ? `Bank: ${bank.bank_name}\nA/C Name: ${bank.account_holder}\nA/C No: ${bank.account_number}\nIFSC: ${bank.ifsc || '-'}  |  Branch: ${bank.branch || '-'}\nUPI ID: ${bank.upi_id || '-'}`
          : 'Bank details not configured.\nPlease transfer to authorized company account.',
        inv.terms || company.terms || "Goods booked at owner's risk. All disputes subject to Ahmedabad jurisdiction only.",
      ],
    ],
  });

  const footY = (doc as any).lastAutoTable.finalY || 240;

  // Signatory
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text(`This is a computer generated ${internal ? 'bill' : 'invoice'} and does not require physical signature.`, margin, footY + 12);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text(`For ${(company.name || 'SHREE SANWARIYA LOGISTICS').toUpperCase()}`, pageWidth - margin, footY + 5, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.text('Authorised Signatory', pageWidth - margin, footY + 16, { align: 'right' });

  downloadPdf(doc, invoiceFileName(inv));
}

export async function printReceiptPDF(payment: Payment, company: CompanySettings) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const logoWidth = 38;
  const logoTop = 12;
  const leftColWidth = pageWidth - margin * 2 - logoWidth - 5;

  const logoHeight = await drawLogo(doc, company, pageWidth - margin - logoWidth, logoTop, logoWidth);

  // Dynamic Header
  let curY = 16;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  const compNameLines = doc.splitTextToSize((company.name || 'SHREE SANWARIYA LOGISTICS').toUpperCase(), leftColWidth);
  doc.text(compNameLines, margin, curY);
  curY += compNameLines.length * 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  const addr = [company.address, company.city, company.state, company.pin].filter(Boolean).join(', ') || 'Ahmedabad, Gujarat';
  const addrLines = doc.splitTextToSize(addr, leftColWidth);
  doc.text(addrLines, margin, curY);
  curY += addrLines.length * 3.8;

  const contactText = `Ph: ${company.phone || '+91 98765 43210'}  |  Email: ${company.email || 'billing@shreesanwariya.com'}`;
  const contactLines = doc.splitTextToSize(contactText, leftColWidth);
  doc.text(contactLines, margin, curY);
  curY += contactLines.length * 3.8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  const taxIdLines = doc.splitTextToSize(`GSTIN: ${company.gstin || '24AABCS1429B1Z8'}  |  PAN: ${company.pan || 'AABCS1429B'}`, leftColWidth);
  doc.text(taxIdLines, margin, curY);
  curY += taxIdLines.length * 3.8;

  // Band
  const bandY = Math.max(curY + 2, logoTop + logoHeight + 3, 36);
  doc.setFillColor(15, 23, 42);
  doc.rect(margin, bandY, pageWidth - margin * 2, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text('PAYMENT RECEIPT', margin + 4, bandY + 4.5);
  doc.text(`Receipt Reference: ${payment.reference || payment.id.slice(0, 8).toUpperCase()}`, pageWidth - margin - 4, bandY + 4.5, { align: 'right' });

  // Receipt Content
  autoTable(doc, {
    startY: bandY + 8.5,
    margin: { left: margin, right: margin },
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 3, textColor: [15, 23, 42] },
    columnStyles: {
      0: { fontStyle: 'bold', fillColor: [248, 250, 252], cellWidth: 45 },
      1: { cellWidth: 137 },
    },
    body: [
      ['Received With Thanks From', payment.customer_name || 'Customer'],
      ['Payment Date', payment.payment_date || '-'],
      ['Payment Mode / Method', payment.method || 'Bank Transfer'],
      ['Transaction / UTR Reference', payment.reference || '-'],
      ['Against Invoice No.', payment.invoice_no || '-'],
      ['Invoice Total Amount', `Rs. ${formatINR(payment.invoice_total || 0)}`],
      ['Amount Received', `Rs. ${formatINR(payment.amount)} (${numberToWords(payment.amount)})`],
      ['Remaining Balance Due', `Rs. ${formatINR(payment.invoice_balance ?? 0)}`],
      ['Notes / Remarks', payment.notes || '-'],
    ],
  });

  const endY = (doc as any).lastAutoTable.finalY || 130;

  // Signatory
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Subject to realisation of cheque / instrument. This receipt is valid against the invoice mentioned above.', margin, endY + 12);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`For ${(company.name || 'SHREE SANWARIYA LOGISTICS').toUpperCase()}`, pageWidth - margin, endY + 10, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.text('Authorised Signatory', pageWidth - margin, endY + 22, { align: 'right' });

  downloadPdf(doc, safeFileName(`receipt_${payment.invoice_no || ''}_${payment.payment_date || ''}`, 'receipt'));
}

export async function printStatementPDF(
  customer: Customer, 
  ledger: any[], 
  summary: any, 
  company: CompanySettings, 
  periodLabel: string = 'All Time Statement',
  invoices: Invoice[] = [],
  bank?: BankAccount
) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const logoWidth = 38;
  const logoTop = 10;
  const leftColWidth = pageWidth - margin * 2 - logoWidth - 5;

  const logoHeight = await drawLogo(doc, company, pageWidth - margin - logoWidth, logoTop, logoWidth);

  // Dynamic Header
  let curY = 14;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  const compNameLines = doc.splitTextToSize((company.name || 'SHREE SANWARIYA LOGISTICS').toUpperCase(), leftColWidth);
  doc.text(compNameLines, margin, curY);
  curY += compNameLines.length * 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  const addr = [company.address, company.city, company.state, company.pin].filter(Boolean).join(', ') || 'Opp. Transport Nagar, Ring Road, Ahmedabad, Gujarat';
  const addrLines = doc.splitTextToSize(addr, leftColWidth);
  doc.text(addrLines, margin, curY);
  curY += addrLines.length * 3.8;

  const contactText = `GSTIN: ${company.gstin || '24AABCS1429B1Z8'}  |  Phone: ${company.phone || '+91 98765 43210'}  |  Email: ${company.email || 'billing@shreesanwariya.com'}`;
  const contactLines = doc.splitTextToSize(contactText, leftColWidth);
  doc.text(contactLines, margin, curY);
  curY += contactLines.length * 3.8;

  // Band
  const bandY = Math.max(curY + 2, logoTop + logoHeight + 3, 34);
  doc.setFillColor(15, 23, 42);
  doc.rect(margin, bandY, pageWidth - margin * 2, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text('MONTHLY OUTSTANDING STATEMENT & LEDGER', margin + 4, bandY + 4.5);
  doc.text(`Period: ${periodLabel}  |  Date: ${new Date().toISOString().slice(0, 10)}`, pageWidth - margin - 4, bandY + 4.5, { align: 'right' });

  // Customer Summary & Period Financial Metrics
  const openingBal = summary.opening_balance ?? 0;
  const periodInv = summary.period_invoiced ?? summary.revenue ?? 0;
  const periodRec = summary.period_received ?? summary.received ?? 0;
  const closingBal = summary.closing_balance ?? summary.outstanding ?? (openingBal + periodInv - periodRec);

  autoTable(doc, {
    startY: bandY + 8.5,
    margin: { left: margin, right: margin },
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 2.2, textColor: [15, 23, 42] },
    columnStyles: {
      0: { cellWidth: 95 },
      1: { fontStyle: 'bold', fillColor: [248, 250, 252], cellWidth: 46 },
      2: { halign: 'right', cellWidth: 45 },
    },
    body: [
      [
        `Customer / Consignee: ${customer.name}\n` +
        `Address: ${[customer.address, customer.city, customer.state, customer.pin].filter(Boolean).join(', ') || '-'}\n` +
        `GSTIN: ${customer.gstin || 'Unregistered'}   |   Phone: ${customer.phone || '-'}\n` +
        `Payment Terms: ${customer.payment_terms || 'Monthly / Net 15 Days'}`,
        `Opening Balance (B/F):\n` +
        `Period Invoiced Sales:\n` +
        `Period Payments Realised:\n` +
        `Net Closing Outstanding:`,
        `Rs. ${formatINR(openingBal)}\n` +
        `Rs. ${formatINR(periodInv)}\n` +
        `Rs. ${formatINR(periodRec)}\n` +
        `Rs. ${formatINR(closingBal)}`,
      ],
    ],
  });

  let nextY = (doc as any).lastAutoTable.finalY || 68;

  // Itemized Invoices Table if invoices exist
  if (invoices && invoices.length > 0) {
    nextY += 3;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(`Itemized Invoice Details for ${periodLabel} (${invoices.length} Invoices)`, margin, nextY + 3);

    const invRows = invoices.map(inv => [
      inv.invoice_date || '-',
      inv.invoice_no || '-',
      inv.lr_no ? `LR #${inv.lr_no}` : '-',
      (inv.origin && inv.destination) ? `${inv.origin} -> ${inv.destination}` : (inv.vehicle_no ? `Veh: ${inv.vehicle_no}` : '-'),
      formatINR(inv.taxable_amount || (inv.totals?.taxable_amount) || 0),
      formatINR(inv.gst_amount || (inv.totals?.gst_amount) || 0),
      formatINR(inv.grand_total || (inv.totals?.grand_total) || 0),
      formatINR(inv.paid ?? 0),
      formatINR(inv.balance ?? inv.grand_total ?? 0),
    ]);

    autoTable(doc, {
      startY: nextY + 4.5,
      margin: { left: margin, right: margin },
      theme: 'grid',
      headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
      styles: { fontSize: 7, cellPadding: 1.8, textColor: [15, 23, 42] },
      columnStyles: {
        0: { cellWidth: 18 },
        1: { cellWidth: 22, fontStyle: 'bold' },
        2: { cellWidth: 20 },
        3: { cellWidth: 38 },
        4: { cellWidth: 18, halign: 'right' },
        5: { cellWidth: 16, halign: 'right' },
        6: { cellWidth: 20, halign: 'right', fontStyle: 'bold' },
        7: { cellWidth: 16, halign: 'right' },
        8: { cellWidth: 18, halign: 'right', fontStyle: 'bold', textColor: [194, 65, 12] },
      },
      head: [['Date', 'Invoice No', 'LR No', 'Route / Vehicle', 'Taxable', 'GST', 'Total (Rs)', 'Paid', 'Balance (Rs)']],
      body: invRows,
    });

    nextY = (doc as any).lastAutoTable.finalY || nextY + 40;
  }

  // Running Statement Ledger Table
  nextY += 3;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text('Chronological Statement of Account / Running Ledger', margin, nextY + 3);

  const ledgerRows = ledger.map(item => [
    item.date || '-',
    item.particulars || '-',
    item.debit ? formatINR(item.debit) : '',
    item.credit ? formatINR(item.credit) : '',
    formatINR(item.balance),
  ]);

  autoTable(doc, {
    startY: nextY + 4.5,
    margin: { left: margin, right: margin },
    theme: 'grid',
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
    styles: { fontSize: 7.2, cellPadding: 2, textColor: [15, 23, 42] },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 84 },
      2: { cellWidth: 26, halign: 'right' },
      3: { cellWidth: 26, halign: 'right', textColor: [16, 149, 102] },
      4: { cellWidth: 28, halign: 'right', fontStyle: 'bold', textColor: [15, 23, 42] },
    },
    head: [['Date', 'Particulars & Reference', 'Debit (Invoice)', 'Credit (Receipt)', 'Balance (Rs)']],
    body: ledgerRows.length > 0 ? ledgerRows : [['-', 'No transactions found in this period', '', '', '0.00']],
  });

  const finalEndY = (doc as any).lastAutoTable.finalY || nextY + 40;

  // Remittance & Signatory Footer
  let footY = finalEndY + 4;
  if (footY + 28 > pageHeight) {
    doc.addPage();
    footY = margin;
  }

  // Bank Details Box
  if (bank && bank.account_number) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(15, 23, 42);
    doc.text('Payment Remittance Details (NEFT / RTGS / IMPS / UPI):', margin, footY);
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(71, 85, 105);
    const bankLine = `Bank: ${bank.bank_name}  |  A/C Holder: ${bank.account_holder}  |  A/C No: ${bank.account_number}  |  IFSC: ${bank.ifsc || '-'}${bank.upi_id ? `  |  UPI: ${bank.upi_id}` : ''}`;
    doc.text(bankLine, margin, footY + 4);
    footY += 7;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('Please verify all invoices and report any discrepancy within 7 days of receiving this statement.', margin, footY + 4);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text(`For ${(company.name || 'SHREE SANWARIYA LOGISTICS').toUpperCase()}`, pageWidth - margin, footY + 2, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text('Authorised Signatory', pageWidth - margin, footY + 12, { align: 'right' });

  downloadPdf(doc, safeFileName(`statement_${customer?.name || ''}`, 'statement'));
}
