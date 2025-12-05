# GeoChem Pro - Feature Recommendations

## Research Summary

This document outlines recommended features based on analysis of:
- Current application capabilities
- ioGAS software features (industry leader)
- GCDkit capabilities (popular academic tool)
- Leapfrog Geochemistry integration features
- Industry best practices in exploration geochemistry
- Modern machine learning approaches

---

## PRIORITY 1: HIGH VALUE / MODERATE EFFORT

### 1.1 QA/QC Module (Quality Assurance/Quality Control)

**Why**: Essential for any professional geochemistry workflow. Required for NI 43-101 compliant reporting.

**Features to implement**:
- **Standard/CRM Analysis**
  - Control charts with ±2σ and ±3σ warning/failure limits
  - Bias detection and drift monitoring over time
  - Standard recovery percentage tracking
  - Expected vs actual value plots

- **Blank Analysis**
  - Contamination detection charts
  - Threshold-based failure flagging
  - High-grade sample proximity analysis

- **Duplicate Analysis**
  - Field duplicate precision (HARD - Half Absolute Relative Difference)
  - Pulp duplicate precision
  - Coarse reject duplicate analysis
  - Thompson-Howarth precision plots
  - Ranked half absolute difference plots

- **Batch Summary Reports**
  - Pass/fail statistics per batch
  - Laboratory performance tracking
  - Exportable QA/QC reports

