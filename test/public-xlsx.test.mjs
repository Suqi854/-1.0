import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { parsePublicXlsx, PUBLIC_XLSX_LIMITS } from '../src/public-xlsx.mjs';

// Generated fixtures only. No fetched exchange data, package dependency,
// network call, provider credential, or authentic XLSX is needed by the tests.
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const mainType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
const sheetType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
const stringsType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(parts, options = {}) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, text] of parts) {
    const override = options.entries?.[name] ?? {};
    const nameBytes = Buffer.from(name);
    const raw = Buffer.isBuffer(text) ? text : Buffer.from(text);
    const method = override.method ?? options.method ?? 8;
    const compressed = override.compressed ?? (method === 0 ? raw : deflateRawSync(raw));
    const flags = override.flags ?? (options.descriptor ? 0x808 : 0x800);
    const crc = override.crc ?? crc32(raw), size = override.size ?? raw.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8);
    if (!(flags & 8)) {
      local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(size, 22);
    }
    local.writeUInt16LE(nameBytes.length, 26);
    const descriptor = flags & 8 ? Buffer.alloc(options.unsignedDescriptor ? 12 : 16) : Buffer.alloc(0);
    if (descriptor.length) {
      const start = descriptor.length === 16 ? 4 : 0;
      if (start) descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, start); descriptor.writeUInt32LE(compressed.length, start + 4); descriptor.writeUInt32LE(size, start + 8);
    }
    locals.push(local, nameBytes, compressed, descriptor);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6);
    record.writeUInt16LE(flags, 8); record.writeUInt16LE(method, 10); record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(compressed.length, 20); record.writeUInt32LE(size, 24);
    record.writeUInt16LE(nameBytes.length, 28); record.writeUInt32LE(offset, 42);
    central.push(record, nameBytes);
    offset += local.length + nameBytes.length + compressed.length + descriptor.length;
  }
  const directory = Buffer.concat(central), eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(parts.length, 8); eocd.writeUInt16LE(parts.length, 10);
  eocd.writeUInt32LE(directory.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, eocd]);
}

