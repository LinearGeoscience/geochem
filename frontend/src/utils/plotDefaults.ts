/**
 * Sensible starting settings for a new plot: chemistry plots never start on
 * ID or coordinate columns; maps start on East/North.
 */
import type { ColumnGeochemMapping } from '../types/associations';
import type { PlotType } from '../store/appStore';
import { buildColumnOptions, ColumnOption, PickerColumn } from './columnGroups';
import { guessAxisColumn } from '../features/plots/viewer3d/coordinateColumns';

const REE_ORDER = ['La', 'Ce', 'Pr', 'Nd', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu'];
const MAJOR_ORDER = ['SiO2', 'TiO2', 'Al2O3', 'Fe2O3', 'Fe2O3T', 'FeO', 'FeOT', 'MnO', 'MgO', 'CaO', 'Na2O', 'K2O', 'P2O5'];

interface Chem {
    majors: ColumnOption[];
    traces: ColumnOption[];
    ree: ColumnOption[];
    /** Majors, then traces, then REE. */
    all: ColumnOption[];
}

const species = (o: ColumnOption) => (o.oxide ?? o.element ?? '').toLowerCase();

function chemistry(columns: PickerColumn[], mappings: ColumnGeochemMapping[]): Chem {
    const opts = buildColumnOptions(columns, mappings, 'numeric');
    const rank = (list: string[], o: ColumnOption) => {
        const k = list.findIndex(x => x.toLowerCase() === species(o));
        return k < 0 ? list.length : k;
    };
    const majors = opts.filter(o => o.group === 'Major oxides').sort((a, b) => rank(MAJOR_ORDER, a) - rank(MAJOR_ORDER, b));
    const traces = opts.filter(o => o.group === 'Trace elements');
    const ree = opts.filter(o => o.group === 'REE' && o.element !== 'Y').sort((a, b) => rank(REE_ORDER, a) - rank(REE_ORDER, b));
    return { majors, traces, ree, all: [...majors, ...traces, ...ree] };
}

const bySpecies = (list: ColumnOption[], ...names: string[]) =>
    names.map(n => list.find(o => species(o) === n.toLowerCase())).find(Boolean);

function eastNorth(columns: PickerColumn[]): { xAxis?: string; yAxis?: string } {
    const cols = columns.map(c => ({ name: c.name, type: c.type, role: c.role }));
    const x = columns.find(c => c.role === 'East')?.name || guessAxisColumn(cols, 'x');
    const y = columns.find(c => c.role === 'North')?.name || guessAxisColumn(cols, 'y');
    return { ...(x ? { xAxis: x } : {}), ...(y ? { yAxis: y } : {}) };
}

const names = (l: (ColumnOption | undefined)[]) => l.filter((o): o is ColumnOption => !!o).map(o => o.name);

/** Settings to seed a new plot of `type`; empty when nothing sensible exists. */
export function suggestPlotSettings(type: PlotType, columns: PickerColumn[], mappings: ColumnGeochemMapping[]): Record<string, any> {
    const chem = chemistry(columns, mappings);
    switch (type) {
        case 'scatter': {
            const x = bySpecies(chem.majors, 'SiO2') ?? chem.all[0];
            const y = bySpecies(chem.majors, 'MgO', 'Al2O3') ?? chem.all.find(o => o !== x);
            return x && y && x !== y ? { xAxis: x.name, yAxes: [y.name] } : {};
        }
        case 'ternary': {
            // Ca–Na–K, else the first three non-silica majors, else any three elements
            const cnk = names([bySpecies(chem.majors, 'CaO'), bySpecies(chem.majors, 'Na2O'), bySpecies(chem.majors, 'K2O')]);
            const majors = names(chem.majors.filter(o => species(o) !== 'sio2').slice(0, 3));
            const abc = cnk.length === 3 ? cnk : majors.length === 3 ? majors : names(chem.all.slice(0, 3));
            return abc.length === 3 ? { aAxis: abc[0], bAxis: abc[1], cAxis: abc[2] } : {};
        }
        case 'spider':
            if (chem.ree.length >= 3) return { selectedElements: names(chem.ree) };
            return chem.traces.length ? { selectedElements: names(chem.traces.slice(0, 12)) } : {};
        case 'splom':
            return chem.all.length >= 2 ? { splomColumns: names(chem.all.slice(0, 6)) } : {};
        case 'histogram':
            return chem.all.length ? { selectedColumns: [(chem.traces[0] ?? chem.all[0]).name] } : {};
        case 'clr': {
            const parts = chem.majors.length >= 3 ? chem.majors : chem.all.slice(0, 8);
            return parts.length >= 3 ? { clrColumns: names(parts) } : {};
        }
        case 'map':
            return eastNorth(columns);
        case 'contour': {
            const el = chem.traces[0]?.element;
            return { ...eastNorth(columns), ...(el ? { selectedElements: [el] } : {}) };
        }
        case 'downhole':
            return chem.all.length ? { selectedFields: names(chem.all.slice(0, 3)) } : {};
        default:
            return {};
    }
}
