import { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  Typography,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Alert,
  CircularProgress,
  Box,
  Chip
} from '@mui/material';
import { CheckCircle, Error as ErrorIcon } from '@mui/icons-material';

interface ColumnInfo {
  name: string;
  type: string;
  suggested_role: string | null;
  confidence: number;
  sample_values: any[];
  non_null_count: number;
  unique_count: number;
}

interface FilePreview {
  columns: ColumnInfo[];
  preview: any[];
  required_fields: string[];
  total_rows?: number;
}

interface PreviewData {
  collar: FilePreview;
  survey: FilePreview;
  assay: FilePreview;
}

interface ColumnMapping {
  [key: string]: string;
}

interface DrillholeColumnMapperProps {
  files: {
    collar: File;
    survey: File;
    assay: File;
  };
  onMappingComplete: (mappings: {
    collar: ColumnMapping;
    survey: ColumnMapping;
    assay: ColumnMapping;
  }) => void;
  onCancel: () => void;
}

export function DrillholeColumnMapper({ files, onMappingComplete, onCancel }: DrillholeColumnMapperProps) {
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [collarMapping, setCollarMapping] = useState<ColumnMapping>({});
  const [surveyMapping, setSurveyMapping] = useState<ColumnMapping>({});
  const [assayMapping, setAssayMapping] = useState<ColumnMapping>({});

  useEffect(() => {
    fetchPreview();
  }, [files]);

  const fetchPreview = async () => {
    console.log('[DrillholeColumnMapper] Starting preview fetch...');
    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('collar', files.collar);
      formData.append('survey', files.survey);
      formData.append('assay', files.assay);

      console.log('[DrillholeColumnMapper] Sending request to /api/drillhole/preview');
      const response = await fetch('/api/drillhole/preview', {
        method: 'POST',
        body: formData
      });

      console.log('[DrillholeColumnMapper] Response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[DrillholeColumnMapper] Error response:', errorText);
        throw new Error(`Preview failed: ${response.statusText}`);
      }

      const data: PreviewData = await response.json();
      console.log('[DrillholeColumnMapper] Preview data received:', data);
      setPreview(data);

      // Auto-set best suggestions based on confidence AND data coverage
      // Score = confidence * (data_coverage_ratio)
      // This ensures we prefer columns with both high confidence AND more data
      const autoCollar = selectBestMappings(data.collar.columns, data.collar.total_rows || data.collar.preview.length);
      const autoSurvey = selectBestMappings(data.survey.columns, data.survey.total_rows || data.survey.preview.length);
      const autoAssay = selectBestMappings(data.assay.columns, data.assay.total_rows || data.assay.preview.length);

      setCollarMapping(autoCollar);
      setSurveyMapping(autoSurvey);
      setAssayMapping(autoAssay);

      console.log('[DrillholeColumnMapper] Auto-mappings set:', { autoCollar, autoSurvey, autoAssay });

    } catch (err) {
      console.error('[DrillholeColumnMapper] Fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load preview');
    } finally {
      setLoading(false);
      console.log('[DrillholeColumnMapper] Loading complete');
    }
  };

  const isValid = () => {
    if (!preview) return false;

    // Check all required fields are mapped
    const collarValid = preview.collar.required_fields.every(field => collarMapping[field]);
    const surveyValid = preview.survey.required_fields.every(field => surveyMapping[field]);
    const assayValid = preview.assay.required_fields.every(field => assayMapping[field]);

    return collarValid && surveyValid && assayValid;
  };

  const handleSubmit = () => {
    if (isValid()) {
      onMappingComplete({
        collar: collarMapping,
        survey: surveyMapping,
        assay: assayMapping
      });
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', p: 8 }}>
        <CircularProgress />
        <Typography sx={{ ml: 2 }}>Loading column preview...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" icon={<ErrorIcon />}>
        {error}
      </Alert>
    );
  }

  if (!preview) return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="h5" fontWeight="bold">Column Mapping</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Please verify or select the correct columns for each file
        </Typography>
      </Box>

      {/* Collar File Mapping */}
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <Typography variant="h6">Collar File</Typography>
            {preview.collar.required_fields.every(f => collarMapping[f]) &&
              <CheckCircle color="success" />
            }
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 3 }}>
            {preview.collar.required_fields.map(field => (
              <ColumnSelector
                key={field}
                label={formatFieldName(field)}
                field={field}
                columns={preview.collar.columns}
                value={collarMapping[field] || ''}
                onChange={(value) => setCollarMapping({...collarMapping, [field]: value})}
                required
              />
            ))}
          </Box>
          <DataPreview data={preview.collar.preview} />
        </CardContent>
      </Card>

      {/* Survey File Mapping */}
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <Typography variant="h6">Survey File</Typography>
            {preview.survey.required_fields.every(f => surveyMapping[f]) &&
              <CheckCircle color="success" />
            }
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 3 }}>
            {preview.survey.required_fields.map(field => (
              <ColumnSelector
                key={field}
                label={formatFieldName(field)}
                field={field}
                columns={preview.survey.columns}
                value={surveyMapping[field] || ''}
                onChange={(value) => setSurveyMapping({...surveyMapping, [field]: value})}
                required
              />
            ))}
          </Box>
          <DataPreview data={preview.survey.preview} />
        </CardContent>
      </Card>

      {/* Assay File Mapping */}
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <Typography variant="h6">Assay File</Typography>
            {preview.assay.required_fields.every(f => assayMapping[f]) &&
              <CheckCircle color="success" />
            }
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 3 }}>
            {preview.assay.required_fields.map(field => (
              <ColumnSelector
                key={field}
                label={formatFieldName(field)}
                field={field}
                columns={preview.assay.columns}
                value={assayMapping[field] || ''}
                onChange={(value) => setAssayMapping({...assayMapping, [field]: value})}
                required
              />
            ))}
          </Box>
          <DataPreview data={preview.assay.preview} />
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
        <Button variant="outlined" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={!isValid()}>
          Process Drillholes
        </Button>
      </Box>
    </Box>
  );
}

