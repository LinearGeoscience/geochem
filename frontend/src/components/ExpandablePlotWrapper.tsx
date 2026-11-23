import React, { useState } from 'react';
import { Dialog, DialogContent, IconButton, Box, Tooltip } from '@mui/material';
import { Fullscreen, FullscreenExit, Close, InfoOutlined, Info } from '@mui/icons-material';
import { useAppStore } from '../store/appStore';
import { usePane } from '../features/workspace/PaneContext';

interface ExpandablePlotWrapperProps {
    children: React.ReactElement;
    plotTitle?: string;
}

export const ExpandablePlotWrapper: React.FC<ExpandablePlotWrapperProps> = ({ children }) => {
    const [expanded, setExpanded] = useState(false);
    // Inside a dock pane, fullscreen maximises the pane instead of a modal
    const pane = usePane();
    const [paneMax, setPaneMax] = useState(() => pane?.isMaximized() ?? false);
    const onFullscreen = () => {
        if (!pane) { setExpanded(true); return; }
        if (pane.isMaximized()) { pane.restore(); setPaneMax(false); } else { pane.maximize(); setPaneMax(true); }
    };
    const tooltipMode = useAppStore(s => s.tooltipMode);
    const setTooltipMode = useAppStore(s => s.setTooltipMode);

    const toggleTooltipMode = () => {
        setTooltipMode(tooltipMode === 'compact' ? 'detailed' : 'compact');
    };

    return (
        <>
            <Box sx={{
                position: 'relative',
                // Overlay buttons stay out of the way until the plot is hovered
                '& > .plot-overlay-btn': { opacity: 0, transition: 'opacity 120ms' },
                '&:hover > .plot-overlay-btn, & > .plot-overlay-btn:focus-visible': { opacity: 0.7 },
                '& > .plot-overlay-btn:hover': { opacity: 1 },
            }}>
                <Tooltip title={tooltipMode === 'compact' ? 'Show detailed tooltips' : 'Show compact tooltips'}>
                    <IconButton
                        className="plot-overlay-btn"
                        onClick={toggleTooltipMode}
                        sx={{
                            position: 'absolute',
                            top: 36,
                            right: 44,
                            zIndex: 10,
                            backgroundColor: 'background.paper',
                            '&:hover': { backgroundColor: 'background.paper' },
                            boxShadow: 1
                        }}
                        size="small"
                    >
                        {tooltipMode === 'compact' ? <InfoOutlined fontSize="small" /> : <Info fontSize="small" />}
                    </IconButton>
                </Tooltip>
                <IconButton
                    className="plot-overlay-btn"
                    onClick={onFullscreen}
                    aria-label={pane ? (paneMax ? 'Restore pane' : 'Maximise pane') : 'Expand plot'}
                    sx={{
                        position: 'absolute',
                        top: 36,
                        right: 8,
                        zIndex: 10,
                        backgroundColor: 'background.paper',
                        '&:hover': { backgroundColor: 'background.paper' },
                        boxShadow: 1
                    }}
                    size="small"
                >
                    {paneMax ? <FullscreenExit fontSize="small" /> : <Fullscreen fontSize="small" />}
                </IconButton>
                {children}
            </Box>

            <Dialog
                open={expanded}
                onClose={() => setExpanded(false)}
                maxWidth={false}
                PaperProps={{
                    sx: {
                        width: '80vw',
                        height: '60vw', // 4:3 ratio
                        maxHeight: '85vh', // Don't exceed viewport height
                        maxWidth: '90vw'
                    }
                }}
            >
                <IconButton
                    onClick={() => setExpanded(false)}
                    sx={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        zIndex: 1000,
                        backgroundColor: 'background.paper',
                        '&:hover': {
                            backgroundColor: 'action.hover',
                        }
                    }}
                >
                    <Close />
                </IconButton>
                <DialogContent sx={{ p: 2, height: '100%' }}>
                    {React.cloneElement(children, {
                        style: { width: '100%', height: '100%' },
                        layout: {
                            ...children.props.layout,
                            autosize: true,
                            width: undefined,  // Let autosize take over
                            height: undefined, // Let it fill the dialog
                        },
                        useResizeHandler: true
                    })}
                </DialogContent>
            </Dialog>
        </>
    );
};
