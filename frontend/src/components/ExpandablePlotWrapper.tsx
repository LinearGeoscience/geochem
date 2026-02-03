import React, { useState } from 'react';
import { Dialog, DialogContent, IconButton, Box } from '@mui/material';
import { Fullscreen, Close } from '@mui/icons-material';

interface ExpandablePlotWrapperProps {
    children: React.ReactElement;
    plotTitle?: string;
}

export const ExpandablePlotWrapper: React.FC<ExpandablePlotWrapperProps> = ({ children }) => {
    const [expanded, setExpanded] = useState(false);

    return (
        <>
            <Box sx={{ position: 'relative' }}>
                <IconButton
                    onClick={() => setExpanded(true)}
                    sx={{
                        position: 'absolute',
                        top: 36,
                        right: 8,
                        zIndex: 10,
                        backgroundColor: 'background.paper',
                        opacity: 0.7,
                        '&:hover': {
                            opacity: 1,
                            backgroundColor: 'background.paper',
                        },
                        boxShadow: 1
                    }}
                    size="small"
                >
                    <Fullscreen fontSize="small" />
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
                            height: undefined // Let it fill the dialog
                        },
                        useResizeHandler: true
                    })}
                </DialogContent>
            </Dialog>
        </>
    );
};
