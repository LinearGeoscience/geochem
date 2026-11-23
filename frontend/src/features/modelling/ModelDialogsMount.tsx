/**
 * The modelling dialogs, once for the whole app (features/model/modelDialogs):
 * a surface between logged units or a body, a shell, readings from columns,
 * the model units, a logging table, a new geological model; and the one
 * that asks before anything
 * is deleted.
 */
import React from 'react';
import { closeModelDialog, useModelDialogs } from '../model/modelDialogs';
import { ContactDialog } from '../plots/viewer3d/ContactDialog';
import { HoleTableDialog } from '../plots/viewer3d/HoleTableDialog';
import { NewModelDialog } from '../plots/viewer3d/NewModelDialog';
import { ProportionDialog } from '../plots/viewer3d/ProportionDialog';
import { ShellDialog } from '../plots/viewer3d/ShellDialog';
import { StructureColumnsDialog } from '../plots/viewer3d/StructureColumnsDialog';
import { UnitsDialog } from '../plots/viewer3d/UnitsDialog';
import { DeleteRequestDialog } from './tree/DeleteObjectsDialog';

export const ModelDialogsMount: React.FC = () => {
    const dialog = useModelDialogs(s => s.dialog);
    const kind = dialog?.kind ?? null;
    const coords = dialog?.coords ?? null;
    const target = dialog?.target ?? null;
    return (
        <>
            <ContactDialog
                open={kind === 'contact' || kind === 'body' || kind === 'vein'} coords={coords} surfaceId={target}
                kind={kind === 'body' || kind === 'vein' ? 'body' : 'contact'} vein={kind === 'vein'} onClose={closeModelDialog}
            />
            <StructureColumnsDialog open={kind === 'readings'} coords={coords} onClose={closeModelDialog} />
            <ShellDialog open={kind === 'shell'} coords={coords} surfaceId={target} onClose={closeModelDialog} />
            <ShellDialog open={kind === 'numeric'} numeric coords={coords} surfaceId={null} numericId={target} onClose={closeModelDialog} />
            <ProportionDialog open={kind === 'proportion'} coords={coords} numericId={target} onClose={closeModelDialog} />
            <UnitsDialog open={kind === 'units'} coords={coords} mapId={target} onClose={closeModelDialog} />
            <HoleTableDialog open={kind === 'tables'} onClose={closeModelDialog} />
            <NewModelDialog open={kind === 'model'} coords={coords} onClose={closeModelDialog} />
            {/* (After the others, so that it comes up over a dialog it was asked from) */}
            <DeleteRequestDialog />
        </>
    );
};
