/**
 * Water chemistry: mg/L → meq/L, ion-balance error, Piper (1944) diagram
 * geometry and hydrochemical facies.
 */

export const PIPER_IONS = ['Ca', 'Mg', 'Na', 'K', 'Cl', 'SO4', 'HCO3', 'CO3'] as const;
export type PiperIon = typeof PIPER_IONS[number];

/** Equivalent weight = formula weight / |charge| (g/eq). */
export const EQUIVALENT_WEIGHT: Record<PiperIon, number> = {
    Ca: 40.078 / 2, Mg: 24.305 / 2, Na: 22.98977, K: 39.0983,
    Cl: 35.453, SO4: 96.0626 / 2, HCO3: 61.0168, CO3: 60.0089 / 2,
};

export type WaterUnit = 'mg/L' | 'meq/L';

export function toMeq(value: number, ion: PiperIon, unit: WaterUnit): number {
    return unit === 'meq/L' ? value : value / EQUIVALENT_WEIGHT[ion];
}

export interface PiperSample {
    /** Cation percentages (meq): Ca, Mg, Na+K. */
    cations: [number, number, number];
    /** Anion percentages (meq): HCO3+CO3, SO4, Cl. */
    anions: [number, number, number];
    /** Ion-balance error, % (Σcat − Σan)/(Σcat + Σan)·100. */
    balance: number;
    /** Hydrochemical facies, e.g. "Ca-HCO3" or "Mixed-Cl". */
    facies: string;
}

/** Sample in meq/L (missing ions = 0). Null without cations or anions. */
export function piperSample(meq: Partial<Record<PiperIon, number | null>>): PiperSample | null {
    const v = (k: PiperIon) => {
        const x = meq[k];
        return x != null && Number.isFinite(x) && x > 0 ? x : 0;
    };
    const ca = v('Ca'), mg = v('Mg'), nak = v('Na') + v('K');
    const hco3 = v('HCO3') + v('CO3'), so4 = v('SO4'), cl = v('Cl');
    const sc = ca + mg + nak, sa = hco3 + so4 + cl;
    if (!(sc > 0) || !(sa > 0)) return null;
    const cations: [number, number, number] = [(ca / sc) * 100, (mg / sc) * 100, (nak / sc) * 100];
    const anions: [number, number, number] = [(hco3 / sa) * 100, (so4 / sa) * 100, (cl / sa) * 100];
    return { cations, anions, balance: ((sc - sa) / (sc + sa)) * 100, facies: faciesOf(cations, anions) };
}

/** Back (1966) facies: an ion is dominant above 50 % of its group, otherwise "Mixed". */
export function faciesOf(cations: [number, number, number], anions: [number, number, number]): string {
    const cat = ['Ca', 'Mg', 'Na+K'][cations.findIndex(p => p > 50)] ?? 'Mixed';
    const an = ['HCO3', 'SO4', 'Cl'][anions.findIndex(p => p > 50)] ?? 'Mixed';
    return `${cat}-${an}`;
}

/** Piper layout: unit triangles, `gap` between them, diamond above. */
export const PIPER_GAP = 0.2;
export const H = Math.sqrt(3) / 2;
type XY = [number, number];

/** Cation triangle: Ca bottom-left, Na+K bottom-right, Mg top. */
export function cationXY([ca, mg, nak]: [number, number, number]): XY {
    void ca;
    return [nak / 100 + mg / 200, (mg / 100) * H];
}

/** Anion triangle: HCO3+CO3 bottom-left, Cl bottom-right, SO4 top. */
export function anionXY([hco3, so4, cl]: [number, number, number]): XY {
    void hco3;
    return [1 + PIPER_GAP + cl / 100 + so4 / 200, (so4 / 100) * H];
}

/**
 * Diamond point: the cation point projected up-right (parallel to the
 * Na+K–Mg edge) meets the anion point projected up-left.
 */
export function diamondXY(c: XY, a: XY): XY {
    const t = (a[0] - c[0]) + (a[1] - c[1]) / (2 * H);
    return [c[0] + 0.5 * t, c[1] + H * t];
}

/** Outline vertices (closed) of the two triangles and the diamond. */
export function piperFrame(): { cation: XY[]; anion: XY[]; diamond: XY[] } {
    const g = PIPER_GAP;
    return {
        cation: [[0, 0], [1, 0], [0.5, H], [0, 0]],
        anion: [[1 + g, 0], [2 + g, 0], [1.5 + g, H], [1 + g, 0]],
        diamond: [[1 + g / 2, H * g], [1.5 + g / 2, H * (1 + g)], [1 + g / 2, H * (2 + g)], [0.5 + g / 2, H * (1 + g)], [1 + g / 2, H * g]],
    };
}

const ION_WORDS: Record<PiperIon, RegExp> = {
    Ca: /^(ca|calcium)$/i, Mg: /^(mg|magnesium)$/i, Na: /^(na|sodium)$/i, K: /^(k|potassium)$/i,
    Cl: /^(cl|chloride)$/i, SO4: /^(so4|sulphate|sulfate)$/i, HCO3: /^(hco3|bicarbonate|alkalinity)$/i, CO3: /^(co3|carbonate)$/i,
};

/** First token of a column name ("Ca_mg/L" → "Ca") matched against each ion. */
export function guessIonColumns(names: string[]): Partial<Record<PiperIon, string>> {
    const out: Partial<Record<PiperIon, string>> = {};
    for (const ion of PIPER_IONS) {
        const hit = names.find(n => ION_WORDS[ion].test(n.split(/[^A-Za-z0-9]+/)[0] ?? ''));
        if (hit) out[ion] = hit;
    }
    return out;
}
