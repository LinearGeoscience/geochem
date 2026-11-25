/**
 * CIPW norm (Cross, Iddings, Pirsson & Washington 1902) in the standard
 * computer formulation (e.g. Kelsey 1965; Verma et al. 2002 SINCLAS order):
 * zircon, apatite, ilmenite, orthoclase, albite, acmite/Na-metasilicate,
 * anorthite/corundum, titanite/rutile, magnetite/hematite, diopside/
 * wollastonite, hypersthene; then the silica deficiency is removed by
 * hypersthene→olivine, titanite→perovskite, albite→nepheline,
 * orthoclase→leucite, wollastonite→Ca-orthosilicate, diopside→Ca-
 * orthosilicate + olivine, leucite→kaliophilite.
 *
 * MnO is added to FeO (as is conventional). Mineral weights use the same
 * molecular weights as the "CIPW Norm" expression chain so the two
 * agree; volume % uses the same densities.
 */

export const CIPW_OXIDES = ['SiO2', 'TiO2', 'Al2O3', 'Fe2O3', 'FeO', 'MnO', 'MgO', 'CaO', 'Na2O', 'K2O', 'P2O5', 'ZrO2'] as const;
export type CipwOxide = typeof CIPW_OXIDES[number];
export type CipwInput = Partial<Record<CipwOxide, number | null>>;

const MW: Record<CipwOxide, number> = {
    SiO2: 60.0843, TiO2: 79.8788, Al2O3: 101.9612, Fe2O3: 159.6922, FeO: 71.8464, MnO: 70.9374,
    MgO: 40.3044, CaO: 56.0794, Na2O: 61.979, K2O: 94.196, P2O5: 141.9446, ZrO2: 123.218,
};

export const CIPW_MINERALS = [
    'Q', 'C', 'Z', 'Or', 'Ab', 'An', 'Lc', 'Ne', 'Kp', 'Ac', 'Ns', 'Ks',
    'Di', 'Wo', 'Hy', 'Ol', 'Cs', 'Mt', 'Hm', 'Il', 'Tn', 'Pf', 'Ru', 'Ap',
] as const;
export type CipwMineral = typeof CIPW_MINERALS[number];

export const CIPW_MINERAL_NAMES: Record<CipwMineral, string> = {
    Q: 'Quartz', C: 'Corundum', Z: 'Zircon', Or: 'Orthoclase', Ab: 'Albite', An: 'Anorthite',
    Lc: 'Leucite', Ne: 'Nepheline', Kp: 'Kaliophilite', Ac: 'Acmite', Ns: 'Na-metasilicate',
    Ks: 'K-metasilicate', Di: 'Diopside', Wo: 'Wollastonite', Hy: 'Hypersthene', Ol: 'Olivine',
    Cs: 'Ca-orthosilicate', Mt: 'Magnetite', Hm: 'Hematite', Il: 'Ilmenite', Tn: 'Titanite',
    Pf: 'Perovskite', Ru: 'Rutile', Ap: 'Apatite',
};

/** Densities (g/cm³) for volume % — as in the chain (Cs uses a realistic 3.27). */
const DENSITY: Record<CipwMineral, number> = {
    Q: 2.65, C: 3.98, Z: 4.56, Or: 2.56, Ab: 2.62, An: 2.76, Lc: 2.49, Ne: 2.56, Kp: 2.54, Ac: 3.6,
    Ns: 2.4, Ks: 2.5, Di: 3.278, Wo: 2.86, Hy: 3.55, Ol: 3.32, Cs: 3.27, Mt: 5.2, Hm: 5.25, Il: 4.75,
    Tn: 3.5, Pf: 4.0, Ru: 4.2, Ap: 3.2,
};

export type FeSplit =
    | { kind: 'as-given' }
    /** Fe2O3/FeO weight ratio, e.g. 0.15 (Middlemost 1989 basalts ~0.2). */
    | { kind: 'ratio'; fe2o3ToFeo: number }
    /** Le Maitre (1976) FeO/(FeO+Fe2O3) from SiO2 and alkalis. */
    | { kind: 'le-maitre'; rock: 'volcanic' | 'plutonic' };

export interface CipwOptions {
    /** Recalculate oxides to 100 % (anhydrous) before the norm. Default true. */
    normalize?: boolean;
    /** How to split total iron when only one Fe oxide is given, or always. Default as-given. */
    fe?: FeSplit;
}

export interface CipwResult {
    /** Mineral wt %. */
    wt: Record<CipwMineral, number>;
    /** Mineral volume %, normalised to 100. */
    vol: Record<CipwMineral, number>;
    /** Differentiation index Q + Or + Ab + Ne + Lc + Kp (wt %). */
    DI: number;
    /** Sum of mineral wt % (≈ oxide total). */
    total: number;
    /** Oxides actually used (after Fe split / normalisation), wt %. */
    oxides: Record<CipwOxide, number>;
}

