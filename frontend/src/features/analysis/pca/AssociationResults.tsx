/**
 * AssociationResults Component
 *
 * Main component for displaying element association pattern matching results.
 * Shows pattern matches for positive and negative ends of each principal component.
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Tab,
  Chip,
  Alert,
  Button,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Tooltip,
  IconButton,
  Menu,
  ListItemIcon,
  ListItemText,
  Snackbar,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningIcon from '@mui/icons-material/Warning';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import SettingsIcon from '@mui/icons-material/Settings';
import PaletteIcon from '@mui/icons-material/Palette';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import AddIcon from '@mui/icons-material/Add';

import { FullPCAResult } from '../../../types/compositional';
import {
  PCAssociationAnalysis,
  MatchingOptions,
  ElementMapping,
  MatchScore,
} from '../../../types/associations';
import { matchAssociations, summarizeAssociations } from '../../../utils/calculations/associationMatcher';
import { CATEGORY_INFO } from '../../../data/elementAssociationPatterns';
import { useAppStore } from '../../../store/appStore';
import { PatternMatchCard } from './PatternMatchCard';
import { ConfidenceEmoji } from './AssociationConfidenceBar';
import { ElementVerificationDialog } from './ElementVerificationDialog';
import { MiniEigenvectorPlot } from './MiniEigenvectorPlot';
import { CreateColorScaleDialog } from './CreateColorScaleDialog';
import {
  createElementMappings,
  buildMappingMap,
  getMappingSummary,
} from '../../../utils/calculations/elementNameNormalizer';

interface AssociationResultsProps {
  pcaResult: FullPCAResult;
  nComponents?: number;
  onClose?: () => void;
}

/**
 * Single PC association panel with mini eigenvector plots
 */
