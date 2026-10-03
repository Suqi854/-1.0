/**
 * A deliberately narrow, dependency-free reader for the SZSE public A-share
 * directory. This is NOT a general Excel reader. All returned values are
 * strings; styles, formulas, numeric dates and rich text are never evaluated.
 *
 * parsePublicXlsx(ArrayBuffer | Uint8Array) -> Promise<{ sheetName, rows }>
 * rows[0] is the header. Rows are rectangular, sparse cells become ''.
 * Rejects unsupported or ambiguous packages instead of trying to repair them.
 */
export const PUBLIC_XLSX_LIMITS = Object.freeze({
  archiveBytes: 8 * 1024 * 1024,
  uncompressedBytes: 16 * 1024 * 1024,
  expansionRatio: 200,
  entries: 16,
  rows: 10001, // one header plus at most 10,000 company rows
  columns: 64,
  cells: 200000, // also bounds the rectangular result, not only XML cells
  sharedStrings: 100000,
  textChars: 32768,
  xmlDepth: 16,
  xmlElements: 750000,
});

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CONTENT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';
const PART_TYPES = Object.freeze({
  'xl/workbook.xml': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  'xl/worksheets/sheet1.xml': 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
  'xl/sharedStrings.xml': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml',
  'xl/styles.xml': 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml',
  'docProps/app.xml': 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
  'docProps/core.xml': 'application/vnd.openxmlformats-package.core-properties+xml',
});
const ALLOWED_PARTS = new Set(['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', ...Object.keys(PART_TYPES)]);
const REQUIRED_PARTS = ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml'];
const decoder = new TextDecoder('utf-8', { fatal: true });
const fail = (message) => { throw new Error(`Invalid public XLSX: ${message}`); };
const own = (object, key) => Object.hasOwn(object, key);
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
  return n >>> 0;
});
function crcUpdate(crc, bytes) {
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return crc >>> 0;
}