**Reference**: [USGS QA/QC Guidelines](https://pubs.usgs.gov/of/2011/1187/pdf/ofr2011-1187.pdf)

---

### 1.2 Classification Diagrams with Pre-drawn Fields

**Why**: Standard tool for rock classification. Currently only have TAS in calculations - need visual diagrams.

**Diagrams to implement**:

**Igneous Classification**:
- TAS (Total Alkali-Silica) - Le Maitre et al. 2002
- AFM ternary (tholeiitic vs calc-alkaline)
- K2O vs SiO2 (Peccerillo & Taylor 1976)
- SiO2 vs FeOt/MgO (Miyashiro 1974)
- A/CNK vs A/NK (Shand's alumina saturation)

**Tectonic Discrimination**:
- Nb-Y (Pearce et al. 1984) - granites
- Rb vs Y+Nb (Pearce et al. 1984)
- Ta-Yb (Pearce et al. 1984)
- Ti-Zr-Y ternary (Pearce & Cann 1973) - basalts
- Hf-Th-Ta ternary (Wood 1980)
- V-Ti (Shervais 1982)
- Th/Yb vs Nb/Yb (Pearce 2008)

**Sedimentary**:
- CIA vs ICV (weathering/provenance)
- Th/Sc vs Zr/Sc (provenance)
- La/Th vs Hf (provenance)

**Implementation**: Add polygon overlay capability to scatter/ternary plots with named regions.

**Reference**: [GCDkit Classification Diagrams](https://www.gcdkit.org/)

---

### 1.3 Advanced Multivariate Analysis

**Why**: ioGAS's core differentiator. Essential for pattern recognition in multi-element data.

**Features to implement**:

**Principal Component Analysis (PCA)**:
- Full PCA (not just CLR-biplot)
- Scree plot (eigenvalue visualization)
- Loading plots (variable contributions)
- Score plots (sample projections)
- Biplot with variable vectors
- Explained variance percentages
- Component selection tools

**Cluster Analysis**:
- K-means clustering
- Hierarchical clustering (dendrogram)
- DBSCAN (density-based)
- Silhouette analysis for optimal k
- Cluster assignment as new column

**Discriminant Analysis**:
- Linear Discriminant Analysis (LDA)
- Quadratic Discriminant Analysis
- Mahalanobis distance calculation
- Leave-one-out cross-validation

**Self-Organizing Maps (SOM)**:
- Kohonen self-organizing maps
- U-matrix visualization
- Component plane visualization

**Reference**: [ioGAS Multivariate Tools](https://www.imdex.com/software/iogas)

---

### 1.4 Harker Variation Diagrams

**Why**: Fundamental tool for igneous petrology. Quick multi-element view.

**Features**:
- Auto-generate matrix of scatter plots
- SiO2 (or user choice) on all X-axes
- Multiple elements on Y-axes
- Shared styling across all plots
- Single legend for entire matrix
- Grid layout customization
- Export as publication-quality figure

---

### 1.5 Data Gridding & Contouring

**Why**: Critical for spatial geochemistry. ioGAS grid export is a key feature.

**Features to implement**:
- **Interpolation Methods**:
  - Inverse Distance Weighting (IDW)
  - Kriging (ordinary kriging)
  - Natural neighbor
  - Minimum curvature

- **Grid Controls**:
  - Cell size configuration
  - Search radius
  - Anisotropy settings
  - Null/no-data handling

- **Contour Display**:
  - Filled contour maps
  - Contour line overlay on attribute maps
  - Contour interval control
  - Color ramp selection

- **Export**:
  - GeoTIFF export
  - Surfer grid format
  - CSV grid export

**Reference**: [QGIS Gridding](https://qgis-in-mineral-exploration.readthedocs.io/en/latest/source/geochemical_data/gridding_surface_data.html)

---

## PRIORITY 2: HIGH VALUE / HIGHER EFFORT

### 2.1 Polygon/Lasso Selection Tool

**Why**: Essential for interactive data classification. Core ioGAS feature.

**Features**:
- Draw polygon on any plot to select points
- Lasso selection mode
- Rectangle selection mode
- Add to / subtract from selection
- Create new classification from selection
- Multi-plot synchronized selection
- Selection as filter (show/hide)

---

### 2.2 Anomaly Detection

**Why**: Core exploration geochemistry need. Differentiator feature.

**Features to implement**:

**Statistical Methods**:
- Threshold-based (mean + nσ)
- Median Absolute Deviation (MAD)
- Box plot fences (IQR-based)
- Percentile-based cutoffs

**Machine Learning Methods**:
- Isolation Forest
- Local Outlier Factor (LOF)
- One-class SVM
- Robust PCA anomalies

**Spatial Methods**:
- Local Moran's I
- Getis-Ord Gi* (hot spot analysis)
- Spatial clustering of anomalies

**Output**:
- Anomaly probability scores
- Binary anomaly classification
- Highlight anomalies on all plots
- Anomaly map generation

**Reference**: [ML Anomaly Detection in Geochemistry](https://www.sciencedirect.com/science/article/abs/pii/S0883292720301700)

---

### 2.3 CIPW Norm Calculation

**Why**: Fundamental igneous petrology calculation. GCDkit has this.

**Features**:
- Full CIPW normative mineralogy
- Handles Fe2O3/FeO ratio estimation
- Display as stacked bar chart
- Mineral abundance table
- Catanorm alternative
- Niggli values calculation

---

### 2.4 Saturation Thermometry

**Why**: Important for igneous petrology. GCDkit feature.

**Calculations**:
- Zircon saturation temperature (Watson & Harrison)
- Apatite saturation temperature
- Monazite saturation temperature
- TiO2 activity
- Aluminosilicate saturation

---

### 2.5 Report Generation

**Why**: Professional output requirement.

**Features**:
- PDF report export
- Customizable report templates
- Include selected plots
- Summary statistics tables
- QA/QC summary
- Branding/logo support

---

## PRIORITY 3: NICE TO HAVE

### 3.1 Sr-Nd Isotope Tools

**Why**: GCDkit strength. Academic petrology feature.

**Features**:
- ε(Nd) calculations
- Initial ratio calculations
- Nd model ages (TDM)
- Sr-Nd correlation plots
- Isotope growth curves

---

### 3.2 Live Link / External Integration

**Why**: ioGAS-Leapfrog integration is popular.

**Features**:
- QGIS plugin export
- Leapfrog CSV export with attributes
- ArcGIS Pro compatible export
- Real-time refresh capability

**Reference**: [ioGAS-Leapfrog Integration](https://www.seequent.com/technical-tuesday-linking-lithology-and-geochemistry-with-iogas-and-leapfrog-geo-workflows/)

---

### 3.3 Python/R Script Runner

**Why**: ioGAS 8.3 added Python scripting. Power user feature.

**Features**:
- Built-in Python console
- Access to current dataset
- Custom calculation scripts
- Plot customization scripts
- Script library/templates

---

### 3.4 Wavelet Analysis

**Why**: Advanced downhole pattern detection (ioGAS feature).

**Features**:
- Wavelet decomposition of downhole data
- Scale-space visualization
- Pattern detection at multiple scales
- Contact/boundary detection

---

### 3.5 UMAP/t-SNE Dimensionality Reduction

**Why**: Modern alternatives to PCA for complex data.

**Features**:
- UMAP projection
- t-SNE projection
- Interactive parameter tuning
- 2D/3D visualization
- Color by other variables

---

## CURRENT GAPS SUMMARY

Based on comparison with ioGAS and GCDkit:

| Feature | ioGAS | GCDkit | GeoChem Pro | Priority |
|---------|-------|--------|-------------|----------|
| QA/QC Module | ✓ | - | **MISSING** | P1 |
| Classification Diagrams | ✓ | ✓ | Partial | P1 |
| Full PCA | ✓ | ✓ | CLR only | P1 |
| Cluster Analysis | ✓ | ✓ | **MISSING** | P1 |
| Polygon Selection | ✓ | - | **MISSING** | P2 |
| Gridding/Contouring | ✓ | - | **MISSING** | P1 |
| Anomaly Detection | ✓ | - | **MISSING** | P2 |
| CIPW Norm | - | ✓ | **MISSING** | P2 |
| Harker Diagrams | ✓ | ✓ | **MISSING** | P1 |
| Isotope Tools | - | ✓ | **MISSING** | P3 |
| Report Export | ✓ | ✓ | **MISSING** | P2 |
| Python Scripting | ✓ | ✓(R) | **MISSING** | P3 |

---

## RECOMMENDED IMPLEMENTATION ORDER

### Phase 1: Core Professional Features (4-6 weeks)
1. QA/QC Module with control charts
2. Classification diagrams with field overlays
3. Harker variation diagram generator
4. Full PCA (scores, loadings, scree plot)

### Phase 2: Spatial & Advanced Analysis (4-6 weeks)
5. Data gridding with IDW/Kriging
6. Contour maps on attribute maps
7. K-means/Hierarchical clustering
8. Polygon selection tool

### Phase 3: Specialized Tools (4-6 weeks)
9. Anomaly detection module
10. CIPW norm calculations
11. Report generation/PDF export
12. Discriminant analysis

### Phase 4: Power Features (ongoing)
13. Python scripting console
14. Leapfrog/QGIS export
15. Isotope calculations
16. UMAP/t-SNE projections

---

## COMPETITIVE POSITIONING

**vs ioGAS**:
- Match core features (QA/QC, classification, multivariate)
- Add modern web advantages (no install, cloud-ready)
- Lower cost / open source option

**vs GCDkit**:
- Better UI/UX (web-based)
- Real-time interactivity
- No R knowledge required
- Add exploration-focused features GCDkit lacks

**vs Leapfrog Geochemistry**:
- Standalone geochemistry (no full 3D modeling needed)
- Lower cost entry point
- Focus on 2D analysis with 3D preview

---

## SOURCES

- [ioGAS Software](https://www.imdex.com/software/iogas)
- [GCDkit Documentation](https://www.gcdkit.org/)
- [PetroGraph Software](https://www.researchgate.net/publication/241063512)
- [Seequent Leapfrog](https://www.seequent.com/)
- [USGS QA/QC Guidelines](https://pubs.usgs.gov/of/2011/1187/)
- [Geochemical Data Plotting Programs](https://serc.carleton.edu/NAGTWorkshops/petrology/plot_programs.html)