interface ColumnSelectorProps {
  label: string;
  field: string;
  columns: ColumnInfo[];
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}

function ColumnSelector({ label, field, columns, value, onChange, required }: ColumnSelectorProps) {
  const selectedColumn = columns.find(c => c.name === value);

  return (
    <FormControl fullWidth size="small">
      <InputLabel id={`${field}-label`}>
        {label} {required && <span style={{ color: 'red' }}>*</span>}
      </InputLabel>
      <Select
        labelId={`${field}-label`}
        id={field}
        value={value}
        label={label}
        onChange={(e) => onChange(e.target.value)}
      >
        <MenuItem value="">
          <em>None</em>
        </MenuItem>
        {columns.map(col => (
          <MenuItem key={col.name} value={col.name}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <span>{col.name}</span>
              {col.suggested_role === field && (
                <Chip
                  label={`${col.confidence}%`}
                  size="small"
                  color="primary"
                  sx={{ ml: 1, height: 20 }}
                />
              )}
            </Box>
          </MenuItem>
        ))}
      </Select>
      {value && selectedColumn && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
          Sample values: {selectedColumn.sample_values.slice(0, 3).join(', ')}
        </Typography>
      )}
    </FormControl>
  );
}

interface DataPreviewProps {
  data: any[];
}

function DataPreview({ data }: DataPreviewProps) {
  if (!data || data.length === 0) return null;

  const columns = Object.keys(data[0]);

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            {columns.slice(0, 6).map(col => (
              <TableCell key={col} sx={{ fontSize: '0.75rem', fontWeight: 'bold' }}>{col}</TableCell>
            ))}
            {columns.length > 6 && <TableCell>...</TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {data.slice(0, 3).map((row, idx) => (
            <TableRow key={idx}>
              {columns.slice(0, 6).map(col => (
                <TableCell key={col} sx={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>
                  {row[col]?.toString() || '-'}
                </TableCell>
              ))}
              {columns.length > 6 && <TableCell>...</TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

function formatFieldName(field: string): string {
  const names: Record<string, string> = {
    'hole_id': 'Hole ID',
    'easting': 'Easting (X)',
    'northing': 'Northing (Y)',
    'rl': 'RL/Elevation (Z)',
    'depth': 'Depth',
    'dip': 'Dip/Inclination',
    'azimuth': 'Azimuth/Bearing',
    'from': 'From Depth',
    'to': 'To Depth'
  };
  return names[field] || field;
}

/**
 * Select the best column mappings based on confidence AND data coverage.
 *
 * Score formula: confidence * (non_null_count / total_rows) * position_weight
 *
 * This ensures:
 * 1. Higher confidence columns are preferred
 * 2. Columns with more data are preferred (e.g., 95% data beats 50% data)
 * 3. Columns earlier in the list get slight preference (when scores are equal)
 */
function selectBestMappings(columns: ColumnInfo[], totalRows: number): ColumnMapping {
  const mapping: ColumnMapping = {};

  // Group columns by their suggested role
  const roleScores: Record<string, Array<{ name: string; score: number; confidence: number; coverage: number }>> = {};

  columns.forEach((col, index) => {
    if (!col.suggested_role || col.confidence < 50) return; // Ignore low confidence

    const role = col.suggested_role;

    // Calculate data coverage ratio (0 to 1)
    const maxRows = Math.max(totalRows, col.non_null_count, 1);
    const coverageRatio = col.non_null_count / maxRows;

    // Calculate combined score
    // - Base score from confidence (0-100)
    // - Multiply by coverage (0-1), but don't let low coverage kill high confidence completely
    // - Minimum coverage weight is 0.5 (so 50% data still gets half score)
    const coverageWeight = Math.max(0.5, coverageRatio);

    // Position weight: columns earlier in list get slight bonus (1.0 to 0.9)
    const positionWeight = 1.0 - (index * 0.01);

    const score = col.confidence * coverageWeight * positionWeight;

    if (!roleScores[role]) {
      roleScores[role] = [];
    }

    roleScores[role].push({
      name: col.name,
      score,
      confidence: col.confidence,
      coverage: coverageRatio * 100
    });
  });

  // For each role, select the column with the highest score
  Object.entries(roleScores).forEach(([role, candidates]) => {
    if (candidates.length === 0) return;

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    const best = candidates[0];

    // Only auto-select if the best score is reasonable (confidence * coverage > 50)
    if (best.score >= 50) {
      mapping[role] = best.name;
      console.log(`[AutoMap] ${role}: selected "${best.name}" (score=${best.score.toFixed(1)}, conf=${best.confidence}%, cov=${best.coverage.toFixed(0)}%)`);
    } else {
      console.log(`[AutoMap] ${role}: no good match (best was "${best.name}" with score=${best.score.toFixed(1)})`);
    }
  });

  return mapping;
}