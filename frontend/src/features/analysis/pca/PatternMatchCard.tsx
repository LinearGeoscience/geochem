/**
 * PatternMatchCard Component
 *
 * Displays a single pattern match result with expandable details.
 * Shows pattern name, confidence score, category, and matched/missing elements.
 */

import React, { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Chip,
  IconButton,
  Collapse,
  Divider,
  Tooltip,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';

import { MatchScore, AssociationCategory } from '../../../types/associations';
import { CATEGORY_INFO, PATTERN_BY_ID } from '../../../data/elementAssociationPatterns';
import { AssociationConfidenceBar, ConfidenceEmoji } from './AssociationConfidenceBar';

interface PatternMatchCardProps {
  match: MatchScore;
  rank: number;
  showDetails?: boolean;
}

/**
 * Get category chip color and style
 */
function getCategoryChipProps(category: AssociationCategory) {
  const info = CATEGORY_INFO[category];
  return {
    label: info.displayName,
    sx: {
      bgcolor: info.bgColor,
      color: info.color,
      borderColor: info.color,
      fontWeight: 500,
      fontSize: '0.75rem',
    },
  };
}

export const PatternMatchCard: React.FC<PatternMatchCardProps> = ({
  match,
  rank,
  showDetails: _initialShowDetails = false, // Ignored - always start collapsed
}) => {
  const [expanded, setExpanded] = useState(false); // Always start collapsed

  const pattern = PATTERN_BY_ID[match.patternId];
  const categoryChipProps = getCategoryChipProps(match.category);

  // Format element lists for display
  const allMatchedElements = [
    ...match.matchedCoreElements,
    ...match.matchedCommonElements,
  ];

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        mb: 1,
        borderColor: match.confidenceScore >= 70 ? '#22c55e' :
                     match.confidenceScore >= 50 ? '#f59e0b' :
                     '#e5e7eb',
        borderWidth: match.confidenceScore >= 70 ? 2 : 1,
        transition: 'border-color 0.2s ease',
      }}
    >
      {/* Header row */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {/* Rank and emoji indicator */}
        <Typography
          variant="body2"
          sx={{
            fontWeight: 600,
            color: 'text.secondary',
            minWidth: 24,
          }}
        >
          #{rank}
        </Typography>

        <ConfidenceEmoji score={match.confidenceScore} />

        {/* Pattern name */}
        <Typography
          variant="body1"
          sx={{
            fontWeight: 600,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {match.patternName}
        </Typography>

        {/* Category chip */}
        <Chip
          size="small"
          variant="outlined"
          {...categoryChipProps}
        />

        {/* Expand button */}
        <IconButton
          size="small"
          onClick={() => setExpanded(!expanded)}
          sx={{ ml: 'auto' }}
        >
          {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        </IconButton>
      </Box>

      {/* Confidence bar */}
      <Box sx={{ mt: 1, pr: 4 }}>
        <AssociationConfidenceBar
          score={match.confidenceScore}
          height={6}
          showPercentage={true}
        />
      </Box>

      {/* Quick summary - always visible */}
      <Box sx={{ mt: 1 }}>
        <Typography variant="caption" color="text.secondary">
          <strong>Matched:</strong> {allMatchedElements.join(', ') || 'None'}
          {match.missingCoreElements.length > 0 && (
            <span style={{ color: '#9ca3af' }}>
              {' '}| <strong>Missing:</strong> {match.missingCoreElements.join(', ')}
            </span>
          )}
        </Typography>
      </Box>

      {/* Expanded details - simplified */}
      <Collapse in={expanded}>
        <Divider sx={{ my: 1.5 }} />

        {/* Matched elements with color-coded chips */}
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {match.matchedCoreElements.map((el) => (
              <Chip
                key={`core-${el}`}
                label={el}
                size="small"
                sx={{ bgcolor: '#dcfce7', color: '#166534' }}
              />
            ))}
            {match.matchedCommonElements.map((el) => (
              <Chip
                key={`common-${el}`}
                label={el}
                size="small"
                sx={{ bgcolor: '#dbeafe', color: '#1e40af' }}
              />
            ))}
            {match.matchedOptionalElements.map((el) => (
              <Chip
                key={`optional-${el}`}
                label={el}
                size="small"
                sx={{ bgcolor: '#f3e8ff', color: '#7c3aed' }}
              />
            ))}
          </Box>
          <Box sx={{ display: 'flex', gap: 2, mt: 0.5 }}>
            <Typography variant="caption" sx={{ color: '#166534' }}>● Core</Typography>
            <Typography variant="caption" sx={{ color: '#1e40af' }}>● Common</Typography>
            <Typography variant="caption" sx={{ color: '#7c3aed' }}>● Optional</Typography>
          </Box>
        </Box>

        {/* Pattern description */}
        {pattern && (
          <Typography variant="caption" color="text.secondary">
            {pattern.description}
          </Typography>
        )}
      </Collapse>
    </Paper>
  );
};

/**
 * Compact version for inline display
 */
export const PatternMatchChip: React.FC<{ match: MatchScore }> = ({ match }) => {
  const categoryInfo = CATEGORY_INFO[match.category];

  return (
    <Tooltip
      title={
        <Box>
          <Typography variant="body2" fontWeight={600}>{match.patternName}</Typography>
          <Typography variant="caption">
            Confidence: {Math.round(match.confidenceScore)}%
          </Typography>
          <br />
          <Typography variant="caption">
            Matched: {match.matchedCoreElements.join(', ')}
          </Typography>
        </Box>
      }
    >
      <Chip
        size="small"
        label={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <ConfidenceEmoji score={match.confidenceScore} />
            <span>{match.patternName}</span>
          </Box>
        }
        sx={{
          bgcolor: categoryInfo.bgColor,
          color: categoryInfo.color,
          border: `1px solid ${categoryInfo.color}`,
        }}
      />
    </Tooltip>
  );
};

export default PatternMatchCard;
