/*
 * Leitura e escrita mínima de .xlsx, sem dependências (ZIP + XML na mão).
 *   readXlsx(arrayBuffer)  -> Promise<{ [sheetName]: any[][] }>   (linhas de células; vazio = '')
 *   writeXlsx(sheets)      -> Uint8Array                          (ver formato em writeXlsx)
 *   parseCsv(text)         -> any[][]
 * Funciona no navegador e no Node (>= 18: usa DecompressionStream).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.XlsxLite = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------------ ZIP (leitura)
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

  async function inflateRaw(data) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([data]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** -> Map(nome -> () => Promise<Uint8Array>) */
  function zipEntries(buf) {
    const b = new Uint8Array(buf);
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (u32(b, i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Arquivo não é um .xlsx válido (ZIP não encontrado).');
    const count = u16(b, eocd + 10);
    let p = u32(b, eocd + 16);
    const entries = new Map();
    for (let n = 0; n < count; n++) {
      if (u32(b, p) !== 0x02014b50) throw new Error('ZIP corrompido.');
      const method = u16(b, p + 10), csize = u32(b, p + 20), nameLen = u16(b, p + 28), extraLen = u16(b, p + 30), cmtLen = u16(b, p + 32), local = u32(b, p + 42);
      const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));
      entries.set(name, async () => {
        const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
        const raw = b.subarray(start, start + csize);
        if (method === 0) return raw;
        if (method === 8) return inflateRaw(raw);
        throw new Error('Compressão ZIP não suportada: ' + method);
      });
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return entries;
  }

  // ------------------------------------------------------------------ XML (leitura)
  const decodeXml = s => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()];
  });
  const attr = (s, name) => { const m = new RegExp('\\b' + name + '="([^"]*)"').exec(s); return m ? decodeXml(m[1]) : null; };
  const textOf = xml => { let t = ''; const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g; let m; while ((m = re.exec(xml))) t += decodeXml(m[1]); return t; };
  const colIndex = ref => { let n = 0; for (const ch of ref.replace(/[0-9]/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

  function parseSheet(xml, sst) {
    const rows = [];
    const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g; let rm;
    let nextRow = 0;
    while ((rm = rowRe.exec(xml))) {
      const rIdx = attr(rm[1], 'r') ? parseInt(attr(rm[1], 'r'), 10) - 1 : nextRow;
      nextRow = rIdx + 1;
      const row = [];
      const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let cm; let nextCol = 0;
      while ((cm = cellRe.exec(rm[2] || ''))) {
        const ref = attr(cm[1], 'r'); const ci = ref ? colIndex(ref) : nextCol; nextCol = ci + 1;
        const t = attr(cm[1], 't'); const body = cm[2] || '';
        let v = '';
        if (t === 'inlineStr') v = textOf(body);
        else {
          const vm = /<v>([\s\S]*?)<\/v>/.exec(body);
          if (vm) {
            const raw = decodeXml(vm[1]);
            if (t === 's') v = sst[parseInt(raw, 10)] ?? '';
            else if (t === 'str' || t === 'e') v = raw;
            else if (t === 'b') v = raw === '1';
            else v = raw === '' ? '' : Number(raw);
          }
        }
        row[ci] = v;
      }
      for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
      rows[rIdx] = row;
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    return rows;
  }

  async function readXlsx(buf) {
    const z = zipEntries(buf);
    const read = async name => { const f = z.get(name); return f ? new TextDecoder().decode(await f()) : null; };
    const wb = await read('xl/workbook.xml');
    if (!wb) throw new Error('Arquivo não parece ser uma planilha Excel (.xlsx).');
    const rels = await read('xl/_rels/workbook.xml.rels') || '';
    const relMap = {};
    for (const m of rels.matchAll(/<Relationship\b([^>]*?)\/?>/g)) relMap[attr(m[1], 'Id')] = attr(m[1], 'Target');
    const sstXml = await read('xl/sharedStrings.xml');
    const sst = sstXml ? [...sstXml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map(m => textOf(m[1] || '')) : [];
    const out = {};
    for (const m of wb.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
      const name = attr(m[1], 'name'); const rid = attr(m[1], 'r:id') || attr(m[1], 'id');
      let target = relMap[rid]; if (!target) continue;
      target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
      const xml = await read(target);
      if (xml) out[name] = parseSheet(xml, sst);
    }
    return out;
  }

  // ------------------------------------------------------------------ CSV
  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    const delim = (text.split(/\r?\n/, 1)[0].match(/;/g) || []).length > (text.split(/\r?\n/, 1)[0].match(/,/g) || []).length ? ';' : ',';
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === delim) { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  // ------------------------------------------------------------------ ZIP (escrita, sem compressão)
  const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

  function zip(files) {   // files: [{ name, data: Uint8Array }]
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const w16 = (a, v) => a.push(v & 255, (v >> 8) & 255);
    const w32 = (a, v) => a.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      const lh = []; w32(lh, 0x04034b50); w16(lh, 20); w16(lh, 0x0800); w16(lh, 0); w16(lh, dosTime); w16(lh, dosDate);
      w32(lh, crc); w32(lh, size); w32(lh, size); w16(lh, name.length); w16(lh, 0);
      parts.push(Uint8Array.from(lh), name, f.data);
      const ch = []; w32(ch, 0x02014b50); w16(ch, 20); w16(ch, 20); w16(ch, 0x0800); w16(ch, 0); w16(ch, dosTime); w16(ch, dosDate);
      w32(ch, crc); w32(ch, size); w32(ch, size); w16(ch, name.length); w16(ch, 0); w16(ch, 0); w16(ch, 0); w16(ch, 0); w32(ch, 0); w32(ch, offset);
      central.push(Uint8Array.from(ch), name);
      offset += lh.length + name.length + size;
    }
    const cdSize = central.reduce((a, p) => a + p.length, 0);
    const end = []; w32(end, 0x06054b50); w16(end, 0); w16(end, 0); w16(end, files.length); w16(end, files.length); w32(end, cdSize); w32(end, offset); w16(end, 0);
    const all = [...parts, ...central, Uint8Array.from(end)];
    const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
    let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
    return out;
  }

  // ------------------------------------------------------------------ XLSX (escrita)
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const colName = i => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

  // estilos: 0 normal | 1 cabeçalho (negrito, fundo azul claro) | 2 quebra de linha | 3 título (negrito grande) | 4 número 0,00
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="0.00"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F1"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  /**
   * sheets: [{
   *   name, rows: [[cell...]],           cell = string | number | boolean | { v, s }  (s = índice de estilo acima)
   *   widths?: [n...], header?: true (1ª linha com estilo de cabeçalho + congelada),
   *   validations?: [{ sqref: 'B2:B500', list: ['Auto','Aggro'] }]
   * }]
   */
  function writeXlsx(sheets) {
    const enc = new TextEncoder();
    const files = [];
    const names = sheets.map(s => s.name.replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31));
    files.push({ name: '[Content_Types].xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`) });
    files.push({ name: '_rels/.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) });
    files.push({ name: 'xl/workbook.xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`) });
    files.push({ name: 'xl/_rels/workbook.xml.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) });
    files.push({ name: 'xl/styles.xml', data: enc.encode(STYLES) });

    sheets.forEach((sh, si) => {
      const maxCols = Math.max(1, ...sh.rows.map(r => r.length));
      let x = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${colName(maxCols - 1)}${Math.max(1, sh.rows.length)}"/>`;
      x += `<sheetViews><sheetView workbookViewId="0"${si === 0 ? ' tabSelected="1"' : ''}>${sh.header ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' : ''}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>`;
      if (sh.widths) x += `<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`;
      x += '<sheetData>';
      sh.rows.forEach((row, ri) => {
        x += `<row r="${ri + 1}">`;
        row.forEach((cell, ci) => {
          if (cell === '' || cell === null || cell === undefined) return;
          let v = cell, s = sh.header && ri === 0 ? 1 : 0;
          if (typeof cell === 'object') { v = cell.v; s = cell.s ?? s; }
          const ref = colName(ci) + (ri + 1);
          if (typeof v === 'number' && Number.isFinite(v)) x += `<c r="${ref}"${s ? ` s="${s}"` : ''}><v>${v}</v></c>`;
          else if (typeof v === 'boolean') x += `<c r="${ref}"${s ? ` s="${s}"` : ''} t="b"><v>${v ? 1 : 0}</v></c>`;
          else x += `<c r="${ref}"${s ? ` s="${s}"` : ''} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
        });
        x += '</row>';
      });
      x += '</sheetData>';
      if (sh.validations && sh.validations.length) {
        x += `<dataValidations count="${sh.validations.length}">` + sh.validations.map(v =>
          `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="${v.sqref}"><formula1>"${esc(v.list.join(','))}"</formula1></dataValidation>`).join('') + '</dataValidations>';
      }
      x += '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';
      files.push({ name: `xl/worksheets/sheet${si + 1}.xml`, data: enc.encode(x) });
    });
    return zip(files);
  }

  return { readXlsx, writeXlsx, parseCsv, _crc32: crc32 };
});