const PCAssociationPanel: React.FC<{
  analysis: PCAssociationAnalysis;
  pcaResult: FullPCAResult;
  componentIndex: number;
  onCreateColorScale: (match: MatchScore, side: 'positive' | 'negative') => void;
}> = ({ analysis, pcaResult, componentIndex, onCreateColorScale }) => {
  const [showAllPositive, setShowAllPositive] = useState(false);
  const [showAllNegative, setShowAllNegative] = useState(false);

  const positiveMatches = analysis.positiveAssociation.matches;
  const negativeMatches = analysis.negativeAssociation.matches;

  const displayPositive = showAllPositive ? positiveMatches : positiveMatches.slice(0, 3);
  const displayNegative = showAllNegative ? negativeMatches : negativeMatches.slice(0, 3);

  // Get highlight info for mini plots
  const topPositiveMatch = positiveMatches[0];
  const topNegativeMatch = negativeMatches[0];

  const positiveHighlightedElements = topPositiveMatch
    ? [...topPositiveMatch.matchedCoreElements, ...topPositiveMatch.matchedCommonElements]
    : [];
  const negativeHighlightedElements = topNegativeMatch
    ? [...topNegativeMatch.matchedCoreElements, ...topNegativeMatch.matchedCommonElements]
    : [];

  const positiveColor = topPositiveMatch
    ? CATEGORY_INFO[topPositiveMatch.category]?.color || '#22c55e'
    : '#22c55e';
  const negativeColor = topNegativeMatch
    ? CATEGORY_INFO[topNegativeMatch.category]?.color || '#ef4444'
    : '#ef4444';

  return (
    <Box>
      {/* Action Bar - Prominent Color Scale Buttons */}
      {(positiveMatches.length > 0 || negativeMatches.length > 0) && (
        <Paper
          sx={{
            p: 1.5,
            mb: 2,
            bgcolor: '#f8fafc',
            display: 'flex',
            gap: 2,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
            Create Color Scale:
          </Typography>
          {positiveMatches.length > 0 && (
            <Button
              variant="contained"
              size="small"
              startIcon={<PaletteIcon />}
              onClick={() => onCreateColorScale(positiveMatches[0], 'positive')}
              sx={{
                bgcolor: '#22c55e',
                '&:hover': { bgcolor: '#16a34a' },
              }}
            >
              Positive ({topPositiveMatch?.patternName || 'Association'})
            </Button>
          )}
          {negativeMatches.length > 0 && (
            <Button
              variant="contained"
              size="small"
              startIcon={<PaletteIcon />}
              onClick={() => onCreateColorScale(negativeMatches[0], 'negative')}
              sx={{
                bgcolor: '#ef4444',
                '&:hover': { bgcolor: '#dc2626' },
              }}
            >
              Negative ({topNegativeMatch?.patternName || 'Association'})
            </Button>
          )}
        </Paper>
      )}

      <Grid container spacing={2}>
      {/* Positive association */}
      <Grid item xs={12} md={6}>
        <Paper
          variant="outlined"
          sx={{
            p: 2,
            height: '100%',
            borderColor: '#22c55e',
            borderWidth: 2,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Typography variant="subtitle2" fontWeight={600} color="#166534">
              POSITIVE END
            </Typography>
            <Chip
              size="small"
              label={analysis.positiveAssociation.elementString || 'No elements'}
              sx={{ bgcolor: '#dcfce7', color: '#166534', maxWidth: 200 }}
            />
          </Box>

          {/* Mini Eigenvector Plot */}
          <Box sx={{ mb: 2, bgcolor: '#f8fafc', borderRadius: 1, p: 0.5 }}>
            <MiniEigenvectorPlot
              pcaResult={pcaResult}
              componentIndex={componentIndex}
              highlightedElements={positiveHighlightedElements}
              highlightColor={positiveColor}
              side="positive"
              height={100}
            />
          </Box>

          {positiveMatches.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              No significant pattern matches (try lowering threshold)
            </Typography>
          ) : (
            <>
              {displayPositive.map((match, idx) => (
                <Box key={match.patternId} sx={{ position: 'relative' }}>
                  <PatternMatchCard
                    match={match}
                    rank={idx + 1}
                    showDetails={idx === 0}
                  />
                  {idx === 0 && (
                    <Tooltip title="Create color scale for this association">
                      <IconButton
                        size="small"
                        sx={{
                          position: 'absolute',
                          top: 8,
                          right: 40,
                          bgcolor: 'background.paper',
                          '&:hover': { bgcolor: 'action.hover' },
                        }}
                        onClick={() => onCreateColorScale(match, 'positive')}
                      >
                        <PaletteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
              ))}
              {positiveMatches.length > 3 && (
                <Button
                  size="small"
                  onClick={() => setShowAllPositive(!showAllPositive)}
                  sx={{ mt: 1 }}
                >
                  {showAllPositive
                    ? 'Show Less'
                    : `Show ${positiveMatches.length - 3} More`}
                </Button>
              )}
            </>
          )}
        </Paper>
      </Grid>

      {/* Negative association */}
      <Grid item xs={12} md={6}>
        <Paper
          variant="outlined"
          sx={{
            p: 2,
            height: '100%',
            borderColor: '#ef4444',
            borderWidth: 2,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Typography variant="subtitle2" fontWeight={600} color="#991b1b">
              NEGATIVE END
            </Typography>
            <Chip
              size="small"
              label={analysis.negativeAssociation.elementString || 'No elements'}
              sx={{ bgcolor: '#fee2e2', color: '#991b1b', maxWidth: 200 }}
            />
          </Box>

          {/* Mini Eigenvector Plot */}
          <Box sx={{ mb: 2, bgcolor: '#f8fafc', borderRadius: 1, p: 0.5 }}>
            <MiniEigenvectorPlot
              pcaResult={pcaResult}
              componentIndex={componentIndex}
              highlightedElements={negativeHighlightedElements}
              highlightColor={negativeColor}
              side="negative"
              height={100}
            />
          </Box>

          {negativeMatches.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              No significant pattern matches (try lowering threshold)
            </Typography>
          ) : (
            <>
              {displayNegative.map((match, idx) => (
                <Box key={match.patternId} sx={{ position: 'relative' }}>
                  <PatternMatchCard
                    match={match}
                    rank={idx + 1}
                    showDetails={idx === 0}
                  />
                  {idx === 0 && (
                    <Tooltip title="Create color scale for this association">
                      <IconButton
                        size="small"
                        sx={{
                          position: 'absolute',
                          top: 8,
                          right: 40,
                          bgcolor: 'background.paper',
                          '&:hover': { bgcolor: 'action.hover' },
                        }}
                        onClick={() => onCreateColorScale(match, 'negative')}
                      >
                        <PaletteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
              ))}
              {negativeMatches.length > 3 && (
                <Button
                  size="small"
                  onClick={() => setShowAllNegative(!showAllNegative)}
                  sx={{ mt: 1 }}
                >
                  {showAllNegative
                    ? 'Show Less'
                    : `Show ${negativeMatches.length - 3} More`}
                </Button>
              )}
            </>
          )}
        </Paper>
      </Grid>

      {/* Quality assessment */}
      <Grid item xs={12}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {analysis.qualityAssessment.notes.map((note, idx) => (
            <Chip
              key={idx}
              size="small"
              icon={
                note.includes('independent') || note.includes('Clear separation') || note.includes('Strong') ? (
                  <CheckCircleIcon fontSize="small" />
                ) : note.includes('influence') || note.includes('Weak') ? (
                  <WarningIcon fontSize="small" />
                ) : (
                  <InfoOutlinedIcon fontSize="small" />
                )
              }
              label={note}
              variant="outlined"
              color={
                note.includes('independent') || note.includes('Clear separation') || note.includes('Strong')
                  ? 'success'
                  : note.includes('influence') || note.includes('Weak')
                  ? 'warning'
                  : 'default'
              }
            />
          ))}
        </Box>
      </Grid>
    </Grid>
    </Box>
  );
};

/**
 * PC Tab with context menu for color scale creation
 */
const PCTabWithMenu: React.FC<{
  pcNumber: number;
  analysis: PCAssociationAnalysis;
  summary: any;
  isSelected: boolean;
  onSelect: () => void;
  onCreateColorScale: (match: MatchScore, side: 'positive' | 'negative') => void;
}> = ({ pcNumber, analysis, summary, isSelected, onSelect, onCreateColorScale }) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const menuOpen = Boolean(anchorEl);

  const handleMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const positiveMatches = analysis.positiveAssociation.matches;
  const negativeMatches = analysis.negativeAssociation.matches;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center' }}>
      <Tab
        onClick={onSelect}
        label={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <span>PC{pcNumber}</span>
            <Typography variant="caption" color="text.secondary">
              ({analysis.varianceExplained.toFixed(1)}%)
            </Typography>
            {summary?.hasMineralisation && (
              <Chip
                size="small"
                label="MIN"
                sx={{
                  height: 16,
                  fontSize: '0.65rem',
                  bgcolor: CATEGORY_INFO.mineralisation.bgColor,
                  color: CATEGORY_INFO.mineralisation.color,
                }}
              />
            )}
          </Box>
        }
        sx={{
          minHeight: 48,
          bgcolor: isSelected ? 'action.selected' : undefined,
        }}
      />
      {(positiveMatches.length > 0 || negativeMatches.length > 0) && (
        <>
          <IconButton
            size="small"
            onClick={handleMenuClick}
            sx={{ ml: -1, mr: 0.5 }}
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
          <Menu
            anchorEl={anchorEl}
            open={menuOpen}
            onClose={handleMenuClose}
            onClick={handleMenuClose}
          >
            {positiveMatches.length > 0 && (
              <MenuItem
                onClick={() => onCreateColorScale(positiveMatches[0], 'positive')}
              >
                <ListItemIcon>
                  <AddIcon fontSize="small" sx={{ color: '#22c55e' }} />
                </ListItemIcon>
                <ListItemText
                  primary="Create Color Scale (Positive)"
                  secondary={positiveMatches[0].patternName}
                />
              </MenuItem>
            )}
            {negativeMatches.length > 0 && (
              <MenuItem
                onClick={() => onCreateColorScale(negativeMatches[0], 'negative')}
              >
                <ListItemIcon>
                  <AddIcon fontSize="small" sx={{ color: '#ef4444' }} />
                </ListItemIcon>
                <ListItemText
                  primary="Create Color Scale (Negative)"
                  secondary={negativeMatches[0].patternName}
                />
              </MenuItem>
            )}
          </Menu>
        </>
      )}
    </Box>
  );
};

export const AssociationResults: React.FC<AssociationResultsProps> = ({
  pcaResult,
  nComponents = 8,
}) => {
  const [selectedPC, setSelectedPC] = useState(0);
  const [loadingThreshold, setLoadingThreshold] = useState(0.3);

  // Element mapping state
  const [verificationDialogOpen, setVerificationDialogOpen] = useState(false);
  const [elementMappings, setElementMappings] = useState<ElementMapping[]>([]);
  const [elementMappingMap, setElementMappingMap] = useState<Map<string, string>>(new Map());
  const [mappingsVerified, setMappingsVerified] = useState(false);

  // Color scale dialog state
  const [colorScaleDialogOpen, setColorScaleDialogOpen] = useState(false);
  const [colorScaleMatch, setColorScaleMatch] = useState<MatchScore | null>(null);
  const [colorScaleSide, setColorScaleSide] = useState<'positive' | 'negative'>('positive');
  const [colorScalePcNumber, setColorScalePcNumber] = useState(1);

  // Snackbar state
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'warning' }>({
    open: false, message: '', severity: 'success',
  });

  // Auto-detect element mappings when component mounts or columns change
  useEffect(() => {
    if (pcaResult.columns && pcaResult.columns.length > 0) {
      const mappings = createElementMappings(pcaResult.columns);
      setElementMappings(mappings);

      // Auto-build mapping for high-confidence matches
      const autoMap = buildMappingMap(mappings.filter(m => m.confidence === 'high'));
      setElementMappingMap(autoMap);

      // Check if we need user verification
      const summary = getMappingSummary(mappings);
      if (summary.low === 0 && summary.unknown === 0) {
        // All high/medium confidence - auto-verify
        const fullMap = buildMappingMap(mappings);
        setElementMappingMap(fullMap);
        setMappingsVerified(true);
      }
    }
  }, [pcaResult.columns]);

  // Handle verification dialog confirm
  const handleMappingConfirm = useCallback((map: Map<string, string>) => {
    setElementMappingMap(map);
    setMappingsVerified(true);
    setVerificationDialogOpen(false);
  }, []);

  // Check if PC columns exist
  const { columns } = useAppStore();

  // Handle color scale creation
  const handleCreateColorScale = useCallback((match: MatchScore, side: 'positive' | 'negative', pcNumber?: number) => {
    const pc = pcNumber ?? selectedPC + 1;
    const hasPcColumns = columns.some((c) => c.name === `PC${pc}` || c.name === `negPC${pc}`);
    if (!hasPcColumns) {
      setSnackbar({ open: true, message: 'Add PC Scores to Data first', severity: 'warning' });
      return;
    }
    setColorScaleMatch(match);
    setColorScaleSide(side);
    setColorScalePcNumber(pc);
    setColorScaleDialogOpen(true);
  }, [selectedPC, columns]);

  // Run association matching
  const analyses = useMemo(() => {
    const options: MatchingOptions = {
      loadingThreshold,
      maxMatches: 5,
      minimumConfidence: 25,
      applyDiscrimination: true,
      elementMapping: elementMappingMap.size > 0 ? elementMappingMap : undefined,
    };

    return matchAssociations(pcaResult, options);
  }, [pcaResult, loadingThreshold, elementMappingMap]);

  // Get summary for quick overview
  const summary = useMemo(() => summarizeAssociations(analyses), [analyses]);

  const actualComponents = Math.min(nComponents, analyses.length);

  // Count mineralisation indicators
  const mineralisationCount = summary.filter((s) => s.hasMineralisation).length;

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Element Association Analysis
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        Automated pattern recognition identifies likely geological interpretations for element
        associations at each end of the principal components. Patterns are ranked by confidence
        score.
      </Typography>

      {/* Element mapping warning */}
      {!mappingsVerified && mineralisationCount === 0 && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => setVerificationDialogOpen(true)}
            >
              Configure
            </Button>
          }
        >
          Element names may need verification. Column names like "K_pct" need to be mapped to element symbols for pattern matching.
        </Alert>
      )}

      {/* Summary and options */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={6} md={3}>
            <Alert
              severity={mineralisationCount > 0 ? 'success' : 'info'}
              sx={{ py: 0.5 }}
            >
              {mineralisationCount > 0
                ? `${mineralisationCount} PC(s) with mineralisation signatures`
                : 'No strong mineralisation signatures detected'}
            </Alert>
          </Grid>

          <Grid item xs={12} sm={6} md={3}>
            <FormControl size="small" fullWidth>
              <InputLabel>Loading Threshold</InputLabel>
              <Select
                value={loadingThreshold}
                onChange={(e) => setLoadingThreshold(Number(e.target.value))}
                label="Loading Threshold"
              >
                <MenuItem value={0.2}>0.2 (Weak)</MenuItem>
                <MenuItem value={0.3}>0.3 (Standard)</MenuItem>
                <MenuItem value={0.4}>0.4 (Moderate)</MenuItem>
                <MenuItem value={0.5}>0.5 (Strong)</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} sm={6} md={3}>
            <Tooltip title="Configure how column names are mapped to element symbols">
              <Button
                variant={mappingsVerified ? 'outlined' : 'contained'}
                color={mappingsVerified ? 'success' : 'primary'}
                size="small"
                startIcon={mappingsVerified ? <CheckCircleIcon /> : <SettingsIcon />}
                onClick={() => setVerificationDialogOpen(true)}
                fullWidth
              >
                {mappingsVerified ? 'Elements Verified' : 'Configure Elements'}
              </Button>
            </Tooltip>
          </Grid>

          <Grid item xs={12} md={3}>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {Object.entries(CATEGORY_INFO).map(([key, info]) => (
                <Chip
                  key={key}
                  size="small"
                  label={info.displayName}
                  sx={{ bgcolor: info.bgColor, color: info.color }}
                />
              ))}
            </Box>
          </Grid>
        </Grid>
      </Paper>

      {/* Summary accordion */}
      <Accordion sx={{ mb: 2 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={500}>Quick Summary - All PCs</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ padding: '8px', textAlign: 'left' }}>PC</th>
                  <th style={{ padding: '8px', textAlign: 'right' }}>Var%</th>
                  <th style={{ padding: '8px', textAlign: 'left' }}>Positive</th>
                  <th style={{ padding: '8px', textAlign: 'left' }}>Negative</th>
                </tr>
              </thead>
              <tbody>
                {summary.slice(0, actualComponents).map((s) => (
                  <tr
                    key={s.pcNumber}
                    style={{
                      borderBottom: '1px solid #e5e7eb',
                      backgroundColor: s.hasMineralisation ? '#f0fdf4' : undefined,
                    }}
                  >
                    <td style={{ padding: '8px', fontWeight: 500 }}>PC{s.pcNumber}</td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>
                      {s.varianceExplained.toFixed(1)}%
                    </td>
                    <td style={{ padding: '8px' }}>
                      {s.positiveInterpretation !== 'No significant match' ? (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <ConfidenceEmoji score={s.positiveConfidence} />
                          <span>{s.positiveInterpretation}</span>
                          <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>
                            ({Math.round(s.positiveConfidence)}%)
                          </span>
                        </Box>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '8px' }}>
                      {s.negativeInterpretation !== 'No significant match' ? (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <ConfidenceEmoji score={s.negativeConfidence} />
                          <span>{s.negativeInterpretation}</span>
                          <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>
                            ({Math.round(s.negativeConfidence)}%)
                          </span>
                        </Box>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
        </AccordionDetails>
      </Accordion>

      {/* PC tabs with menus */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap' }}>
          {analyses.slice(0, actualComponents).map((analysis, i) => (
            <PCTabWithMenu
              key={i}
              pcNumber={i + 1}
              analysis={analysis}
              summary={summary[i]}
              isSelected={selectedPC === i}
              onSelect={() => setSelectedPC(i)}
              onCreateColorScale={(match, side) => handleCreateColorScale(match, side, i + 1)}
            />
          ))}
        </Box>
      </Box>

      {/* Selected PC details */}
      {analyses[selectedPC] && (
        <Box sx={{ minHeight: 400 }}>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>
            PC{selectedPC + 1} Association Analysis ({analyses[selectedPC].varianceExplained.toFixed(1)}% variance)
          </Typography>

          <PCAssociationPanel
            analysis={analyses[selectedPC]}
            pcaResult={pcaResult}
            componentIndex={selectedPC}
            onCreateColorScale={(match, side) => handleCreateColorScale(match, side)}
          />
        </Box>
      )}

      {/* Interpretation guide */}
      <Paper sx={{ mt: 3, p: 2, bgcolor: '#f8fafc' }}>
        <Typography variant="subtitle2" gutterBottom>
          Interpretation Guide
        </Typography>
        <Typography variant="body2" color="text.secondary">
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>
              <strong>High confidence (&gt;70%):</strong> Strong match with reference pattern.
              Core elements present and well-defined.
            </li>
            <li>
              <strong>Moderate confidence (50-70%):</strong> Good match but some key elements
              missing or pattern mixing possible.
            </li>
            <li>
              <strong>Low confidence (25-50%):</strong> Partial match only. Consider alternative
              interpretations or mixed signatures.
            </li>
            <li>
              <strong>Best mineralisation evidence</strong> is independent of lithophile elements
              (Al, Zr, Ti, Y, Hf, Nb, Th) - this indicates the ore signature is separating from
              host rock.
            </li>
          </ul>
        </Typography>
      </Paper>

      {/* Element Verification Dialog */}
      <ElementVerificationDialog
        open={verificationDialogOpen}
        onClose={() => setVerificationDialogOpen(false)}
        onConfirm={handleMappingConfirm}
        columnNames={pcaResult.columns}
        initialMappings={elementMappings}
      />

      {/* Create Color Scale Dialog */}
      {colorScaleMatch && (
        <CreateColorScaleDialog
          open={colorScaleDialogOpen}
          onClose={() => {
            setColorScaleDialogOpen(false);
            setColorScaleMatch(null);
          }}
          onSuccess={(msg) => setSnackbar({ open: true, message: msg, severity: 'success' })}
          pcNumber={colorScalePcNumber}
          association={colorScaleMatch}
          side={colorScaleSide}
          varianceExplained={analyses[colorScalePcNumber - 1]?.varianceExplained || 0}
        />
      )}

      {/* Snackbar feedback */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
          severity={snackbar.severity}
          variant="filled"
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default AssociationResults;
