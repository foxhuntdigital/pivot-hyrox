/**
 * RFC 4180 CSV, read and written, with no dependencies.
 *
 * The reconciliation files round-trip through a spreadsheet and back, and the
 * fields they carry are exactly the ones a naive `split(',')` destroys: notes
 * containing commas, names containing quotes, and ladder chains containing
 * arrows and other non-ASCII. A parser that is nearly right here corrupts
 * canonical identity decisions silently, which is the failure this whole gate
 * exists to prevent.
 *
 * Deliberately strict about one thing and lenient about another. Strict: a
 * quoted field ends only at a quote that is not doubled, so `""` inside quotes
 * is a literal quote and never a terminator. Lenient: rows may have fewer
 * cells than the header, because spreadsheets drop trailing empties on export.
 */

/** Rows of raw cells. Handles quoted fields, embedded commas, newlines, CRLF. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false, i = 0;

  // A BOM survives a spreadsheet round-trip and would otherwise become part of
  // the first header name, so the first column silently stops matching.
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  for (; i < text.length; i++) {
    const ch = text[i];

    if (quoted) {
      if (ch !== '"') { field += ch; continue; }
      if (text[i + 1] === '"') { field += '"'; i++; continue; }
      quoted = false;
      continue;
    }

    if (ch === '"' && field === '') { quoted = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  // A trailing newline produces one empty row, which is not a record.
  return rows.filter(r => r.length > 1 || (r[0] ?? '') !== '');
}

/** Records keyed by the header row, trimmed. */
export function readCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => {
    const rec = {};
    header.forEach((h, i) => { rec[h] = (r[i] ?? '').trim(); });
    return rec;
  });
}

/** One field, quoted only when it has to be — smaller diffs, same meaning. */
export function csvField(v) {
  const s = String(Array.isArray(v) ? v.join('; ') : (v ?? ''));
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function writeCsv(columns, records) {
  return [columns.join(','), ...records.map(r => columns.map(c => csvField(r[c])).join(','))]
    .join('\n') + '\n';
}
