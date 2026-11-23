/**
 * Dataset projection ("Define Projection"): the EPSG code of the
 * East/North columns. Maps use it unless a map sets its own; WGS84 Long/Lat
 * conversion and GIS export read it.
 */
import React from 'react';
import { Autocomplete, TextField, Tooltip } from '@mui/material';
import { useAppStore } from '../store/appStore';
import { ALL_EPSG_CODES, epsgOption, EpsgOption } from '../utils/epsgCodes';

const OPTIONS = ALL_EPSG_CODES.filter(e => e.code !== '');

export const ProjectionPicker: React.FC<{ minWidth?: number }> = ({ minWidth = 320 }) => {
    const datasetEpsg = useAppStore(s => s.datasetEpsg);
    const setDatasetEpsg = useAppStore(s => s.setDatasetEpsg);
    return (
        <Tooltip title="Coordinate system of the East/North columns (e.g. MGA zone 50). Maps, Long/Lat conversion and GIS export use it." placement="top">
            <Autocomplete<EpsgOption, false, false, true>
                size="small"
                freeSolo
                options={OPTIONS}
                value={epsgOption(datasetEpsg)}
                getOptionLabel={o => (typeof o === 'string' ? o : o.label)}
                isOptionEqualToValue={(a, b) => a.code === b.code}
                onChange={(_, v) => {
                    if (v === null) setDatasetEpsg(null);
                    else setDatasetEpsg(epsgOption(typeof v === 'string' ? v.trim() : v.code)?.code ?? null);
                }}
                renderInput={params => <TextField {...params} label="Projection" placeholder="None (local grid)" />}
                sx={{ minWidth }}
            />
        </Tooltip>
    );
};
