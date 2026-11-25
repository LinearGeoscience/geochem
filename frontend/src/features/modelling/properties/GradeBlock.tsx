/**
 * Grade by part of the ground (Phase 273), asked for from the properties of
 * what the parts are: a numeric model (inside each of its shells), a
 * geological model (by lithology, as modelled and as logged) or a mesh from
 * a file (inside it). Worked out when asked for; put in the report from here.
 */
import React, { useEffect, useState } from 'react';
import { Box, Button, TextField, Typography } from '@mui/material';
import { useModelStore } from '../../../store/modelStore';
import { useGeoModelCache } from '../../model/geoModelCache';
import { gradeByMesh, gradeByModel, gradeByShells, gradeRows, gradeToReport, type GradeAsked } from '../../model/gradeReport';
import { shellColumns } from '../../model/logging';
import { useModelCache } from '../../model/modelCache';
import { smallButton } from './styles';

const cell = { padding: '2px 10px 2px 0', textAlign: 'left', fontWeight: 'inherit', verticalAlign: 'top' } as const;
const select = { native: true, inputProps: { style: { fontSize: 13, paddingTop: 2, paddingBottom: 2 } } } as const;

export type GradeOf = { kind: 'numeric'; id: string } | { kind: 'model'; id: string; logged: boolean } | { kind: 'mesh'; id: string };

/** One table as asked for, with the way to the report */
const Table: React.FC<{ asked: GradeAsked; name: string }> = ({ asked, name }) => {
    const [said, setSaid] = useState('');
    if (!asked.ok) return <Typography data-testid={`grade-${name}-problem`} variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.5 }}>{asked.reason}</Typography>;
    const { columns, rows } = gradeRows(asked);
    return (
        <Box sx={{ mt: 0.75 }}>
            <Typography variant="caption" sx={{ display: 'block', fontWeight: 600 }}>{asked.title}</Typography>
            <Box sx={{ overflowX: 'auto' }}>
                <Box component="table" data-testid={`grade-${name}`} sx={{ borderCollapse: 'collapse', fontSize: 12, mt: 0.25, whiteSpace: 'nowrap' }}>
                    <thead>
                        <tr>{columns.map((c, i) => <Box component="th" key={i} sx={{ ...cell, color: 'text.secondary' }}>{c}</Box>)}</tr>
                    </thead>
                    <tbody>
                        {rows.map((r, k) => (
                            <Box component="tr" key={k} sx={k === rows.length - 1 ? { borderTop: 1, borderColor: 'divider' } : undefined}>
                                {r.map((v, i) => <Box component="td" key={i} sx={cell}>{v}</Box>)}
                            </Box>
                        ))}
                    </tbody>
                </Box>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3, mt: 0.25 }}>{asked.caption}</Typography>
            <Button size="small" variant="outlined" data-action={`grade-${name}-report`} sx={{ ...smallButton, mt: 0.5 }} onClick={() => { gradeToReport(asked); setSaid('The table is in the report.'); }}>
                Add the table to the report
            </Button>
            {said && <Typography data-testid={`grade-${name}-said`} variant="caption" sx={{ display: 'block', mt: 0.25 }}>{said}</Typography>}
        </Box>
    );
};

export const GradeBlock: React.FC<{ of: GradeOf }> = ({ of }) => {
    const coords = useModelStore(s => s.scene.coords);
    const columns = of.kind === 'numeric' ? [] : shellColumns(coords);
    const [column, setColumn] = useState('');
    const [cut, setCut] = useState('');
    const [asked, setAsked] = useState<{ name: string; asked: GradeAsked }[] | null>(null);
    // (What the table was read off: when it changes, the table is no longer of it)
    const fits = useModelCache(s => (of.kind === 'numeric' ? s.byId : null));
    const numeric = useModelStore(s => (of.kind === 'numeric' ? s.scene.numericModels?.find(m => m.id === of.id) : null));
    const built = useGeoModelCache(s => (of.kind === 'model' ? s.byId[of.id]?.out : null));
    useEffect(() => { setAsked(null); }, [fits, numeric, built, of.kind, of.id]);

    const chosen = columns.includes(column) ? column : columns[0] ?? '';
    const typed = cut.trim() === '' ? null : Number(cut);
    const badCut = typed !== null && !(Number.isFinite(typed) && typed > 0);
    const work = () => {
        const top = badCut ? null : typed;
        if (of.kind === 'numeric') setAsked([{ name: 'shells', asked: gradeByShells(of.id) }]);
        else if (of.kind === 'mesh') setAsked([{ name: 'mesh', asked: gradeByMesh(of.id, chosen, top) }]);
        else setAsked([{ name: 'modelled', asked: gradeByModel(of.id, chosen, top, true) }, ...(of.logged ? [{ name: 'logged', asked: gradeByModel(of.id, chosen, top, false) }] : [])]);
    };
    const heading = of.kind === 'numeric' ? 'Grade inside its shells' : of.kind === 'mesh' ? 'Grade inside it' : 'Grade by lithology';
    // Nothing assayed in the data: said, not left blank
    if (of.kind !== 'numeric' && columns.length === 0) {
        return (
            <Box data-testid="grade-block" sx={{ mt: 1.5 }}>
                <Typography variant="subtitle2">{heading}</Typography>
                <Typography data-testid="grade-none" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    The data has no column of numbers (an assay) to count a grade from.
                </Typography>
            </Box>
        );
    }

    return (
        <Box data-testid="grade-block" sx={{ mt: 1.5 }}>
            <Typography variant="subtitle2">{heading}</Typography>
            <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1, flexWrap: 'wrap', mt: 0.25 }}>
                {of.kind !== 'numeric' && (
                    <>
                        <TextField
                            select size="small" variant="standard" SelectProps={select} value={chosen} sx={{ minWidth: 110 }}
                            inputProps={{ 'aria-label': 'The column whose grade is counted', 'data-field': 'grade-column' }} onChange={e => setColumn(e.target.value)}
                        >
                            {columns.map(c => <option key={c} value={c}>{c}</option>)}
                        </TextField>
                        <TextField
                            size="small" variant="standard" value={cut} placeholder="Top cut (none)" error={badCut} sx={{ width: 110 }}
                            inputProps={{ 'aria-label': 'Top cut', 'data-field': 'grade-top-cut', inputMode: 'decimal', style: { fontSize: 13, paddingTop: 2, paddingBottom: 2 } }} onChange={e => setCut(e.target.value)}
                        />
                    </>
                )}
                <Button size="small" variant="outlined" data-action="grade-work" sx={smallButton} disabled={badCut} onClick={work}>Work it out</Button>
            </Box>
            {asked?.map(a => <Table key={a.name} name={a.name} asked={a.asked} />)}
        </Box>
    );
};