function zipDirectory(input) {
  const supplied = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : fail('input must be ArrayBuffer or Uint8Array');
  if (supplied.length < 22 || supplied.length > PUBLIC_XLSX_LIMITS.archiveBytes) fail('archive size limit or truncated ZIP');
  // Bind the asynchronous reader to the validated archive, even if the caller
  // reuses its response buffer or supplied a view of a SharedArrayBuffer.
  const bytes = new Uint8Array(supplied);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at) => view.getUint16(at, true);
  const u32 = (at) => view.getUint32(at, true);
  const eocd = bytes.length - 22;
  // Public exports have no ZIP comments. Requiring a final EOCD also prevents
  // appended records, ambiguous EOCD signatures and hidden/trailing payloads.
  if (u32(eocd) !== 0x06054b50 || u16(eocd + 20) !== 0) fail('truncated ZIP or unsupported ZIP comment/trailing data');
  if (u16(eocd + 4) || u16(eocd + 6) || u16(eocd + 8) !== u16(eocd + 10)) fail('multi-disk ZIP is unsupported');
  const count = u16(eocd + 10), centralSize = u32(eocd + 12), centralAt = u32(eocd + 16);
  if (count === 0xffff || centralSize === 0xffffffff || centralAt === 0xffffffff) fail('ZIP64 is unsupported');
  if (!count || count > PUBLIC_XLSX_LIMITS.entries || centralAt + centralSize !== eocd) fail('invalid central directory bounds');
  const entries = new Map();
  let at = centralAt, total = 0;
  for (let index = 0; index < count; index++) {
    if (at + 46 > eocd || u32(at) !== 0x02014b50) fail('truncated or invalid central directory');
    const version = u16(at + 6), flags = u16(at + 8), method = u16(at + 10);
    const crc = u32(at + 16), compressed = u32(at + 20), size = u32(at + 24);
    const nameSize = u16(at + 28), extraSize = u16(at + 30), commentSize = u16(at + 32), offset = u32(at + 42);
    if (compressed === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) fail('ZIP64 is unsupported');
    if ((version !== 10 && version !== 20) || extraSize || commentSize) fail('unsupported ZIP version, extra field or entry comment');
    if (flags & 1) fail('encrypted ZIP is unsupported');
    if (![0, 8, 0x800, 0x808].includes(flags)) fail('unsupported ZIP flags');
    if (method !== 0 && method !== 8) fail('unsupported ZIP compression');
    if (u16(at + 34)) fail('multi-disk ZIP is unsupported');
    const unixType = (u32(at + 38) >>> 16) & 0xf000;
    if (unixType && unixType !== 0x8000) fail('non-regular ZIP entry');
    if (!nameSize || nameSize > 128 || at + 46 + nameSize > eocd) fail('invalid ZIP entry name bounds');
    let name;
    try { name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameSize)); } catch { fail('invalid ZIP filename encoding'); }
    if (!ALLOWED_PARTS.has(name) || entries.has(name)) fail('unexpected, duplicate or unsafe ZIP path');
    if (size > PUBLIC_XLSX_LIMITS.uncompressedBytes || size > Math.max(1, compressed) * PUBLIC_XLSX_LIMITS.expansionRatio) fail('ZIP expansion limit');
    if (method === 0 && size !== compressed) fail('stored ZIP size mismatch');
    total += size;
    if (total > PUBLIC_XLSX_LIMITS.uncompressedBytes) fail('total ZIP expansion limit');
    entries.set(name, { name, version, flags, method, crc, compressed, size, offset, time: u16(at + 12), date: u16(at + 14) });
    at += 46 + nameSize;
  }
  if (at !== eocd) fail('central directory size/count mismatch');
  for (const name of REQUIRED_PARTS) if (!entries.has(name)) fail(`missing required part ${name}`);
  const ordered = [...entries.values()].sort((a, b) => a.offset - b.offset);
  let next = 0;
  for (let i = 0; i < ordered.length; i++) {
    const entry = ordered[i], local = entry.offset;
    const regionEnd = ordered[i + 1]?.offset ?? centralAt;
    if (local !== next || local + 30 > centralAt || u32(local) !== 0x04034b50) fail('overlapping, gapped or invalid local ZIP header');
    if (u16(local + 4) !== entry.version || u16(local + 6) !== entry.flags || u16(local + 8) !== entry.method || u16(local + 10) !== entry.time || u16(local + 12) !== entry.date) fail('local/central ZIP header mismatch');
    const nameSize = u16(local + 26), extraSize = u16(local + 28);
    if (nameSize !== entry.name.length || extraSize || local + 30 + nameSize > centralAt) fail('invalid local ZIP name/extra field');
    for (let n = 0; n < nameSize; n++) if (bytes[local + 30 + n] !== entry.name.charCodeAt(n)) fail('local/central ZIP filename mismatch');
    const localCrc = u32(local + 14), localCompressed = u32(local + 18), localSize = u32(local + 22);
    const zero = localCrc === 0 && localCompressed === 0 && localSize === 0;
    const equal = localCrc === entry.crc && localCompressed === entry.compressed && localSize === entry.size;
    if (!(entry.flags & 8 ? zero || equal : equal)) fail('local/central ZIP sizes or CRC mismatch');
    entry.dataAt = local + 30 + nameSize;
    const dataEnd = entry.dataAt + entry.compressed;
    if (dataEnd > regionEnd || regionEnd > centralAt) fail('truncated or overlapping compressed ZIP data');
    if (entry.flags & 8) {
      let descriptor = dataEnd;
      if (regionEnd - dataEnd === 16 && u32(descriptor) === 0x08074b50) descriptor += 4;
      else if (regionEnd - dataEnd !== 12) fail('invalid ZIP data descriptor bounds');
      if (u32(descriptor) !== entry.crc || u32(descriptor + 4) !== entry.compressed || u32(descriptor + 8) !== entry.size) fail('ZIP data descriptor mismatch');
    } else if (dataEnd !== regionEnd) fail('unexpected bytes after ZIP entry');
    next = regionEnd;
  }
  if (next !== centralAt) fail('local/central ZIP layout mismatch');
  return { bytes, entries };
}

