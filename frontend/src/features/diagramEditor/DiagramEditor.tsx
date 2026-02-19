/**
 * Main Diagram Editor component with MUI Stepper workflow.
 * 5 steps: Setup → Calibrate → Draw Boundaries → Labels & Lines → Review & Export
 */

import React, { useEffect } from 'react';
import {
    Box, Stepper, Step, StepLabel, Button, Typography, Paper,
} from '@mui/material';
import { useDiagramEditorStore } from '../../store/diagramEditorStore';
import { StepSetup } from './steps/StepSetup';
import { StepCalibrate } from './steps/StepCalibrate';
import { StepDrawBoundaries } from './steps/StepDrawBoundaries';
import { StepLabelsAndLines } from './steps/StepLabelsAndLines';
import { StepReviewExport } from './steps/StepReviewExport';

const STEPS = [
    'Setup',
    'Calibrate Axes',
    'Draw Boundaries',
    'Labels & Lines',
    'Review & Export',
];

export const DiagramEditor: React.FC = () => {
    const { activeStep, setActiveStep, canProceedFromStep, reset } = useDiagramEditorStore();

    const canProceed = canProceedFromStep(activeStep);

    const handleNext = () => {
        if (canProceed && activeStep < STEPS.length - 1) {
            setActiveStep(activeStep + 1);
        }
    };

    const handleBack = () => {
        if (activeStep > 0) {
            setActiveStep(activeStep - 1);
        }
    };

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
                useDiagramEditorStore.getState().undo();
            } else if (
                (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) ||
                (e.key === 'y' && (e.ctrlKey || e.metaKey))
            ) {
                useDiagramEditorStore.getState().redo();
            } else if (e.key === 'Escape') {
                useDiagramEditorStore.getState().cancelActivePolygon();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const renderStep = () => {
        switch (activeStep) {
            case 0: return <StepSetup />;
            case 1: return <StepCalibrate />;
            case 2: return <StepDrawBoundaries />;
            case 3: return <StepLabelsAndLines />;
            case 4: return <StepReviewExport />;
            default: return null;
        }
    };

    return (
        <Box sx={{ maxWidth: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 2 }}>
                <Typography variant="h4">Classification Diagram Editor</Typography>
                <Box sx={{ flexGrow: 1 }} />
                <Button
                    variant="outlined"
                    color="warning"
                    size="small"
                    onClick={reset}
                >
                    Reset All
                </Button>
            </Box>

            <Paper sx={{ p: 2, mb: 2 }}>
                <Stepper activeStep={activeStep}>
                    {STEPS.map((label, index) => (
                        <Step key={label} completed={index < activeStep}>
                            <StepLabel
                                onClick={() => {
                                    if (index < activeStep) setActiveStep(index);
                                }}
                                sx={{ cursor: index < activeStep ? 'pointer' : 'default' }}
                            >
                                {label}
                            </StepLabel>
                        </Step>
                    ))}
                </Stepper>
            </Paper>

            <Box sx={{ mb: 2 }}>
                {renderStep()}
            </Box>

            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Button
                    disabled={activeStep === 0}
                    onClick={handleBack}
                    variant="outlined"
                >
                    Back
                </Button>
                {activeStep < STEPS.length - 1 && (
                    <Button
                        variant="contained"
                        onClick={handleNext}
                        disabled={!canProceed}
                    >
                        Next
                    </Button>
                )}
            </Box>
        </Box>
    );
};
