// Convierte el archivo del plan de estudios en texto, sin mandarlo a ningún lado.
// Devuelve { sheets: [{ name, text }] }: una entrada por hoja de Excel, o una sola para el resto.
(function (root) {
  const LIMIT = 15 * 1024 * 1024;
  const decode = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');

  // ---------- Excel: un .xlsx es un zip con XML adentro
  async function unzip(buffer) {
    const v = new DataView(buffer);
    let eocd = -1;
    for (let i = buffer.byteLength - 22; i >= 0 && i > buffer.byteLength - 70000; i--) {
      if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('formato');
    const count = v.getUint16(eocd + 10, true);
    let p = v.getUint32(eocd + 16, true);
    const out = {};
    const text = new TextDecoder();
    for (let i = 0; i < count; i++) {
      if (v.getUint32(p, true) !== 0x02014b50) throw new Error('formato');
      const method = v.getUint16(p + 10, true);
      const size = v.getUint32(p + 20, true);
      const nameLen = v.getUint16(p + 28, true);
      const extraLen = v.getUint16(p + 30, true);
      const commentLen = v.getUint16(p + 32, true);
      const offset = v.getUint32(p + 42, true);
      const name = text.decode(new Uint8Array(buffer, p + 46, nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      if (!/^xl\/(workbook\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml)$/.test(name)) continue;
      const start = offset + 30 + v.getUint16(offset + 26, true) + v.getUint16(offset + 28, true);
      const data = new Uint8Array(buffer, start, size);
      if (method === 0) out[name] = text.decode(data);
      else if (method === 8) {
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        out[name] = await new Response(stream).text();
      } else throw new Error('formato');
    }
    return out;
  }
  const colNum = (ref) => { let n = 0; for (const ch of ref.replace(/\d/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
  async function readXlsx(buffer) {
    const files = await unzip(buffer);
    const wb = files['xl/workbook.xml'];
    if (!wb) throw new Error('formato');
    const shared = [...(files['xl/sharedStrings.xml'] || '').matchAll(/<si>([\s\S]*?)<\/si>/g)]
      .map((m) => decode([...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
    const rels = {};
    for (const m of (files['xl/_rels/workbook.xml.rels'] || '').matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /\bId="([^"]+)"/.exec(m[0]); const target = /\bTarget="([^"]+)"/.exec(m[0]);
      if (id && target) rels[id[1]] = target[1].replace(/^\/?(xl\/)?/, 'xl/');
    }
    const sheets = [];
    for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
      const name = /\bname="([^"]*)"/.exec(m[0]); const rid = /\br:id="([^"]+)"/.exec(m[0]);
      const xml = rid && files[rels[rid[1]]];
      if (!xml) continue;
      const lines = [];
      for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
        const cells = [];
        for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const inner = c[2] || '';
          const ref = /\br="([A-Z]+\d+)"/.exec(c[1]);
          const type = /\bt="([^"]+)"/.exec(c[1]);
          let value = '';
          if (type && type[1] === 's') { const i = /<v>(\d+)<\/v>/.exec(inner); value = i ? shared[+i[1]] || '' : ''; }
          else if (type && type[1] === 'inlineStr') value = decode([...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
          else if (type && type[1] === 'str') { const i = /<v>([\s\S]*?)<\/v>/.exec(inner); value = i ? decode(i[1]) : ''; }
          else if (type && type[1] === 'b') value = '';
          else { const i = /<v>([\s\S]*?)<\/v>/.exec(inner); value = i ? i[1] : ''; }
          if (String(value).trim()) cells.push({ col: ref ? colNum(ref[1]) : cells.length, value: String(value).trim().replace(/\s+/g, ' ') });
        }
        if (cells.length) lines.push(cells.map((x) => x.value).join('\t'));
      }
      sheets.push({ name: name ? decode(name[1]) : `Hoja ${sheets.length + 1}`, text: lines.join('\n') });
    }
    if (!sheets.length) throw new Error('formato');
    return { sheets };
  }

  // ---------- PDF: reconstruye las líneas a partir de la posición del texto en la página
  async function readPdf(buffer) {
    const pdfjs = await import(new URL('vendor/pdf.min.mjs', document.baseURI).href);
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.mjs', document.baseURI).href;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false }).promise;
    const out = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const rows = [];
      for (const it of content.items) {
        if (!it.str || !it.str.trim()) continue;
        const y = it.transform[5]; const x = it.transform[4];
        let row = rows.find((r) => Math.abs(r.y - y) < 3);
        if (!row) { row = { y, items: [] }; rows.push(row); }
        row.items.push({ x, end: x + (it.width || 0), str: it.str });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const r of rows) {
        r.items.sort((a, b) => a.x - b.x);
        let line = '';
        r.items.forEach((it, i) => {
          if (i) { const gap = it.x - r.items[i - 1].end; line += gap > 10 ? '\t' : gap > 1 ? ' ' : ''; }
          line += it.str;
        });
        out.push(line.trim());
      }
      out.push('');
    }
    const text = out.join('\n').trim();
    if (!text) throw new Error('sin-texto');
    return { sheets: [{ name: 'PDF', text }] };
  }

  // ---------- CSV y texto
  function readText(buffer) {
    let text = new TextDecoder().decode(buffer);
    if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buffer);
    return text.replace(/^﻿/, '');
  }
  function csvToTabs(text) {
    const first = text.split(/\r?\n/, 1)[0];
    const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
    return text.split(/\r?\n/).map((line) => {
      const cells = []; let cur = ''; let q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (ch === sep && !q) { cells.push(cur.trim()); cur = ''; } else cur += ch;
      }
      cells.push(cur.trim());
      return cells.filter(Boolean).join('\t');
    }).join('\n');
  }

  async function read(file) {
    if (file.size > LIMIT) throw new Error('grande');
    const name = (file.name || '').toLowerCase();
    const buffer = await file.arrayBuffer();
    if (name.endsWith('.xlsx')) return readXlsx(buffer);
    if (name.endsWith('.pdf')) return readPdf(buffer);
    if (name.endsWith('.csv')) return { sheets: [{ name: 'CSV', text: csvToTabs(readText(buffer)) }] };
    if (name.endsWith('.txt')) return { sheets: [{ name: 'Texto', text: readText(buffer) }] };
    throw new Error('tipo');
  }

  // Elige la hoja que más se parece a un plan: por nombre, o la que tiene más materias.
  function bestSheet(sheets, parse) {
    const named = sheets.findIndex((s) => /plan|carrera|materia/i.test(s.name));
    if (named >= 0) return named;
    let best = 0; let max = -1;
    sheets.forEach((s, i) => { const n = parse(s.text).items.length; if (n > max) { max = n; best = i; } });
    return best;
  }

  root.CursadaImport = { read, readXlsx, csvToTabs, bestSheet };
})(typeof window !== 'undefined' ? window : globalThis);
