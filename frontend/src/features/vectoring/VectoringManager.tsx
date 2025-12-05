/**
 * Vectoring Manager Component
 * Comprehensive UI for deposit-specific geochemical vectoring analysis
 * With histogram visualizations and threshold lines for each indicator
 */

import React, { useState, useMemo } from 'react';
import Plot from 'react-plotly.js';
import { useAppStore } from '../../store/appStore';
import { useVectoringStore } from '../../store/vectoringStore';
import { DepositType, CalculatedIndicator } from '../../types/vectoring';
import { DEPOSIT_CONFIGS, VECTORING_INDICATORS, getDepositConfig } from '../../utils/depositVectoring';

// ============================================================================
// DEPOSIT CATEGORY GROUPINGS
// ============================================================================

const DEPOSIT_CATEGORIES: Record<string, DepositType[]> = {
  'Gold Systems': ['orogenic-gold', 'carlin-gold', 'irgs', 'epithermal-hs', 'epithermal-ls'],
  'Porphyry & IOCG': ['porphyry-cu-au', 'porphyry-cu-mo', 'iocg', 'skarn'],
  'Mafic-Ultramafic Ni-Cu-PGE': ['ni-cu-pge-intrusion', 'komatiite-ni'],
  'VMS & Sediment-Hosted': ['vms', 'sedex', 'mvt'],
  'Critical Minerals': ['lct-pegmatite', 'sn-w-greisen', 'carbonatite-ree', 'uranium-rollfront']
};

// ============================================================================
// INDICATOR HISTOGRAM COMPONENT
// ============================================================================

interface IndicatorHistogramProps {
  indicator: CalculatedIndicator;
  thresholds: { value: number; color: string; label: string }[];
}