async function unpack(bytes, entry) {
  const compressed = bytes.subarray(entry.dataAt, entry.dataAt + entry.compressed);
  let crc = 0xffffffff, size = 0;
  const chunks = [];
  const accept = (chunk) => {
    // Check before retaining or copying any expansion chunk. Declared sizes
    // are not trusted: a lying stream cannot exceed them even temporarily in
    // our retained buffers, regardless of its advertised compression ratio.
    if (chunk.length > entry.size - size || chunk.length > PUBLIC_XLSX_LIMITS.uncompressedBytes - size) fail('decompressed size/expansion limit');
    size += chunk.length;
    crc = crcUpdate(crc, chunk);
    chunks.push(chunk);
  };
  if (entry.method === 0) accept(compressed);
  else {
    if (typeof DecompressionStream !== 'function') fail('deflate-raw decompression is unavailable');
    let reader;
    try {
      let at = 0;
      const source = new ReadableStream({ pull(controller) {
        if (at === compressed.length) return controller.close();
        const end = Math.min(at + 16384, compressed.length);
        controller.enqueue(compressed.subarray(at, end));
        at = end;
      } });
      reader = source.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accept(value);
      }
    } catch (error) {
      if (reader) await reader.cancel().catch(() => {});
      if (error?.message?.startsWith('Invalid public XLSX:')) throw error;
      fail('invalid or truncated deflate stream');
    } finally { reader?.releaseLock(); }
  }
  if (size !== entry.size) fail('decompressed size mismatch');
  if (((crc ^ 0xffffffff) >>> 0) !== entry.crc) fail('ZIP CRC mismatch');
  const output = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { output.set(chunk, at); at += chunk.length; }
  try { return decoder.decode(output); } catch { fail('invalid UTF-8 XML'); }
}

function xmlChars(text) {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(text)) fail('invalid XML character');
  return text;
}
function entityText(raw) {
  if (raw.length > PUBLIC_XLSX_LIMITS.textChars) fail('XML text length limit');
  let result = '', at = 0;
  const known = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  for (let amp = raw.indexOf('&'); amp !== -1; amp = raw.indexOf('&', at)) {
    result += raw.slice(at, amp);
    const end = raw.indexOf(';', amp + 1);
    if (end === -1 || end - amp > 16) fail('invalid XML entity');
    const entity = raw.slice(amp + 1, end);
    if (own(known, entity)) result += known[entity];
    else if (/^#(?:[0-9]+|x[0-9A-Fa-f]+)$/.test(entity)) {
      const point = entity[1] === 'x' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      if (!Number.isSafeInteger(point) || point > 0x10ffff || (point < 32 && ![9, 10, 13].includes(point)) || (point >= 0xd800 && point <= 0xdfff) || point === 0xfffe || point === 0xffff) fail('invalid XML character entity');
      result += String.fromCodePoint(point);
    } else fail('unsupported XML entity');
    at = end + 1;
  }
  return xmlChars(result + raw.slice(at));
}

