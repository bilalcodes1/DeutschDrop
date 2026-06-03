export interface PictogramSearchResult {
    provider: 'arasaac';
    pictogramId: string;
    imageUrl: string;
    thumbnailUrl: string;
    title: string;
    license: string;
    attribution: string;
    sourceUrl: string;
}

interface ArasaacPictogram {
    _id: number;
    keywords?: Array<{ keyword?: string }>;
    aac?: boolean;
    aacColor?: boolean;
    schematic?: boolean;
}

const ARASAAC_LICENSE = 'CC BY-NC-SA 4.0';
const ARASAAC_ATTRIBUTION = 'Pictogram: ARASAAC / Sergio Palao';

export async function searchEducationalPictograms(
    german: string,
    arabic?: string | null,
    limit: number = 3
): Promise<PictogramSearchResult[]> {
    const germanResults = await searchArasaac('de', german, limit);
    if (germanResults.length > 0) return germanResults;

    if (arabic) {
        return searchArasaac('ar', arabic, limit);
    }

    return [];
}

export async function searchArasaac(
    language: 'de' | 'ar',
    term: string,
    limit: number = 3
): Promise<PictogramSearchResult[]> {
    const cleaned = term.trim();
    if (!cleaned) return [];

    const url = `https://api.arasaac.org/api/pictograms/${language}/search/${encodeURIComponent(cleaned)}`;
    const response = await fetch(url, {
        headers: { Accept: 'application/json' },
    });
    if (!response.ok) return [];

    const rows = await response.json<ArasaacPictogram[]>();
    return normalizeArasaacResults(rows, cleaned).slice(0, limit);
}

export function normalizeArasaacResults(rows: ArasaacPictogram[], term: string): PictogramSearchResult[] {
    return [...rows]
        .sort((a, b) => scoreArasaac(b, term) - scoreArasaac(a, term))
        .map(row => {
            const id = String(row._id);
            const title = bestTitle(row, term);
            return {
                provider: 'arasaac',
                pictogramId: id,
                imageUrl: buildArasaacImageUrl(id),
                thumbnailUrl: buildArasaacImageUrl(id),
                title,
                license: ARASAAC_LICENSE,
                attribution: ARASAAC_ATTRIBUTION,
                sourceUrl: `https://arasaac.org/pictograms/${id}`,
            };
        });
}

export function buildArasaacImageUrl(id: string | number): string {
    return `https://static.arasaac.org/pictograms/${id}/${id}_300.png`;
}

function bestTitle(row: ArasaacPictogram, term: string): string {
    const exact = row.keywords?.find(item => item.keyword?.toLowerCase() === term.toLowerCase())?.keyword;
    return exact ?? row.keywords?.[0]?.keyword ?? term;
}

function scoreArasaac(row: ArasaacPictogram, term: string): number {
    const keywords = row.keywords?.map(item => item.keyword?.toLowerCase() ?? '') ?? [];
    const normalizedTerm = term.toLowerCase();
    let score = 0;
    if (keywords.includes(normalizedTerm)) score += 100;
    if (row.aac) score += 20;
    if (row.aacColor) score += 10;
    if (row.schematic) score += 5;
    return score;
}
