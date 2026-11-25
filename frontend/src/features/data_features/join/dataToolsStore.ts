import { create } from 'zustand';

/** Open state of the Join table / Below-detection text / Group standardisation dialogs (kept out of uiStore) */
interface DataToolsState {
    joinOpen: boolean;
    lodOpen: boolean;
    standardizeOpen: boolean;
    setJoinOpen: (open: boolean) => void;
    setLodOpen: (open: boolean) => void;
    setStandardizeOpen: (open: boolean) => void;
}

export const useDataToolsStore = create<DataToolsState>(set => ({
    joinOpen: false,
    lodOpen: false,
    standardizeOpen: false,
    setJoinOpen: joinOpen => set({ joinOpen }),
    setLodOpen: lodOpen => set({ lodOpen }),
    setStandardizeOpen: standardizeOpen => set({ standardizeOpen }),
}));
