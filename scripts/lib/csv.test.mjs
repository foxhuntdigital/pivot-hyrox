import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCsv, readCsv, writeCsv, csvField } from './csv.mjs';

test('a quoted field keeps its commas', () => {
  assert.deepEqual(parseCsv('a,"b,c",d\n'), [['a', 'b,c', 'd']]);
});

test('a doubled quote is a literal quote, not a terminator', () => {
  // `1-Arm DB Row ("single-arm")` is the kind of note that ends up in this file.
  assert.deepEqual(parseCsv('x,"he said ""no"", firmly",y\n'),
    [['x', 'he said "no", firmly', 'y']]);
});

test('a quoted field may contain newlines', () => {
  assert.deepEqual(parseCsv('a,"line one\nline two"\n'), [['a', 'line one\nline two']]);
});

test('CRLF from a spreadsheet export is not part of the value', () => {
  assert.deepEqual(parseCsv('a,b\r\nc,d\r\n'), [['a', 'b'], ['c', 'd']]);
});

test('a BOM does not become part of the first header name', () => {
  // Excel writes one. Without this the first column stops matching by name and
  // every ruling in it reads as blank.
  const rows = readCsv('﻿ruling,id\nEXACT_EXISTING,ex_a\n');
  assert.equal(rows[0].ruling, 'EXACT_EXISTING');
  assert.equal(Object.keys(rows[0])[0], 'ruling');
});

test('rows shorter than the header read as empty, not as undefined', () => {
  // Spreadsheets drop trailing empty cells on export.
  const rows = readCsv('a,b,c\n1,2\n');
  assert.deepEqual(rows[0], { a: '1', b: '2', c: '' });
});

test('a trailing newline is not a record', () => {
  assert.equal(readCsv('a,b\n1,2\n').length, 1);
});

test('non-ASCII survives intact', () => {
  // The ladder chains are written with arrows.
  const chain = 'assisted_pistol → box_target_pistol → pistol_squat';
  assert.equal(readCsv(`a\n${chain}\n`)[0].a, chain);
});

test('fields are quoted only when they need to be', () => {
  assert.equal(csvField('plain'), 'plain');
  assert.equal(csvField('has,comma'), '"has,comma"');
  assert.equal(csvField('has"quote'), '"has""quote"');
  assert.equal(csvField(null), '');
});

test('write then read returns what went in', () => {
  const records = [
    { ruling: 'VARIANT_OF_EXISTING', note: 'a, with comma', chain: 'x → y' },
    { ruling: 'NEW_CANONICAL', note: 'he said "no"', chain: '' },
  ];
  const cols = ['ruling', 'note', 'chain'];
  assert.deepEqual(readCsv(writeCsv(cols, records)), records);
});