const IndicatorHistogram: React.FC<IndicatorHistogramProps> = ({ indicator, thresholds }) => {
  const validValues = indicator.values.filter((v): v is number => v !== null && !isNaN(v));

  if (validValues.length === 0) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280', background: '#f9fafb', borderRadius: '8px' }}>
        No valid data for {indicator.name}
      </div>
    );
  }

  // Create threshold shapes for vertical lines
  const shapes = thresholds.map(t => ({
    type: 'line' as const,
    x0: t.value,
    x1: t.value,
    y0: 0,
    y1: 1,
    yref: 'paper' as const,
    line: { color: t.color, width: 2, dash: 'dash' as const }
  }));

  // Create annotations for threshold labels
  const annotations = thresholds.map(t => ({
    x: t.value,
    y: 1,
    yref: 'paper' as const,
    text: t.label,
    showarrow: false,
    font: { size: 10, color: t.color },
    yanchor: 'bottom' as const,
    textangle: -45
  }));

  // Color the histogram bars based on thresholds
  const getBarColor = (value: number): string => {
    // Sort thresholds and find where value falls
    const sortedThresholds = [...thresholds].sort((a, b) => a.value - b.value);
    for (let i = sortedThresholds.length - 1; i >= 0; i--) {
      if (value >= sortedThresholds[i].value) {
        return sortedThresholds[i].color;
      }
    }
    return '#94a3b8'; // Default gray
  };

  // Calculate histogram bins manually for coloring
  const min = Math.min(...validValues);
  const max = Math.max(...validValues);
  const binCount = Math.min(30, Math.ceil(Math.sqrt(validValues.length)));
  const binWidth = (max - min) / binCount || 1;

  return (
    <div style={{ marginBottom: '24px', background: 'white', borderRadius: '8px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
      {/* Header with stats */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: '15px' }}>{indicator.name}</div>
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
              {indicator.statistics.validCount} valid samples
            </div>
          </div>
          <div style={{ display: 'flex', gap: '16px', fontSize: '12px' }}>
            <div><span style={{ color: '#6b7280' }}>Min:</span> <strong>{indicator.statistics.min.toFixed(2)}</strong></div>
            <div><span style={{ color: '#6b7280' }}>Max:</span> <strong>{indicator.statistics.max.toFixed(2)}</strong></div>
            <div><span style={{ color: '#6b7280' }}>Mean:</span> <strong>{indicator.statistics.mean.toFixed(2)}</strong></div>
            <div><span style={{ color: '#6b7280' }}>Median:</span> <strong>{indicator.statistics.median.toFixed(2)}</strong></div>
          </div>
        </div>
      </div>

      {/* Histogram plot */}
      <Plot
        data={[{
          x: validValues,
          type: 'histogram',
          marker: {
            color: validValues.map(v => getBarColor(v)),
            line: { color: 'white', width: 1 }
          },
          nbinsx: binCount,
          hovertemplate: 'Value: %{x:.2f}<br>Count: %{y}<extra></extra>'
        }]}
        layout={{
          height: 200,
          margin: { t: 20, b: 40, l: 50, r: 20 },
          xaxis: { title: { text: indicator.name, font: { size: 11 } } },
          yaxis: { title: { text: 'Count', font: { size: 11 } } },
          shapes,
          annotations,
          showlegend: false,
          paper_bgcolor: 'white',
          plot_bgcolor: 'white'
        }}
        config={{ responsive: true, displayModeBar: false }}
        style={{ width: '100%' }}
      />

      {/* Fertility distribution bar */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid #e5e7eb' }}>
        <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '6px' }}>Sample Classification</div>
        <div style={{ display: 'flex', height: '24px', borderRadius: '4px', overflow: 'hidden', background: '#e5e7eb' }}>
          {(() => {
            const veryHigh = indicator.fertility.filter(f => f === 'very-high').length;
            const high = indicator.fertility.filter(f => f === 'high').length;
            const mod = indicator.fertility.filter(f => f === 'moderate').length;
            const low = indicator.fertility.filter(f => f === 'low').length;
            const barren = indicator.fertility.filter(f => f === 'barren').length;
            const total = indicator.statistics.validCount;

            return (
              <>
                {veryHigh > 0 && (
                  <div
                    style={{ width: `${(veryHigh/total)*100}%`, background: '#15803d', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '10px' }}
                    title={`Very High: ${veryHigh} samples`}
                  >
                    {(veryHigh/total)*100 > 10 && `${((veryHigh/total)*100).toFixed(0)}%`}
                  </div>
                )}
                {high > 0 && (
                  <div
                    style={{ width: `${(high/total)*100}%`, background: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '10px' }}
                    title={`High: ${high} samples`}
                  >
                    {(high/total)*100 > 10 && `${((high/total)*100).toFixed(0)}%`}
                  </div>
                )}
                {mod > 0 && (
                  <div
                    style={{ width: `${(mod/total)*100}%`, background: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '10px' }}
                    title={`Moderate: ${mod} samples`}
                  >
                    {(mod/total)*100 > 10 && `${((mod/total)*100).toFixed(0)}%`}
                  </div>
                )}
                {low > 0 && (
                  <div
                    style={{ width: `${(low/total)*100}%`, background: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '10px' }}
                    title={`Low: ${low} samples`}
                  >
                    {(low/total)*100 > 10 && `${((low/total)*100).toFixed(0)}%`}
                  </div>
                )}
                {barren > 0 && (
                  <div
                    style={{ width: `${(barren/total)*100}%`, background: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '10px' }}
                    title={`Barren: ${barren} samples`}
                  >
                    {(barren/total)*100 > 10 && `${((barren/total)*100).toFixed(0)}%`}
                  </div>
                )}
              </>
            );
          })()}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '10px', color: '#6b7280' }}>
          <div style={{ display: 'flex', gap: '12px' }}>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, background: '#15803d', borderRadius: 2, marginRight: 4 }}></span>Very High</span>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, background: '#22c55e', borderRadius: 2, marginRight: 4 }}></span>High</span>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, background: '#f59e0b', borderRadius: 2, marginRight: 4 }}></span>Moderate</span>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, background: '#94a3b8', borderRadius: 2, marginRight: 4 }}></span>Low</span>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, background: '#ef4444', borderRadius: 2, marginRight: 4 }}></span>Barren</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// TAB BUTTON COMPONENT
// ============================================================================

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

const TabButton: React.FC<TabButtonProps> = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    style={{
      padding: '10px 20px',
      border: 'none',
      borderBottom: active ? '3px solid #3b82f6' : '3px solid transparent',
      background: active ? '#eff6ff' : 'transparent',
      color: active ? '#1d4ed8' : '#6b7280',
      fontWeight: active ? 600 : 400,
      cursor: 'pointer',
      fontSize: '14px',
      transition: 'all 0.2s'
    }}
  >
    {children}
  </button>
);