// Small strict SAX tokenizer. It never resolves DTDs, external entities,
// processing instructions, namespaces or package relationships automatically.
function parseXml(xml, handler = {}) {
  xml = xml.replace(/\r\n?/g, '\n');
  if (xml[0] === '\ufeff') xml = xml.slice(1);
  xmlChars(xml);
  let at = 0, root = false, finished = false, elements = 0;
  const stack = [], namespaceStack = [];
  if (xml.startsWith('<?xml')) {
    const declaration = /^<\?xml[ \t\n]+version=(?:"1\.0"|'1\.0')(?:[ \t\n]+encoding=(?:"UTF-8"|'UTF-8'|"utf-8"|'utf-8'))?(?:[ \t\n]+standalone=(?:"(?:yes|no)"|'(?:yes|no)'))?[ \t\n]*\?>/.exec(xml);
    if (!declaration) fail('unsupported XML declaration');
    at = declaration[0].length;
  }
  while (at < xml.length) {
    if (xml[at] !== '<') {
      const end = xml.indexOf('<', at), stop = end === -1 ? xml.length : end;
      const raw = xml.slice(at, stop);
      if (raw.includes(']]>')) fail('invalid XML text terminator');
      const value = entityText(raw);
      if (!stack.length && /[^ \t\n\r]/.test(value)) fail('text outside XML root');
      handler.text?.(value, stack);
      at = stop;
      continue;
    }
    if (xml.startsWith('<!', at) || xml.startsWith('<?', at)) fail('DTD, declarations, comments and processing instructions are unsupported');
    let end = at + 1, quote = '';
    for (; end < xml.length; end++) {
      const char = xml[end];
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
      else if (char === '<') fail('invalid XML tag');
      if (end - at > 16384) fail('XML tag length limit');
    }
    if (end === xml.length || quote) fail('truncated XML tag');
    let tag = xml.slice(at + 1, end);
    at = end + 1;
    if (tag.startsWith('/')) {
      const close = /^\/([A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?)[ \t\n]*$/.exec(tag);
      if (!close || stack.at(-1) !== close[1]) fail('mismatched XML closing tag');
      handler.end?.(close[1], stack);
      stack.pop();
      namespaceStack.pop();
      if (!stack.length) finished = true;
      continue;
    }
    const selfClosing = tag.endsWith('/');
    if (selfClosing) tag = tag.slice(0, -1);
    const opening = /^([A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?)(?=[ \t\n]|$)/.exec(tag);
    if (!opening || finished) fail('invalid or multiple XML roots');
    const name = opening[1], attrs = Object.create(null);
    let rest = tag.slice(name.length), attrCount = 0;
    while (rest.length) {
      if (/^[ \t\n]*$/.test(rest)) break;
      const attr = /^[ \t\n]+([A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?)[ \t\n]*=[ \t\n]*("[^"<]*"|'[^'<]*')/.exec(rest);
      if (!attr || own(attrs, attr[1]) || ++attrCount > 16) fail('invalid, duplicate or excessive XML attributes');
      attrs[attr[1]] = entityText(attr[2].slice(1, -1)).replace(/[\t\n]/g, ' ');
      rest = rest.slice(attr[0].length);
    }
    let namespaces = namespaceStack.at(-1) ?? { xml: XML_NAMESPACE };
    const declarations = Object.keys(attrs).filter((key) => key === 'xmlns' || key.startsWith('xmlns:'));
    if (declarations.length) {
      namespaces = Object.assign(Object.create(null), namespaces);
      for (const key of declarations) {
        const prefix = key === 'xmlns' ? '' : key.slice(6), uri = attrs[key];
        if (prefix === 'xmlns' || uri === XMLNS_NAMESPACE || (prefix === 'xml' ? uri !== XML_NAMESPACE : uri === XML_NAMESPACE) || (prefix && !uri)) fail('invalid XML namespace declaration');
        namespaces[prefix] = uri;
      }
    }
    const prefix = name.includes(':') ? name.split(':')[0] : '';
    if (prefix && (!own(namespaces, prefix) || prefix === 'xmlns')) fail('unbound XML element namespace');
    const expandedAttrs = new Set();
    for (const key of Object.keys(attrs)) {
      if (declarations.includes(key)) continue;
      const [first, second] = key.split(':');
      if (second && !own(namespaces, first)) fail('unbound XML attribute namespace');
      const expanded = `${second ? namespaces[first] : ''}\0${second ?? first}`;
      if (expandedAttrs.has(expanded)) fail('duplicate expanded XML attribute');
      expandedAttrs.add(expanded);
    }
    if (++elements > PUBLIC_XLSX_LIMITS.xmlElements || stack.length >= PUBLIC_XLSX_LIMITS.xmlDepth) fail('XML element/depth limit');
    if (!stack.length) { if (root) fail('multiple XML roots'); root = true; }
    handler.start?.(name, attrs, stack);
    stack.push(name);
    namespaceStack.push(namespaces);
    if (selfClosing) {
      handler.end?.(name, stack);
      stack.pop();
      namespaceStack.pop();
      if (!stack.length) finished = true;
    }
  }
  if (!root || !finished || stack.length) fail('truncated or empty XML');
}

function attrsOnly(attrs, allowed, required = []) {
  if (Object.keys(attrs).some((key) => !allowed.includes(key)) || required.some((key) => !own(attrs, key))) fail('unexpected or missing XML attribute');
}
function whitespace(value) { if (/[^ \t\n\r]/.test(value)) fail('unexpected XML text'); }
function integer(value, max, label = 'integer', min = 0) {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value ?? '') || Number(value) > max || Number(value) < min) fail(`invalid ${label}`);
  return Number(value);
}
function namespace(attrs, expected) { if (attrs.xmlns !== expected) fail('unexpected XML namespace'); }

function contentTypes(xml, entries) {
  const declared = new Set(), defaults = new Set();
  parseXml(xml, {
    text: whitespace,
    start(name, attrs, stack) {
      if (!stack.length) { if (name !== 'Types') fail('unexpected content-types root'); attrsOnly(attrs, ['xmlns'], ['xmlns']); namespace(attrs, CONTENT); }
      else if (stack.length === 1 && name === 'Default') {
        attrsOnly(attrs, ['Extension', 'ContentType'], ['Extension', 'ContentType']);
        const type = attrs.Extension === 'xml' ? 'application/xml' : attrs.Extension === 'rels' ? 'application/vnd.openxmlformats-package.relationships+xml' : '';
        if (!type || attrs.ContentType !== type || defaults.has(attrs.Extension)) fail('unexpected content type');
        defaults.add(attrs.Extension);
      } else if (stack.length === 1 && name === 'Override') {
        attrsOnly(attrs, ['PartName', 'ContentType'], ['PartName', 'ContentType']);
        const part = attrs.PartName.slice(1);
        if (attrs.PartName !== `/${part}` || !own(PART_TYPES, part) || attrs.ContentType !== PART_TYPES[part] || !entries.has(part) || declared.has(part)) fail('unexpected, macro-enabled or duplicate content type');
        declared.add(part);
      } else fail('unexpected content-types element');
    },
  });
  if (!defaults.has('xml') || !defaults.has('rels')) fail('missing content-type defaults');
  for (const part of Object.keys(PART_TYPES)) if (entries.has(part) && !declared.has(part)) fail('missing part content type');
}

function relationships(xml, kind, entries) {
  const byId = new Map(), types = new Set();
  const allowed = kind === 'root' ? {
    [`${OFFICE}/officeDocument`]: 'xl/workbook.xml',
    [`${OFFICE}/extended-properties`]: 'docProps/app.xml',
    [`${PACKAGE}/metadata/core-properties`]: 'docProps/core.xml',
  } : {
    [`${OFFICE}/worksheet`]: 'worksheets/sheet1.xml',
    [`${OFFICE}/sharedStrings`]: 'sharedStrings.xml',
    [`${OFFICE}/styles`]: 'styles.xml',
  };
  parseXml(xml, {
    text: whitespace,
    start(name, attrs, stack) {
      if (!stack.length) { if (name !== 'Relationships') fail('unexpected relationships root'); attrsOnly(attrs, ['xmlns'], ['xmlns']); namespace(attrs, PACKAGE); }
      else if (stack.length === 1 && name === 'Relationship') {
        attrsOnly(attrs, ['Id', 'Type', 'Target', 'TargetMode'], ['Id', 'Type', 'Target']);
        if (attrs.TargetMode && attrs.TargetMode !== 'Internal') fail('external relationships are unsupported');
        if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(attrs.Id) || byId.has(attrs.Id) || !own(allowed, attrs.Type) || types.has(attrs.Type) || attrs.Target !== allowed[attrs.Type]) fail('unexpected or ambiguous relationship');
        const part = kind === 'root' ? attrs.Target : `xl/${attrs.Target}`;
        if (!entries.has(part)) fail('relationship target is missing');
        byId.set(attrs.Id, { type: attrs.Type, part });
        types.add(attrs.Type);
      } else fail('unexpected relationships element');
    },
  });
  if (!types.has(`${OFFICE}/${kind === 'root' ? 'officeDocument' : 'worksheet'}`)) fail('required relationship is missing');
  if (kind !== 'root') for (const type of ['sharedStrings', 'styles']) {
    if (entries.has(`xl/${type}.xml`) !== types.has(`${OFFICE}/${type}`)) fail('orphaned workbook part');
  }
  return byId;
}