const FE2O3_TO_FEO = (2 * MW.FeO) / MW.Fe2O3; // 0.8998

/** Split / re-split iron per `fe`. Returns [Fe2O3, FeO] wt %. */
export function splitIron(ox: Record<CipwOxide, number>, fe: FeSplit): [number, number] {
    const feot = ox.FeO + ox.Fe2O3 * FE2O3_TO_FEO;
    if (fe.kind === 'as-given') return [ox.Fe2O3, ox.FeO];
    let feoFraction: number; // FeO / (FeO + Fe2O3), by weight
    if (fe.kind === 'ratio') {
        feoFraction = 1 / (1 + Math.max(0, fe.fe2o3ToFeo));
    } else {
        const alk = ox.Na2O + ox.K2O;
        feoFraction = fe.rock === 'volcanic'
            ? 0.93 - 0.0042 * ox.SiO2 - 0.022 * alk
            : 0.88 - 0.0016 * ox.SiO2 - 0.027 * alk;
        feoFraction = Math.min(1, Math.max(0, feoFraction));
    }
    // FeO = f·(FeO + Fe2O3) with Fe2O3 expressed so total Fe is conserved
    const feo = (feoFraction * feot) / (feoFraction + (1 - feoFraction) * FE2O3_TO_FEO);
    const fe2o3 = (feot - feo) / FE2O3_TO_FEO;
    return [fe2o3, feo];
}

const zeroMinerals = (): Record<CipwMineral, number> =>
    Object.fromEntries(CIPW_MINERALS.map(m => [m, 0])) as Record<CipwMineral, number>;

/**
 * CIPW norm of one analysis (oxide wt %). Returns null when the analysis
 * has no SiO2 or no usable total.
 */
