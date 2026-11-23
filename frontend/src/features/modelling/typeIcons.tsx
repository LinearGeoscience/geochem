/**
 * What a surface, a contact or a fault is to a geologist, as an icon (the
 * tree's rows and the head of an editor show the same one), named for
 * whoever hovers over it or has it read out.
 */
import React from 'react';
import { BubbleChart, CallSplit, Layers, LayersOutlined, Lens, Terrain, Timeline, TripOrigin, Waves } from '@mui/icons-material';
import type { SxProps, Theme } from '@mui/material';
import { typeTerm, type ObjectType } from '../model/objectTypes';
import { t } from '../model/terms';

const TYPE_ICON: Record<ObjectType, typeof Layers> = {
    deposit: Layers, erosion: Waves, intrusion: BubbleChart, vein: Timeline, fault: CallSplit, topography: Terrain,
    offset: LayersOutlined, shell: TripOrigin, contact: Layers, body: Lens, surface: Layers,
};

export const TypeIcon: React.FC<{ type: ObjectType; sx?: SxProps<Theme> }> = ({ type, sx }) => {
    const Icon = TYPE_ICON[type];
    return <Icon data-type={type} titleAccess={t(typeTerm(type))} sx={sx} />;
};
