/**
 * Parse uploaded CSV / Excel for column mapping and import.
 * Uses SheetJS (xlsx) — supports .csv, .xlsx, .xls, .ods.
 */
import * as XLSX from 'xlsx';

function decodeTextBuffer(buf) {
    const u8 = new Uint8Array(buf);
    if (u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
        return new TextDecoder('utf-8').decode(u8.slice(3));
    }
    if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) {
        return new TextDecoder('utf-16le').decode(u8.slice(2));
    }
    if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff) {
        return new TextDecoder('utf-16be').decode(u8.slice(2));
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(u8);
}

function firstSheetToRows(wb) {
    if (!wb?.SheetNames?.length) return [];
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
}

function normalizeHeaders(raw) {
    const seen = new Map();
    return raw.map((h, i) => {
        let name = String(h ?? '').trim();
        if (!name) name = `Column_${i + 1}`;
        let key = name;
        let n = 0;
        while (seen.has(key)) {
            key = `${name}_${++n}`;
        }
        seen.set(key, true);
        return key;
    });
}

function rowsToObjects(rows) {
    if (!rows?.length) return { headers: [], data: [] };
    const rawHeaders = rows[0].map((c) => c);
    const headers = normalizeHeaders(rawHeaders);
    const data = rows.slice(1).map((row) => {
        const obj = {};
        headers.forEach((h, i) => {
            obj[h] = row[i];
        });
        return obj;
    });
    return { headers, data };
}

function parseCsvWithDelimiter(text, fs) {
    const wb = XLSX.read(text, { type: 'string', raw: false, FS: fs });
    return firstSheetToRows(wb);
}

function parseCsvText(text) {
    const firstLine = (text.split(/\r?\n/).find((l) => l.trim().length) || '').trim();
    let rows = parseCsvWithDelimiter(text, ',');

    if (rows[0]?.length === 1 && firstLine.includes(';')) {
        const trySemi = parseCsvWithDelimiter(text, ';');
        if (trySemi[0]?.length > 1) rows = trySemi;
    }
    if (rows[0]?.length === 1 && firstLine.includes('\t')) {
        const tryTab = parseCsvWithDelimiter(text, '\t');
        if (tryTab[0]?.length > 1) rows = tryTab;
    }
    return rows;
}

export async function readHeadersAndData(file) {
    const name = (file?.name || '').toLowerCase();
    const mime = (file?.type || '').toLowerCase();
    const buf = await file.arrayBuffer();

    const isCsv =
        name.endsWith('.csv') ||
        name.endsWith('.tsv') ||
        mime.includes('csv') ||
        mime === 'text/plain' ||
        mime === 'text/csv';

    if (isCsv && !name.endsWith('.xlsx') && !name.endsWith('.xls')) {
        const text = decodeTextBuffer(buf);
        const rows = name.endsWith('.tsv') ? parseCsvWithDelimiter(text, '\t') : parseCsvText(text);
        return rowsToObjects(rows);
    }

    const wb = XLSX.read(buf, { type: 'array' });
    const rows = firstSheetToRows(wb);
    return rowsToObjects(rows);
}
