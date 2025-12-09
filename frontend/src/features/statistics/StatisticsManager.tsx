/**
 * Statistics Manager - Main UI Component for Stage 5 Features
 * Robust Statistics, Anomaly Detection, Clustering, and Classification
 */

import React, { useState, useMemo } from 'react';
import Plot from 'react-plotly.js';
import { useStatisticsStore } from '../../store/statisticsStore';
import { useAppStore } from '../../store/appStore';
import {
    RobustRegressionConfig,
    AnomalyDetectionConfig,
    PopulationSeparationConfig,
    EnhancedClusteringConfig,
    ClassificationConfig,
    RegressionMethod,
    AnomalyMethod,
    ClusteringMethod,
} from '../../types/statistics';

// =============================================================================
// TAB COMPONENTS
// =============================================================================

const RegressionTab: React.FC = () => {
    const { columns, data } = useAppStore();
    const {
        regressionResult,
        setRegressionConfig,
        runRegression,
        clearRegressionResult,
        isProcessing,
    } = useStatisticsStore();

    const numericColumns = useMemo(() =>
        columns.filter(c => c.type === 'numeric').map(c => c.name),
        [columns]
    );

    const [config, setConfig] = useState<Partial<RobustRegressionConfig>>({
        method: 'lts',
        xColumn: '',
        yColumn: '',
        confidenceLevel: 0.95,
        trimFraction: 0.75,
    });

    const handleRun = () => {
        if (config.xColumn && config.yColumn) {
            setRegressionConfig(config as RobustRegressionConfig);
            setTimeout(() => runRegression(), 0);
        }
    };

    const result = regressionResult && !('groups' in regressionResult) ? regressionResult : null;

    return (
        <div style={{ padding: '16px' }}>
            <h3 style={{ marginBottom: '16px' }}>Robust Regression Analysis</h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div>
                    <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>Method</label>
                    <select
                        value={config.method}
                        onChange={e => setConfig({ ...config, method: e.target.value as RegressionMethod })}
                        style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #d1d5db' }}
                    >
                        <option value="ols">OLS (Ordinary Least Squares)</option>
                        <option value="lts">LTS (Least Trimmed Squares)</option>
                        <option value="bisquare">Bisquare (Tukey's Biweight)</option>
                        <option value="huber">Huber M-estimator</option>
                    </select>
                </div>

                <div>
                    <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>Confidence Level</label>
                    <select
                        value={config.confidenceLevel}
                        onChange={e => setConfig({ ...config, confidenceLevel: parseFloat(e.target.value) })}
                        style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #d1d5db' }}
                    >
                        <option value={0.90}>90%</option>
                        <option value={0.95}>95%</option>
                        <option value={0.99}>99%</option>
                    </select>
                </div>

                <div>
                    <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>X Column (Independent)</label>
                    <select
                        value={config.xColumn}
                        onChange={e => setConfig({ ...config, xColumn: e.target.value })}
                        style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #d1d5db' }}
                    >
                        <option value="">Select column...</option>
                        {numericColumns.map(col => (
                            <option key={col} value={col}>{col}</option>
                        ))}
                    </select>
                </div>

                <div>
                    <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>Y Column (Dependent)</label>
                    <select
                        value={config.yColumn}
                        onChange={e => setConfig({ ...config, yColumn: e.target.value })}
                        style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #d1d5db' }}
                    >
                        <option value="">Select column...</option>
                        {numericColumns.map(col => (
                            <option key={col} value={col}>{col}</option>
                        ))}
                    </select>
                </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
                <button
                    onClick={handleRun}
                    disabled={!config.xColumn || !config.yColumn || isProcessing}
                    style={{
                        padding: '10px 24px',
                        backgroundColor: '#3b82f6',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: isProcessing ? 'wait' : 'pointer',
                        marginRight: '8px',
                    }}
                >
                    {isProcessing ? 'Running...' : 'Run Regression'}
                </button>
                {result && (
                    <button
                        onClick={clearRegressionResult}
                        style={{
                            padding: '10px 24px',
                            backgroundColor: '#6b7280',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                        }}
                    >
                        Clear
                    </button>
                )}
            </div>

            {result && (
                <div>
                    {/* Results summary */}
                    <div style={{
                        background: '#f9fafb',
                        padding: '16px',
                        borderRadius: '8px',
                        marginBottom: '16px',
                    }}>
                        <h4 style={{ marginBottom: '12px' }}>Results ({result.method.toUpperCase()})</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
                            <div>
                                <div style={{ fontSize: '12px', color: '#6b7280' }}>Slope</div>
                                <div style={{ fontSize: '18px', fontWeight: 600 }}>{result.slope.toFixed(4)}</div>
                            </div>
                            <div>
                                <div style={{ fontSize: '12px', color: '#6b7280' }}>Intercept</div>
                                <div style={{ fontSize: '18px', fontWeight: 600 }}>{result.intercept.toFixed(4)}</div>
                            </div>
                            <div>
                                <div style={{ fontSize: '12px', color: '#6b7280' }}>R²</div>
                                <div style={{ fontSize: '18px', fontWeight: 600 }}>{result.rSquared.toFixed(4)}</div>
                            </div>
                            <div>
                                <div style={{ fontSize: '12px', color: '#6b7280' }}>Outliers</div>
                                <div style={{ fontSize: '18px', fontWeight: 600 }}>{result.outlierIndices.length}</div>
                            </div>
                        </div>
                    </div>

                    {/* Scatter plot with regression line */}
                    <Plot
                        data={[
                            // Data points
                            {
                                x: data.map(d => d[config.xColumn!]).filter((_, i) => !result.outlierIndices.includes(i)),
                                y: data.map(d => d[config.yColumn!]).filter((_, i) => !result.outlierIndices.includes(i)),
                                mode: 'markers',
                                type: 'scatter',
                                name: 'Data',
                                marker: { color: '#3b82f6', size: 6 },
                            },
                            // Outliers
                            {
                                x: result.outlierIndices.map(i => data[i]?.[config.xColumn!]),
                                y: result.outlierIndices.map(i => data[i]?.[config.yColumn!]),
                                mode: 'markers',
                                type: 'scatter',
                                name: 'Outliers',
                                marker: { color: '#ef4444', size: 8, symbol: 'x' },
                            },
                            // Regression line
                            {
                                x: [Math.min(...data.map(d => parseFloat(d[config.xColumn!]) || 0)),
                                    Math.max(...data.map(d => parseFloat(d[config.xColumn!]) || 0))],
                                y: [result.intercept + result.slope * Math.min(...data.map(d => parseFloat(d[config.xColumn!]) || 0)),
                                    result.intercept + result.slope * Math.max(...data.map(d => parseFloat(d[config.xColumn!]) || 0))],
                                mode: 'lines',
                                type: 'scatter',
                                name: 'Fit',
                                line: { color: '#10b981', width: 2 },
                            },
                        ] as any}
                        layout={{
                            title: { text: `${config.yColumn} vs ${config.xColumn}` } as any,
                            xaxis: { title: { text: config.xColumn } as any },
                            yaxis: { title: { text: config.yColumn } as any },
                            height: 400,
                            margin: { t: 40, b: 50, l: 60, r: 20 },
                            showlegend: true,
                        }}
                        config={{ responsive: true }}
                        style={{ width: '100%' }}
                    />
                </div>
            )}
        </div>
    );
};

const AnomalyTab: React.FC = () => {
    const { columns } = useAppStore();
    const {
        anomalyConfigs,
        anomalyResults,
        addAnomalyConfig,
        removeAnomalyConfig,
        runAnomalyDetection,
        clearAnomalyResults,
        isProcessing,
    } = useStatisticsStore();

    const numericColumns = useMemo(() =>
        columns.filter(c => c.type === 'numeric').map(c => c.name),
        [columns]
    );

    const [newConfig, setNewConfig] = useState<Partial<AnomalyDetectionConfig>>({
        method: 'mad',
        column: '',
        sigmaMultiplier: 3,
        iqrMultiplier: 1.5,
        bidirectional: false,
    });

    const handleAdd = () => {
        if (newConfig.column) {
            addAnomalyConfig(newConfig as AnomalyDetectionConfig);
            setNewConfig({ ...newConfig, column: '' });
        }
    };

    return (
        <div style={{ padding: '16px' }}>
            <h3 style={{ marginBottom: '16px' }}>Anomaly Detection</h3>

            {/* Configuration */}
            <div style={{
                background: '#f9fafb',
                padding: '16px',
                borderRadius: '8px',
                marginBottom: '16px',
            }}>
                <h4 style={{ marginBottom: '12px' }}>Add Detection Rule</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '12px' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Method</label>
                        <select
                            value={newConfig.method}
                            onChange={e => setNewConfig({ ...newConfig, method: e.target.value as AnomalyMethod })}
                            style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #d1d5db' }}
                        >
                            <option value="mad">MAD (Robust)</option>
                            <option value="sigma">Mean ± nσ</option>
                            <option value="iqr">IQR (Box Plot)</option>
                            <option value="percentile">Percentile</option>
                        </select>
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Column</label>
                        <select
                            value={newConfig.column}
                            onChange={e => setNewConfig({ ...newConfig, column: e.target.value })}
                            style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #d1d5db' }}
                        >
                            <option value="">Select...</option>
                            {numericColumns.map(col => (
                                <option key={col} value={col}>{col}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Threshold</label>
                        <input
                            type="number"
                            value={newConfig.sigmaMultiplier}
                            onChange={e => setNewConfig({ ...newConfig, sigmaMultiplier: parseFloat(e.target.value) })}
                            style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #d1d5db' }}
                        />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'end' }}>
                        <button
                            onClick={handleAdd}
                            disabled={!newConfig.column}
                            style={{
                                padding: '6px 16px',
                                backgroundColor: '#10b981',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                            }}
                        >
                            Add
                        </button>
                    </div>
                </div>

                {/* Current configs */}
                {anomalyConfigs.length > 0 && (
                    <div style={{ marginTop: '12px' }}>
                        <div style={{ fontSize: '12px', fontWeight: 500, marginBottom: '8px' }}>Active Rules:</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                            {anomalyConfigs.map((cfg, i) => (
                                <div
                                    key={i}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        padding: '4px 12px',
                                        background: '#e5e7eb',
                                        borderRadius: '16px',
                                        fontSize: '12px',
                                    }}
                                >
                                    <span>{cfg.column} ({cfg.method})</span>
                                    <button
                                        onClick={() => removeAnomalyConfig(i)}
                                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}
                                    >
                                        ×
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div style={{ marginBottom: '16px' }}>
                <button
                    onClick={runAnomalyDetection}
                    disabled={anomalyConfigs.length === 0 || isProcessing}
                    style={{
                        padding: '10px 24px',
                        backgroundColor: '#3b82f6',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: isProcessing ? 'wait' : 'pointer',
                        marginRight: '8px',
                    }}
                >
                    {isProcessing ? 'Detecting...' : 'Detect Anomalies'}
                </button>
                {anomalyResults.length > 0 && (
                    <button
                        onClick={clearAnomalyResults}
                        style={{
                            padding: '10px 24px',
                            backgroundColor: '#6b7280',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                        }}
                    >
                        Clear
                    </button>
                )}
            </div>

            {/* Results */}
            {anomalyResults.length > 0 && (
                <div>
                    {anomalyResults.map((result, i) => (
                        <div
                            key={i}
                            style={{
                                background: 'white',
                                border: '1px solid #e5e7eb',
                                borderRadius: '8px',
                                padding: '16px',
                                marginBottom: '16px',
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                                <h4>{result.column}</h4>
                                <div style={{
                                    padding: '4px 12px',
                                    background: result.statistics.nAnomalies > 0 ? '#fef3c7' : '#d1fae5',
                                    borderRadius: '16px',
                                    fontSize: '12px',
                                }}>
                                    {result.statistics.nAnomalies} anomalies ({(result.statistics.anomalyRate * 100).toFixed(1)}%)
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px', fontSize: '12px' }}>
                                <div>
                                    <div style={{ color: '#6b7280' }}>Method</div>
                                    <div style={{ fontWeight: 500 }}>{result.method}</div>
                                </div>
                                <div>
                                    <div style={{ color: '#6b7280' }}>Mean</div>
                                    <div style={{ fontWeight: 500 }}>{result.statistics.mean?.toFixed(2)}</div>
                                </div>
                                <div>
                                    <div style={{ color: '#6b7280' }}>Median</div>
                                    <div style={{ fontWeight: 500 }}>{result.statistics.median?.toFixed(2)}</div>
                                </div>
                                <div>
                                    <div style={{ color: '#6b7280' }}>Lower Threshold</div>
                                    <div style={{ fontWeight: 500 }}>{result.thresholds.lower?.toFixed(2) || 'N/A'}</div>
                                </div>
                                <div>
                                    <div style={{ color: '#6b7280' }}>Upper Threshold</div>
                                    <div style={{ fontWeight: 500 }}>{result.thresholds.upper?.toFixed(2) || 'N/A'}</div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const ClusteringTab: React.FC = () => {
    const { columns } = useAppStore();
    const {
        clusteringResult,
        setClusteringConfig,
        runClustering,
        isProcessing,
    } = useStatisticsStore();

    const numericColumns = useMemo(() =>
        columns.filter(c => c.type === 'numeric').map(c => c.name),
        [columns]
    );

    const [config, setConfig] = useState<Partial<EnhancedClusteringConfig>>({
        method: 'kmeans',
        columns: [],
        k: 3,
        transformationType: 'zscore',
        linkage: 'ward',
        calculateSilhouette: true,
    });

    const handleRun = () => {
        if (config.columns && config.columns.length >= 2) {
            setClusteringConfig(config as EnhancedClusteringConfig);
            setTimeout(() => runClustering(), 0);
        }
    };

    const toggleColumn = (col: string) => {
        const cols = config.columns || [];
        if (cols.includes(col)) {
            setConfig({ ...config, columns: cols.filter(c => c !== col) });
        } else {
            setConfig({ ...config, columns: [...cols, col] });
        }
    };

    return (
        <div style={{ padding: '16px' }}>
            <h3 style={{ marginBottom: '16px' }}>Clustering Analysis</h3>

            <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '24px' }}>
                {/* Configuration panel */}
                <div style={{
                    background: '#f9fafb',
                    padding: '16px',
                    borderRadius: '8px',
                }}>
                    <div style={{ marginBottom: '16px' }}>
                        <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>Method</label>
                        <select
                            value={config.method}
                            onChange={e => setConfig({ ...config, method: e.target.value as ClusteringMethod })}
                            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #d1d5db' }}
                        >
                            <option value="kmeans">K-Means</option>
                            <option value="hierarchical">Hierarchical</option>
                        </select>
                    </div>

                    <div style={{ marginBottom: '16px' }}>
                        <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>Number of Clusters (k)</label>
                        <input
                            type="number"
                            min={2}
                            max={20}
                            value={config.k}
                            onChange={e => setConfig({ ...config, k: parseInt(e.target.value) })}
                            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #d1d5db' }}
                        />
                    </div>

                    <div style={{ marginBottom: '16px' }}>
                        <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>Transformation</label>
                        <select
                            value={config.transformationType}
                            onChange={e => setConfig({ ...config, transformationType: e.target.value as any })}
                            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #d1d5db' }}
                        >
                            <option value="none">None</option>
                            <option value="zscore">Z-Score</option>
                            <option value="clr">CLR (Compositional)</option>
                        </select>
                    </div>

                    <div style={{ marginBottom: '16px' }}>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>
                            Select Columns ({(config.columns || []).length} selected)
                        </label>
                        <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '8px' }}>
                            {numericColumns.map(col => (
                                <label key={col} style={{ display: 'flex', alignItems: 'center', padding: '4px 0', cursor: 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={(config.columns || []).includes(col)}
                                        onChange={() => toggleColumn(col)}
                                        style={{ marginRight: '8px' }}
                                    />
                                    <span style={{ fontSize: '13px' }}>{col}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <button
                        onClick={handleRun}
                        disabled={(config.columns || []).length < 2 || isProcessing}
                        style={{
                            width: '100%',
                            padding: '10px 24px',
                            backgroundColor: '#3b82f6',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: isProcessing ? 'wait' : 'pointer',
                        }}
                    >
                        {isProcessing ? 'Running...' : 'Run Clustering'}
                    </button>
                </div>

                {/* Results */}
                <div>
                    {clusteringResult && (
                        <div>
                            {/* Summary */}
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(4, 1fr)',
                                gap: '16px',
                                marginBottom: '24px',
                            }}>
                                <div style={{ background: 'white', padding: '16px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                                    <div style={{ fontSize: '12px', color: '#6b7280' }}>Clusters</div>
                                    <div style={{ fontSize: '24px', fontWeight: 600 }}>{clusteringResult.k}</div>
                                </div>
                                <div style={{ background: 'white', padding: '16px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                                    <div style={{ fontSize: '12px', color: '#6b7280' }}>Avg Silhouette</div>
                                    <div style={{ fontSize: '24px', fontWeight: 600 }}>{clusteringResult.avgSilhouette?.toFixed(3) || 'N/A'}</div>
                                </div>
                                <div style={{ background: 'white', padding: '16px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                                    <div style={{ fontSize: '12px', color: '#6b7280' }}>BSS/TSS</div>
                                    <div style={{ fontSize: '24px', fontWeight: 600 }}>{((clusteringResult.bssOverTss || 0) * 100).toFixed(1)}%</div>
                                </div>
                                <div style={{ background: 'white', padding: '16px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                                    <div style={{ fontSize: '12px', color: '#6b7280' }}>Method</div>
                                    <div style={{ fontSize: '24px', fontWeight: 600 }}>{clusteringResult.method}</div>
                                </div>
                            </div>

                            {/* Cluster stats */}
                            <h4 style={{ marginBottom: '12px' }}>Cluster Statistics</h4>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                    <thead>
                                        <tr style={{ background: '#f9fafb' }}>
                                            <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Cluster</th>
                                            <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>Count</th>
                                            <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>%</th>
                                            {(config.columns || []).slice(0, 5).map(col => (
                                                <th key={col} style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>{col}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {clusteringResult.clusterStats.map(stat => (
                                            <tr key={stat.clusterId}>
                                                <td style={{ padding: '8px', borderBottom: '1px solid #e5e7eb' }}>
                                                    <span style={{
                                                        display: 'inline-block',
                                                        width: '12px',
                                                        height: '12px',
                                                        borderRadius: '50%',
                                                        backgroundColor: ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'][stat.clusterId % 6],
                                                        marginRight: '8px',
                                                    }}></span>
                                                    Cluster {stat.clusterId}
                                                </td>
                                                <td style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>{stat.count}</td>
                                                <td style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>{(stat.proportion * 100).toFixed(1)}%</td>
                                                {(config.columns || []).slice(0, 5).map(col => (
                                                    <td key={col} style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>
                                                        {stat.meanByColumn[col]?.toFixed(2) || 'N/A'}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const ClassificationTab: React.FC = () => {
    const { columns } = useAppStore();
    const {
        classificationResult,
        setClassificationConfig,
        runClassification,
        isProcessing,
    } = useStatisticsStore();

    const numericColumns = useMemo(() =>
        columns.filter(c => c.type === 'numeric').map(c => c.name),
        [columns]
    );

    const categoricalColumns = useMemo(() =>
        columns.filter(c => c.type === 'string' || c.type === 'category').map(c => c.name),
        [columns]
    );

    const [config, setConfig] = useState<Partial<ClassificationConfig>>({
        method: 'random-forest',
        targetColumn: '',
        featureColumns: [],
        useLogratios: false,
        nEstimators: 100,
        maxDepth: 10,
        trainTestSplit: 0.7,
    });

    const handleRun = () => {
        if (config.targetColumn && (config.featureColumns || []).length >= 2) {
            setClassificationConfig(config as ClassificationConfig);
            setTimeout(() => runClassification(), 0);
        }
    };

    const toggleColumn = (col: string) => {
        const cols = config.featureColumns || [];
        if (cols.includes(col)) {
            setConfig({ ...config, featureColumns: cols.filter(c => c !== col) });
        } else {
            setConfig({ ...config, featureColumns: [...cols, col] });
        }
    };

    return (
        <div style={{ padding: '16px' }}>
            <h3 style={{ marginBottom: '16px' }}>Classification</h3>

            <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '24px' }}>
                {/* Configuration */}
                <div style={{
                    background: '#f9fafb',
                    padding: '16px',
                    borderRadius: '8px',
                }}>
                    <div style={{ marginBottom: '16px' }}>
                        <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>Method</label>
                        <select
                            value={config.method}
                            onChange={e => setConfig({ ...config, method: e.target.value as any })}
                            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #d1d5db' }}
                        >
                            <option value="random-forest">Random Forest</option>
                            <option value="decision-tree">Decision Tree</option>
                            <option value="logistic-regression">Logistic Regression</option>
                        </select>
                    </div>

                    <div style={{ marginBottom: '16px' }}>
                        <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>Target Column</label>
                        <select
                            value={config.targetColumn}
                            onChange={e => setConfig({ ...config, targetColumn: e.target.value })}
                            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #d1d5db' }}
                        >
                            <option value="">Select...</option>
                            {categoricalColumns.map(col => (
                                <option key={col} value={col}>{col}</option>
                            ))}
                        </select>
                    </div>

                    <div style={{ marginBottom: '16px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={config.useLogratios}
                                onChange={e => setConfig({ ...config, useLogratios: e.target.checked })}
                                style={{ marginRight: '8px' }}
                            />
                            <span>Use Log-Ratios</span>
                        </label>
                    </div>

                    <div style={{ marginBottom: '16px' }}>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>
                            Feature Columns ({(config.featureColumns || []).length} selected)
                        </label>
                        <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '8px' }}>
                            {numericColumns.map(col => (
                                <label key={col} style={{ display: 'flex', alignItems: 'center', padding: '4px 0', cursor: 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={(config.featureColumns || []).includes(col)}
                                        onChange={() => toggleColumn(col)}
                                        style={{ marginRight: '8px' }}
                                    />
                                    <span style={{ fontSize: '13px' }}>{col}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <button
                        onClick={handleRun}
                        disabled={!config.targetColumn || (config.featureColumns || []).length < 2 || isProcessing}
                        style={{
                            width: '100%',
                            padding: '10px 24px',
                            backgroundColor: '#3b82f6',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: isProcessing ? 'wait' : 'pointer',
                        }}
                    >
                        {isProcessing ? 'Training...' : 'Train Model'}
                    </button>
                </div>

                {/* Results */}
                <div>
                    {classificationResult && classificationResult.testConfusionMatrix && (
                        <div>
                            {/* Accuracy summary */}
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(3, 1fr)',
                                gap: '16px',
                                marginBottom: '24px',
                            }}>
                                <div style={{ background: 'white', padding: '16px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                                    <div style={{ fontSize: '12px', color: '#6b7280' }}>Test Accuracy</div>
                                    <div style={{ fontSize: '24px', fontWeight: 600 }}>
                                        {(classificationResult.testConfusionMatrix.accuracy * 100).toFixed(1)}%
                                    </div>
                                </div>
                                <div style={{ background: 'white', padding: '16px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                                    <div style={{ fontSize: '12px', color: '#6b7280' }}>Train Accuracy</div>
                                    <div style={{ fontSize: '24px', fontWeight: 600 }}>
                                        {((classificationResult.trainConfusionMatrix?.accuracy || 0) * 100).toFixed(1)}%
                                    </div>
                                </div>
                                <div style={{ background: 'white', padding: '16px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                                    <div style={{ fontSize: '12px', color: '#6b7280' }}>OOB Accuracy</div>
                                    <div style={{ fontSize: '24px', fontWeight: 600 }}>
                                        {classificationResult.oobAccuracy ? (classificationResult.oobAccuracy * 100).toFixed(1) + '%' : 'N/A'}
                                    </div>
                                </div>
                            </div>

                            {/* Feature importance */}
                            {classificationResult.featureImportance && classificationResult.featureImportance.length > 0 && (
                                <div style={{ marginBottom: '24px' }}>
                                    <h4 style={{ marginBottom: '12px' }}>Feature Importance</h4>
                                    {classificationResult.featureImportance.slice(0, 10).map(fi => (
                                        <div key={fi.feature} style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                                            <div style={{ width: '150px', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {fi.feature}
                                            </div>
                                            <div style={{ flex: 1, marginLeft: '8px' }}>
                                                <div style={{
                                                    height: '16px',
                                                    width: `${fi.importance * 100}%`,
                                                    backgroundColor: '#3b82f6',
                                                    borderRadius: '4px',
                                                }}></div>
                                            </div>
                                            <div style={{ width: '50px', textAlign: 'right', fontSize: '12px' }}>
                                                {(fi.importance * 100).toFixed(1)}%
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Decision rules */}
                            {classificationResult.decisionRules && classificationResult.decisionRules.length > 0 && (
                                <div>
                                    <h4 style={{ marginBottom: '12px' }}>Decision Rules</h4>
                                    <div style={{
                                        background: '#1f2937',
                                        color: '#f9fafb',
                                        padding: '12px',
                                        borderRadius: '8px',
                                        fontFamily: 'monospace',
                                        fontSize: '12px',
                                        maxHeight: '200px',
                                        overflowY: 'auto',
                                    }}>
                                        {classificationResult.decisionRules.slice(0, 10).map((rule, i) => (
                                            <div key={i} style={{ marginBottom: '4px' }}>{rule}</div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const PopulationTab: React.FC = () => {
    const { columns } = useAppStore();
    const {
        populationResult,
        setPopulationConfig,
        runPopulationSeparation,
        isProcessing,
    } = useStatisticsStore();

    const numericColumns = useMemo(() =>
        columns.filter(c => c.type === 'numeric').map(c => c.name),
        [columns]
    );

    const [config, setConfig] = useState<Partial<PopulationSeparationConfig>>({
        column: '',
        maxPopulations: 4,
        method: 'gaussian-mixture',
        useLogScale: true,
    });

    const handleRun = () => {
        if (config.column) {
            setPopulationConfig(config as PopulationSeparationConfig);
            setTimeout(() => runPopulationSeparation(), 0);
        }
    };

    return (
        <div style={{ padding: '16px' }}>
            <h3 style={{ marginBottom: '16px' }}>Population Separation</h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div>
                    <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>Column</label>
                    <select
                        value={config.column}
                        onChange={e => setConfig({ ...config, column: e.target.value })}
                        style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #d1d5db' }}
                    >
                        <option value="">Select column...</option>
                        {numericColumns.map(col => (
                            <option key={col} value={col}>{col}</option>
                        ))}
                    </select>
                </div>

                <div>
                    <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>Method</label>
                    <select
                        value={config.method}
                        onChange={e => setConfig({ ...config, method: e.target.value as any })}
                        style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #d1d5db' }}
                    >
                        <option value="gaussian-mixture">Gaussian Mixture Model</option>
                        <option value="log-probability">Log-Probability Plot</option>
                        <option value="histogram-mode">Histogram Mode Detection</option>
                    </select>
                </div>

                <div>
                    <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>Max Populations</label>
                    <input
                        type="number"
                        min={2}
                        max={10}
                        value={config.maxPopulations}
                        onChange={e => setConfig({ ...config, maxPopulations: parseInt(e.target.value) })}
                        style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #d1d5db' }}
                    />
                </div>

                <div>
                    <label style={{ display: 'flex', alignItems: 'center', paddingTop: '28px', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={config.useLogScale}
                            onChange={e => setConfig({ ...config, useLogScale: e.target.checked })}
                            style={{ marginRight: '8px' }}
                        />
                        <span>Use Log Scale</span>
                    </label>
                </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
                <button
                    onClick={handleRun}
                    disabled={!config.column || isProcessing}
                    style={{
                        padding: '10px 24px',
                        backgroundColor: '#3b82f6',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: isProcessing ? 'wait' : 'pointer',
                        marginRight: '8px',
                    }}
                >
                    {isProcessing ? 'Analyzing...' : 'Separate Populations'}
                </button>
            </div>

            {populationResult && (
                <div>
                    <h4 style={{ marginBottom: '12px' }}>
                        {populationResult.nPopulations} Populations Detected
                    </h4>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                        {populationResult.populations.map(pop => (
                            <div
                                key={pop.id}
                                style={{
                                    background: 'white',
                                    border: '1px solid #e5e7eb',
                                    borderRadius: '8px',
                                    padding: '16px',
                                    borderLeft: `4px solid ${
                                        pop.classification === 'background' ? '#10b981' :
                                        pop.classification === 'threshold' ? '#f59e0b' :
                                        pop.classification === 'anomalous' ? '#ef4444' :
                                        '#8b5cf6'
                                    }`,
                                }}
                            >
                                <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
                                    {pop.classification.charAt(0).toUpperCase() + pop.classification.slice(1)}
                                </div>
                                <div style={{ fontSize: '12px', color: '#6b7280' }}>
                                    <div>Mean: {pop.mean.toFixed(2)}</div>
                                    <div>Std: {pop.stdDev.toFixed(2)}</div>
                                    <div>Count: {pop.count} ({(pop.proportion * 100).toFixed(1)}%)</div>
                                    <div>Range: {pop.lowerBound.toFixed(2)} - {pop.upperBound.toFixed(2)}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const StatisticsManager: React.FC = () => {
    const { activeTab, setActiveTab, error } = useStatisticsStore();

    const tabs = [
        { id: 'regression' as const, label: 'Regression' },
        { id: 'anomaly' as const, label: 'Anomaly Detection' },
        { id: 'population' as const, label: 'Population Separation' },
        { id: 'clustering' as const, label: 'Clustering' },
        { id: 'classification' as const, label: 'Classification' },
    ];

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* Tab bar */}
            <div style={{
                display: 'flex',
                borderBottom: '1px solid #e5e7eb',
                background: '#f9fafb',
            }}>
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        style={{
                            padding: '12px 24px',
                            border: 'none',
                            background: activeTab === tab.id ? 'white' : 'transparent',
                            borderBottom: activeTab === tab.id ? '2px solid #3b82f6' : '2px solid transparent',
                            fontWeight: activeTab === tab.id ? 600 : 400,
                            color: activeTab === tab.id ? '#3b82f6' : '#6b7280',
                            cursor: 'pointer',
                        }}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Error banner */}
            {error && (
                <div style={{
                    padding: '12px 16px',
                    background: '#fef2f2',
                    color: '#dc2626',
                    borderBottom: '1px solid #fecaca',
                }}>
                    {error}
                </div>
            )}

            {/* Tab content */}
            <div style={{ flex: 1, overflow: 'auto' }}>
                {activeTab === 'regression' && <RegressionTab />}
                {activeTab === 'anomaly' && <AnomalyTab />}
                {activeTab === 'population' && <PopulationTab />}
                {activeTab === 'clustering' && <ClusteringTab />}
                {activeTab === 'classification' && <ClassificationTab />}
            </div>
        </div>
    );
};

export default StatisticsManager;