function workbook(xml, rels) {
  const seen = new Set();
  let sheet;
  parseXml(xml, {
    text: whitespace,
    start(name, attrs, stack) {
      const path = [...stack, name].join('/');
      if (seen.has(path)) fail('unexpected duplicate workbook element');
      seen.add(path);
      switch (path) {
        case 'workbook':
          attrsOnly(attrs, ['xmlns', 'xmlns:r'], ['xmlns', 'xmlns:r']); namespace(attrs, MAIN);
          if (attrs['xmlns:r'] !== OFFICE) fail('unexpected workbook relationship namespace');
          break;
        case 'workbook/workbookPr':
          attrsOnly(attrs, ['date1904']);
          if (attrs.date1904 && !['false', '0'].includes(attrs.date1904)) fail('unsupported workbook date system');
          break;
        case 'workbook/bookViews': case 'workbook/sheets': attrsOnly(attrs, []); break;
        case 'workbook/bookViews/workbookView':
          attrsOnly(attrs, ['activeTab']);
          if (attrs.activeTab && attrs.activeTab !== '0') fail('unexpected active sheet');
          break;
        case 'workbook/sheets/sheet':
          attrsOnly(attrs, ['name', 'r:id', 'sheetId', 'state'], ['name', 'r:id', 'sheetId']);
          if (attrs.name !== 'A股列表' || attrs.sheetId !== '1' || (attrs.state && attrs.state !== 'visible')) fail('unexpected sheet');
          if (rels.get(attrs['r:id'])?.part !== 'xl/worksheets/sheet1.xml') fail('worksheet relationship mismatch');
          sheet = attrs.name;
          break;
        default: fail('unexpected workbook element');
      }
    },
  });
  if (!sheet) fail('missing declared single sheet');
  return sheet;
}

