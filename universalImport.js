import { getSupportedCsvParameters, parseWaterReadingsCsv } from './csvImport.js';

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_PDF_PAGES = 20;
const MAX_OCR_PDF_PAGES = 3;
const PARAMETER_ROWS = getSupportedCsvParameters();
const NORMALIZE = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const SITE_HEADER_ALIASES = ['siteid', 'objectid', 'site', 'object', 'location', 'asset', 'station', 'sensorid', 'area', 'waterbody', 'monitoringpoint'];
const TIME_HEADER_ALIASES = ['timestamp', 'datetime', 'date', 'recordedat', 'measuredat', 'time', 'createdat'];

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rowsToCsv(rows) {
  return rows.map(row => row.map(csvCell).join(',')).join('\n');
}

function flattenRecord(value, prefix = '', output = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
    for (const [key, child] of Object.entries(value)) {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      if (child && typeof child === 'object' && !Array.isArray(child)) flattenRecord(child, nextPrefix, output);
      else if (Array.isArray(child)) output[key] = child.map(item => typeof item === 'object' ? JSON.stringify(item) : item).join('; ');
      else output[key] = child;
    }
  } else if (prefix) output[prefix] = value;
  return output;
}

function collectObjectArrays(value, output = [], depth = 0) {
  if (depth > 8 || value == null) return output;
  if (Array.isArray(value)) {
    const objectRows = value.filter(item => item && typeof item === 'object' && !Array.isArray(item));
    if (objectRows.length) output.push(objectRows.map(row => flattenRecord(row)));
    for (const item of value) collectObjectArrays(item, output, depth + 1);
  } else if (typeof value === 'object') {
    for (const child of Object.values(value)) collectObjectArrays(child, output, depth + 1);
  }
  return output;
}

function jsonCandidates(text) {
  const parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  const arrays = collectObjectArrays(parsed);
  const normalized = arrays
    .filter(rows => rows.length)
    .map(rows => ({ rows, score: rows.reduce((sum, row) => sum + Object.keys(row).filter(key => canonicalField(key)?.kind === 'parameter').length, 0) }))
    .sort((a, b) => b.score - a.score);
  const candidates = normalized.map(({ rows }) => rowsToCsv([
    [...new Set(rows.flatMap(row => Object.keys(row)))],
    ...rows.map(row => {
      const keys = [...new Set(rows.flatMap(item => Object.keys(item)))];
      return keys.map(key => row[key] ?? '');
    }),
  ]));
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const flat = flattenRecord(parsed);
    if (Object.keys(flat).length) candidates.push(rowsToCsv([Object.keys(flat), Object.values(flat)]));
  }
  if (Array.isArray(parsed) && parsed.length && parsed.every(item => item && typeof item === 'object' && !Array.isArray(item))) {
    const rows = parsed.map(row => flattenRecord(row));
    const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
    candidates.unshift(rowsToCsv([keys, ...rows.map(row => keys.map(key => row[key] ?? ''))]));
  }
  return candidates;
}

function canonicalField(rawName) {
  let name = String(rawName ?? '').trim()
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s*\[[^\]]*\]\s*$/, '')
    .replace(/\s+(?:units?|mg\s*\/\s*l|ug\s*\/\s*l|µg\s*\/\s*l|ntu|°?c|ppm|ppt)$/i, '')
    .trim();
  const normalized = NORMALIZE(name.split(/[./]/).pop());
  if (SITE_HEADER_ALIASES.includes(normalized)) return { kind: 'site', header: 'site_id' };
  if (TIME_HEADER_ALIASES.includes(normalized)) return { kind: 'time', header: 'timestamp' };
  for (const spec of PARAMETER_ROWS) {
    const aliases = [spec.label, spec.key, ...(spec.aliases || [])].map(NORMALIZE);
    if (aliases.includes(normalized)) return { kind: 'parameter', header: spec.label };
  }
  // Handles headings such as “Turbidity NTU” or “Dissolved Oxygen mg/L”.
  const looseMatch = PARAMETER_ROWS
    .map(spec => ({ spec, aliases: [spec.label, spec.key, ...(spec.aliases || [])].map(NORMALIZE) }))
    .flatMap(item => item.aliases.map(alias => ({ ...item, alias })))
    .filter(item => item.alias.length >= 2 && normalized.startsWith(item.alias))
    .sort((a, b) => b.alias.length - a.alias.length)[0];
  if (looseMatch) return { kind: 'parameter', header: looseMatch.spec.label };
  return null;
}

