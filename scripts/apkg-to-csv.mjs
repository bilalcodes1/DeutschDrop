import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import AdmZip from 'adm-zip';
import Database from 'better-sqlite3';

const [, , inputPath, outputPath] = process.argv;

if (!inputPath || !outputPath) {
    console.error('Usage: node scripts/apkg-to-csv.mjs input.apkg output.csv');
    process.exit(1);
}

const resolvedInput = path.resolve(inputPath);
const resolvedOutput = path.resolve(outputPath);

if (!fs.existsSync(resolvedInput)) {
    console.error(`Input file not found: ${resolvedInput}`);
    process.exit(1);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deutschdrop-apkg-'));
const collectionPath = path.join(tempDir, 'collection.anki2');

try {
    extractCollection(resolvedInput, collectionPath);
    const rows = readNoteRows(collectionPath);
    writeCsv(resolvedOutput, rows);
    console.log(`Wrote ${rows.length} rows to ${resolvedOutput}`);
} finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
}

function extractCollection(apkgPath, destinationPath) {
    const zip = new AdmZip(apkgPath);
    const entry = zip.getEntry('collection.anki2') ?? zip.getEntry('collection.anki21');

    if (!entry) {
        throw new Error('APKG does not contain collection.anki2 or collection.anki21');
    }

    fs.writeFileSync(destinationPath, entry.getData());
}

function readNoteRows(collectionFile) {
    const db = new Database(collectionFile, { readonly: true, fileMustExist: true });
    try {
        const notes = db.prepare('SELECT flds FROM notes ORDER BY id').all();
        const seen = new Set();
        const rows = [];

        for (const note of notes) {
            const fields = String(note.flds ?? '').split('\x1f');
            const german = cleanField(fields[0] ?? '');
            const arabic = cleanField(fields[1] ?? '');

            if (!german || !arabic) continue;

            const key = `${german.toLocaleLowerCase()}\x1f${arabic.toLocaleLowerCase()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            rows.push({ german, arabic });
        }

        return rows;
    } finally {
        db.close();
    }
}

function cleanField(value) {
    return String(value)
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function writeCsv(filePath, rows) {
    const csv = [
        'German,Arabic',
        ...rows.map(row => `${escapeCsv(row.german)},${escapeCsv(row.arabic)}`),
    ].join('\n');

    fs.writeFileSync(filePath, `${csv}\n`, 'utf8');
}

function escapeCsv(value) {
    if (!/[",\n\r]/.test(value)) return value;
    return `"${value.replace(/"/g, '""')}"`;
}
