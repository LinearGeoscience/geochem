/**
 * Lithology colours: rock codes coloured by family, after the Linear
 * Geoscience mapping template's '4 - Basemap' fills (the QGIS mapping
 * tools' `Template/patterns/lith_fills.tsv`).
 *
 * - A code's FAMILY is its first letter: F felsic, I intermediate, M mafic,
 *   U ultramafic, S sedimentary, H metamorphic, Z sheared, V vein,
 *   R regolith, T transported cover. Letter case does not matter.
 * - A code the basemap has takes the basemap's colour. Any other code of a
 *   family takes the colour of the basemap code it shares the longest start
 *   with, when that start is at least two letters (FDAC -> FD dacite,
 *   IDI -> ID diorite); this is how the first two letters split a family
 *   the way the basemap does (felsic volcanics yellow, felsic intrusives
 *   pink; mafic volcanics green, mafic intrusives teal). Otherwise it takes
 *   the family's colour.
 * - The basemap fills are pale, made to fill polygons under a texture.
 *   Here they are deepened to show as points on a white plot, keeping
 *   their hue; near-white fills (transported cover) take the family colour.
 * - Codes that would look alike are moved apart, lighter or darker and a
 *   little round the hue, until every class can be told from the others,
 *   while staying in its family's colour.
 * - Codes starting with any other letter are grouped by that letter on
 *   muted neutral colours.
 */

/** The ten families of the basemap's codes, by first letter */
export const LITH_FAMILIES: Record<string, string> = {
    F: 'Felsic', I: 'Intermediate', M: 'Mafic', U: 'Ultramafic', S: 'Sedimentary',
    H: 'Metamorphic', Z: 'Sheared', V: 'Vein', R: 'Regolith', T: 'Transported cover',
};