function stringTable(xml) {
  const strings = [];
  let current = null, textSeen = false, count, uniqueCount;
  parseXml(xml, {
    start(name, attrs, stack) {
      const path = [...stack, name].join('/');
      if (path === 'sst') {
        attrsOnly(attrs, ['xmlns', 'count', 'uniqueCount'], ['xmlns']); namespace(attrs, MAIN);
        if (own(attrs, 'count')) count = integer(attrs.count, PUBLIC_XLSX_LIMITS.cells, 'shared-string reference count');
        if (own(attrs, 'uniqueCount')) uniqueCount = integer(attrs.uniqueCount, PUBLIC_XLSX_LIMITS.sharedStrings, 'shared-string count');
      } else if (path === 'sst/si') {
        attrsOnly(attrs, []);
        if (strings.length >= PUBLIC_XLSX_LIMITS.sharedStrings) fail('shared-string limit');
        current = ''; textSeen = false;
      } else if (path === 'sst/si/t') {
        attrsOnly(attrs, ['xml:space']);
        if (textSeen || (attrs['xml:space'] && !['preserve', 'default'].includes(attrs['xml:space']))) fail('invalid shared string');
        textSeen = true;
      } else fail('unsupported shared-string element or rich text');
    },
    text(value, stack) {
      if (stack.join('/') === 'sst/si/t') { current += value; if (current.length > PUBLIC_XLSX_LIMITS.textChars) fail('shared-string text length limit'); }
      else whitespace(value);
    },
    end(name) { if (name === 'si') { if (!textSeen) fail('missing shared-string text'); strings.push(current); current = null; } },
  });
  if (uniqueCount !== undefined && uniqueCount !== strings.length) fail('shared-string count mismatch');
  if (count !== undefined && count < strings.length) fail('shared-string reference count mismatch');
  return { strings, count };
}

