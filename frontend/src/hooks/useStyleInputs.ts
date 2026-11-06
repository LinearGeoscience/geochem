/**
 * Everything attribute styling depends on, as one value whose identity
 * changes whenever any of it does (colour, shape, size, filter, painted
 * groups, emphasis, global opacity, value filter). Put it in the dependency
 * list of any memo that calls getStyleArraysColumnar, so no plot can miss a
 * change again (Phase 60).
 */
import { useShallow } from 'zustand/react/shallow';
import { useAttributeStore } from '../store/attributeStore';
import { styleInputsOf, type StyleInputs } from '../utils/styleEngine';

export function useStyleInputs(): StyleInputs {
    return useAttributeStore(useShallow(styleInputsOf));
}
