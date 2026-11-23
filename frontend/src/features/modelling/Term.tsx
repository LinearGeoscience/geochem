/**
 * The name of one of the modelling's ideas (features/model/terms.ts), as it
 * is written in a label or a heading: marked with the idea, and with its
 * plain line as a tip when it has one. (The mark of the words is
 * `data-term-label`; `data-term` is the control that sets the thing, so that
 * the two are never mistaken for one another.)
 */
import React from 'react';
import { Tooltip } from '@mui/material';
import { TERMS, type TermKey } from '../model/terms';

export const Term: React.FC<{ k: TermKey; before?: string; after?: string }> = ({ k, before = '', after = '' }) => {
    const { label, plain } = TERMS[k];
    const text = <span data-term-label={k}>{before}{label}{after}</span>;
    return plain ? <Tooltip title={plain}>{text}</Tooltip> : text;
};