function cellReference(ref) {
  const match = /^([A-Z]{1,2})([1-9][0-9]*)$/.exec(ref ?? '');
  if (!match) fail('noncanonical cell reference');
  let column = 0;
  for (const char of match[1]) column = column * 26 + char.charCodeAt(0) - 64;
  if (column > PUBLIC_XLSX_LIMITS.columns) fail('cell column limit');
  return { column, row: integer(match[2], PUBLIC_XLSX_LIMITS.rows, 'cell row', 1) };
}

function worksheet(xml, table) {
  const rows = [], rootChildren = new Set();
  let row, rowNumber = 0, previousColumn = 0, cells = 0, width = 0, cell, sharedReferences = 0;
  parseXml(xml, {
    start(name, attrs, stack) {
      const path = [...stack, name].join('/');
      if (stack.length === 1) { if (rootChildren.has(name)) fail('duplicate worksheet section'); rootChildren.add(name); }
      switch (path) {
        case 'worksheet': attrsOnly(attrs, ['xmlns'], ['xmlns']); namespace(attrs, MAIN); break;
        case 'worksheet/dimension': {
          attrsOnly(attrs, ['ref'], ['ref']);
          const ends = attrs.ref.split(':');
          if (ends.length > 2) fail('invalid worksheet dimension');
          const refs = ends.map(cellReference);
          if (refs.length === 2 && (refs[0].column > refs[1].column || refs[0].row > refs[1].row)) fail('invalid worksheet dimension');
          break;
        }
        case 'worksheet/sheetViews': case 'worksheet/sheetData': attrsOnly(attrs, []); break;
        case 'worksheet/sheetViews/sheetView':
          attrsOnly(attrs, ['workbookViewId', 'tabSelected'], ['workbookViewId']);
          if (attrs.workbookViewId !== '0' || (attrs.tabSelected && !['true', 'false', '0', '1'].includes(attrs.tabSelected))) fail('unexpected worksheet view');
          break;
        case 'worksheet/sheetFormatPr':
          attrsOnly(attrs, ['defaultRowHeight', 'baseColWidth']);
          if (Object.values(attrs).some((v) => !/^[0-9]+(?:\.[0-9]+)?$/.test(v))) fail('invalid sheet format');
          break;
        case 'worksheet/pageMargins':
          attrsOnly(attrs, ['bottom', 'footer', 'header', 'left', 'right', 'top']);
          if (Object.values(attrs).some((v) => !/^[0-9]+(?:\.[0-9]+)?$/.test(v))) fail('invalid page margins');
          break;
        case 'worksheet/sheetData/row':
          attrsOnly(attrs, ['r'], ['r']);
          rowNumber = integer(attrs.r, PUBLIC_XLSX_LIMITS.rows, 'row reference', 1);
          if (rowNumber !== rows.length + 1) fail('nonconsecutive or duplicate row reference');
          row = []; previousColumn = 0;
          break;
        case 'worksheet/sheetData/row/c': {
          attrsOnly(attrs, ['r', 's', 't'], ['r']);
          const reference = cellReference(attrs.r);
          if (reference.row !== rowNumber || reference.column <= previousColumn) fail('invalid, duplicate or out-of-order cell reference');
          if (rows.length && reference.column > width) fail('cell outside header width');
          if (++cells > PUBLIC_XLSX_LIMITS.cells) fail('cell limit');
          if (own(attrs, 's')) integer(attrs.s, 10000, 'style index');
          const type = attrs.t ?? 'n';
          if (!['inlineStr', 's', 'n'].includes(type)) fail('unsupported cell type');
          previousColumn = reference.column;
          cell = { column: reference.column, type, value: '', is: false, t: false, v: false };
          break;
        }
        case 'worksheet/sheetData/row/c/is':
          attrsOnly(attrs, []);
          if (cell.type !== 'inlineStr' || cell.is || cell.v) fail('invalid inline string cell');
          cell.is = true;
          break;
        case 'worksheet/sheetData/row/c/is/t':
          attrsOnly(attrs, ['xml:space']);
          if (cell.t || (attrs['xml:space'] && !['preserve', 'default'].includes(attrs['xml:space']))) fail('invalid inline string text');
          cell.t = true;
          break;
        case 'worksheet/sheetData/row/c/v':
          attrsOnly(attrs, []);
          if (cell.type === 'inlineStr' || cell.v || cell.is) fail('invalid cell value');
          cell.v = true;
          break;
        default: fail('unsupported worksheet element, formula or rich text');
      }
    },
    text(value, stack) {
      const path = stack.join('/');
      if (path === 'worksheet/sheetData/row/c/is/t' || path === 'worksheet/sheetData/row/c/v') {
        cell.value += value;
        if (cell.value.length > PUBLIC_XLSX_LIMITS.textChars) fail('cell text length limit');
      } else whitespace(value);
    },
    end(name) {
      if (name === 'c') {
        let value = cell.value;
        if (cell.type === 'inlineStr') { if (!cell.is || !cell.t) fail('missing inline string text'); }
        else if (cell.type === 's') {
          if (!cell.v) fail('missing shared-string index');
          const index = integer(value, PUBLIC_XLSX_LIMITS.sharedStrings - 1, 'shared-string index');
          if (index >= table.strings.length) fail('shared-string index out of range');
          value = table.strings[index]; sharedReferences++;
        } else if (cell.v && (!/^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[Ee][+-]?[0-9]+)?$/.test(value) || !Number.isFinite(Number(value)))) fail('invalid numeric cell');
        while (row.length < cell.column - 1) row.push('');
        row.push(value); cell = null;
      } else if (name === 'row') {
        if (!row.length) fail('empty worksheet row');
        if (!rows.length) width = row.length;
        if ((rows.length + 1) * width > PUBLIC_XLSX_LIMITS.cells) fail('rectangular cell limit');
        while (row.length < width) row.push('');
        rows.push(row); row = null;
      }
    },
  });
  if (!rootChildren.has('sheetData') || !rows.length) fail('missing worksheet data');
  if (table.count !== undefined && table.count !== sharedReferences) fail('shared-string reference count mismatch');
  return rows;
}