const inline = (ref, text) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
const row = (number, cells) => `<row r="${number}">${cells.join('')}</row>`;
function parts(options = {}) {
  const workbook = options.workbook ?? `<workbook xmlns="${NS}" xmlns:r="${REL}"><workbookPr date1904="false"/><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="A股列表" sheetId="1" r:id="rId3"/></sheets></workbook>`;
  const rows = options.rows ?? [
    row(1, ['板块', 'A股代码', 'A股简称', 'A股上市日期'].map((text, i) => inline(`${String.fromCharCode(65 + i)}1`, text))),
    row(2, ['主板', '000001', '平安银行', '1991-04-03'].map((text, i) => inline(`${String.fromCharCode(65 + i)}2`, text))),
    row(3, ['创业板', '300001', '特锐德', '2009-10-30'].map((text, i) => inline(`${String.fromCharCode(65 + i)}3`, text))),
  ];
  const result = [
    ['[Content_Types].xml', `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${mainType}"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="${sheetType}"/>${options.strings === undefined ? '' : `<Override PartName="/xl/sharedStrings.xml" ContentType="${stringsType}"/>`}</Types>`],
    ['_rels/.rels', `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', workbook],
    ['xl/_rels/workbook.xml.rels', options.rels ?? `<Relationships xmlns="${PKG}"><Relationship Id="rId3" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>${options.strings === undefined ? '' : `<Relationship Id="rId1" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>`}</Relationships>`],
    ['xl/worksheets/sheet1.xml', options.sheet ?? `<worksheet xmlns="${NS}"><dimension ref="A1"/><sheetViews><sheetView workbookViewId="0" tabSelected="true"/></sheetViews><sheetFormatPr defaultRowHeight="15.0" baseColWidth="10"/><sheetData>${rows.join('\n')}</sheetData><pageMargins bottom="0.75" footer="0.3" header="0.3" left="0.7" right="0.7" top="0.75"/></worksheet>`],
  ];
  if (options.strings !== undefined) result.push(['xl/sharedStrings.xml', options.strings]);
  return result;
}
const replacePart = (input, name, change) => input.map(([part, text]) => [part, part === name ? change(text) : text]);
async function rejects(input, pattern) { await assert.rejects(parsePublicXlsx(input), pattern); }
function withAppProperties(xml) {
  let result = replacePart(parts(), '[Content_Types].xml', (text) => text.replace('</Types>', '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>'));
  result = replacePart(result, '_rels/.rels', (text) => text.replace('</Relationships>', `<Relationship Id="rId2" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`));
  return [...result, ['docProps/app.xml', xml]];
}

test('preserves official labels, Chinese names, leading zero codes and listing date strings', async () => {
  for (const options of [{}, { method: 0 }, { descriptor: true }, { descriptor: true, unsignedDescriptor: true }]) {
    const parsed = await parsePublicXlsx(zip(parts(), options));
    assert.equal(parsed.sheetName, 'A股列表');
    assert.deepEqual(parsed.rows, [
      ['板块', 'A股代码', 'A股简称', 'A股上市日期'],
      ['主板', '000001', '平安银行', '1991-04-03'],
      ['创业板', '300001', '特锐德', '2009-10-30'],
    ]);
  }
  const bytes = zip(parts());
  assert.deepEqual(await parsePublicXlsx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), await parsePublicXlsx(bytes));
  const padded = Buffer.concat([Buffer.alloc(20), bytes, Buffer.alloc(30)]);
  assert.deepEqual(await parsePublicXlsx(padded.subarray(20, padded.length - 30)), await parsePublicXlsx(bytes));
  const mutable = zip(parts()), pending = parsePublicXlsx(mutable);
  mutable.fill(0);
  assert.deepEqual((await pending).rows[1], ['主板', '000001', '平安银行', '1991-04-03']);
});

test('supports strict shared strings, empty inline strings, sparse cells and lexical numbers', async () => {
  const strings = `<sst xmlns="${NS}" count="3" uniqueCount="2"><si><t>000001</t></si><si><t xml:space="preserve"> 万  科Ａ </t></si></sst>`;
  const parsed = await parsePublicXlsx(zip(parts({ strings, rows: [
    row(1, [inline('A1', 'code'), inline('B1', 'name'), inline('C1', 'number'), inline('D1', 'empty')]),
    row(2, ['<c r="A2" t="s"><v>0</v></c>', '<c r="B2" t="s"><v>1</v></c>', '<c r="C2"><v>001.20E+2</v></c>', inline('D2', '')]),
    row(3, ['<c r="A3" t="s"><v>0</v></c>', '<c r="C3"/>']),
  ] })));
  assert.deepEqual(parsed.rows[1], ['000001', ' 万  科Ａ ', '001.20E+2', '']);
  assert.deepEqual(parsed.rows[2], ['000001', '', '', '']);
});

test('decodes only predefined/numeric XML entities once and preserves original spacing', async () => {
  const value = '&amp;lt; &lt; &gt; &quot; &apos; &#65; &#x4e2d; &#x1f642;';
  const parsed = await parsePublicXlsx(zip(parts({ rows: [row(1, [inline('A1', value)])] })));
  assert.equal(parsed.rows[0][0], '&lt; < > " \' A 中 🙂');
  for (const bad of ['&custom;', '&amp', '&#0;', '&#xD800;', '&#x110000;', '&#xFFFE;', 'bare & name', 'a]]>b']) {
    await rejects(zip(parts({ rows: [row(1, [inline('A1', bad)])] })), /XML (entity|character|text)/);
  }
});

test('rejects CRC mismatch even when local and central CRC fields agree', async () => {
  await rejects(zip(parts(), { entries: { 'xl/worksheets/sheet1.xml': { crc: 0 } } }), /CRC mismatch/);
});

test('rejects advertised expansion bombs and total/archive limits before decompression', async () => {
  await rejects(zip(parts(), { entries: { 'xl/worksheets/sheet1.xml': { size: 16 * 1024 * 1024 } } }), /expansion limit/);
  const extraLarge = parts({ sheet: 'x'.repeat(2 * 1024 * 1024) });
  await rejects(zip(extraLarge), /expansion limit/);
  await rejects(new Uint8Array(PUBLIC_XLSX_LIMITS.archiveBytes + 1), /archive size/);
  const many = parts();
  for (let i = many.length; i < PUBLIC_XLSX_LIMITS.entries + 1; i++) many.push([`extra${i}`, 'x']);
  await rejects(zip(many), /central directory bounds/);
  const claimed = [...parts(), ['xl/sharedStrings.xml', 'x'], ['xl/styles.xml', 'x'], ['docProps/app.xml', 'x'], ['docProps/core.xml', 'x']];
  const entries = Object.fromEntries(claimed.map(([name]) => [name, { size: 2 * 1024 * 1024, compressed: Buffer.alloc(12000) }]));
  await rejects(zip(claimed, { entries }), /total ZIP expansion limit/);
});

test('enforces actual expansion cap while reading a stream whose sizes lie', async () => {
  // Not rejected by the declared ratio: decompression produces much more than
  // the claimed size. The reader cancels before retaining the oversized chunk.
  const compressed = deflateRawSync(Buffer.alloc(128 * 1024, 65));
  await rejects(zip(parts(), { entries: { 'xl/worksheets/sheet1.xml': { size: 1000, compressed } } }), /decompressed size\/expansion limit/);
});

test('rejects unsupported compression, encryption, multi-disk and ZIP64', async () => {
  await rejects(zip(parts(), { entries: { 'xl/workbook.xml': { method: 12 } } }), /compression/);
  await rejects(zip(parts(), { entries: { 'xl/workbook.xml': { flags: 0x801 } } }), /encrypted/);
  const disk = zip(parts()); disk.writeUInt16LE(1, disk.length - 18);
  await rejects(disk, /multi-disk/);
  const zip64 = zip(parts()); zip64.writeUInt16LE(0xffff, zip64.length - 14); zip64.writeUInt16LE(0xffff, zip64.length - 12);
  await rejects(zip64, /ZIP64/);
});

test('rejects truncation, trailing data and broken deflate streams', async () => {
  const good = zip(parts());
  for (const amount of [1, 15, 100, good.length - 10]) await rejects(good.subarray(0, good.length - amount), /truncated ZIP|archive size/);
  await rejects(Buffer.concat([good, Buffer.from('trailer')]), /truncated ZIP|trailing/);
  await rejects(zip(parts(), { entries: { 'xl/workbook.xml': { compressed: Buffer.from([0xff, 0xff, 0xff]) } } }), /deflate stream/);
  const text = Buffer.from(parts().find(([name]) => name === 'xl/workbook.xml')[1]);
  const compressed = deflateRawSync(text);
  await rejects(zip(parts(), { entries: { 'xl/workbook.xml': { compressed: compressed.subarray(0, compressed.length - 1) } } }), /deflate stream/);
  await rejects(zip(parts(), { entries: { 'xl/workbook.xml': { compressed: Buffer.concat([compressed, Buffer.from('junk')]) } } }), /deflate stream/);
});

test('rejects local/central mismatches, descriptor corruption and overlapping entry offsets', async () => {
  const mismatch = zip(parts()); mismatch[30] ^= 1;
  await rejects(mismatch, /filename mismatch/);
  const sizes = zip(parts()); sizes.writeUInt32LE(1, 22);
  await rejects(sizes, /sizes or CRC mismatch/);
  const descriptor = zip(parts(), { descriptor: true });
  const start = descriptor.indexOf(Buffer.from([0x50, 0x4b, 0x07, 0x08])); descriptor[start + 4] ^= 1;
  await rejects(descriptor, /descriptor mismatch/);
  const overlap = zip(parts());
  const central = overlap.readUInt32LE(overlap.length - 6);
  const next = central + 46 + overlap.readUInt16LE(central + 28);
  overlap.writeUInt32LE(0, next + 42);
  await rejects(overlap, /overlapping|compressed ZIP data/);
});

test('rejects unsafe/duplicate/unexpected paths, extra sheets, macros and missing parts', async () => {
  for (const name of ['../xl/workbook.xml', '/xl/workbook.xml', 'xl\\workbook.xml', 'xl/worksheets/sheet2.xml', 'xl/vbaProject.bin', 'xl/worksheets/_rels/sheet1.xml.rels']) {
    await rejects(zip([...parts(), [name, 'x']]), /unsafe ZIP path/);
  }
  await rejects(zip([...parts(), parts()[0]]), /duplicate/);
  await rejects(zip(parts().filter(([name]) => name !== 'xl/workbook.xml')), /missing required/);
  await rejects(zip(replacePart(parts(), '[Content_Types].xml', (text) => text.replace(mainType, 'application/vnd.ms-excel.sheet.macroEnabled.main+xml'))), /macro-enabled/);
});

test('rejects external/traversing/mismatched relationships and undeclared/orphaned parts', async () => {
  for (const change of [
    (text) => text.replace('Target="worksheets/sheet1.xml"', 'Target="https://evil.example/sheet.xml" TargetMode="External"'),
    (text) => text.replace('Target="worksheets/sheet1.xml"', 'Target="../worksheets/sheet1.xml"'),
    (text) => text.replace('Id="rId3"', 'Id="other"'),
  ]) await rejects(zip(replacePart(parts(), 'xl/_rels/workbook.xml.rels', change)), /external|relationship/);
  const orphan = parts({ strings: `<sst xmlns="${NS}" count="0" uniqueCount="0"/>` });
  await rejects(zip(replacePart(orphan, 'xl/_rels/workbook.xml.rels', (text) => text.replace(/<Relationship Id="rId1"[^>]+\/>/, ''))), /orphaned/);
});

test('rejects unexpected sheet declarations, hidden sheets, date system and multiple sheets', async () => {
  for (const change of [
    (text) => text.replace('name="A股列表"', 'name="other"'),
    (text) => text.replace('sheetId="1"', 'sheetId="2"'),
    (text) => text.replace('sheetId="1"', 'sheetId="1" state="hidden"'),
    (text) => text.replace('date1904="false"', 'date1904="true"'),
    (text) => text.replace('</sheets>', '<sheet name="A股列表" sheetId="2" r:id="rId3"/></sheets>'),
  ]) await rejects(zip(replacePart(parts(), 'xl/workbook.xml', change)), /unexpected|date system/);
});

test('rejects DTDs/entities, comments, processing instructions and malformed XML', async () => {
  const original = parts();
  for (const name of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml']) {
    await rejects(zip(replacePart(original, name, (text) => `<!DOCTYPE x [<!ENTITY attack SYSTEM "file:///etc/passwd">]>${text}`)), /DTD/);
  }
  for (const change of [
    (text) => `<!-- comment -->${text}`,
    (text) => `<?processing x?>${text}`,
    (text) => text.replace('</sheetData>', '</other>'),
    (text) => text.replace('r="A1"', 'r="A1" r="B1"'),
    (text) => text.replace('r="A1"', 'r="A1"unexpected="1"'),
    (text) => text.replace('xmlns=', 'wrong='),
    (text) => `${text}<another/>`,
    (text) => text.slice(0, -1),
  ]) await rejects(zip(replacePart(original, 'xl/worksheets/sheet1.xml', change)), /XML|namespace|truncated|DTD/);
});

test('rejects invalid cell references, row order, formulas, types and numeric values', async () => {
  for (const change of [
    (text) => text.replace('r="A2"', 'r="A02"'),
    (text) => text.replace('r="A2"', 'r="a2"'),
    (text) => text.replace('r="A2"', 'r="A1"'),
    (text) => text.replace('r="B2"', 'r="A2"'),
    (text) => text.replace('r="B2"', 'r="E2"'),
    (text) => text.replace('<row r="2">', '<row r="3">'),
    (text) => text.replace('<is><t>主板</t></is>', '<f>1+1</f><v>2</v>'),
    (text) => text.replace('r="A2" t="inlineStr"', 'r="A2" t="b"'),
    (text) => text.replace('<is><t>主板</t></is>', '<is><t>主</t><t>板</t></is>'),
  ]) await rejects(zip(replacePart(parts(), 'xl/worksheets/sheet1.xml', change)), /cell|row|formula|inline string/);
  for (const value of ['NaN', 'Infinity', '1,000', ' 1 ', '1x', '1e9999']) {
    await rejects(zip(parts({ rows: [row(1, [`<c r="A1"><v>${value}</v></c>`])] })), /numeric cell/);
  }
});

test('rejects unsupported/missing/mismatched shared strings and out-of-range indices', async () => {
  for (const strings of [
    `<sst xmlns="${NS}" count="1" uniqueCount="2"><si><t>x</t></si></sst>`,
    `<sst xmlns="${NS}" count="0" uniqueCount="1"><si><t>x</t></si></sst>`,
    `<sst xmlns="${NS}" count="1" uniqueCount="1"><si><r><t>x</t></r></si></sst>`,
    `<sst xmlns="${NS}" count="1" uniqueCount="1"><si/></sst>`,
  ]) await rejects(zip(parts({ strings })), /shared-string|shared string/);
  const strings = `<sst xmlns="${NS}" count="1" uniqueCount="1"><si><t>x</t></si></sst>`;
  for (const value of ['1', '-1', '01', '1.0', '&bad;']) {
    await rejects(zip(parts({ strings, rows: [row(1, [`<c r="A1" t="s"><v>${value}</v></c>`])] })), /shared-string|XML entity/);
  }
  await rejects(zip(parts({ rows: [row(1, ['<c r="A1" t="s"><v>0</v></c>'])] })), /out of range/);
  await rejects(zip(parts({ strings })), /reference count mismatch/);
});

test('accepts 10,000 future company rows when within cell/byte limits', async () => {
  const rows = [row(1, [inline('A1', 'A股代码')])];
  for (let n = 2; n <= PUBLIC_XLSX_LIMITS.rows; n++) rows.push(row(n, [inline(`A${n}`, String(n - 1).padStart(6, '0'))]));
  const parsed = await parsePublicXlsx(zip(parts({ rows })));
  assert.equal(parsed.rows.length, 10001);
  assert.equal(parsed.rows.at(-1)[0], '010000');
  rows.push(row(10002, [inline('A10002', '010001')]));
  await rejects(zip(parts({ rows })), /row reference/);
});

test('enforces text, column, rectangular cell and shared-string count limits', async () => {
  // Store oversized text so ratio enforcement does not hide the text limit.
  await rejects(zip(parts({ rows: [row(1, [inline('A1', 'x'.repeat(PUBLIC_XLSX_LIMITS.textChars + 1))])] }), { method: 0 }), /text length/);
  await rejects(zip(parts({ rows: [row(1, [inline('BM1', 'x')])] })), /column limit/);
  const strings = `<sst xmlns="${NS}" uniqueCount="${PUBLIC_XLSX_LIMITS.sharedStrings + 1}"/>`;
  await rejects(zip(parts({ strings })), /shared-string count/);
  const rows = [row(1, [inline('A1', 'start'), inline('BL1', 'end')])];
  for (let n = 2; n <= 3126; n++) rows.push(row(n, [inline(`A${n}`, String(n))]));
  await rejects(zip(parts({ rows })), /rectangular cell limit/);
});

test('rejects XML invalid UTF-8, controls, excessive nesting and declaration variants', async () => {
  await rejects(zip(replacePart(parts(), 'xl/workbook.xml', () => Buffer.from([0xc0, 0xaf]))), /UTF-8/);
  await rejects(zip(parts({ rows: [row(1, [inline('A1', '\u0000')])] })), /XML character/);
  await rejects(zip(replacePart(parts(), 'xl/workbook.xml', (text) => `<?xml version="1.1"?>${text}`)), /declaration/);
  await rejects(zip(replacePart(parts(), 'xl/workbook.xml', (text) => `<?xml version="1.0" encoding="UTF-16"?>${text}`)), /declaration/);
  // Unsupported nesting is rejected by the narrow schema before the generic
  // depth bound is needed. This never interprets an arbitrary XML subtree.
  await rejects(zip(parts({ sheet: `<worksheet xmlns="${NS}">${'<nested>'.repeat(50)}${'</nested>'.repeat(50)}</worksheet>` })), /unsupported worksheet element/);
});

test('checks optional metadata integrity, namespaces, DTDs and forbidden relationship/macro XML', async () => {
  const open = '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">';
  const good = `${open}<Application>Generated fixture</Application></Properties>`;
  assert.equal((await parsePublicXlsx(zip(withAppProperties(good)))).rows.length, 3);
  await rejects(zip(withAppProperties(good), { entries: { 'docProps/app.xml': { crc: 0 } } }), /CRC mismatch/);
  for (const text of [
    `<!DOCTYPE Properties [<!ENTITY x "bad">]>${good}`,
    `${open}<Relationships><Relationship TargetMode="External"/></Relationships></Properties>`,
    `${open}<vbaProject/></Properties>`,
    `${open}<unknown:tag/></Properties>`,
    `${open}<tag xmlns:a="urn:one" xmlns:b="urn:one" a:key="1" b:key="2"/></Properties>`,
    `${open}<tag xmlns:xml="urn:wrong"/></Properties>`,
    `${open}<tag a:b:c="1"/></Properties>`,
    `${open}<tag\u00a0attribute="1"/></Properties>`,
    `${open}${'<e>'.repeat(20)}${'</e>'.repeat(20)}</Properties>`,
  ]) await rejects(zip(withAppProperties(text)), /DTD|XML|relationship|macro/);
});

test('caps actual shared-string and XML element counts even without advertised counts', async () => {
  const strings = `<sst xmlns="${NS}">${'<si><t/></si>'.repeat(PUBLIC_XLSX_LIMITS.sharedStrings + 1)}</sst>`;
  await rejects(zip(parts({ strings }), { method: 0 }), /shared-string limit/);
  const metadata = `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">${'<e/>'.repeat(PUBLIC_XLSX_LIMITS.xmlElements)}</Properties>`;
  await rejects(zip(withAppProperties(metadata), { method: 0 }), /XML element\/depth limit/);
});
