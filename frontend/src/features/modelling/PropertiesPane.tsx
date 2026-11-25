/**
 * The properties pane of the Modelling page: what is picked in the project
 * tree, each kind with its own editor (features/modelling/properties). What
 * they show and hide, place, draw and frame is in the model view the tree
 * acts on (the one last used): the pane gives its panels that view's list of
 * shown objects.
 */
import React from 'react';
import { Box, Typography } from '@mui/material';
import { useViewVisibility, ViewVisibilityContext } from '../../hooks/useViewVisibility';
import { useDrillholeStore } from '../../store/drillholeStore';
import { useModelStore } from '../../store/modelStore';
import { useModellingStore } from '../../store/modellingStore';
import { parseKey, parseModelGroup, parseModelPart } from '../model/objectKeys';
import { findNode, type TreeNode } from '../model/projectTree';
import { ancestorsOf } from '../model/treeRules';
import { CollarsEditor, SamplesEditor, TableEditor } from './properties/DrillholeEditors';
import { FolderEditor, GroupEditor, InfoEditor, LinkEditor, ManyEditor, StructureGroup } from './properties/GroupEditors';
import { ModelEditor } from './properties/ModelEditor';
import { MeshEditor, SectionSetEditor, UnitMapEditor } from './properties/ObjectEditors';
import { ShownBox } from './properties/parts';
import { InputSetEditor, ReadingSetEditor } from './properties/SetEditors';
import { BlockPartEditor } from './properties/BlockPartEditor';
import { SurfaceEditor } from './properties/SurfaceEditor';
import { NumericModelEditor } from './properties/NumericModelEditor';
import { VeinSystemEditor } from './properties/VeinSystemEditor';
import { SolidEditor } from './properties/SolidEditor';
import { useTargetView } from './targetView';
import { useProjectTree } from './tree/useProjectTree';

/** The editor of one object (null: it is no longer in the project) */
const OneEditor: React.FC<{ node: TreeNode; tree: readonly TreeNode[] }> = ({ node, tree }) => {
    const scene = useModelStore(s => s.scene);
    const db = useDrillholeStore(s => s.db);
    const id = parseKey(node.key)?.id ?? '';
    const goTo = (key: string) => {
        const tm = useModellingStore.getState();
        tm.setExpanded([...new Set([...tm.expanded, ...(ancestorsOf(tree, key) ?? [])])]);
        tm.setSelected([key]);
    };
    switch (node.kind) {
        case 'surface': {
            const s = scene.surfaces.find(x => x.id === id);
            return !s ? null : s.blockOf ? <BlockPartEditor surface={s} onGoTo={goTo} /> : <SurfaceEditor surface={s} />;
        }
        case 'inputs': {
            const s = scene.inputs?.find(x => x.id === id);
            return s ? <InputSetEditor set={s} /> : null;
        }
        case 'readings': {
            const s = scene.structure?.sets?.find(x => x.id === id);
            return s ? <ReadingSetEditor set={s} /> : null;
        }
        case 'sectionSet': {
            const s = scene.sectionSets?.find(x => x.id === id);
            return s ? <SectionSetEditor set={s} /> : null;
        }
        case 'unitMap': {
            const m = scene.unitMaps?.find(x => x.id === id);
            return m ? <UnitMapEditor map={m} tableName={m.table ? db?.tables.find(t => t.id === m.table)?.name ?? null : null} /> : null;
        }
        case 'model': case 'modelContact': case 'modelFault': {
            const part = node.kind === 'model' ? null : parseModelPart(node.key);
            const g = scene.models?.find(x => x.id === (part ? part.model : id));
            return g ? <ModelEditor tabs model={g} contact={part?.part ?? null} onGoTo={goTo} /> : null;
        }
        case 'volume': return <SolidEditor node={node} onGoTo={goTo} />;
        case 'numericModel': {
            const m = scene.numericModels?.find(x => x.id === id);
            return m ? <NumericModelEditor model={m} onGoTo={goTo} /> : null;
        }
        case 'veinSystem': {
            const v = scene.veinSystems?.find(x => x.id === id);
            return v ? <VeinSystemEditor system={v} onGoTo={goTo} /> : null;
        }
        case 'modelGroup': {
            // A part of a model: the model's editor, opened on that part
            const part = parseModelGroup(node.key);
            const g = scene.models?.find(x => x.id === part?.model);
            return g && part ? <ModelEditor tabs model={g} contact={null} section={part.part} onGoTo={goTo} /> : null;
        }
        case 'table': {
            const t = db?.tables.find(x => x.id === id);
            return t ? <TableEditor table={t} /> : <InfoEditor node={node} />;
        }
        case 'wireframe': {
            const w = scene.wireframes.find(x => x.id === id);
            return w ? <MeshEditor mesh={w} /> : null;
        }
        case 'structure':
            return (
                <Box data-testid="structure-editor">
                    <Typography variant="subtitle2">{node.name}</Typography>
                    <ShownBox visKeys={node.visKey ? [node.visKey] : []} />
                    <StructureGroup />
                </Box>
            );
        case 'dataset': return <SamplesEditor />;
        case 'collars': return <CollarsEditor name={node.name} />;
        case 'folder': return <FolderEditor node={node} />;
        case 'root': return <GroupEditor node={node} />;
        case 'link': return <LinkEditor node={node} onGoTo={goTo} />;
        default: return <InfoEditor node={node} />;
    }
};

export const PropertiesPane: React.FC = () => {
    const tree = useProjectTree();
    const selected = useModellingStore(s => s.selected);
    const target = useTargetView();
    // The panels inside show and hide in the view the tree acts on
    const visibility = useViewVisibility(target.id);
    // (A line of the tree that says something of an object: that object's properties)
    const nodes = [...new Set(selected.map(k => findNode(tree, k)).map(n => (n?.kind === 'note' && n.of ? findNode(tree, n.of) : n)).filter((n): n is TreeNode => !!n))];
    return (
        <ViewVisibilityContext.Provider value={target.id ? visibility : null}>
            <Box aria-label="Properties" data-testid="properties-pane" sx={{ height: '100%', overflow: 'auto', p: 1.5, bgcolor: 'background.paper' }}>
                {nodes.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">Pick an object in the project tree, the Scene tab or a view to see its properties.</Typography>
                ) : nodes.length > 1 ? (
                    <ManyEditor nodes={nodes} />
                ) : (
                    <OneEditor key={nodes[0].key} node={nodes[0]} tree={tree} />
                )}
            </Box>
        </ViewVisibilityContext.Provider>
    );
};