function checkOpaqueXml(xml, part) {
  const expected = part === 'xl/styles.xml' ? ['styleSheet', MAIN]
    : part === 'docProps/app.xml' ? ['Properties', 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties']
    : ['cp:coreProperties', 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties'];
  parseXml(xml, { start(name, attrs, stack) {
    if (!stack.length && (name !== expected[0] || attrs[part === 'docProps/core.xml' ? 'xmlns:cp' : 'xmlns'] !== expected[1])) fail('unexpected opaque XML part root');
    const local = name.split(':').at(-1);
    if (['Relationships', 'Relationship', 'externalReferences', 'externalReference', 'externalLink', 'vbaProject'].includes(local)) fail('unsupported external relationship or macro XML');
  } });
}

export async function parsePublicXlsx(input) {
  const { bytes, entries } = zipDirectory(input);
  // Only the fixed, allowlisted public package parts can be decompressed. All
  // get integrity/UTF-8/DTD checks; only required data parts are interpreted.
  const xml = new Map();
  for (const entry of entries.values()) xml.set(entry.name, await unpack(bytes, entry));
  contentTypes(xml.get('[Content_Types].xml'), entries);
  relationships(xml.get('_rels/.rels'), 'root', entries);
  const rels = relationships(xml.get('xl/_rels/workbook.xml.rels'), 'workbook', entries);
  const sheetName = workbook(xml.get('xl/workbook.xml'), rels);
  for (const name of ['docProps/app.xml', 'docProps/core.xml', 'xl/styles.xml']) if (xml.has(name)) checkOpaqueXml(xml.get(name), name);
  const table = xml.has('xl/sharedStrings.xml') ? stringTable(xml.get('xl/sharedStrings.xml')) : { strings: [] };
  const rows = worksheet(xml.get('xl/worksheets/sheet1.xml'), table);
  return { sheetName, rows };
}
