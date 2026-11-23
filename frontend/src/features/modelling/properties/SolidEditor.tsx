/**
 * A lithology's solid in a geological model, in the properties: what it is
 * of, how much ground it holds and what share of the model that is, shown or
 * not in the view, and the way to the model's outputs.
 */
import React from 'react';
import { Box, Link, Typography } from '@mui/material';
import { formatVolume } from '../../model/describe';
import { useGeoModelCache } from '../../model/geoModelCache';
import { keys, parseModelPart } from '../../model/objectKeys';
import type { TreeNode } from '../../model/projectTree';
import { t } from '../../model/terms';
import { useModelStore } from '../../../store/modelStore';
import { Fact, LookRow } from './parts';

export const SolidEditor: React.FC<{ node: TreeNode; onGoTo: (key: string) => void }> = ({ node, onGoTo }) => {
    const part = parseModelPart(node.key);
    const model = useModelStore(s => s.scene.models?.find(g => g.id === part?.model));
    const built = useGeoModelCache(s => (part ? s.byId[part.model] : undefined));
    if (!part || !model) return null;
    const u = built?.units.indexOf(part.part) ?? -1;
    const volumes = built?.out?.volumes ?? null;
    const volume = volumes && u >= 0 ? volumes[u] : null;
    const all = volumes ? volumes.reduce((a, v) => a + v, 0) : 0;
    const color = (u >= 0 ? built?.colors[u] : undefined) ?? node.color ?? '#9e9e9e';
    return (
        <Box data-testid="solid-editor">
            <Typography variant="body2" color="text.secondary">A lithology of a geological model</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.5 }}>
                <Box component="span" sx={{ width: 14, height: 14, flexShrink: 0, bgcolor: color, border: 1, borderColor: 'divider', borderRadius: 0.5 }} />
                <Typography variant="subtitle2" noWrap>{part.part}</Typography>
            </Box>
            {/* (Framing it frames its model: a solid can be anywhere in it) */}
            <LookRow objectKeys={[keys.model(model.id)]} visKeys={[node.key]} />
            <Fact>
                {volume === null ? 'The model is not built yet.'
                    : volume > 0 ? `${formatVolume(volume)}: ${all > 0 ? `${Number(((100 * volume) / all).toPrecision(2))}% of ${model.name}` : model.name}.`
                        : `It has no ground in ${model.name} as built.`}
            </Fact>
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                <Link component="button" type="button" data-action="go-model" onClick={() => onGoTo(keys.model(model.id))}>{model.name}</Link>
                {`: its ${t('lithologies').toLowerCase()}, its ${t('chronology').toLowerCase()} and what it puts out.`}
            </Typography>
        </Box>
    );
};
