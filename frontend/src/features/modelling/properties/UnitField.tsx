/**
 * A unit of a geological model, chosen: with model units the names are
 * theirs to choose from; with none they are typed, those in use offered.
 */
import React, { useId } from 'react';
import { MenuItem, TextField } from '@mui/material';
import { useModelStore } from '../../../store/modelStore';
import type { GeoModel } from '../../model/types';
import type { TermKey } from '../../model/terms';

const NONE = '\u0000none';

interface Props {
    model: GeoModel;
    /** Its accessible name */
    label: string;
    value: string;
    onChange: (unit: string) => void;
    /** A fixed width (left out: it takes the room there is) */
    width?: number;
    term?: TermKey;
    fontSize?: number;
}

/** The units to choose from: those of the map the model reads, and any already named in it */
function unitsToChoose(maps: readonly { id: string; units: readonly { name: string }[] }[] | undefined, model: GeoModel): { mapped: boolean; names: string[] } {
    const map = maps?.find(m => m.id === model.unitMap);
    return { mapped: !!map, names: [...new Set([...(map?.units.map(u => u.name) ?? []), model.base, ...model.contacts.map(c => c.unit)].filter(Boolean))] };
}

export const UnitField: React.FC<Props> = ({ model, label, value, onChange, width, term, fontSize = 12 }) => {
    const maps = useModelStore(s => s.scene.unitMaps);
    const { mapped, names } = unitsToChoose(maps, model);
    const list = useId();
    const sx = { width, flex: width ? undefined : 1, minWidth: 0 };
    const mark = term ? { 'data-term': term } : {};
    if (mapped) {
        return (
            <TextField
                select size="small" variant="standard" value={value || NONE} onChange={e => onChange(e.target.value === NONE ? '' : e.target.value)} sx={sx}
                SelectProps={{ SelectDisplayProps: { style: { fontSize, paddingTop: 2, paddingBottom: 2 }, 'aria-label': label, ...mark } as React.HTMLAttributes<HTMLDivElement> }}
            >
                <MenuItem dense value={NONE}><em>None</em></MenuItem>
                {names.map(u => <MenuItem key={u} dense value={u}>{u}</MenuItem>)}
            </TextField>
        );
    }
    return (
        <>
            <datalist id={list}>{names.map(u => <option key={u} value={u} />)}</datalist>
            <TextField
                size="small" variant="standard" defaultValue={value} key={value} placeholder="Its name" sx={sx}
                inputProps={{ 'aria-label': label, ...mark, style: { fontSize }, list }}
                onBlur={e => { if (e.target.value.trim() !== value) onChange(e.target.value.trim()); }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLElement).blur(); }}
            />
        </>
    );
};