function delimitedCandidates(text) {
  const clean = String(text ?? '').replace(/^\uFEFF/, '').trim();
  if (!clean) return [];
  const lines = clean.split(/\r?\n/).filter(line => line.trim());
  const candidates = [clean];
  for (const delimiter of ['\t', ';', '|']) {
    const sample = lines.slice(0, 8);
    if (sample.filter(line => line.includes(delimiter)).length >= Math.min(2, sample.length)) {
      const rows = lines.map(line => {
        const cells = [];
        let cell = '';
        let quoted = false;
        for (let i = 0; i < line.length; i += 1) {
          const ch = line[i];
          if (ch === '"') {
            if (quoted && line[i + 1] === '"') { cell += '"'; i += 1; }
            else quoted = !quoted;
          } else if (ch === delimiter && !quoted) { cells.push(cell.trim()); cell = ''; }
          else cell += ch;
        }
        cells.push(cell.trim());
        return cells;
      });
      candidates.push(rowsToCsv(rows));
    }
  }
  return candidates;
}

function stripMarkup(text) {
  let source = String(text ?? '');
  // Preserve water-parameter tags in simple XML exports, e.g. <pH>7.1</pH>.
  const knownNames = PARAMETER_ROWS.flatMap(spec => [spec.label, spec.key, ...(spec.aliases || [])]);
  for (const name of [...new Set(knownNames)].sort((a, b) => b.length - a.length)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tagPattern = new RegExp(`<(${escaped})(?:\\s+[^>]*)?>([^<]+)<\\/\\1\\s*>`, 'gi');
    source = source.replace(tagPattern, (_, tag, value) => `\n${tag}: ${value.trim()}\n`);
  }
  return source
    .replace(/<\/(?:td|th|tr|p|br|div|li|h[1-6]|section|article|table)>/gi, '\n')
    .replace(/<(?:td|th|tr|p|br|div|li|h[1-6]|section|article|table)\b[^>]*>/gi, '\t')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"');
}

function keyValueCandidate(text) {
  const found = new Map();
  const warnings = [];
  const lines = String(text ?? '').replace(/\u00a0/g, ' ').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (const line of lines) {
    // Key/value reports usually look like “pH: 7.2” or “Turbidity    5 NTU”.
    const match = line.match(/^\s*([A-Za-zµ°][A-Za-z0-9µ° _./()\-]{0,70}?)\s*(?::|=|\t+|\s{1,})\s*([-+]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][-+]?\d+)?)(?:\s|$)/);
    if (!match) continue;
    const field = canonicalField(match[1]);
    if (!field) continue;
    let value = match[2];
    if (value.includes(',') && !value.includes('.')) value = value.replace(',', '.');
    if (field.kind === 'parameter') found.set(field.header, value);
    else if (field.kind === 'site') found.set('site_id', line.slice(match[0].length).trim() || match[2]);
    else if (field.kind === 'time') {
      // Date/time text may not be a measurement; capture it only when it is plainly provided.
      const dateMatch = line.match(/(?:timestamp|datetime|date|time|recorded at|measured at)\s*[:=]?\s*(.+)$/i);
      if (dateMatch) found.set('timestamp', dateMatch[1].trim());
    }
  }
  if (found.size && [...found.keys()].some(key => canonicalField(key)?.kind === 'parameter')) {
    const headers = [...found.keys()];
    const values = headers.map(header => found.get(header));
    return { csv: rowsToCsv([headers, values]), warnings };
  }
  return null;
}

function textCandidates(text) {
  const clean = String(text ?? '').trim();
  if (!clean) return [];
  const candidates = delimitedCandidates(clean);
  const pairs = keyValueCandidate(clean);
  if (pairs) candidates.unshift(pairs.csv);
  // Many copied laboratory reports use aligned columns with spaces instead of commas.
  const lines = clean.split(/\r?\n/).filter(line => line.trim());
  if (lines.length >= 2 && lines.some(line => /\s{2,}/.test(line))) {
    const rows = lines.map(line => line.trim().split(/\s{2,}/).map(cell => cell.trim()));
    if (rows[0].length >= 2) candidates.push(rowsToCsv(rows));
  }
  return [...new Set(candidates)];
}

function parseCandidates(candidates, selected) {
  const errors = [];
  for (const candidate of candidates) {
    try {
      const parsed = parseWaterReadingsCsv(candidate, selected);
      return parsed;
    } catch (error) {
      if (error instanceof Error) errors.push(error.message);
    }
  }
  throw new Error(errors[0] || 'Could not find a supported numeric water-quality measurement in this file.');
}