// ============================================================================
// DEPOSIT CARD COMPONENT
// ============================================================================

interface DepositCardProps {
  type: DepositType;
  selected: boolean;
  onClick: () => void;
}

const DepositCard: React.FC<DepositCardProps> = ({ type, selected, onClick }) => {
  const config = DEPOSIT_CONFIGS.find(c => c.type === type);
  if (!config) return null;

  return (
    <button
      onClick={onClick}
      style={{
        padding: '12px 16px',
        borderRadius: '8px',
        border: selected ? '2px solid #3b82f6' : '1px solid #d1d5db',
        background: selected ? '#eff6ff' : 'white',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 0.2s',
        width: '100%'
      }}
    >
      <div style={{ fontWeight: 600, fontSize: '13px', color: selected ? '#1d4ed8' : '#111827' }}>
        {config.name}
      </div>
      <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px', lineHeight: 1.4 }}>
        {config.description}
      </div>
      <div style={{ fontSize: '10px', color: '#9ca3af', marginTop: '6px' }}>
        Pathfinders: {config.pathfinderSuite.slice(0, 5).join(', ')}{config.pathfinderSuite.length > 5 ? '...' : ''}
      </div>
    </button>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const VectoringManager: React.FC = () => {
  const { data, columns } = useAppStore();
  const {
    selectedDepositType,
    currentResult,
    comparisonResults,
    isProcessing,
    error,
    activeTab,
    setSelectedDepositType,
    setActiveTab,
    runVectoring,
    runMultipleDepositTypes,
  } = useVectoringStore();

  const [selectedForComparison, setSelectedForComparison] = useState<DepositType[]>([]);
  const [expandedCategory, setExpandedCategory] = useState<string | null>('Gold Systems');

  // Get column names
  const columnNames = useMemo(() => columns.map(c => c.name), [columns]);

  // Handle running analysis
  const handleRunAnalysis = async () => {
    if (!selectedDepositType) return;
    await runVectoring(data, columnNames);
  };

  // Handle comparison analysis
  const handleRunComparison = async () => {
    if (selectedForComparison.length < 2) return;
    await runMultipleDepositTypes(data, columnNames, selectedForComparison);
  };

  // Toggle deposit for comparison
  const toggleComparisonDeposit = (type: DepositType) => {
    setSelectedForComparison(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  // Get thresholds for an indicator
  const getIndicatorThresholds = (indicatorId: string): { value: number; color: string; label: string }[] => {
    const indicator = VECTORING_INDICATORS.find(i => i.id === indicatorId);
    if (!indicator) return [];

    return indicator.thresholds
      .filter(t => t.operator !== 'between') // Skip 'between' for simple threshold lines
      .map(t => ({
        value: t.value,
        color: t.color,
        label: t.interpretation.split(' ')[0] // First word of interpretation
      }));
  };

  return (
    <div style={{ padding: '16px', height: '100%', overflow: 'auto' }}>
      <div style={{ marginBottom: '16px' }}>
        <h2 style={{ margin: '0 0 4px 0', fontSize: '20px', fontWeight: 600 }}>
          Deposit-Specific Vectoring Analysis
        </h2>
        <p style={{ margin: 0, fontSize: '13px', color: '#6b7280' }}>
          Analyze your geochemical data against deposit-specific fertility and proximity indicators
        </p>
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid #e5e7eb', marginBottom: '20px', display: 'flex' }}>
        <TabButton active={activeTab === 'analysis'} onClick={() => setActiveTab('analysis')}>
          Select Deposit Type
        </TabButton>
        <TabButton active={activeTab === 'results'} onClick={() => setActiveTab('results')}>
          Results & Visualization
        </TabButton>
        <TabButton active={activeTab === 'compare'} onClick={() => setActiveTab('compare')}>
          Compare Multiple Types
        </TabButton>
      </div>

      {/* Error display */}
      {error && (
        <div style={{
          padding: '12px 16px',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '8px',
          color: '#dc2626',
          marginBottom: '16px',
          fontSize: '13px'
        }}>
          {error}
        </div>
      )}

      {/* Analysis Tab - Deposit Selection */}
      {activeTab === 'analysis' && (
        <div>
          {/* Deposit categories */}
          {Object.entries(DEPOSIT_CATEGORIES).map(([category, types]) => (
            <div key={category} style={{ marginBottom: '16px' }}>
              <button
                onClick={() => setExpandedCategory(expandedCategory === category ? null : category)}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  background: '#f9fafb',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  textAlign: 'left'
                }}
              >
                <span style={{ fontWeight: 600, fontSize: '14px' }}>{category}</span>
                <span style={{ fontSize: '12px', color: '#6b7280' }}>
                  {types.filter(t => DEPOSIT_CONFIGS.some(c => c.type === t)).length} deposit types
                  <span style={{ marginLeft: '8px' }}>{expandedCategory === category ? '▼' : '▶'}</span>
                </span>
              </button>

              {expandedCategory === category && (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: '8px',
                  marginTop: '8px',
                  padding: '8px'
                }}>
                  {types.map(type => {
                    const config = DEPOSIT_CONFIGS.find(c => c.type === type);
                    if (!config) return null;
                    return (
                      <DepositCard
                        key={type}
                        type={type}
                        selected={selectedDepositType === type}
                        onClick={() => setSelectedDepositType(type)}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          ))}

          {/* Selected deposit details */}
          {selectedDepositType && (() => {
            const config = getDepositConfig(selectedDepositType);
            if (!config) return null;

            return (
              <div style={{
                padding: '20px',
                background: '#f0f9ff',
                border: '2px solid #3b82f6',
                borderRadius: '8px',
                marginTop: '20px'
              }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', color: '#1d4ed8' }}>
                  Selected: {config.name}
                </h3>
                <p style={{ fontSize: '13px', color: '#374151', margin: '0 0 16px 0' }}>
                  {config.description}
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '16px' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                      INDICATORS
                    </div>
                    <div style={{ fontSize: '13px' }}>
                      {config.indicators.map(id => {
                        const ind = VECTORING_INDICATORS.find(i => i.id === id);
                        return ind?.name;
                      }).filter(Boolean).join(', ')}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                      PATHFINDER SUITE
                    </div>
                    <div style={{ fontSize: '13px' }}>
                      {config.pathfinderSuite.join(', ')}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                      KEY RATIOS
                    </div>
                    <div style={{ fontSize: '13px' }}>
                      {config.keyRatios.length > 0 ? config.keyRatios.join(', ') : 'N/A'}
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleRunAnalysis}
                  disabled={isProcessing || data.length === 0}
                  style={{
                    width: '100%',
                    padding: '14px',
                    borderRadius: '8px',
                    border: 'none',
                    background: isProcessing ? '#9ca3af' : '#2563eb',
                    color: 'white',
                    fontWeight: 600,
                    cursor: isProcessing ? 'not-allowed' : 'pointer',
                    fontSize: '14px'
                  }}
                >
                  {isProcessing ? 'Analyzing...' : `Analyze for ${config.name}`}
                </button>

                {data.length === 0 && (
                  <p style={{ fontSize: '12px', color: '#dc2626', marginTop: '8px', textAlign: 'center' }}>
                    Please load data first before running analysis
                  </p>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Results Tab with Histograms */}
      {activeTab === 'results' && (
        <div>
          {!currentResult ? (
            <div style={{
              padding: '60px',
              textAlign: 'center',
              color: '#6b7280',
              background: '#f9fafb',
              borderRadius: '8px'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>📊</div>
              <p style={{ fontSize: '15px', margin: 0 }}>
                No results yet. Select a deposit type and run analysis.
              </p>
            </div>
          ) : (
            <>
              {/* Summary header */}
              <div style={{
                padding: '20px',
                background: currentResult.summary.overallAssessment.includes('High')
                  ? 'linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%)'
                  : currentResult.summary.overallAssessment.includes('Moderate')
                    ? 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)'
                    : 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)',
                borderRadius: '12px',
                marginBottom: '24px',
                border: `2px solid ${
                  currentResult.summary.overallAssessment.includes('High') ? '#22c55e'
                    : currentResult.summary.overallAssessment.includes('Moderate') ? '#f59e0b' : '#d1d5db'
                }`
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h3 style={{ margin: '0 0 4px 0', fontSize: '18px' }}>
                      {getDepositConfig(currentResult.depositType)?.name}
                    </h3>
                    <div style={{
                      fontSize: '16px',
                      fontWeight: 700,
                      color: currentResult.summary.overallAssessment.includes('High') ? '#15803d'
                        : currentResult.summary.overallAssessment.includes('Moderate') ? '#d97706' : '#374151'
                    }}>
                      {currentResult.summary.overallAssessment}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: '13px', color: '#6b7280' }}>
                    <div>{currentResult.sampleCount.toLocaleString()} samples analyzed</div>
                    <div>{currentResult.indicators.length} indicators calculated</div>
                  </div>
                </div>

                {/* Key findings */}
                {currentResult.summary.keyFindings.length > 0 && currentResult.summary.keyFindings[0] !== 'No significant anomalies detected' && (
                  <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid rgba(0,0,0,0.1)' }}>
                    <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '8px' }}>Key Findings:</div>
                    <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px' }}>
                      {currentResult.summary.keyFindings.map((f, i) => (
                        <li key={i} style={{ marginBottom: '4px' }}>{f}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Indicator Histograms */}
              <h4 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 600 }}>
                Indicator Analysis
              </h4>

              {currentResult.indicators.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280', background: '#f9fafb', borderRadius: '8px' }}>
                  No indicators could be calculated. Check that required elements are present in your data.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: '16px' }}>
                  {currentResult.indicators.map(indicator => (
                    <IndicatorHistogram
                      key={indicator.indicatorId}
                      indicator={indicator}
                      thresholds={getIndicatorThresholds(indicator.indicatorId)}
                    />
                  ))}
                </div>
              )}

              {/* Recommendations */}
              {currentResult.summary.recommendations.length > 0 && (
                <div style={{
                  marginTop: '24px',
                  padding: '16px',
                  background: '#f0f9ff',
                  borderRadius: '8px',
                  border: '1px solid #bae6fd'
                }}>
                  <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#0369a1' }}>Recommendations</h4>
                  <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: '#0c4a6e' }}>
                    {currentResult.summary.recommendations.map((rec, i) => (
                      <li key={i} style={{ marginBottom: '4px' }}>{rec}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Compare Tab */}
      {activeTab === 'compare' && (
        <div>
          <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '16px' }}>
            Select 2-6 deposit types to compare. This will run all indicators and show which deposit type best matches your data.
          </p>

          {/* Quick select buttons */}
          <div style={{ marginBottom: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {Object.entries(DEPOSIT_CATEGORIES).map(([category, types]) => (
              <button
                key={category}
                onClick={() => {
                  const validTypes = types.filter(t => DEPOSIT_CONFIGS.some(c => c.type === t));
                  setSelectedForComparison(prev => {
                    const allSelected = validTypes.every(t => prev.includes(t));
                    if (allSelected) {
                      return prev.filter(t => !validTypes.includes(t));
                    }
                    return [...new Set([...prev, ...validTypes])];
                  });
                }}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  borderRadius: '16px',
                  border: '1px solid #d1d5db',
                  background: 'white',
                  cursor: 'pointer'
                }}
              >
                {category}
              </button>
            ))}
          </div>

          {/* Deposit grid for selection */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '8px',
            marginBottom: '16px'
          }}>
            {DEPOSIT_CONFIGS.map(config => (
              <label
                key={config.type}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: selectedForComparison.includes(config.type)
                    ? '2px solid #3b82f6'
                    : '1px solid #d1d5db',
                  background: selectedForComparison.includes(config.type) ? '#eff6ff' : 'white',
                  cursor: 'pointer',
                  fontSize: '13px'
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedForComparison.includes(config.type)}
                  onChange={() => toggleComparisonDeposit(config.type)}
                  style={{ marginRight: '10px' }}
                />
                {config.name}
              </label>
            ))}
          </div>

          <button
            onClick={handleRunComparison}
            disabled={selectedForComparison.length < 2 || isProcessing || data.length === 0}
            style={{
              width: '100%',
              padding: '14px',
              borderRadius: '8px',
              border: 'none',
              background: (selectedForComparison.length < 2 || isProcessing) ? '#9ca3af' : '#2563eb',
              color: 'white',
              fontWeight: 600,
              cursor: (selectedForComparison.length < 2 || isProcessing) ? 'not-allowed' : 'pointer',
              marginBottom: '20px',
              fontSize: '14px'
            }}
          >
            {isProcessing ? 'Comparing...' : `Compare ${selectedForComparison.length} Deposit Types`}
          </button>

          {/* Comparison results */}
          {comparisonResults.length > 0 && (
            <div>
              <h4 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 600 }}>Comparison Results</h4>

              {/* Ranking table */}
              <div style={{ overflowX: 'auto', marginBottom: '24px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ background: '#f9fafb' }}>
                      <th style={{ padding: '12px', textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>Rank</th>
                      <th style={{ padding: '12px', textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>Deposit Type</th>
                      <th style={{ padding: '12px', textAlign: 'center', borderBottom: '2px solid #e5e7eb' }}>Positive Indicators</th>
                      <th style={{ padding: '12px', textAlign: 'center', borderBottom: '2px solid #e5e7eb' }}>Match Score</th>
                      <th style={{ padding: '12px', textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>Assessment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonResults
                      .map(result => {
                        const positiveIndicators = result.indicators.filter(ind =>
                          ind.fertility.filter(f => f === 'high' || f === 'very-high').length > ind.statistics.validCount * 0.1
                        ).length;
                        const score = result.indicators.length > 0
                          ? (positiveIndicators / result.indicators.length) * 100
                          : 0;
                        return { ...result, positiveIndicators, score };
                      })
                      .sort((a, b) => b.score - a.score)
                      .map((result, index) => {
                        const config = getDepositConfig(result.depositType);
                        return (
                          <tr key={result.depositType} style={{ borderBottom: '1px solid #e5e7eb' }}>
                            <td style={{ padding: '12px', fontWeight: 600 }}>#{index + 1}</td>
                            <td style={{ padding: '12px' }}>{config?.name}</td>
                            <td style={{ padding: '12px', textAlign: 'center' }}>
                              {result.positiveIndicators} / {result.indicators.length}
                            </td>
                            <td style={{ padding: '12px', textAlign: 'center' }}>
                              <div style={{
                                display: 'inline-block',
                                padding: '4px 12px',
                                borderRadius: '16px',
                                background: result.score > 50 ? '#dcfce7' : result.score > 25 ? '#fef3c7' : '#f3f4f6',
                                color: result.score > 50 ? '#15803d' : result.score > 25 ? '#d97706' : '#6b7280',
                                fontWeight: 600
                              }}>
                                {result.score.toFixed(0)}%
                              </div>
                            </td>
                            <td style={{ padding: '12px', color: '#6b7280', fontSize: '12px' }}>
                              {result.summary.overallAssessment}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>

              {/* Radar chart */}
              <Plot
                data={comparisonResults.slice(0, 6).map((result, i) => {
                  const config = getDepositConfig(result.depositType);
                  const scores = result.indicators.map(ind => {
                    const high = ind.fertility.filter(f => f === 'high' || f === 'very-high').length;
                    return ind.statistics.validCount > 0 ? (high / ind.statistics.validCount) * 100 : 0;
                  });
                  const labels = result.indicators.map(ind => ind.name.length > 15 ? ind.name.slice(0, 15) + '...' : ind.name);

                  return {
                    type: 'scatterpolar',
                    r: [...scores, scores[0]], // Close the polygon
                    theta: [...labels, labels[0]],
                    fill: 'toself',
                    name: config?.name || result.depositType,
                    opacity: 0.6,
                    marker: { color: ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'][i] }
                  } as any;
                })}
                layout={{
                  title: { text: 'Indicator Comparison by Deposit Type', font: { size: 14 } },
                  polar: { radialaxis: { visible: true, range: [0, 100] } },
                  height: 450,
                  margin: { t: 60, b: 40, l: 80, r: 80 },
                  showlegend: true,
                  legend: { x: 1.1, y: 0.5 }
                }}
                config={{ responsive: true }}
                style={{ width: '100%' }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default VectoringManager;
