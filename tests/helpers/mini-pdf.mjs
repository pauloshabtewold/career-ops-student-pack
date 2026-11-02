// Minimal synthetic PDF writer for tests: Helvetica text lines per page, WinAnsi encoding, valid xref table.
// A page given as null or [] has no text layer (an image-only page). A line given as an array of strings is one TJ
// array of separate chunks with no space between them, the way a renderer that positions each word glues them.
const WIN_ANSI = new Map([['\u2013', 0x96], ['\u2014', 0x97]]);

function pdfString(s) {
  let out = '';
  for (const ch of s) {
    const code = WIN_ANSI.get(ch) ?? ch.charCodeAt(0);
    if (ch === '(' || ch === ')' || ch === '\\') out += `\\${ch}`;
    else if (code < 0x20 || code > 0x7e) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += ch;
  }
  return `(${out})`;
}

export function makePdf(pages) {
  const objs = [];
  const n = pages.length;
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${n} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  pages.forEach((lines, i) => {
    const pageId = 4 + i * 2;
    const body = (lines ?? []).length
      ? `BT /F1 12 Tf 14 TL 50 740 Td ${lines.map((l) => (Array.isArray(l) ? `[${l.map(pdfString).join(' ')}] TJ T*` : `${pdfString(l)} Tj T*`)).join(' ')} ET`
      : '0.5 g 50 50 200 100 re f';
    objs[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objs[pageId + 1] = `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
  });
  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let id = 1; id < objs.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objs[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objs.length; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