export function parseWaterReadingsText(text, selected, options = {}) {
  let content = String(text ?? '');
  if (options.markup) content = stripMarkup(content);
  const candidates = [];
  if (options.tryJson !== false) {
    try { candidates.push(...jsonCandidates(content)); } catch { /* not JSON; continue with text parsing */ }
  }
  candidates.push(...textCandidates(content));
  return parseCandidates(candidates, selected);
}

function pdfItemsToText(items) {
  const entries = items.filter(item => item.str && item.str.trim()).map(item => ({
    x: item.transform?.[4] ?? 0,
    y: item.transform?.[5] ?? 0,
    text: item.str.trim(),
  })).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const entry of entries) {
    let line = lines.findLast?.(item => Math.abs(item.y - entry.y) < 2.5);
    if (!line) {
      line = { y: entry.y, entries: [] };
      lines.push(line);
    }
    line.entries.push(entry);
  }
  return lines.sort((a, b) => b.y - a.y).map(line => {
    const parts = line.entries.sort((a, b) => a.x - b.x);
    let previousX = null;
    let previousWidth = 0;
    let output = '';
    for (const part of parts) {
      const gap = previousX == null ? 0 : part.x - (previousX + previousWidth);
      output += previousX == null ? part.text : `${gap > 28 ? '\t' : gap > 5 ? '  ' : ' '}${part.text}`;
      previousX = part.x;
      previousWidth = Math.max(5, part.text.length * 4.5);
    }
    return output;
  }).join('\n');
}

async function makeOcrWorker(onProgress) {
  const tesseract = await import('tesseract.js');
  return tesseract.createWorker('eng', 1, {
    logger: message => {
      if (message?.status) {
        const percent = Number.isFinite(message.progress) ? ` ${Math.round(message.progress * 100)}%` : '';
        onProgress?.(`OCR: ${message.status}${percent}`);
      }
    },
  });
}

async function recognizeImage(file, onProgress) {
  onProgress?.('Loading OCR engine… (first image may need internet access)');
  const worker = await makeOcrWorker(onProgress);
  try {
    let imageSource = file;
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('The browser could not prepare this image for OCR.');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close?.();
      imageSource = canvas;
    }
    const result = await worker.recognize(imageSource);
    return result.data.text || '';
  } finally {
    await worker.terminate();
  }
}

async function readPdf(file, selected, onProgress) {
  onProgress?.('Extracting text from PDF…');
  const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
  try {
    const workerUrl = await import('pdfjs-dist/build/pdf.worker.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.default;
  } catch {
    // pdf.js may fall back to its fake worker, depending on the host bundler.
  }
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const warnings = [];
  const texts = [];
  const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES);
  if (pdf.numPages > MAX_PDF_PAGES) warnings.push(`Only the first ${MAX_PDF_PAGES} pages of this PDF were scanned.`);
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    onProgress?.(`Reading PDF page ${pageNumber} of ${pageCount}…`);
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    texts.push(pdfItemsToText(content.items || []));
  }
  const pdfText = texts.join('\n');
  try {
    const parsed = parseWaterReadingsText(pdfText, selected);
    return { ...parsed, warnings, extractionMethod: 'PDF text extraction' };
  } catch (textError) {
    // Scanned PDFs often contain images rather than selectable text. OCR a few pages.
    const worker = await makeOcrWorker(onProgress);
    try {
      const ocrTexts = [];
      const pagesToOcr = Math.min(pdf.numPages, MAX_OCR_PDF_PAGES);
      for (let pageNumber = 1; pageNumber <= pagesToOcr; pageNumber += 1) {
        onProgress?.(`OCR on scanned PDF page ${pageNumber} of ${pagesToOcr}…`);
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1.6 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('The browser could not prepare the PDF page for OCR.');
        await page.render({ canvasContext: context, viewport }).promise;
        const result = await worker.recognize(canvas);
        ocrTexts.push(result.data.text || '');
      }
      if (pdf.numPages > pagesToOcr) warnings.push(`OCR was run on only the first ${pagesToOcr} pages of this scanned PDF.`);
      const parsed = parseWaterReadingsText(ocrTexts.join('\n'), selected);
      return { ...parsed, warnings, extractionMethod: 'PDF OCR' };
    } catch (ocrError) {
      throw new Error(`No readable water measurements were found in the PDF. Text extraction said: ${textError.message} OCR said: ${ocrError instanceof Error ? ocrError.message : 'unknown OCR error'}`);
    } finally {
      await worker.terminate();
    }
  }
}

