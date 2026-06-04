export interface ParsedWordRow {
    german: string;
    arabic: string;
    example: string | null;
}

export interface CsvParseResult {
    words: ParsedWordRow[];
    errors: number;
}

export function parseWordCsv(content: string): CsvParseResult {
    const rows = parseDelimitedRows(content);
    const result: CsvParseResult = { words: [], errors: 0 };
    if (rows.length === 0) return result;

    const first = rows[0].map(cell => cleanCell(cell).toLowerCase());
    const hasHeader = first.includes('german') || first.includes('arabic') || first.includes('deutsch');
    const dataRows = hasHeader ? rows.slice(1) : rows;

    for (const row of dataRows) {
        if (row.length === 0 || row.every(cell => !cell.trim())) continue;

        const simplePair = row.length === 1 ? parseEqualsPair(row[0]) : null;
        const german = simplePair?.german ?? cleanCell(row[0] ?? '');
        const arabic = simplePair?.arabic ?? cleanCell(row[1] ?? '');
        const example = simplePair ? null : cleanCell(row[2] ?? '') || null;

        if (!german || !arabic) {
            result.errors++;
            continue;
        }

        result.words.push({ german, arabic, example });
    }

    return result;
}

function parseEqualsPair(line: string): { german: string; arabic: string } | null {
    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) return null;

    return {
        german: cleanCell(line.slice(0, separatorIndex)),
        arabic: cleanCell(line.slice(separatorIndex + 1)),
    };
}

function cleanCell(value: string): string {
    return value.replace(/^\uFEFF/, '').trim().replace(/\s+/g, ' ');
}

function parseDelimitedRows(content: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < content.length; i++) {
        const char = content[i];
        const next = content[i + 1];

        if (char === '"') {
            if (inQuotes && next === '"') {
                field += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (char === ',' && !inQuotes) {
            row.push(field);
            field = '';
            continue;
        }

        if ((char === '\n' || char === '\r') && !inQuotes) {
            if (char === '\r' && next === '\n') i++;
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
            continue;
        }

        field += char;
    }

    row.push(field);
    rows.push(row);

    return rows.filter(r => r.some(cell => cell.trim()));
}