export function cipwNorm(input: CipwInput, options: CipwOptions = {}): CipwResult | null {
    const ox = Object.fromEntries(CIPW_OXIDES.map(k => {
        const v = input[k];
        return [k, v != null && Number.isFinite(v) && v > 0 ? v : 0];
    })) as Record<CipwOxide, number>;
    if (!(ox.SiO2 > 0)) return null;

    const [fe2o3, feo] = splitIron(ox, options.fe ?? { kind: 'as-given' });
    ox.Fe2O3 = fe2o3;
    ox.FeO = feo;
    if (options.normalize ?? true) {
        const sum = CIPW_OXIDES.reduce((s, k) => s + ox[k], 0);
        if (!(sum > 0)) return null;
        for (const k of CIPW_OXIDES) ox[k] = (ox[k] / sum) * 100;
    }

    // Molecular proportions
    const m = Object.fromEntries(CIPW_OXIDES.map(k => [k, ox[k] / MW[k]])) as Record<CipwOxide, number>;
    const si = m.SiO2, mg = m.MgO, na = m.Na2O;
    let ti = m.TiO2, al = m.Al2O3, fe3 = m.Fe2O3, ca = m.CaO, k = m.K2O;
    let fe2 = m.FeO + m.MnO;
    const n = zeroMinerals(); // molecular amounts

    // Zircon, apatite
    n.Z = m.ZrO2;
    n.Ap = m.P2O5;
    ca -= (10 / 3) * n.Ap;
    if (ca < 0) ca = 0;

    // Ilmenite; excess TiO2 kept for titanite/rutile
    if (fe2 > ti) { n.Il = ti; fe2 -= ti; ti = 0; } else { n.Il = fe2; ti -= fe2; fe2 = 0; }

    // Orthoclase (excess K2O → K-metasilicate)
    let orP: number;
    if (al >= k) { orP = k; al -= k; k = 0; } else { orP = al; n.Ks = k - al; al = 0; k = 0; }

    // Albite (excess Na2O → acmite, then Na-metasilicate)
    let abP: number, naEx = 0;
    if (al >= na) { abP = na; al -= na; } else { abP = al; naEx = na - al; al = 0; }
    if (naEx > 0) {
        if (naEx > fe3) { n.Ac = fe3; n.Ns = naEx - fe3; fe3 = 0; } else { n.Ac = naEx; fe3 -= naEx; }
    }

    // Anorthite, corundum
    if (al >= ca) { n.An = ca; n.C = al - ca; ca = 0; } else { n.An = al; ca -= al; }
    al = 0;

    // Titanite (provisional), rutile
    let tnP = 0;
    if (ti > 0) {
        if (ca >= ti) { tnP = ti; ca -= ti; } else { tnP = ca; n.Ru = ti - ca; ca = 0; }
        ti = 0;
    }

    // Magnetite, hematite
    if (fe3 > fe2) { n.Mt = fe2; n.Hm = fe3 - fe2; fe2 = 0; } else { n.Mt = fe3; fe2 -= fe3; }
    fe3 = 0;

    // Mg/(Mg+Fe) for the ferromagnesian silicates
    const mf = mg + fe2;
    const xMg = mf > 0 ? mg / mf : 1;

    // Diopside, wollastonite, hypersthene (provisional)
    let diP: number, woP = 0, hyP = 0;
    if (ca > mf) { diP = mf; woP = ca - mf; } else { diP = ca; hyP = mf - ca; }

    // Silica required by the provisional minerals
    const need = n.Z + 6 * orP + n.Ks + 6 * abP + 4 * n.Ac + n.Ns + 2 * n.An + tnP + 2 * diP + woP + hyP;
    let d = need - si;
    let or = orP, ab = abP, tn = tnP, wo = woP, di = diP, hy = hyP;
    if (d <= 0) {
        n.Q = -d;
    } else {
        // Hy → Ol
        if (d < hy / 2) { n.Ol = d; hy -= 2 * d; d = 0; } else { n.Ol = hy / 2; d -= hy / 2; hy = 0; }
        // Tn → Pf
        if (d > 0) { if (d < tn) { n.Pf = d; tn -= d; d = 0; } else { n.Pf = tn; d -= tn; tn = 0; } }
        // Ab → Ne
        if (d > 0) { if (d < 4 * ab) { n.Ne = d / 4; ab -= d / 4; d = 0; } else { n.Ne = ab; d -= 4 * ab; ab = 0; } }
        // Or → Lc
        if (d > 0) { if (d < 2 * or) { n.Lc = d / 2; or -= d / 2; d = 0; } else { n.Lc = or; d -= 2 * or; or = 0; } }
        // Wo → Cs
        if (d > 0) { if (d < wo / 2) { n.Cs = d; wo -= 2 * d; d = 0; } else { n.Cs = wo / 2; d -= wo / 2; wo = 0; } }
        // Di → Cs + Ol
        if (d > 0) {
            if (d < di) { n.Cs += d / 2; n.Ol += d / 2; di -= d; d = 0; } else { n.Cs += di / 2; n.Ol += di / 2; d -= di; di = 0; }
        }
        // Lc → Kp
        if (d > 0) { const kp = Math.min(n.Lc, d / 2); n.Kp = kp; n.Lc -= kp; }
    }
    n.Or = or; n.Ab = ab; n.Tn = tn; n.Wo = wo; n.Di = di; n.Hy = hy;
    void k;

    // Weights
    const W: Record<CipwMineral, number> = {
        Q: MW.SiO2, C: MW.Al2O3, Z: MW.ZrO2 + MW.SiO2,
        Or: MW.K2O + MW.Al2O3 + 6 * MW.SiO2, Ab: MW.Na2O + MW.Al2O3 + 6 * MW.SiO2, An: MW.CaO + MW.Al2O3 + 2 * MW.SiO2,
        Lc: MW.K2O + MW.Al2O3 + 4 * MW.SiO2, Ne: MW.Na2O + MW.Al2O3 + 2 * MW.SiO2, Kp: MW.K2O + MW.Al2O3 + 2 * MW.SiO2,
        Ac: MW.Na2O + MW.Fe2O3 + 4 * MW.SiO2, Ns: MW.Na2O + MW.SiO2, Ks: MW.K2O + MW.SiO2,
        Di: MW.CaO + xMg * MW.MgO + (1 - xMg) * MW.FeO + 2 * MW.SiO2,
        Wo: MW.CaO + MW.SiO2,
        Hy: xMg * MW.MgO + (1 - xMg) * MW.FeO + MW.SiO2,
        Ol: 2 * (xMg * MW.MgO + (1 - xMg) * MW.FeO) + MW.SiO2,
        Cs: 2 * MW.CaO + MW.SiO2, Mt: MW.FeO + MW.Fe2O3, Hm: MW.Fe2O3, Il: MW.FeO + MW.TiO2,
        Tn: MW.CaO + MW.TiO2 + MW.SiO2, Pf: MW.CaO + MW.TiO2, Ru: MW.TiO2, Ap: (10 / 3) * MW.CaO + MW.P2O5,
    };
    const wt = zeroMinerals();
    let total = 0;
    for (const min of CIPW_MINERALS) { wt[min] = n[min] * W[min]; total += wt[min]; }

    const vol = zeroMinerals();
    let vsum = 0;
    for (const min of CIPW_MINERALS) { vol[min] = wt[min] / DENSITY[min]; vsum += vol[min]; }
    if (vsum > 0) for (const min of CIPW_MINERALS) vol[min] = (vol[min] / vsum) * 100;

    return { wt, vol, DI: wt.Q + wt.Or + wt.Ab + wt.Ne + wt.Lc + wt.Kp, total, oxides: ox };
}
