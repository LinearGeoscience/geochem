/**
 * Transformation Manager Component
 * Comprehensive UI for compositional data transformations based on GeoCoDA workflow
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Plot from 'react-plotly.js';
import { useAppStore } from '../../store/appStore';
import { useTransformationStore } from '../../store/transformationStore';
import { TransformationResult } from '../../types/compositional';
import { TransformationType, ZeroHandlingStrategy } from '../../types/compositional';

// ============================================================================
// TYPES
// ============================================================================

interface TabProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

const Tab: React.FC<TabProps> = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    style={{
      padding: '8px 16px',
      border: 'none',
      borderBottom: active ? '2px solid #3b82f6' : '2px solid transparent',
      background: 'none',
      color: active ? '#3b82f6' : '#6b7280',
      fontWeight: active ? 600 : 400,
      cursor: 'pointer',
      fontSize: '14px'
    }}
  >
    {children}
  </button>
);

const InfoTooltip: React.FC<{ text: string }> = ({ text }) => (
  <span
    title={text}
    style={{
      marginLeft: '4px',
      cursor: 'help',
      color: '#9ca3af',
      fontSize: '12px'
    }}
  >
    ⓘ
  </span>
);

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const TransformationManager: React.FC = () => {
  const { data, addColumn, getFilteredColumns } = useAppStore();
  const filteredColumns = getFilteredColumns();
  const {
    activeTransformation,
    selectedColumns,
    zeroStrategy,
    customZeroValue,
    alrReference,
    numeratorAmalgamation,
    denominatorAmalgamation,
    chiPowerLambda,
    currentResult,
    varianceResult,
    procrustesResult,
    pcaResult,
    zeroSummary,
    isProcessing,
    error,
    setActiveTransformation,
    setSelectedColumns,
    setZeroStrategy,
    setCustomZeroValue,
    setALRReference,
    setNumeratorAmalgamation,
    setDenominatorAmalgamation,
    setChiPowerLambda,
    executeTransformation,
    runVarianceDecomposition,
    runProcrustesAnalysis,
    runPCA,
    analyzeZeros,
    getAllAmalgamations,
    // Log Additive Index
    logAdditiveIndices,
    logAdditiveSelectedColumns,
    logAdditiveIndexName,
    setLogAdditiveSelectedColumns,
    setLogAdditiveIndexName,
    createLogAdditiveIndex,
    suggestLogAdditiveIndexName
  } = useTransformationStore();

  const [activeTab, setActiveTab] = useState<'transform' | 'variance' | 'pca' | 'zeros' | 'logindex'>('transform');
  const [groupColumn, setGroupColumn] = useState<string>('');

  // Get numeric columns - respects RAW/CLR filter
  const numericColumns = useMemo(() =>
    filteredColumns.filter(col => col.type === 'numeric').map(col => col.name),
    [filteredColumns]
  );

  // Get categorical columns for grouping
  const categoricalColumns = useMemo(() =>
    filteredColumns.filter(col => col.type === 'categorical' || col.type === 'text').map(col => col.name),
    [filteredColumns]
  );

  // Auto-select columns on mount
  useEffect(() => {
    if (selectedColumns.length === 0 && numericColumns.length > 0) {
      // Auto-select element/oxide columns
      const elementPattern = /^(Si|Ti|Al|Fe|Mn|Mg|Ca|Na|K|P|Cr|Ni|Co|V|Zr|Nb|Y|La|Ce|Nd|Sm|Eu|Gd|Dy|Er|Yb|Lu|Ba|Sr|Rb|Th|U|Pb|Zn|Cu|As|Sb|Au|Ag)/i;
      const autoSelected = numericColumns.filter(col => elementPattern.test(col)).slice(0, 15);
      if (autoSelected.length >= 3) {
        setSelectedColumns(autoSelected);
      }
    }
  }, [numericColumns, selectedColumns.length, setSelectedColumns]);

  // Add transformed columns to main data store
  const addTransformedColumnsToStore = useCallback((result: TransformationResult) => {
    // Add each transformed column to the main data store with transformation type
    const transformType = result.config.type as 'clr' | 'alr' | 'ilr' | 'plr' | 'slr' | 'chipower';
    const suffix = transformType.toUpperCase();
    const addedColumns: string[] = [];

    result.columnNames.forEach((colName, colIndex) => {
      // Suffix column name with transformation type (e.g., Au_ppm_CLR) to avoid overwriting original columns
      const newColName = colName.endsWith(`_${suffix}`) ? colName : `${colName}_${suffix}`;
      const values = result.values.map(row => row[colIndex]);
      addColumn(newColName, values, 'numeric', 'Transformed', transformType);
      addedColumns.push(newColName);
    });
    console.log(`[Transform] Added ${addedColumns.length} columns to data store: ${addedColumns.join(', ')}`);
  }, [addColumn]);

  // Handle transformation execution
  const handleExecute = async () => {
    if (selectedColumns.length < 2) {
      alert('Please select at least 2 columns for transformation');
      return;
    }
    const result = await executeTransformation(data, selectedColumns);
    if (result) {
      addTransformedColumnsToStore(result);
    }
  };

  // Handle variance decomposition
  const handleVarianceDecomposition = () => {
    if (selectedColumns.length < 2) return;
    const groups = groupColumn ? data.map(row => String(row[groupColumn] ?? '')) : undefined;
    runVarianceDecomposition(data, selectedColumns, groups);
  };

  // Handle Procrustes analysis
  const handleProcrustesAnalysis = () => {
    if (selectedColumns.length < 3) return;
    runProcrustesAnalysis(data, selectedColumns);
  };

  // Handle PCA
  const handlePCA = () => {
    if (selectedColumns.length < 2) return;
    runPCA(data, selectedColumns);
  };

  // Handle zero analysis
  const handleZeroAnalysis = () => {
    if (selectedColumns.length < 1) return;
    analyzeZeros(data, selectedColumns);
  };

  // Handle log additive index creation
  const handleCreateLogAdditiveIndex = () => {
    if (logAdditiveSelectedColumns.length < 2) {
      alert('Please select at least 2 columns for the log additive index');
      return;
    }
    const name = logAdditiveIndexName.trim() || suggestLogAdditiveIndexName(logAdditiveSelectedColumns);
    const result = createLogAdditiveIndex(data, logAdditiveSelectedColumns, name);
    if (result) {
      // Add the index column to the main data store
      addColumn(result.name, result.values, 'numeric', 'Index', 'log-additive');
      // Clear the name field for next index
      setLogAdditiveIndexName('');
    }
  };

  // Auto-suggest log additive index name
  const handleAutoSuggestName = () => {
    if (logAdditiveSelectedColumns.length > 0) {
      setLogAdditiveIndexName(suggestLogAdditiveIndexName(logAdditiveSelectedColumns));
    }
  };

  // Render transformation options based on type
  const renderTransformationOptions = () => {
    switch (activeTransformation) {
      case 'alr':
        return (
          <div style={{ marginTop: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>
              Reference Element
              <InfoTooltip text="ALR uses a fixed reference element as denominator. Use Procrustes analysis to find the optimal reference." />
            </label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <select
                value={alrReference}
                onChange={(e) => setALRReference(e.target.value)}
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid #d1d5db'
                }}
              >
                <option value="">Select reference...</option>
                {selectedColumns.map(col => (
                  <option key={col} value={col}>{col}</option>
                ))}
              </select>
              <button
                onClick={handleProcrustesAnalysis}
                disabled={selectedColumns.length < 3 || isProcessing}
                style={{
                  padding: '8px 12px',
                  borderRadius: '4px',
                  border: 'none',
                  background: '#10b981',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                Find Optimal
              </button>
            </div>

            {procrustesResult && (
              <div style={{
                marginTop: '12px',
                padding: '12px',
                background: '#f0fdf4',
                borderRadius: '4px',
                fontSize: '13px'
              }}>
                <div style={{ fontWeight: 500, marginBottom: '8px' }}>
                  Procrustes Analysis Results
                </div>
                <div>
                  Optimal: <strong>{procrustesResult.referenceElement}</strong> (r = {procrustesResult.correlation.toFixed(3)})
                </div>
                <div style={{ marginTop: '8px', fontSize: '12px', color: '#6b7280' }}>
                  Top 5: {procrustesResult.rankings.slice(0, 5).map(r =>
                    `${r.element} (${r.correlation.toFixed(3)})`
                  ).join(', ')}
                </div>
              </div>
            )}
          </div>
        );

      case 'slr':
        const amalgamations = getAllAmalgamations();
        return (
          <div style={{ marginTop: '16px' }}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>
                Numerator Group (Sum)
                <InfoTooltip text="Elements to sum in the numerator of the SLR ratio" />
              </label>
              <select
                onChange={(e) => {
                  const selected = amalgamations.find(a => a.id === e.target.value);
                  if (selected) {
                    const matched = numericColumns.filter(col =>
                      selected.elements.some(elem =>
                        col.toLowerCase().includes(elem.toLowerCase())
                      )
                    );
                    setNumeratorAmalgamation(matched);
                  }
                }}
                style={{
                  width: '100%',
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid #d1d5db',
                  marginBottom: '8px'
                }}
              >
                <option value="">Select preset amalgamation...</option>
                {amalgamations.map(a => (
                  <option key={a.id} value={a.id}>{a.name} - {a.description}</option>
                ))}
              </select>
              <div style={{ fontSize: '12px', color: '#6b7280' }}>
                Selected: {numeratorAmalgamation.join(', ') || 'None'}
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>
                Denominator Group (Sum)
                <InfoTooltip text="Elements to sum in the denominator of the SLR ratio" />
              </label>
              <select
                onChange={(e) => {
                  const selected = amalgamations.find(a => a.id === e.target.value);
                  if (selected) {
                    const matched = numericColumns.filter(col =>
                      selected.elements.some(elem =>
                        col.toLowerCase().includes(elem.toLowerCase())
                      )
                    );
                    setDenominatorAmalgamation(matched);
                  }
                }}
                style={{
                  width: '100%',
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid #d1d5db',
                  marginBottom: '8px'
                }}
              >
                <option value="">Select preset amalgamation...</option>
                {amalgamations.map(a => (
                  <option key={a.id} value={a.id}>{a.name} - {a.description}</option>
                ))}
              </select>
              <div style={{ fontSize: '12px', color: '#6b7280' }}>
                Selected: {denominatorAmalgamation.join(', ') || 'None'}
              </div>
            </div>
          </div>
        );

      case 'chipower':
        return (
          <div style={{ marginTop: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>
              Lambda (λ) Parameter
              <InfoTooltip text="Power parameter. λ=0 gives LRA, λ=0.25 (fourth-root) is default for data with zeros" />
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={chiPowerLambda}
              onChange={(e) => setChiPowerLambda(parseFloat(e.target.value))}
              style={{ width: '100%' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#6b7280' }}>
              <span>0 (LRA)</span>
              <span>λ = {chiPowerLambda.toFixed(2)}</span>
              <span>1 (Linear)</span>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div style={{ padding: '16px', height: '100%', overflow: 'auto' }}>
      <h2 style={{ margin: '0 0 16px 0', fontSize: '18px' }}>
        Compositional Data Transformations
      </h2>

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid #e5e7eb', marginBottom: '16px' }}>
        <Tab active={activeTab === 'transform'} onClick={() => setActiveTab('transform')}>
          Transform
        </Tab>
        <Tab active={activeTab === 'variance'} onClick={() => setActiveTab('variance')}>
          Variance Analysis
        </Tab>
        <Tab active={activeTab === 'pca'} onClick={() => setActiveTab('pca')}>
          PCA / LRA
        </Tab>
        <Tab active={activeTab === 'zeros'} onClick={() => setActiveTab('zeros')}>
          Zero Analysis
        </Tab>
        <Tab active={activeTab === 'logindex'} onClick={() => setActiveTab('logindex')}>
          Log Index
        </Tab>
      </div>

      {/* Error display */}
      {error && (
        <div style={{
          padding: '12px',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '4px',
          color: '#dc2626',
          marginBottom: '16px',
          fontSize: '13px'
        }}>
          {error}
        </div>
      )}

      {/* Transform Tab */}
      {activeTab === 'transform' && (
        <div>
          {/* Transformation Type Selection */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>
              Transformation Type
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
              {[
                { value: 'clr', label: 'CLR', desc: 'Centered Log-Ratio' },
                { value: 'alr', label: 'ALR', desc: 'Additive Log-Ratio' },
                { value: 'plr', label: 'PLR', desc: 'Pairwise Log-Ratio' },
                { value: 'ilr', label: 'ILR', desc: 'Isometric Log-Ratio' },
                { value: 'slr', label: 'SLR', desc: 'Summed Log-Ratio' },
                { value: 'chipower', label: 'chiPower', desc: 'Chi-Power Transform' }
              ].map(t => (
                <button
                  key={t.value}
                  onClick={() => setActiveTransformation(t.value as TransformationType)}
                  style={{
                    padding: '12px 8px',
                    borderRadius: '4px',
                    border: activeTransformation === t.value
                      ? '2px solid #3b82f6'
                      : '1px solid #d1d5db',
                    background: activeTransformation === t.value ? '#eff6ff' : 'white',
                    cursor: 'pointer',
                    textAlign: 'center'
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{t.label}</div>
                  <div style={{ fontSize: '11px', color: '#6b7280' }}>{t.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Column Selection */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>
              Select Columns ({selectedColumns.length} selected)
              <InfoTooltip text="Select the compositional columns (elements/oxides) to transform" />
            </label>
            <div style={{
              maxHeight: '150px',
              overflow: 'auto',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              padding: '8px'
            }}>
              {numericColumns.map(col => (
                <label
                  key={col}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '4px',
                    cursor: 'pointer'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedColumns.includes(col)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedColumns([...selectedColumns, col]);
                      } else {
                        setSelectedColumns(selectedColumns.filter(c => c !== col));
                      }
                    }}
                    style={{ marginRight: '8px' }}
                  />
                  {col}
                </label>
              ))}
            </div>
            <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setSelectedColumns(numericColumns)}
                style={{
                  padding: '4px 8px',
                  fontSize: '12px',
                  borderRadius: '4px',
                  border: '1px solid #d1d5db',
                  background: 'white',
                  cursor: 'pointer'
                }}
              >
                Select All
              </button>
              <button
                onClick={() => setSelectedColumns([])}
                style={{
                  padding: '4px 8px',
                  fontSize: '12px',
                  borderRadius: '4px',
                  border: '1px solid #d1d5db',
                  background: 'white',
                  cursor: 'pointer'
                }}
              >
                Clear
              </button>
            </div>
          </div>

          {/* Zero Handling */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>
              Zero Handling Strategy
              <InfoTooltip text="How to handle zero/missing values before log transformation" />
            </label>
            <select
              value={zeroStrategy}
              onChange={(e) => setZeroStrategy(e.target.value as ZeroHandlingStrategy)}
              style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid #d1d5db'
              }}
            >
              <option value="half-min">Half Minimum (½ × min non-zero)</option>
              <option value="half-dl">Half Detection Limit</option>
              <option value="small-constant">Small Constant (0.65 × min)</option>
              <option value="multiplicative">Multiplicative Replacement</option>
              <option value="custom">Custom Value</option>
            </select>

            {zeroStrategy === 'custom' && (
              <input
                type="number"
                value={customZeroValue}
                onChange={(e) => setCustomZeroValue(parseFloat(e.target.value))}
                step="0.001"
                min="0"
                style={{
                  width: '100%',
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid #d1d5db',
                  marginTop: '8px'
                }}
                placeholder="Enter custom replacement value"
              />
            )}
          </div>

          {/* Transformation-specific options */}
          {renderTransformationOptions()}

          {/* Execute Button */}
          <button
            onClick={handleExecute}
            disabled={isProcessing || selectedColumns.length < 2}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '4px',
              border: 'none',
              background: isProcessing ? '#9ca3af' : '#3b82f6',
              color: 'white',
              fontWeight: 600,
              cursor: isProcessing ? 'not-allowed' : 'pointer',
              marginTop: '16px'
            }}
          >
            {isProcessing ? 'Processing...' : 'Execute Transformation'}
          </button>

          {/* Results */}
          {currentResult && (() => {
            const suffix = currentResult.config.type.toUpperCase();
            const suffixedNames = currentResult.columnNames.map(name =>
              name.endsWith(`_${suffix}`) ? name : `${name}_${suffix}`
            );
            return (
              <div style={{
                marginTop: '16px',
                padding: '12px',
                background: '#f0fdf4',
                borderRadius: '4px',
                border: '1px solid #86efac'
              }}>
                <div style={{ fontWeight: 500, marginBottom: '8px', color: '#166534' }}>
                  ✓ Transformation Complete - Columns Added to Data
                </div>
                <div style={{ fontSize: '13px' }}>
                  <div>Type: {suffix}</div>
                  <div>New columns: {suffixedNames.join(', ')}</div>
                  <div>Samples: {currentResult.values.length}</div>
                  {currentResult.zerosReplaced > 0 && (
                    <div>Zeros replaced: {currentResult.zerosReplaced}</div>
                  )}
                  {currentResult.procrustesCorrelation && (
                    <div>Procrustes correlation: {currentResult.procrustesCorrelation.toFixed(3)}</div>
                  )}
                </div>
                <div style={{
                  marginTop: '8px',
                  padding: '8px',
                  background: '#dcfce7',
                  borderRadius: '4px',
                  fontSize: '12px',
                  color: '#166534'
                }}>
                  These columns are now available in Data View, Plots, Correlation Matrix, and other analyses.
                  Use the filter dropdown in the toolbar to show only {suffix} columns.
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Variance Tab */}
      {activeTab === 'variance' && (
        <div>
          <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '16px' }}>
            Analyze variance contributions of pairwise logratios (PLRs) to identify the most
            important element ratios for your data.
          </p>

          {/* Group selection for between-group variance */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>
              Group Column (optional)
              <InfoTooltip text="Select a categorical column to calculate between-group variance" />
            </label>
            <select
              value={groupColumn}
              onChange={(e) => setGroupColumn(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid #d1d5db'
              }}
            >
              <option value="">None</option>
              {categoricalColumns.map(col => (
                <option key={col} value={col}>{col}</option>
              ))}
            </select>
          </div>

          <button
            onClick={handleVarianceDecomposition}
            disabled={isProcessing || selectedColumns.length < 2}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '4px',
              border: 'none',
              background: isProcessing ? '#9ca3af' : '#3b82f6',
              color: 'white',
              fontWeight: 600,
              cursor: isProcessing ? 'not-allowed' : 'pointer'
            }}
          >
            {isProcessing ? 'Analyzing...' : 'Run Variance Decomposition'}
          </button>

          {varianceResult && (
            <div style={{ marginTop: '16px' }}>
              <h4 style={{ margin: '0 0 12px 0' }}>Top PLRs by Contributed Variance</h4>
              <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f3f4f6' }}>
                    <th style={{ padding: '8px', textAlign: 'left' }}>PLR</th>
                    <th style={{ padding: '8px', textAlign: 'right' }}>Contributed %</th>
                    <th style={{ padding: '8px', textAlign: 'right' }}>Explained R²</th>
                    {groupColumn && <th style={{ padding: '8px', textAlign: 'right' }}>Between-Group %</th>}
                  </tr>
                </thead>
                <tbody>
                  {varianceResult.topByContributed.slice(0, 10).map((v, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '8px' }}>{v.plrName}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>{v.contributedVariance.toFixed(2)}%</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>{v.explainedVariance.toFixed(1)}%</td>
                      {groupColumn && (
                        <td style={{ padding: '8px', textAlign: 'right' }}>
                          {v.betweenGroupVariance?.toFixed(1) ?? '-'}%
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* PCA Tab */}
      {activeTab === 'pca' && (
        <div>
          <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '16px' }}>
            Logratio Analysis (LRA) - PCA on CLR-transformed data. The biplot shows both
            samples and variable loadings in reduced dimensions.
          </p>

          <button
            onClick={handlePCA}
            disabled={isProcessing || selectedColumns.length < 2}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '4px',
              border: 'none',
              background: isProcessing ? '#9ca3af' : '#3b82f6',
              color: 'white',
              fontWeight: 600,
              cursor: isProcessing ? 'not-allowed' : 'pointer'
            }}
          >
            {isProcessing ? 'Computing...' : 'Run PCA / LRA'}
          </button>

          {pcaResult && pcaResult.scores.length > 0 && (
            <div style={{ marginTop: '16px' }}>
              <div style={{ marginBottom: '8px', fontSize: '13px' }}>
                PC1: {pcaResult.varianceExplained[0]?.toFixed(1)}% |
                PC2: {pcaResult.varianceExplained[1]?.toFixed(1)}% |
                Cumulative: {pcaResult.cumulativeVariance[1]?.toFixed(1)}%
              </div>

              <Plot
                data={[
                  // Samples
                  {
                    x: pcaResult.scores.map(s => s[0]),
                    y: pcaResult.scores.map(s => s[1]),
                    mode: 'markers',
                    type: 'scatter',
                    name: 'Samples',
                    marker: { size: 6, color: '#3b82f6', opacity: 0.6 }
                  },
                  // Loadings (scaled)
                  {
                    x: pcaResult.loadings.map(l => l[0] * 3),
                    y: pcaResult.loadings.map(l => l[1] * 3),
                    mode: 'markers+text' as any,
                    type: 'scatter',
                    name: 'Variables',
                    text: pcaResult.columns,
                    textposition: 'top center' as any,
                    marker: { size: 8, color: '#dc2626', symbol: 'diamond' }
                  }
                ]}
                layout={{
                  title: { text: 'LRA Biplot' } as any,
                  xaxis: { title: { text: `PC1 (${pcaResult.varianceExplained[0]?.toFixed(1)}%)` } as any, zeroline: true },
                  yaxis: { title: { text: `PC2 (${pcaResult.varianceExplained[1]?.toFixed(1)}%)` } as any, zeroline: true },
                  height: 400,
                  margin: { t: 40, b: 40, l: 50, r: 20 },
                  showlegend: true,
                  legend: { x: 1, y: 1 }
                }}
                config={{ responsive: true }}
                style={{ width: '100%' }}
              />
            </div>
          )}
        </div>
      )}

      {/* Zeros Tab */}
      {activeTab === 'zeros' && (
        <div>
          <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '16px' }}>
            Analyze zeros in your data. The GeoCoDA workflow classifies zeros as:
            structural (element doesn't exist), missing, or below detection limit.
          </p>

          <button
            onClick={handleZeroAnalysis}
            disabled={isProcessing || selectedColumns.length < 1}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '4px',
              border: 'none',
              background: isProcessing ? '#9ca3af' : '#3b82f6',
              color: 'white',
              fontWeight: 600,
              cursor: isProcessing ? 'not-allowed' : 'pointer'
            }}
          >
            {isProcessing ? 'Analyzing...' : 'Analyze Zeros'}
          </button>

          {zeroSummary && (
            <div style={{ marginTop: '16px' }}>
              <div style={{
                padding: '12px',
                background: '#f3f4f6',
                borderRadius: '4px',
                marginBottom: '16px'
              }}>
                <div style={{ fontWeight: 500, marginBottom: '8px' }}>Summary</div>
                <div style={{ fontSize: '13px' }}>
                  <div>Total zeros/missing: {zeroSummary.totalZeros}</div>
                  <div>By type: Unknown: {zeroSummary.byType.unknown}, Below DL: {zeroSummary.byType['below-dl']}</div>
                </div>
              </div>

              <h4 style={{ margin: '0 0 8px 0', fontSize: '14px' }}>Zeros by Column</h4>
              <div style={{ maxHeight: '200px', overflow: 'auto' }}>
                {Object.entries(zeroSummary.byColumn)
                  .sort((a, b) => b[1] - a[1])
                  .map(([col, count]) => (
                    <div
                      key={col}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: '4px 8px',
                        borderBottom: '1px solid #e5e7eb',
                        fontSize: '13px'
                      }}
                    >
                      <span>{col}</span>
                      <span style={{ color: count > 10 ? '#dc2626' : '#6b7280' }}>
                        {count} ({((count / data.length) * 100).toFixed(1)}%)
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Log Index Tab */}
      {activeTab === 'logindex' && (
        <div>
          <div style={{
            padding: '12px',
            background: '#f0f9ff',
            borderRadius: '4px',
            marginBottom: '16px',
            border: '1px solid #bae6fd'
          }}>
            <div style={{ fontWeight: 500, marginBottom: '4px', color: '#0369a1' }}>
              Log Additive Index
            </div>
            <p style={{ fontSize: '13px', color: '#6b7280', margin: 0 }}>
              Sum of log10 values for selected elements. Useful for highlighting mineralisation
              signatures without being affected by different units and orders of magnitude.
            </p>
            <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px', fontFamily: 'monospace' }}>
              Index = LOG10(E1) + LOG10(E2) + ... + LOG10(En)
            </div>
          </div>

          {/* Index Name Input */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>
              Index Name
              <InfoTooltip text="Name for the new index column. Use auto-suggest for automatic naming based on selected elements." />
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={logAdditiveIndexName}
                onChange={(e) => setLogAdditiveIndexName(e.target.value)}
                placeholder="e.g., Log_CuZnPbAg"
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid #d1d5db'
                }}
              />
              <button
                onClick={handleAutoSuggestName}
                disabled={logAdditiveSelectedColumns.length === 0}
                style={{
                  padding: '8px 12px',
                  borderRadius: '4px',
                  border: '1px solid #d1d5db',
                  background: '#f3f4f6',
                  cursor: logAdditiveSelectedColumns.length > 0 ? 'pointer' : 'not-allowed',
                  fontSize: '13px',
                  whiteSpace: 'nowrap'
                }}
              >
                Auto-suggest
              </button>
            </div>
          </div>

          {/* Column Selection */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>
              Select Elements ({logAdditiveSelectedColumns.length} selected)
              <InfoTooltip text="Select the element columns to combine into the index. Minimum 2 required." />
            </label>
            <div style={{
              maxHeight: '200px',
              overflow: 'auto',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              padding: '8px'
            }}>
              {numericColumns.map(col => (
                <label
                  key={col}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '4px 8px',
                    cursor: 'pointer',
                    minWidth: '120px'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={logAdditiveSelectedColumns.includes(col)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setLogAdditiveSelectedColumns([...logAdditiveSelectedColumns, col]);
                      } else {
                        setLogAdditiveSelectedColumns(logAdditiveSelectedColumns.filter(c => c !== col));
                      }
                    }}
                    style={{ marginRight: '6px' }}
                  />
                  <span style={{ fontSize: '13px' }}>{col}</span>
                </label>
              ))}
            </div>
            <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setLogAdditiveSelectedColumns(numericColumns)}
                style={{
                  padding: '4px 8px',
                  fontSize: '12px',
                  borderRadius: '4px',
                  border: '1px solid #d1d5db',
                  background: 'white',
                  cursor: 'pointer'
                }}
              >
                Select All
              </button>
              <button
                onClick={() => setLogAdditiveSelectedColumns([])}
                style={{
                  padding: '4px 8px',
                  fontSize: '12px',
                  borderRadius: '4px',
                  border: '1px solid #d1d5db',
                  background: 'white',
                  cursor: 'pointer'
                }}
              >
                Clear All
              </button>
            </div>
          </div>

          {/* Zero Handling */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>
              Zero Handling
              <InfoTooltip text="How to handle zero/negative values before log transformation" />
            </label>
            <select
              value={zeroStrategy}
              onChange={(e) => setZeroStrategy(e.target.value as ZeroHandlingStrategy)}
              style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid #d1d5db'
              }}
            >
              <option value="half-min">Half Minimum (1/2 x min non-zero)</option>
              <option value="half-dl">Half Detection Limit</option>
              <option value="small-constant">Small Constant (0.65 x min)</option>
              <option value="multiplicative">Multiplicative Replacement</option>
              <option value="custom">Custom Value</option>
            </select>
            {zeroStrategy === 'custom' && (
              <input
                type="number"
                value={customZeroValue}
                onChange={(e) => setCustomZeroValue(parseFloat(e.target.value))}
                step="0.001"
                min="0"
                style={{
                  width: '100%',
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid #d1d5db',
                  marginTop: '8px'
                }}
                placeholder="Enter custom replacement value"
              />
            )}
          </div>

          {/* Create Button */}
          <button
            onClick={handleCreateLogAdditiveIndex}
            disabled={isProcessing || logAdditiveSelectedColumns.length < 2}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '4px',
              border: 'none',
              background: isProcessing || logAdditiveSelectedColumns.length < 2 ? '#9ca3af' : '#3b82f6',
              color: 'white',
              fontWeight: 600,
              cursor: isProcessing || logAdditiveSelectedColumns.length < 2 ? 'not-allowed' : 'pointer'
            }}
          >
            {isProcessing ? 'Creating...' : 'Create Log Additive Index'}
          </button>

          {/* Validation feedback */}
          {logAdditiveSelectedColumns.length > 0 && logAdditiveSelectedColumns.length < 2 && (
            <div style={{
              marginTop: '8px',
              padding: '8px',
              background: '#fef3c7',
              borderRadius: '4px',
              fontSize: '12px',
              color: '#92400e'
            }}>
              Select at least 2 columns to create an index
            </div>
          )}

          {/* Results - Created Indices */}
          {logAdditiveIndices.length > 0 && (
            <div style={{ marginTop: '24px' }}>
              <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 500 }}>
                Created Indices ({logAdditiveIndices.length})
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {logAdditiveIndices.map((idx) => (
                  <div
                    key={idx.id}
                    style={{
                      padding: '12px',
                      background: '#f0fdf4',
                      borderRadius: '4px',
                      border: '1px solid #86efac'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ color: '#166534', marginRight: '8px' }}>✓</span>
                      <span style={{ fontWeight: 500 }}>{idx.name}</span>
                      <span style={{ fontSize: '12px', color: '#6b7280', marginLeft: '8px' }}>
                        ({idx.columns.length} elements, {idx.values.filter(v => v !== null).length} samples)
                      </span>
                    </div>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(4, 1fr)',
                      gap: '8px',
                      fontSize: '12px',
                      color: '#6b7280'
                    }}>
                      <div>
                        <span style={{ fontWeight: 500 }}>Min:</span> {idx.statistics.min.toFixed(2)}
                      </div>
                      <div>
                        <span style={{ fontWeight: 500 }}>Max:</span> {idx.statistics.max.toFixed(2)}
                      </div>
                      <div>
                        <span style={{ fontWeight: 500 }}>Mean:</span> {idx.statistics.mean.toFixed(2)}
                      </div>
                      <div>
                        <span style={{ fontWeight: 500 }}>Zeros:</span> {idx.statistics.zerosReplaced}
                      </div>
                    </div>
                    <div style={{
                      marginTop: '8px',
                      fontSize: '11px',
                      color: '#9ca3af',
                      wordBreak: 'break-word'
                    }}>
                      Elements: {idx.columns.join(', ')}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{
                marginTop: '12px',
                padding: '8px',
                background: '#dcfce7',
                borderRadius: '4px',
                fontSize: '12px',
                color: '#166534'
              }}>
                These indices are now available in Data View, Plots, and other analyses.
                Use the column filter dropdown to show only Log Additive Index columns.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TransformationManager;