async function readSpreadsheet(file, selected) {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const errors = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    try {
      const parsed = parseWaterReadingsText(csv, selected, { tryJson: false });
      return { ...parsed, extractionMethod: `Spreadsheet sheet: ${sheetName}` };
    } catch (error) { errors.push(error instanceof Error ? error.message : 'Unsupported spreadsheet sheet.'); }
  }
  throw new Error(errors[0] || 'No supported water readings were found in the spreadsheet sheets.');
}

async function readDocx(file, selected) {
  const mammoth = await import('mammoth/mammoth.browser');
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  const parsed = parseWaterReadingsText(result.value, selected);
  const warnings = result.messages?.length ? [`Document extraction reported ${result.messages.length} formatting notice(s).`] : [];
  return { ...parsed, warnings, extractionMethod: 'Word document text extraction' };
}

function extensionOf(file) {
  return String(file?.name || '').split('.').pop().toLowerCase();
}

/**
 * Read common structured files and extract supported water readings. This is not a guarantee
 * that arbitrary files can be interpreted; the file must contain readable, labelled values.
 */
export async function parseWaterReadingsFile(file, selected, onProgress) {
  if (!file) throw new Error('Choose a file first.');
  if (!file.size) throw new Error('This file is empty.');
  if (file.size > MAX_FILE_BYTES) throw new Error('This file is larger than 15 MB. Please use a smaller file.');
  const extension = extensionOf(file);
  let parsed;
  let extractionMethod = 'Text parser';
  let warnings = [];

  if (['csv', 'tsv'].includes(extension)) {
    onProgress?.('Reading delimited text…');
    const text = await file.text();
    parsed = parseWaterReadingsText(text, selected);
    extractionMethod = extension.toUpperCase() + ' parser';
  } else if (['txt', 'text', 'md', 'log', 'xml', 'html', 'htm', 'rtf'].includes(extension)) {
    onProgress?.('Reading text and searching for labelled measurements…');
    let text = await file.text();
    if (['xml', 'html', 'htm', 'rtf'].includes(extension)) {
      if (extension === 'rtf') text = text.replace(/\\[a-z]+\d* ?/gi, ' ').replace(/[{}]/g, ' ');
      else text = stripMarkup(text);
    }
    parsed = parseWaterReadingsText(text, selected, { tryJson: true });
    extractionMethod = 'Text/table parsing';
  } else if (extension === 'json') {
    onProgress?.('Reading JSON records…');
    parsed = parseWaterReadingsText(await file.text(), selected);
    extractionMethod = 'JSON parsing';
  } else if (['xlsx', 'xls', 'xlsm', 'ods'].includes(extension)) {
    onProgress?.('Opening spreadsheet…');
    parsed = await readSpreadsheet(file, selected);
    extractionMethod = parsed.extractionMethod || 'Spreadsheet parser';
  } else if (extension === 'pdf') {
    const result = await readPdf(file, selected, onProgress);
    parsed = result;
    extractionMethod = result.extractionMethod || 'PDF extraction';
    warnings = result.warnings || [];
  } else if (['docx'].includes(extension)) {
    onProgress?.('Extracting text from Word document…');
    const result = await readDocx(file, selected);
    parsed = result;
    extractionMethod = result.extractionMethod || 'Word document text extraction';
    warnings = result.warnings || [];
  } else if (['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff'].includes(extension)) {
    const text = await recognizeImage(file, onProgress);
    parsed = parseWaterReadingsText(text, selected);
    extractionMethod = 'Image OCR';
    warnings = ['Image text recognition can misread decimal points, units, or labels. Check every extracted reading against the original image.'];
  } else {
    throw new Error(`Unsupported file type “.${extension}”. Supported formats: CSV, TSV, TXT, JSON, XLSX, XLS, ODS, PDF, DOCX, HTML, XML, Markdown, and common images (PNG/JPG/WebP/TIFF). For other files, export the readings to CSV or XLSX first.`);
  }

  return {
    ...parsed,
    warnings: [...(parsed.warnings || []), ...warnings],
    fileType: extension.toUpperCase(),
    extractionMethod,
  };
}

export const SUPPORTED_IMPORT_EXTENSIONS = '.csv,.tsv,.txt,.text,.json,.xlsx,.xls,.xlsm,.ods,.pdf,.docx,.html,.htm,.xml,.md,.log,.rtf,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff';
