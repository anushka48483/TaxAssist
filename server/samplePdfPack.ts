import zlib from 'node:zlib';

export interface SamplePdfDocumentSpec {
  fileName: string;
  title: string;
  subtitle: string;
  badgeText: string;
  pages: PdfPageBlock[][];
}

export type PdfPageBlock =
  | { type: 'section'; title: string }
  | { type: 'kv'; label: string; value: string }
  | { type: 'line'; text: string; bold?: boolean }
  | {
      type: 'table';
      headers: string[];
      colWidths: number[]; // sum <= 515
      rows: Array<{ cells: string[]; bold?: boolean; shaded?: boolean }>;
    }
  | { type: 'note'; text: string }
  | { type: 'spacer'; height?: number };

function escapePdfText(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, ' ');
}

function approxTextWidth(text: string, fontSize: number, bold = false): number {
  const avgRatio = bold ? 0.54 : 0.5;
  return text.length * fontSize * avgRatio;
}

function wrapText(text: string, maxWidth: number, fontSize: number, bold = false): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (approxTextWidth(candidate, fontSize, bold) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Generates a real, standards-compliant PDF 1.4 document using Helvetica / Helvetica-Bold
 * with crisp layout, tables, and statutory formatting that renders cleanly in viewers
 * and extracts accurately via PDF text parsers (unpdf).
 */
export function buildFormattedPdf(spec: SamplePdfDocumentSpec): Buffer {
  const pageWidth = 595.28; // A4 portrait width (pt)
  const pageHeight = 841.89; // A4 portrait height (pt)
  const marginX = 40;
  const contentWidth = pageWidth - marginX * 2; // ~515pt

  const contentStreams: string[] = [];

  spec.pages.forEach((blocks, pageIdx) => {
    const ops: string[] = [];
    const pageNum = pageIdx + 1;
    const totalPages = spec.pages.length;

    const drawText = (
      x: number,
      y: number,
      text: string,
      opts?: { font?: 'F1' | 'F2'; size?: number; rgb?: [number, number, number] }
    ) => {
      const font = opts?.font ?? 'F1';
      const size = opts?.size ?? 9.5;
      const [r, g, b] = opts?.rgb ?? [0.09, 0.17, 0.3]; // #172B4D
      ops.push(
        `BT /${font} ${size} Tf ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${escapePdfText(text)}) Tj ET`
      );
    };

    const drawRect = (
      x: number,
      y: number,
      w: number,
      h: number,
      opts?: { fillRgb?: [number, number, number]; strokeRgb?: [number, number, number]; lineWidth?: number }
    ) => {
      if (opts?.fillRgb && opts?.strokeRgb) {
        ops.push(
          `${opts.lineWidth ?? 0.6} w ${opts.fillRgb.map((v) => v.toFixed(3)).join(' ')} rg ${opts.strokeRgb.map((v) => v.toFixed(3)).join(' ')} RG ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re B`
        );
      } else if (opts?.fillRgb) {
        ops.push(
          `${opts.fillRgb.map((v) => v.toFixed(3)).join(' ')} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`
        );
      } else if (opts?.strokeRgb) {
        ops.push(
          `${opts.lineWidth ?? 0.6} w ${opts.strokeRgb.map((v) => v.toFixed(3)).join(' ')} RG ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`
        );
      }
    };

    const drawLine = (x1: number, y1: number, x2: number, y2: number, rgb: [number, number, number] = [0.886, 0.91, 0.941]) => {
      ops.push(`0.6 w ${rgb.map((v) => v.toFixed(3)).join(' ')} RG ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
    };

    // Top Header Banner
    drawRect(marginX, pageHeight - 94, contentWidth, 56, {
      fillRgb: [0.973, 0.98, 0.988], // #F8FAFC
      strokeRgb: [0.886, 0.91, 0.941], // #E2E8F0
    });
    drawRect(marginX, pageHeight - 41, contentWidth, 3, {
      fillRgb: [0.145, 0.388, 0.922], // #2563EB
    });

    drawText(marginX + 12, pageHeight - 58, spec.title, {
      font: 'F2',
      size: 12,
      rgb: [0.09, 0.17, 0.3],
    });
    drawText(marginX + 12, pageHeight - 75, spec.subtitle, {
      font: 'F1',
      size: 8.5,
      rgb: [0.39, 0.45, 0.55],
    });
    const badgeWidth = approxTextWidth(spec.badgeText, 8, true) + 14;
    drawRect(pageWidth - marginX - badgeWidth - 10, pageHeight - 67, badgeWidth, 16, {
      fillRgb: [0.937, 0.965, 1.0],
      strokeRgb: [0.749, 0.859, 0.996],
    });
    drawText(pageWidth - marginX - badgeWidth - 3, pageHeight - 62, spec.badgeText, {
      font: 'F2',
      size: 8,
      rgb: [0.145, 0.388, 0.922],
    });

    let cursorY = pageHeight - 114;

    for (const block of blocks) {
      if (block.type === 'spacer') {
        cursorY -= block.height ?? 10;
        continue;
      }

      if (block.type === 'section') {
        cursorY -= 6;
        drawRect(marginX, cursorY - 5, contentWidth, 20, {
          fillRgb: [0.945, 0.961, 0.976],
          strokeRgb: [0.886, 0.91, 0.941],
        });
        drawText(marginX + 8, cursorY + 2, block.title, {
          font: 'F2',
          size: 9.5,
          rgb: [0.09, 0.17, 0.3],
        });
        cursorY -= 22;
        continue;
      }

      if (block.type === 'kv') {
        const lineText = `${block.label}: ${block.value}`;
        const wrapped = wrapText(lineText, contentWidth - 16, 9, false);
        for (const wline of wrapped) {
          drawText(marginX + 8, cursorY, wline, { font: 'F1', size: 9, rgb: [0.09, 0.17, 0.3] });
          cursorY -= 13.5;
        }
        continue;
      }

      if (block.type === 'line') {
        const wrapped = wrapText(block.text, contentWidth - 16, 9, block.bold);
        for (const wline of wrapped) {
          drawText(marginX + 8, cursorY, wline, {
            font: block.bold ? 'F2' : 'F1',
            size: 9,
            rgb: [0.09, 0.17, 0.3],
          });
          cursorY -= 13.5;
        }
        continue;
      }

      if (block.type === 'table') {
        const rowHeight = 20;
        // Header row
        drawRect(marginX, cursorY - rowHeight + 5, contentWidth, rowHeight, {
          fillRgb: [0.973, 0.98, 0.988],
          strokeRgb: [0.82, 0.85, 0.9],
        });
        let cx = marginX;
        block.headers.forEach((h, i) => {
          const w = block.colWidths[i];
          const isNumericCol = i === block.headers.length - 1;
          const tx = isNumericCol
            ? cx + w - 8 - approxTextWidth(h, 8.5, true)
            : cx + 8;
          drawText(Math.max(cx + 6, tx), cursorY - 9, h, {
            font: 'F2',
            size: 8.5,
            rgb: [0.39, 0.45, 0.55],
          });
          cx += w;
        });
        cursorY -= rowHeight;

        for (const r of block.rows) {
          drawRect(marginX, cursorY - rowHeight + 5, contentWidth, rowHeight, {
            fillRgb: r.shaded ? [0.96, 0.976, 0.996] : [1, 1, 1],
            strokeRgb: [0.886, 0.91, 0.941],
          });
          let rx = marginX;
          r.cells.forEach((cell, i) => {
            const w = block.colWidths[i];
            const isNumericCol = i === r.cells.length - 1;
            const font: 'F1' | 'F2' = r.bold ? 'F2' : 'F1';
            const tx = isNumericCol
              ? rx + w - 8 - approxTextWidth(cell, 8.5, r.bold)
              : rx + 8;
            drawText(Math.max(rx + 6, tx), cursorY - 9, cell, {
              font,
              size: 8.5,
              rgb: [0.09, 0.17, 0.3],
            });
            rx += w;
          });
          cursorY -= rowHeight;
        }
        cursorY -= 8;
        continue;
      }

      if (block.type === 'note') {
        const wrapped = wrapText(block.text, contentWidth - 18, 8.5, false);
        const boxHeight = wrapped.length * 12 + 12;
        drawRect(marginX, cursorY - boxHeight + 10, contentWidth, boxHeight, {
          fillRgb: [0.985, 0.99, 0.995],
          strokeRgb: [0.886, 0.91, 0.941],
        });
        for (const wline of wrapped) {
          drawText(marginX + 9, cursorY - 2, wline, {
            font: 'F1',
            size: 8.5,
            rgb: [0.39, 0.45, 0.55],
          });
          cursorY -= 12;
        }
        cursorY -= 12;
      }
    }

    // Page Footer
    drawLine(marginX, 46, pageWidth - marginX, 46);
    drawText(
      marginX,
      32,
      'SAMPLE TEST DOCUMENT (DUMMY DATA FOR TAXSHIELD VERIFICATION — NOT A GOVERNMENT FILING)',
      { font: 'F1', size: 7.5, rgb: [0.45, 0.52, 0.62] }
    );
    drawText(
      pageWidth - marginX - 50,
      32,
      `Page ${pageNum} of ${totalPages}`,
      { font: 'F1', size: 7.5, rgb: [0.45, 0.52, 0.62] }
    );

    contentStreams.push(ops.join('\n'));
  });

  // Assemble PDF Object Graph
  // 1: Catalog, 2: Pages, 3: Helvetica (F1), 4: Helvetica-Bold (F2), then per-page [Page, Content]
  const objects: string[] = [];
  const pageObjNums: number[] = [];

  // Placeholder slots 1..4
  objects.push(''); // 1
  objects.push(''); // 2
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'); // 3
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'); // 4

  contentStreams.forEach((streamText) => {
    const streamBuf = Buffer.from(streamText, 'latin1');
    const pageObjNum = objects.length + 1;
    const contentObjNum = objects.length + 2;
    pageObjNums.push(pageObjNum);

    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjNum} 0 R >>`
    );
    objects.push(
      `<< /Length ${streamBuf.length} >>\nstream\n${streamText}\nendstream`
    );
  });

  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageObjNums.length} >>`;

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets: number[] = [0];
  let bytePos = chunks[0].length;

  objects.forEach((body, idx) => {
    const objHeader = Buffer.from(`${idx + 1} 0 obj\n`, 'latin1');
    const objBody = Buffer.from(`${body}\nendobj\n`, 'latin1');
    offsets.push(bytePos);
    chunks.push(objHeader, objBody);
    bytePos += objHeader.length + objBody.length;
  });

  const xrefStart = bytePos;
  const xrefLines = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`];
  for (let i = 1; i <= objects.length; i++) {
    xrefLines.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  chunks.push(Buffer.from(xrefLines.join('') + trailer, 'latin1'));

  return Buffer.concat(chunks);
}

// Cohesive fictional taxpayer profile for realistic upload testing
const SAMPLE_SPECS: SamplePdfDocumentSpec[] = [
  {
    fileName: '01_Form16_AY2026_27.pdf',
    title: 'FORM NO. 16 [See rule 31(1)(a)]',
    subtitle: 'Certificate u/s 203 of the Income-tax Act, 1961 for Tax Deducted at Source on Salary',
    badgeText: 'AY 2026-27',
    pages: [
      [
        { type: 'section', title: 'PART A — Employer & Employee Details' },
        { type: 'kv', label: 'Certificate No', value: 'TRACES-F16-2026-90418' },
        {
          type: 'kv',
          label: 'Name and Address of Employer',
          value: 'NEXUS CLOUD TECHNOLOGIES PVT LTD, Outer Ring Road, Bengaluru 560103',
        },
        { type: 'kv', label: 'TAN of Deductor', value: 'BLRN04821D' },
        { type: 'kv', label: 'Employee Name', value: 'Aarav Mehta' },
        { type: 'kv', label: 'PAN of Employee', value: 'ABCDE1234F' },
        { type: 'kv', label: 'Date of Birth', value: '1993-08-14' },
        { type: 'kv', label: 'Aadhaar Number', value: 'XXXX-XXXX-4821' },
        { type: 'kv', label: 'Mobile', value: '+91 98204 51120' },
        { type: 'kv', label: 'Email', value: 'aarav.mehta.sample@example.in' },
        {
          type: 'kv',
          label: 'Residential Address',
          value: 'Flat 402, Sapphire Heights, Indiranagar, Bengaluru 560038',
        },
        { type: 'kv', label: 'Assessment Year', value: '2026-27 (FY 2025-26)' },
        { type: 'spacer', height: 8 },
        { type: 'section', title: 'Summary of Tax Deducted & Deposited (Quarterly TDS)' },
        {
          type: 'table',
          headers: ['Quarter', 'Receipt Number', 'Amount Paid / Credited', 'Tax Deducted & Deposited'],
          colWidths: [110, 145, 130, 130],
          rows: [
            { cells: ['Q1 (Apr - Jun 2025)', 'TDSQ1884210', 'Rs. 3,55,000', 'Rs. 18,000'] },
            { cells: ['Q2 (Jul - Sep 2025)', 'TDSQ2884912', 'Rs. 3,55,000', 'Rs. 18,000'] },
            { cells: ['Q3 (Oct - Dec 2025)', 'TDSQ3885304', 'Rs. 3,55,000', 'Rs. 18,000'] },
            { cells: ['Q4 (Jan - Mar 2026)', 'TDSQ4886190', 'Rs. 3,85,000', 'Rs. 21,000'] },
            {
              cells: ['Total TDS', 'Verified Q1-Q4', 'Rs. 14,50,000', 'Rs. 75,000'],
              bold: true,
              shaded: true,
            },
          ],
        },
        {
          type: 'kv',
          label: 'Total Tax Deducted (TDS on Salary u/s 192)',
          value: 'Rs. 75,000',
        },
      ],
      [
        { type: 'section', title: 'PART B (Annexure) — Details of Salary Paid and Tax Deducted' },
        {
          type: 'table',
          headers: ['Particulars', 'Section', 'Amount (INR)'],
          colWidths: [285, 100, 130],
          rows: [
            { cells: ['Basic Salary', 'u/s 17(1)', 'Rs. 7,20,000'] },
            { cells: ['House Rent Allowance (HRA Received)', 'u/s 17(1)', 'Rs. 2,88,000'] },
            { cells: ['Special & Conveyance Allowances', 'u/s 17(1)', 'Rs. 4,42,000'] },
            {
              cells: ['Total Gross Salary u/s 17(1)', 'Schedule S', 'Rs. 14,50,000'],
              bold: true,
              shaded: true,
            },
            { cells: ['Exempt HRA Allowance', 'u/s 10(13A)', 'Rs. 0'] },
            { cells: ['Standard Deduction', 'u/s 16(ia)', 'Rs. 75,000'] },
            { cells: ['Professional Tax', 'u/s 16(iii)', 'Rs. 2,400'] },
          ],
        },
        { type: 'kv', label: 'Basic Salary', value: 'Rs. 7,20,000' },
        { type: 'kv', label: 'HRA Received', value: 'Rs. 2,88,000' },
        { type: 'kv', label: 'Total Gross Salary u/s 17(1)', value: 'Rs. 14,50,000' },
        { type: 'kv', label: 'Professional Tax u/s 16(iii)', value: 'Rs. 2,400' },
        { type: 'spacer', height: 6 },
        { type: 'section', title: 'Chapter VI-A Deductions Declared to Employer Payroll' },
        {
          type: 'kv',
          label: 'Section 80C Declared in Form 16',
          value: 'Rs. 0 (Investment proofs not submitted before payroll cutoff)',
        },
        { type: 'kv', label: 'Section 80D Declared in Form 16', value: 'Rs. 0' },
        {
          type: 'note',
          text: 'Note: Employees who complete tax-saving investments after the payroll cutoff can claim verified Section 80C, 80D, and 80CCD(1B) proofs directly while filing ITR-1 under Old Regime comparison.',
        },
      ],
    ],
  },
  {
    fileName: '02_HDFC_Savings_Bank_Statement_FY2025_26.pdf',
    title: 'HDFC BANK LTD — ANNUAL SAVINGS ACCOUNT STATEMENT',
    subtitle: 'Statement Period: 01-Apr-2025 to 31-Mar-2026 | Financial Year 2025-26',
    badgeText: 'SAVINGS ACCOUNT',
    pages: [
      [
        { type: 'section', title: 'Account Holder & Branch Details' },
        { type: 'kv', label: 'Account Holder', value: 'Aarav Mehta' },
        { type: 'kv', label: 'PAN', value: 'ABCDE1234F' },
        { type: 'kv', label: 'Bank Name', value: 'HDFC Bank' },
        { type: 'kv', label: 'Account Number', value: '50100482917344' },
        { type: 'kv', label: 'IFSC Code', value: 'HDFC0001204' },
        { type: 'kv', label: 'Branch', value: 'Indiranagar 100ft Road, Bengaluru' },
        { type: 'spacer', height: 8 },
        { type: 'section', title: 'Quarterly Savings Interest Credits (FY 2025-26)' },
        {
          type: 'table',
          headers: ['Posting Date', 'Narration', 'Reference No', 'Credit Amount (INR)'],
          colWidths: [100, 195, 100, 120],
          rows: [
            { cells: ['30-Jun-2025', 'Q1 Savings Interest Capitalised', 'INT2506001', 'Rs. 2,010'] },
            { cells: ['30-Sep-2025', 'Q2 Savings Interest Capitalised', 'INT2509042', 'Rs. 2,120'] },
            { cells: ['31-Dec-2025', 'Q3 Savings Interest Capitalised', 'INT2512089', 'Rs. 2,140'] },
            { cells: ['31-Mar-2026', 'Q4 Savings Interest Capitalised', 'INT2603115', 'Rs. 2,180'] },
            {
              cells: ['Total', 'Total Savings Bank Interest FY 2025-26', 'All Quarters', 'Rs. 8,450'],
              bold: true,
              shaded: true,
            },
          ],
        },
        {
          type: 'kv',
          label: 'Total Savings Bank Interest Credited in FY 2025-26',
          value: 'Rs. 8,450',
        },
        { type: 'kv', label: 'Fixed Deposit Interest Credited in Savings Passbook', value: 'Rs. 0' },
        { type: 'kv', label: 'TDS Deducted by Bank u/s 194A', value: 'Rs. 0' },
        {
          type: 'note',
          text: 'Savings bank account interest is eligible for deduction up to Rs. 10,000 under Section 80TTA (Old Tax Regime). Term/Fixed Deposit interest is issued separately.',
        },
      ],
    ],
  },
  {
    fileName: '03_HDFC_Fixed_Deposit_Interest_Certificate_FY2025_26.pdf',
    title: 'HDFC BANK LTD — TERM / FIXED DEPOSIT INTEREST CERTIFICATE',
    subtitle: 'Interest Paid & Accrued Statement for Financial Year 2025-26 (AY 2026-27)',
    badgeText: 'FD CERTIFICATE',
    pages: [
      [
        { type: 'section', title: 'Depositor Details' },
        { type: 'kv', label: 'Depositor Name', value: 'Aarav Mehta' },
        { type: 'kv', label: 'PAN', value: 'ABCDE1234F' },
        { type: 'kv', label: 'Bank Name', value: 'HDFC Bank' },
        { type: 'kv', label: 'IFSC Code', value: 'HDFC0001204' },
        { type: 'kv', label: 'FD Receipt Number', value: 'FD-77492018-BLR' },
        { type: 'spacer', height: 8 },
        { type: 'section', title: 'Fixed Deposit Interest Accrual Summary' },
        {
          type: 'table',
          headers: ['Deposit ID', 'Principal (INR)', 'Rate p.a.', 'Interest Accrued (INR)'],
          colWidths: [145, 130, 90, 150],
          rows: [
            { cells: ['FD-77492018-A', 'Rs. 3,00,000', '7.20%', 'Rs. 21,600'] },
            { cells: ['FD-77492018-B', 'Rs. 1,50,000', '7.20%', 'Rs. 10,800'] },
            {
              cells: ['Total FD Interest', 'Rs. 4,50,000', '7.20%', 'Rs. 32,400'],
              bold: true,
              shaded: true,
            },
          ],
        },
        {
          type: 'kv',
          label: 'Fixed Deposit Interest Accrued & Credited in FY 2025-26',
          value: 'Rs. 32,400',
        },
        {
          type: 'kv',
          label: 'TDS Deducted by Bank u/s 194A',
          value: 'Rs. 0 (Below Rs. 50,000 threshold)',
        },
        {
          type: 'note',
          text: 'Fixed Deposit interest is taxable under Income from Other Sources in both New and Old regimes and is NOT eligible for Section 80TTA savings interest deduction.',
        },
      ],
    ],
  },
  {
    fileName: '04_Investment_and_Health_Insurance_Proofs_FY2025_26.pdf',
    title: 'CONSOLIDATED TAX-SAVING INVESTMENT & INSURANCE PROOFS',
    subtitle: 'Verified Payments Made During FY 2025-26 (Assessment Year 2026-27)',
    badgeText: '80C / 80D / NPS',
    pages: [
      [
        { type: 'section', title: 'Investor & Policyholder Details' },
        { type: 'kv', label: 'Investor Name', value: 'Aarav Mehta' },
        { type: 'kv', label: 'PAN', value: 'ABCDE1234F' },
        { type: 'kv', label: 'Financial Year', value: '2025-26 (AY 2026-27)' },
        { type: 'spacer', height: 8 },
        { type: 'section', title: 'Schedule of Verified Investment & Premium Receipts' },
        {
          type: 'table',
          headers: ['Instrument / Policy', 'Section', 'Receipt / Ref No', 'Amount Paid (INR)'],
          colWidths: [195, 90, 110, 120],
          rows: [
            { cells: ['Public Provident Fund (PPF)', 'Section 80C', 'PPF-2026-0118', 'Rs. 60,000'] },
            { cells: ['Mirae ELSS Tax Saver Fund', 'Section 80C', 'ELSS-884210', 'Rs. 90,000'] },
            {
              cells: ['Total Eligible Section 80C', 'u/s 80C', 'Cap Rs. 1,50,000', 'Rs. 1,50,000'],
              bold: true,
              shaded: true,
            },
            { cells: ['NPS Tier-I Self Contribution', 'u/s 80CCD(1B)', 'PRAN-11048291', 'Rs. 50,000'] },
            { cells: ['Star Comprehensive Health Policy', 'Section 80D', 'HLTH-5520194', 'Rs. 24,500'] },
          ],
        },
        {
          type: 'kv',
          label: 'Total Eligible Section 80C Investments Paid in FY 2025-26',
          value: 'Rs. 1,50,000',
        },
        {
          type: 'kv',
          label: 'Additional NPS Contribution u/s 80CCD(1B)',
          value: 'Rs. 50,000',
        },
        {
          type: 'kv',
          label: 'Section 80D Health Insurance Proofs Attached',
          value: 'Rs. 24,500',
        },
        {
          type: 'note',
          text: 'All contributions above were paid via banking channels between 01-Apr-2025 and 31-Mar-2026. Section 80C, 80D, and 80CCD(1B) deductions apply under the Old Tax Regime.',
        },
      ],
    ],
  },
  {
    fileName: '05_Form26AS_Annual_Tax_Statement_AY2026_27.pdf',
    title: 'FORM 26AS — ANNUAL TAX STATEMENT u/s 203AA',
    subtitle: 'Summary of Tax Deducted at Source (TDS) Credited to PAN for AY 2026-27',
    badgeText: 'FORM 26AS',
    pages: [
      [
        { type: 'section', title: 'Taxpayer Identification' },
        { type: 'kv', label: 'Name of Assessee', value: 'Aarav Mehta' },
        { type: 'kv', label: 'PAN', value: 'ABCDE1234F' },
        { type: 'kv', label: 'Assessment Year', value: '2026-27 (FY 2025-26)' },
        { type: 'spacer', height: 8 },
        { type: 'section', title: 'PART A — Details of Tax Deducted at Source (TDS)' },
        {
          type: 'table',
          headers: ['Deductor Name', 'TAN', 'Amount Credited', 'TDS Deposited (INR)'],
          colWidths: [195, 95, 115, 110],
          rows: [
            {
              cells: ['NEXUS CLOUD TECHNOLOGIES PVT LTD', 'BLRN04821D', 'Rs. 14,50,000', 'Rs. 75,000'],
            },
            {
              cells: ['Total TDS Credited in Form 26AS', 'All Deductors', 'Rs. 14,50,000', 'Rs. 75,000'],
              bold: true,
              shaded: true,
            },
          ],
        },
        {
          type: 'kv',
          label: 'Total TDS Credited in 26AS',
          value: 'Rs. 75,000',
        },
        {
          type: 'note',
          text: 'TDS reported in Form 26AS reconciles directly with Form 16 Part A (Rs. 75,000). Bank FD interest TDS u/s 194A is Rs. 0 as interest accrued is below statutory TDS deduction threshold.',
        },
      ],
    ],
  },
];

// Standard CRC-32 lookup table for PKZIP creation
const CRC32_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[n] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZipArchive(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const fileNameBuf = Buffer.from(entry.name, 'utf-8');
    const uncompressed = entry.data;
    const compressed = zlib.deflateRawSync(uncompressed, { level: 6 });
    const crc = crc32(uncompressed);

    // Local File Header (30 bytes + filename)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // local file header signature
    localHeader.writeUInt16LE(20, 4); // version needed to extract (2.0)
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(8, 8); // compression method: 8 = deflate
    localHeader.writeUInt16LE(0x5421, 10); // mod time
    localHeader.writeUInt16LE(0x5b74, 12); // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(uncompressed.length, 22);
    localHeader.writeUInt16LE(fileNameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length

    localParts.push(localHeader, fileNameBuf, compressed);

    // Central Directory Header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // central dir signature
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 filename flag
    centralHeader.writeUInt16LE(8, 10); // deflate
    centralHeader.writeUInt16LE(0x5421, 12);
    centralHeader.writeUInt16LE(0x5b74, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(uncompressed.length, 24);
    centralHeader.writeUInt16LE(fileNameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42); // relative offset of local header

    centralParts.push(centralHeader, fileNameBuf);
    offset += localHeader.length + fileNameBuf.length + compressed.length;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk where central dir starts
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

export function generateSamplePdfFiles(): Array<{ fileName: string; buffer: Buffer }> {
  return SAMPLE_SPECS.map((spec) => ({
    fileName: spec.fileName,
    buffer: buildFormattedPdf(spec),
  }));
}

export function buildSampleDocumentsZip(): Buffer {
  const files = generateSamplePdfFiles();
  return createZipArchive(
    files.map((f) => ({
      name: `TaxShield_Sample_Documents_AY2026_27/${f.fileName}`,
      data: f.buffer,
    }))
  );
}