/** Basemap fill per code (families only), from the mapping template's lith_fills.tsv */
const BASEMAP_FILLS = [
    'F:feafc2 FAB:feafc2 FAPL:fedee6 FD:fdeca5 FGAP:feafc2 FGD:fc94b7 FGM:feafc2 FGR2M:feafc2 FGR:feafc2',
    'FGRA:feafc2 FGRB:feafc2 FGRL:fec8d5 FGY:feafc2 FI:feafc2 FIG:fef1ae FMG:feafc2 FMZQ:fc94b7 FP:fce093',
    'FPG:fda6be FPGS:f79bb8 FQFP:fdeca5 FQP:fef5b8 FR:fdeca5 FRD:fef5b8 FSY:fda6be FSYG:fee4d9 FTA:fde79c',
    'FTJ:fda6be FTO:feb9c7 FTX:fef1ae FV:fef5b8 FVC:fef8c1 FVP:fefbcb FVX:fef1ae HAMP:8abcc1 HBL:6caea9',
    'HCAT:9a9086 HCK:c86a44 HCS:c8cf9e HEC:84babd HFBX:8e857b HFG:e09a72 HGF:d4794f HGG:d96a4e',
    'HGGA:e3876f HGI:55ecc4 HGM:84babd HGOU:a79d92 HGS:78b6b5 HGT:a0455a HGU:6c3d9a HHF:b08968 HIG:55ecc4',
    'HMB:c3ddd2 HMG:84babd HMI:b04168 HMID:af3a58 HMIM:c95672 HMIN:e89fb0 HMIP:f0b6c3 HMIS:e0889d',
    'HMIT:d8718a HMY:82786f HPA:8abcc1 HPC:8abcc1 HPEG:5b90c2 HPG:5b90c2 HPH:5b90c2 HPK:8abcc1',
    'HPMA:8abcc1 HPPG:5b90c2 HPSG:5b90c2 HPST:6b6259 HSK:a8a05c HSL:5b90c2 HUMY:6f675e I:84f5db IA:6bf1c4',
    'IAC:73f2cc IBN:7bf4d4 ICB:73f2cc ID:84f5db IDQ:73f2cc II:84f5db IIG:7bf4d4 ILP:7bf4d4 IMC:73f2cc',
    'IMZ:84f5db IMZD:84f5db IP:84f5db IPG:7bf4d4 ITA:8df5e1 IVC:84f5db IVX:7bf4d4 M:e4f0e4 MAGG:c8ddc3',
    'MAM:85b98b MB:d2e4cf MBA:d2e4cf MBFS:c4dabd MBK:d2e4cf MBP:d2e4cf MBV:d2e4cf MBX:d2e4cf MD:b0ced2',
    'MDF:b0ced2 MDFS:55a9ad MDH:62aab3 MDQ:98c3c3 MG:bfd6da MGA:5b908b MGBO:c6dade MGF:8bbbb7 MGFS:62aab3',
    'MGGN:bfd6da MGGNO:c6dade MGL:5b908e MGN:99c4c4 MGNO:c6dade MGQ:a0c7c9 MGT:a8cbcd MGTC:c6dade',
    'MGY:afced1 MI:bfd6da MLP:a4c9cb MMZG:b7d2d6 MPC:c8ddc3 MPG:a4c9cb RARZ:ffefdb RBX:ffefdb RCC:fff9f3',
    'RDLM:ffeed6 RDLN:faead7 RDLP:ffeed6 RDLX:ffeed6 RFC:ffe9d2 RFSP:ffe9d2 RGO:876e4c RIST:ffeed6',
    'RMZ:ffeed6 RPLZ:ffeed6 RSIL:fee3c8 RSLS:ffefdb RSLU:cbc1d1 RSPC:ffeed6 RSPL:e4d5c4 RSPR:ffeed6',
    'RSPU:ffeed6 S:67a2c7 SAK:e7dab1 SBS:7a8288 SBX:cfc9ab SCA:71a5d0 SCG:c1b796 SCGFM:5d68c3',
    'SCGFP:656cc6 SCGIM:6dbdc9 SCGIP:71c1d0 SCGMM:78d3cb SCGMP:80d6d1 SCGUM:ac88d8 SCGUP:b490db',
    'SCT:bbc4ca SCTB:c5ccd2 SDM:98b4de SDO:78a7d3 SDOSL:6ea3c9 SEV:e3e0d3 SGT:fcedc1 SGW:71a5d0',
    'SHC:f8f8f8 SIF:895245 SJP:965f4a SLI:a5c0ca SMD:6ea3c9 SML:78a7d3 SPE:7f868d SPH:bf9c7d SPP:898f96',
    'SPR:71a5d0 SPS:71a5d0 SQT:78a7d3 SSH:848a92 SSL:dedede SSLS:dbd7c4 SST:eee8c7 SSTF:8eaeda',
    'SSTL:eee8c7 SSTM:efebd0 SSTP:7fa9d5 SSTQ:8eaeda SSTR:78a7d3 SSTS:e4dbc0 STB:7fa9d5 STI:a0b8e0',
    'STU:7fa9d5 SW:8eaeda TAES:f7ecf2 TALL:ecf7f8 TASH:e7f2f8 TBCH:ebf5ef TCO:fcf3ed TCOC:f8f4f1',
    'TCOD:f5f5f1 TCOS:fff2ef TCY:f1f1fa TDLP:f7edeb TEVS:e0eef0 TFIL:f4e8ec TGFO:e6edec TGRV:f5f4fb',
    'TGYP:eef6fd THP:f5ebe6 TLAC:e8f5f1 TLG:fcf3f1 TLGC:f3f5ee TLOE:f7f0f8 TLSC:f5e9e8 TLSD:edebe4',
    'TLTP:eef0e8 TMUD:eaf4f2 TPEA:f5f1e8 TRSL:f1f6ed TRSLM:e8ede4 TRSS:eeece8 TSA:e9f7fa TSAC:f3f4f8',
    'TSI:ebf1f6 TSP:f1f6f3 TSW:f1f5fe TTIL:e8ecef U-A:b0a0bc U-CA:b0a0bc U-T:786487 U-TA:b0a0bc',
    'U-TCB:786487 U-TCBA:786487 U:b0a0bc UCR:7b4daf UDN:855db7 UHB:8351b4 UHZ:895ab8 UKI:8351b4',
    'UKO:998aac UKOC:8351b4 UKOS:a595b4 ULP:8351b4 ULZ:895ab8 UPD:895ab8 UPDO:895ab8 UPG:8351b4',
    'UPY:8b58b7 UPYC:8b58b7 UPYO:8b58b7 USP:766487 USPX:b0a0bc UWB:8b58b7 UWBO:8c59b8 UWH:895ab8',
    'VC:c15666 VEG:fdfdfd VL:f9917e VN:f9917e VOID:f7f7f7 VPG:f75050 VQ:c6646d VQC:f5484d VS:f9917e',
    'VSTW:f75e59 VT:f9917e VX:f75050 ZBXS:8cacc9 ZBXSI:819fc4 ZCS:628789 ZF:eea5b7 ZGT:578eaa ZI:79dcc2',
    'ZM:b1c6cb ZMAM:a6c0c3 ZMB:b1c6cb ZMD:b1c6cb ZMG:b1c6cb ZQM:6393b2 ZS:94a9ce ZSAS:6f97b9 ZSBS:7b9dc0',
    'ZSPE:94a9ce ZSQT:87a3c7 ZSST:94a9ce ZU-A:765696 ZU-CA:765696 ZU-P:765696 ZU-T:765595 ZU-TA:765696',
    'ZU-TCB:765595 ZU:765696',
].join(' ').split(' ').map(p => p.split(':') as [string, string]);

