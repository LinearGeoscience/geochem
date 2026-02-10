/**
 * AssociationConfidenceBar Component
 *
 * Visual indicator for pattern match confidence scores.
 * Uses color gradient: red (low) -> yellow (moderate) -> green (high)
 */

import React from 'react';
import { Box, Typography, Tooltip } from '@mui/material';
import { getConfidenceLevel } from '../../../utils/calculations/associationMatcher';

interface AssociationConfidenceBarProps {
  score: number;
  width?: number | string;
  height?: number;
  showLabel?: boolean;
  showPercentage?: boolean;
}

/**
 * Get color based on confidence score
 */
function getConfidenceColor(score: number): string {
  // Red to yellow to green gradient
  if (score >= 70) {
    // Green gradient (70-100)
    const intensity = (score - 70) / 30;
    return `rgb(${Math.round(34 + (22 - 34) * intensity)}, ${Math.round(197 + (163 - 197) * intensity)}, ${Math.round(94 + (74 - 94) * intensity)})`;
  } else if (score >= 50) {
    // Yellow to green gradient (50-70)
    const intensity = (score - 50) / 20;
    return `rgb(${Math.round(234 - (234 - 34) * intensity)}, ${Math.round(179 + (197 - 179) * intensity)}, ${Math.round(8 + (94 - 8) * intensity)})`;
  } else if (score >= 25) {
    // Orange to yellow gradient (25-50)
    const intensity = (score - 25) / 25;
    return `rgb(${Math.round(249 - (249 - 234) * intensity)}, ${Math.round(115 + (179 - 115) * intensity)}, ${Math.round(22 - (22 - 8) * intensity)})`;
  } else {
    // Red gradient (0-25)
    return `rgb(239, 68, 68)`;
  }
}

/**
 * Get label for confidence level
 */
function getConfidenceLabel(score: number): string {
  const level = getConfidenceLevel(score);
  switch (level) {
    case 'high': return 'High';
    case 'moderate': return 'Moderate';
    case 'low': return 'Low';
    default: return 'None';
  }
}

export const AssociationConfidenceBar: React.FC<AssociationConfidenceBarProps> = ({
  score,
  width = '100%',
  height = 8,
  showLabel = false,
  showPercentage = true,
}) => {
  const clampedScore = Math.max(0, Math.min(100, score));
  const fillColor = getConfidenceColor(clampedScore);
  const label = getConfidenceLabel(clampedScore);

  const bar = (
    <Box
      sx={{
        width,
        height,
        bgcolor: '#e5e7eb',
        borderRadius: height / 2,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <Box
        sx={{
          width: `${clampedScore}%`,
          height: '100%',
          bgcolor: fillColor,
          borderRadius: height / 2,
          transition: 'width 0.3s ease, background-color 0.3s ease',
        }}
      />
    </Box>
  );

  if (showLabel) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Tooltip title={`${label} confidence (${Math.round(clampedScore)}%)`}>
          <Box sx={{ flex: 1 }}>{bar}</Box>
        </Tooltip>
        {showPercentage && (
          <Typography
            variant="caption"
            sx={{
              fontWeight: 600,
              color: fillColor,
              minWidth: 40,
              textAlign: 'right',
            }}
          >
            {Math.round(clampedScore)}%
          </Typography>
        )}
      </Box>
    );
  }

  return (
    <Tooltip title={`${label} confidence (${Math.round(clampedScore)}%)`}>
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, width }}>
        {bar}
        {showPercentage && (
          <Typography
            variant="caption"
            sx={{
              fontWeight: 600,
              color: fillColor,
              minWidth: 32,
            }}
          >
            {Math.round(clampedScore)}%
          </Typography>
        )}
      </Box>
    </Tooltip>
  );
};

/**
 * Compact confidence indicator (just a colored dot with percentage)
 */
export const ConfidenceIndicator: React.FC<{ score: number }> = ({ score }) => {
  const clampedScore = Math.max(0, Math.min(100, score));
  const fillColor = getConfidenceColor(clampedScore);
  const label = getConfidenceLabel(clampedScore);

  return (
    <Tooltip title={`${label} confidence`}>
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
        <Box
          sx={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            bgcolor: fillColor,
            border: '1px solid rgba(0,0,0,0.1)',
          }}
        />
        <Typography
          variant="body2"
          sx={{
            fontWeight: 600,
            color: fillColor,
          }}
        >
          {Math.round(clampedScore)}%
        </Typography>
      </Box>
    </Tooltip>
  );
};

/**
 * Emoji-based confidence indicator
 */
export const ConfidenceEmoji: React.FC<{ score: number }> = ({ score }) => {
  let emoji: string;
  if (score >= 70) emoji = '🟢';
  else if (score >= 50) emoji = '🟡';
  else if (score >= 25) emoji = '🟠';
  else emoji = '🔴';

  return (
    <span title={`${Math.round(score)}% confidence`}>
      {emoji}
    </span>
  );
};

export default AssociationConfidenceBar;
