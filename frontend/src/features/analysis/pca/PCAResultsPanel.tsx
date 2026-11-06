/**
 * PCA results (scree, loading matrix, ranked eigenvector plots, factor
 * analysis) for the result in the transformation store. Shown as the last
 * step of the PCA workflow and in a "PCA results" plot window, so the
 * eigenvector plots can sit next to the maps coloured by the scores.
 */
import React, { useMemo, useState } from 'react';
import { Box, Button, Chip, Tabs, Tab, Snackbar, Alert, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore, useDisplayRows } from '../../../store/appStore';
import { useAttributeStore } from '../../../store/attributeStore';
import { useTransformationStore } from '../../../store/transformationStore';
import { FactorAnalysisPanel } from '../FactorAnalysisPanel';
import { ScreePlot } from './ScreePlot';
import { SortedLoadingMatrix } from './SortedLoadingMatrix';
import { RankedEigenvectorPlot } from './RankedEigenvectorPlot';
import { PCAReportExport } from './PCAReportExport';
import { addPcScoresToData } from './addPcScores';
import { openPcaResultsWindow } from './openPcaResultsWindow';

export const PCAResultsPanel: React.FC<{ inWindow?: boolean }> = ({ inWindow = false }) => {
  const { fullPcaResult, pcaSelectedElements, nComponents, resultsTab, setPcaUi } = useTransformationStore(useShallow(s => ({
    fullPcaResult: s.fullPcaResult,
    pcaSelectedElements: s.pcaSelectedElements,
    nComponents: s.pcaUi.nComponents,
    resultsTab: s.pcaUi.resultsTab,
    setPcaUi: s.setPcaUi,
  })));
  const attributeColor = useAttributeStore(s => s.color);
  const setAttributeField = useAttributeStore(s => s.setField);
  const setAttributeEntries = useAttributeStore(s => s.setEntries);
  const displayData = useDisplayRows();
  const displayIndices = useAppStore(s => s._sampleIndicesArray);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'info' | 'warning' }>({
    open: false, message: '', severity: 'success',
  });

  // Active colour scale on a PC score column
  const activeColorScale = useMemo(() => {
    const field = attributeColor.field;
    if (!field || (!field.startsWith('PC') && !field.startsWith('negPC'))) return null;
    const numClasses = attributeColor.entries.filter((e) => !e.isDefault).length;
    const methodLabels: Record<string, string> = { quantile: 'quantile', jenks: 'Jenks', equal: 'equal interval', categorical: 'categorical', manual: 'manual' };
    return `${field} (${numClasses} classes, ${methodLabels[attributeColor.method] || attributeColor.method})`;
  }, [attributeColor]);

  if (!fullPcaResult) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">No PCA results yet. Run PCA in Analysis → PCA, then open the results here.</Alert>
      </Box>
    );
  }

  const handleAddPCScores = () => {
    const r = addPcScoresToData();
    setSnackbar({ open: true, message: r.message, severity: r.ok ? 'success' : 'warning' });
  };

  return (
    <Box sx={inWindow ? { p: 1.5, height: '100%', overflow: 'auto' } : undefined}>
      <Box sx={{ display: 'flex', gap: 1.5, mb: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
        {inWindow && (
          <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
            {fullPcaResult.displayColumns.length} variables · {fullPcaResult.nSamples.toLocaleString()} samples · PC1 {fullPcaResult.varianceExplained[0]?.toFixed(1)}%
          </Typography>
        )}
        <Button variant="contained" onClick={handleAddPCScores}>
          Add PC Scores to Data
        </Button>
        <PCAReportExport pcaResult={fullPcaResult} />
        {!inWindow && (
          <Button variant="outlined" startIcon={<OpenInNewIcon />} onClick={openPcaResultsWindow}>
            Open in plot window
          </Button>
        )}
        {activeColorScale && (
          <Chip
            label={`Active Colour Scale: ${activeColorScale}`}
            color="secondary"
            variant="outlined"
            onDelete={() => {
              setAttributeField('color', null);
              setAttributeEntries('color', []);
              setSnackbar({ open: true, message: 'Colour scale cleared', severity: 'info' });
            }}
            deleteIcon={<CloseIcon />}
          />
        )}
      </Box>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs value={resultsTab} onChange={(_, v) => setPcaUi({ resultsTab: v })}>
          <Tab label="Scree Plot" />
          <Tab label="Loading Matrix" />
          <Tab label="Eigenvector Plots" />
          <Tab label="Factor Analysis" />
        </Tabs>
      </Box>

      {resultsTab === 0 && <ScreePlot pcaResult={fullPcaResult} />}
      {resultsTab === 1 && <SortedLoadingMatrix pcaResult={fullPcaResult} nComponents={nComponents} />}
      {resultsTab === 2 && <RankedEigenvectorPlot pcaResult={fullPcaResult} nComponents={nComponents} />}
      {resultsTab === 3 && (
        <FactorAnalysisPanel elements={pcaSelectedElements} rows={displayData} rowIndices={displayIndices} />
      )}

      <Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setSnackbar((s) => ({ ...s, open: false }))} severity={snackbar.severity} variant="filled">
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default PCAResultsPanel;