const BASEMAP = new Map(BASEMAP_FILLS.map(([code, fill]) => [code, `#${fill}`]));

/** The basemap fill that stands for each family where a code matches no basemap code by two letters */
const FAMILY_FILL: Record<string, string> = {
    F: '#feafc2', I: '#84f5db', M: '#d2e4cf', U: '#8351b4', S: '#78a7d3',
    H: '#9a9086', Z: '#94a9ce', V: '#f9917e', R: '#ffeed6',
};
/** Transported cover is near-white in the basemap: a khaki grey here */
const TRANSPORTED = hslHex(45, 0.2, 0.58);

/** Codes of other first letters, by letter (first letter met gets the first colour) */
const NEUTRALS = ['#8d8d8d', '#a1887f', '#8a8f5c', '#6d7f99', '#9c7a96', '#b0956a', '#6f8f84', '#a07070'];

// ---- colour maths ---------------------------------------------------------------

type Rgb = [number, number, number];

function hexRgb(hex: string): Rgb {
    const h = hex.replace('#', '');
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

function rgbHsl([r, g, b]: Rgb): [number, number, number] {
    const R = r / 255, G = g / 255, B = b / 255;
    const max = Math.max(R, G, B), min = Math.min(R, G, B);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    let h: number;
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    return [(h * 60 + 360) % 360, s, l];
}

function hslHex(h: number, s: number, l: number): string {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = (((h % 360) + 360) % 360) / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
    const m = l - c / 2;
    return `#${[r1, g1, b1].map(v => Math.round(Math.min(1, Math.max(0, v + m)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** CIE L*a*b* (D65) of an sRGB colour */
function rgbLab(rgb: Rgb): [number, number, number] {
    const lin = rgb.map(v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    const x = (lin[0] * 0.4124 + lin[1] * 0.3576 + lin[2] * 0.1805) / 0.95047;
    const y = lin[0] * 0.2126 + lin[1] * 0.7152 + lin[2] * 0.0722;
    const z = (lin[0] * 0.0193 + lin[1] * 0.1192 + lin[2] * 0.9505) / 1.08883;
    const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    const fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE(a: [number, number, number], b: [number, number, number]): number {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---- basemap fill -> point colour -----------------------------------------------

/** Fills paler than this (chroma) carry no usable hue */
const NEUTRAL_CHROMA = 0.06;
const L_LO = 0.3, L_HI = 0.68, S_MIN = 0.32, S_MAX = 0.65;
/** Yellows go darker, or they vanish on white */
const YELLOW_L_MAX = 0.5;

/** HSL of a basemap fill deepened to show as a point, or null for a near-white fill */
function pointHsl(fill: string): [number, number, number] | null {
    const [h, s, l] = rgbHsl(hexRgb(fill));
    if (s * (1 - Math.abs(2 * l - 1)) < NEUTRAL_CHROMA) return null;
    let L = clamp(L_LO + ((l - 0.25) / 0.75) * (L_HI - L_LO), L_LO, L_HI);
    if (h >= 38 && h <= 75) L = Math.min(L, YELLOW_L_MAX);
    return [h, clamp(s, S_MIN, S_MAX), L];
}

function familyHsl(letter: string): [number, number, number] {
    if (letter === 'T') return rgbHsl(hexRgb(TRANSPORTED));
    return pointHsl(FAMILY_FILL[letter])!;
}

/** Length of the start two codes share */
function sharedStart(a: string, b: string): number {
    let k = 0;
    while (k < a.length && k < b.length && a[k] === b[k]) k++;
    return k;
}

/** The basemap code a code takes its colour from: itself, else the one sharing the longest start (2+ letters) */
function basemapMatch(code: string): string | null {
    if (BASEMAP.has(code)) return code;
    let best: string | null = null, bestLen = 1;
    for (const ref of BASEMAP.keys()) {
        if (ref[0] !== code[0]) continue;
        const k = sharedStart(code, ref);
        // Longest shared start wins; then the shorter (more general) basemap code; then A-Z
        if (k > bestLen || (k === bestLen && best !== null && (ref.length < best.length || (ref.length === best.length && ref < best)))) {
            best = ref; bestLen = k;
        }
    }
    return bestLen >= 2 ? best : null;
}

/** Family letter of a code, or null when its first letter is no family */
export function lithFamily(code: string): string | null {
    const c = code.trim().charAt(0).toUpperCase();
    return c in LITH_FAMILIES ? c : null;
}

// ---- telling the codes apart ----------------------------------------------------

/** Smallest difference (CIE76) kept between the colours of two codes */
const MIN_DIFFERENCE = 11;
const L_STEP = 0.06, H_STEP = 7;
const L_MIN = 0.22, L_MAX = 0.76;

/** Moves to try, smallest first, darker before lighter (points sit on white): then a little round the hue, never far enough to reach another family */
const MOVES: [number, number][] = (() => {
    const out: [number, number][] = [];
    for (let dl = -6; dl <= 6; dl++) for (let dh = -1; dh <= 1; dh++) out.push([dl, dh]);
    return out.sort((a, b) => (Math.abs(a[0]) + Math.abs(a[1]) * 1.2) - (Math.abs(b[0]) + Math.abs(b[1]) * 1.2)
        || a[0] - b[0] || a[1] - b[1]);
})();

/**
 * The colour of each code: its family colour from the basemap, moved apart
 * from the codes already placed so that no two look alike. Codes the
 * basemap has are placed first and keep their colour (shorter codes first);
 * then codes matched by their first letters, then by family alone, then the
 * other codes.
 */
export function lithologyColours(values: readonly string[]): Map<string, string> {
    const otherLetters = [...new Set(values.filter(v => !lithFamily(v)).map(v => v.trim().charAt(0).toUpperCase()))]
        .sort((a, b) => a.localeCompare(b));
    const items = values.map(value => {
        const code = value.trim().toUpperCase();
        const family = lithFamily(code);
        if (!family) {
            const k = otherLetters.indexOf(code.charAt(0));
            return { value, rank: 3, hsl: rgbHsl(hexRgb(NEUTRALS[Math.max(0, k) % NEUTRALS.length])) };
        }
        // Transported cover's fills are all near-white tints: the family colour for all of it
        const ref = family === 'T' ? null : basemapMatch(code);
        const hsl = ref ? pointHsl(BASEMAP.get(ref)!) : null;
        if (hsl) return { value, rank: ref === code ? 0 : 1, hsl };
        return { value, rank: 2, hsl: familyHsl(family) };
    });
    // The general codes (F, FV, I) keep the family colours; the more particular ones move round them
    items.sort((a, b) => a.rank - b.rank || a.value.trim().length - b.value.trim().length
        || a.value.localeCompare(b.value, undefined, { numeric: true }));

    const placed: [number, number, number][] = [];
    const out = new Map<string, string>();
    for (const it of items) {
        const [h, s, l] = it.hsl;
        let best = '', bestLab: [number, number, number] = [0, 0, 0], bestGap = -1;
        for (const [dl, dh] of MOVES) {
            const hex = hslHex(h + dh * H_STEP, s, clamp(l + dl * L_STEP, L_MIN, L_MAX));
            const lab = rgbLab(hexRgb(hex));
            const gap = placed.reduce((m, p) => Math.min(m, deltaE(p, lab)), Infinity);
            if (gap >= MIN_DIFFERENCE) { best = hex; bestLab = lab; bestGap = gap; break; }
            if (gap > bestGap) { best = hex; bestLab = lab; bestGap = gap; }
        }
        placed.push(bestLab);
        out.set(it.value, best);
    }
    return out;
}

/** One colour per family, for the palette's swatch */
export const LITHOLOGY_SWATCH: string[] = ['F', 'FV', 'I', 'M', 'MG', 'U', 'S', 'V', 'R'].map(code => {
    const ref = basemapMatch(code);
    const hsl = (ref && pointHsl(BASEMAP.get(ref)!)) || familyHsl(code[0]);
    return hslHex(...hsl);
});
