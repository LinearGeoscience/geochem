/**
 * Shared resizable right sidebar (Phase 11b).
 * Extracted from App.tsx where this exact block was duplicated three times
 * (plots / analysis / QAQC views).
 */
import React from 'react';
import { Box, IconButton } from '@mui/material';
import { ChevronRight, ChevronLeft } from '@mui/icons-material';
import { APPBAR_HEIGHT } from '../theme';

export interface RightSidebarProps {
    open: boolean;
    width: number;
    isResizing: boolean;
    onToggle: () => void;
    onStartResize: (e: React.MouseEvent) => void;
    children: React.ReactNode;
}

export const RightSidebar: React.FC<RightSidebarProps> = ({
    open, width, isResizing, onToggle, onStartResize, children,
}) => (
    <Box sx={{ position: 'relative', width: open ? width : 40, flexShrink: 0, display: 'flex' }}>
        {/* Resize handle */}
        {open && (
            <Box
                onMouseDown={onStartResize}
                sx={{
                    width: 6,
                    cursor: 'col-resize',
                    backgroundColor: isResizing ? 'primary.main' : 'transparent',
                    '&:hover': {
                        backgroundColor: 'primary.light',
                    },
                    transition: 'background-color 0.15s',
                    flexShrink: 0,
                }}
            />
        )}
        <Box sx={{ flex: 1, position: 'relative' }}>
            <IconButton
                onClick={onToggle}
                sx={{
                    position: 'absolute',
                    left: -20,
                    top: 0,
                    zIndex: 1,
                    backgroundColor: 'background.paper',
                    boxShadow: 1,
                    '&:hover': { backgroundColor: 'action.hover' }
                }}
                size="small"
            >
                {open ? <ChevronRight /> : <ChevronLeft />}
            </IconButton>
            {open && (
                <Box
                    sx={{
                        position: 'sticky',
                        top: APPBAR_HEIGHT + 16,
                        maxHeight: `calc(100vh - ${APPBAR_HEIGHT + 36}px)`,
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        width: '100%',
                        '&::-webkit-scrollbar': {
                            width: '8px',
                        },
                        '&::-webkit-scrollbar-thumb': {
                            backgroundColor: 'rgba(0,0,0,0.2)',
                            borderRadius: '4px',
                        }
                    }}
                >
                    {children}
                </Box>
            )}
        </Box>
    </Box>
);
