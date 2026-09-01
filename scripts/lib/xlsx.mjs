/**
 * A read-only xlsx reader, in Node, with no dependencies.
 *
 * The canonical vocabulary arrives as a workbook, and the reconciliation gate
 * that stands between it and the library has to be re-runnable — a gate you
 * can only pass by hand-converting a file somewhere else is not a gate. So the
 * ~60 lines of ZIP and SharedStrings handling live here rather than in a
 * one-off conversion nobody can repeat.
 *
 * Deliberately minimal: values as text, no formulas, no dates, no styles. A
 * review sheet is a grid of words, and anything cleverer would be inventing
 * meaning the reviewer did not write.
 *
 * Every tag pattern tolerates a namespace prefix. Excel writes bare `<sheet>`;
 * the .NET and Google exporters write `<x:sheet>` on the same schema, and a
 * reader that only matches one of the two silently finds a workbook with no
 * sheets in it rather than failing.
 */
/** Matches an element name with or without a namespace prefix. */
const T = (name) => `(?:[A-Za-z0-9]+:)?${name}`;
import { inflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

/** Entries of a ZIP archive, by name. Reads the central directory, not a scan. */
function unzip(buf) {
  // End of central directory: fixed signature, then the offset of the first
  // central-directory record. Searched backwards because it sits at the end
  // behind a variable-length comment.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    // The local header repeats the name and extra fields at its own lengths,
    // which are NOT always the central directory's — reusing those is the
    // classic way to read a file offset by a few bytes.
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compressedSize);

    out.set(name, method === 0 ? raw : inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const textOf = (xml) => xml.replace(/<[^>]+>/g, '');

/** Decodes the five XML entities that appear in spreadsheet text. */
function decode(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

const colIndex = (ref) => {
  let n = 0;
  for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** Every sheet in the workbook, as arrays of raw cell rows keyed by column. */
export function readWorkbook(path) {
  const zip = unzip(readFileSync(path));
  const get = (name) => {
    const b = zip.get(name);
    if (!b) throw new Error(`missing ${name} in workbook`);
    return b.toString('utf8');
  };

  const shared = [];
  if (zip.has('xl/sharedStrings.xml')) {
    const siRe = new RegExp(`<${T('si')}>([\\s\\S]*?)</${T('si')}>`, 'g');
    for (const m of get('xl/sharedStrings.xml').matchAll(siRe)) {
      shared.push(decode(textOf(m[1])));
    }
  }

  // Attributes are matched independently rather than in one pattern: exporters
  // disagree about their order — this workbook writes Target before Id — and a
  // fixed-order regex quietly yields a relationship map with nothing in it.
  const rels = new Map();
  for (const m of get('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = m[1].match(/\bId="([^"]+)"/)?.[1];
    const target = m[1].match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) rels.set(id, target);
  }

  const sheets = [];
  const sheetRe = new RegExp(`<${T('sheet')}[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"`, 'g');
  for (const m of get('xl/workbook.xml').matchAll(sheetRe)) {
    let target = (rels.get(m[2]) ?? '').replace(/^\/+/, '');
    if (!target.startsWith('xl/')) target = `xl/${target}`;
    sheets.push([decode(m[1]), target]);
  }

  const out = new Map();
  for (const [name, target] of sheets) {
    const rows = [];
    const rowRe = new RegExp(`<${T('row')}[^>]*>([\\s\\S]*?)</${T('row')}>`, 'g');
    const cellRe = new RegExp(`<${T('c')} r="([A-Z]+\\d+)"([^>]*)>([\\s\\S]*?)</${T('c')}>`, 'g');
    const vRe = new RegExp(`<${T('v')}>([\\s\\S]*?)</${T('v')}>`);
    const isRe = new RegExp(`<${T('is')}>([\\s\\S]*?)</${T('is')}>`);
    for (const r of get(target).matchAll(rowRe)) {
      const cells = new Map();
      for (const c of r[1].matchAll(cellRe)) {
        const [, ref, attrs, body] = c;
        const isShared = /t="s"/.test(attrs);
        const v = body.match(vRe);
        const inline = body.match(isRe);
        const value = isShared && v ? (shared[Number(v[1])] ?? '')
          : inline ? decode(textOf(inline[1]))
          : v ? decode(textOf(v[1]))
          : '';
        cells.set(colIndex(ref), value.trim());
      }
      rows.push(cells);
    }
    out.set(name, rows);
  }
  return out;
}

/**
 * A sheet as objects keyed by its own header row.
 *
 * The header is the first row carrying two or more values, so a title or a
 * blank line above the table does not become the column names.
 */
export function asTable(rows) {
  const headerAt = rows.findIndex(r => [...r.values()].filter(Boolean).length >= 2);
  if (headerAt < 0) return [];
  const header = rows[headerAt];
  const cols = [...header.keys()].sort((a, b) => a - b);

  const out = [];
  for (const row of rows.slice(headerAt + 1)) {
    if (![...row.values()].some(Boolean)) continue;
    const rec = {};
    for (const c of cols) rec[header.get(c)] = row.get(c) ?? '';
    out.push(rec);
  }
  return out;
}
