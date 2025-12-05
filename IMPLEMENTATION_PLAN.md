# GeoChem Pro - Comprehensive Implementation Plan

## Based on "The Geochemical Architect" Guide & GeoCoDA Workflow

This plan transforms GeoChem Pro into a statistically rigorous, industry-standard geochemistry platform that properly handles compositional data and provides deposit-specific vectoring tools.

**Key Academic References:**
- Grunsky, Greenacre & Kjarsgaard (2024) - "GeoCoDA: Recognizing and Validating Structural Processes in Geochemical Data" - Applied Computing and Geosciences
- Aitchison (1986) - "The Statistical Analysis of Compositional Data"
- Greenacre et al. (2023) - "Aitchison's compositional data analysis 40 years on: a reappraisal"

---

## STAGE 1: COMPOSITIONAL DATA FOUNDATIONS
**Priority: CRITICAL - This is the statistical foundation everything else depends on**

### 1.1 Log-Ratio Transformations (GeoCoDA Complete Suite)

The GeoCoDA workflow emphasizes that **raw geochemical data is mathematically invalid for multivariate statistics** due to the closure problem (parts sum to 100%). We must implement the **complete suite of five logratio transformations**.

#### Complete Logratio Transformation Suite:

| Transformation | Formula | Variables | Primary Use |
|---------------|---------|-----------|-------------|
| PLR (Pairwise) | `log(xj/xk)` | J(J-1)/2 | Simple element comparisons |
| ALR (Additive) | `log(xj/xD)` | J-1 | Fixed reference analysis |
| CLR (Centered) | `log(xj/g(x))` | J | PCA, correlation matrix |
| ILR (Isometric) | Geometric mean ratios | J-1 | Orthogonal coordinates |
| **SLR (Summed)** | `log(Σgroup1/Σgroup2)` | Knowledge-driven | **Process interpretation** |

**A. PLR (Pairwise Log-Ratio) Transformation** - *NEW from GeoCoDA*
```
PLR(j,k) = log(xj / xk)
For J elements, there are J(J-1)/2 = 231 unique PLRs (for J=22)
Note: log(xj/xk) = -log(xk/xj)
```
- [ ] Generate all unique PLRs for dataset
- [ ] PLR variance contribution analysis (Table 1 from GeoCoDA)
- [ ] PLR explained variance ranking
- [ ] Between-group variance ranking for classification
- [ ] Interactive PLR explorer/selector

**B. CLR (Centered Log-Ratio) Transformation** - *Currently Partial*
```
CLR(xj) = log(xj / g(x))
where g(x) = (x1 × x2 × ... × xJ)^(1/J) = geometric mean
```
- [ ] Robust implementation handling zeros
- [ ] Apply to correlation matrix calculation
- [ ] Apply to PCA (becomes Logratio Analysis - LRA)
- [ ] Visual indicator showing "CLR-transformed" on plots
- [ ] Toggle between raw and CLR views
- [ ] CLR is equivalent to analyzing all J(J-1)/2 PLRs

**C. ALR (Additive Log-Ratio) Transformation**
```
ALR(xj) = log(xj / xD), j = 1, ..., J-1
where xD = denominator element (reference part)
```
- [ ] User selection of denominator element
- [ ] **Procrustes correlation ranking** to find optimal denominator (Section S6 of GeoCoDA)
- [ ] Auto-suggest immobile elements (Zr, Y, Cr, V, Ti) as denominators
- [ ] Display Procrustes correlation score for selected denominator
- [ ] Warning if selected denominator has low Procrustes correlation (<0.95)

**Procrustes Correlation Reference Table** (from GeoCoDA):
| Rank | Element | Procrustes Correlation |
|------|---------|----------------------|
| 1 | **Zr** | 0.977 |
| 2 | Y | 0.977 |
| 3 | Cr | 0.973 |
| 4 | V | 0.972 |
| 5 | Fe | 0.968 |
| ... | Ca | 0.823 (worst) |

**D. ILR (Isometric Log-Ratio) Transformation**
```
ILR(J1, J2) = sqrt(J1×J2/(J1+J2)) × log([∏xj∈J1]^(1/J1) / [∏xj∈J2]^(1/J2))
```
- [ ] Implementation using dendrogram-based partitioning
- [ ] Back-transformation for interpretation
- [ ] Note: ILRs are difficult to interpret - prefer ALR/CLR/SLR per Greenacre et al. (2023)

**E. SLR (Summed Log-Ratio / Amalgamation Logratio)** - *NEW from GeoCoDA - CRITICAL*
```
SLR(J1, J2) = log(Σxj∈J1 / Σxj∈J2)
```
SLRs are **knowledge-driven** groupings that are much easier to interpret than ILRs:
- [ ] Amalgamation builder UI for creating element groups
- [ ] Pre-defined geochemical amalgamations:
  - **Mantle**: Si+Mg+Fe+Cr+Co+Ni+Ti
  - **Crustal**: Al+Rb+Na+K+Ga
  - **Kimberlite/Magmatic**: Nb+La+Th+Zr+P+Er+Yb
  - **Felsic**: Si+Na+K+Al
  - **Mafic**: Fe+Mg+Ca+Ti
  - **LREE**: La+Ce+Pr+Nd
  - **HREE**: Gd+Tb+Dy+Ho+Er+Tm+Yb+Lu
- [ ] Custom amalgamation creation with save/load
- [ ] Amalgamation variance calculation for denominator selection
- [ ] SLR calculation between any two amalgamations

### 1.2 Zero and Detection Limit Handling (GeoCoDA Classification)

**Current Problem**: Zeros crash log-transformations (ln(0) = -∞)

#### Three-Way Zero Classification (from GeoCoDA Section 4):

| Zero Type | Cause | Handling Strategy |
|-----------|-------|-------------------|
| **Structural** | Element doesn't exist in geochemical environment | Drop element or sample |
| **Missing** | Data not collected/lost | Nearest neighbor imputation |
| **Below DL** | Below instrument detection | DL-respecting imputation |

#### Features to Implement:

**A. Zero Type Detection & Classification**
- [ ] Auto-classify zeros by type based on context
- [ ] UI for manual zero type assignment
- [ ] Different handling pipelines per zero type

**B. Below Detection Limit (BDL) Handling**
- [ ] Auto-detect censored values ("<X" format)
- [ ] Multiple replacement strategies:
  - Half detection limit (½ DL) - Default
  - Small constant (0.65 × DL)
  - Multiplicative replacement (Martín-Fernández et al.)
  - EM imputation (advanced)
- [ ] User selection with explanation of trade-offs
- [ ] Visual flagging of imputed values

**C. Over Limit Handling**
- [ ] Detect ">X" values
- [ ] Cap at upper limit with flag
- [ ] Warning for ratio calculations using capped values

**D. chiPower Transformation (Alternative for Zero-Heavy Data)** - *NEW from GeoCoDA*
```
chiPower combines:
1. Chi-square standardization from Correspondence Analysis
2. Box-Cox power transformation (λ parameter)
As λ → 0, chiPower → Logratio Analysis (LRA)
```
- [ ] Implement chiPower transformation (Greenacre 2023)
- [ ] **Advantages**: No zero replacement needed
- [ ] Close to isometric and subcompositionally coherent
- [ ] Interpretable in terms of parts, not ratios
- [ ] Auto-optimize λ for group separation
- [ ] Fourth-root transform (λ=0.25) as default for data with zeros

### 1.3 Logratio-Based Statistics (GeoCoDA Methods)

**Replace raw statistics with compositionally-valid versions:**

- [ ] **CLR Correlation Matrix** - Replace current Pearson on raw data
- [ ] **Logratio Analysis (LRA)** - PCA on CLR-transformed data (Figure 9 of GeoCoDA)
- [ ] **ALR-PCA** - PCA on ALR-transformed data with optimal reference (Figure 10 of GeoCoDA)
- [ ] **CLR Cluster Analysis** - K-means on transformed data
- [ ] Warning system when user attempts raw statistics
- [ ] Educational tooltips explaining why logratio transformation is necessary

### 1.4 Variance Decomposition Methods (NEW from GeoCoDA Table 1)

Three complementary ways to assess logratio importance:

**A. Contributed Variance**
```
How much each PLR contributes to total logratio variance
Sum of all contributions = 100%
```
- [ ] Calculate contributed variance for all PLRs
- [ ] Rank PLRs by contribution
- [ ] Top 10 PLRs typically explain 15-20% of total variance

**B. Explained Variance (R²)**
```
Regress all logratios on each specific logratio
R² shows how much of total variance that logratio explains
```
- [ ] Calculate explained variance for all PLRs
- [ ] Rank by explanatory power
- [ ] Identify logratios with highest R² (e.g., Mg/K at 47.3% in GeoCoDA)

**C. Between-Group Explained Variance** (for supervised learning)
```
Which logratios best explain differences between known groups
```
- [ ] Calculate between-group variance for classification tasks
- [ ] Rank logratios by group separation power
- [ ] Use for feature selection in classification models

**Variance Analysis Dashboard:**
- [ ] Side-by-side comparison of three variance rankings
- [ ] Identify logratios that appear in multiple top-10 lists
- [ ] Recommend logratios for different objectives

---

## STAGE 2: QUALITY ASSURANCE / QUALITY CONTROL (QA/QC)
**Priority: HIGH - Essential for data integrity**

### 2.1 Control Sample Detection

- [ ] Auto-detect QC samples by naming patterns:
  - Standards/CRMs: "STD", "CRM", "OREAS", "GEOSTATS"
  - Blanks: "BLK", "BLANK", "FB" (field blank)
  - Duplicates: "DUP", "-A/-B" suffix pairs
- [ ] Manual tagging interface for undetected controls
- [ ] QC sample insertion rate calculation

### 2.2 Standard/CRM Analysis

**Shewhart Control Charts:**
- [ ] Plot standard values over time/sequence
- [ ] Calculate certified mean and standard deviation
- [ ] Draw control limits:
  - ±2σ warning limits (yellow zone)
  - ±3σ failure limits (red zone)
- [ ] Auto-detect failures:
  - Single value > 3σ = FAILURE
  - Two consecutive > 2σ same side = BIAS
- [ ] Batch identification and failure flagging
- [ ] Recovery % calculation (Measured/Certified × 100)
- [ ] Drift detection over time

### 2.3 Blank Analysis

- [ ] Blank value sequence plots
- [ ] Threshold lines at 5× and 10× detection limit
- [ ] Contamination detection after high-grade samples
- [ ] Batch contamination flagging

### 2.4 Duplicate Analysis

**Field Duplicates:**
- [ ] Relative Percent Difference (RPD) calculation:
  ```
  RPD = |A - B| / ((A + B) / 2) × 100
  ```
- [ ] RPD threshold: 30% for field duplicates
- [ ] Nugget effect assessment

**Pulp Duplicates:**
- [ ] RPD threshold: 10% for pulp duplicates
- [ ] Laboratory precision assessment

**Visualization:**
- [ ] Thompson-Howarth precision plots
- [ ] Ranked Half Absolute Relative Difference (HARD) plots
- [ ] Duplicate pair scatter plots with 1:1 line

### 2.5 QA/QC Dashboard

- [ ] Summary statistics per control type
- [ ] Pass/Fail rates by element
- [ ] Batch-level QC summary
- [ ] Exportable QA/QC report (PDF)
- [ ] Data quality score/rating

---

## STAGE 3: MASS BALANCE & ALTERATION ANALYSIS
**Priority: HIGH - Core vectoring capability**

### 3.1 Isocon Analysis

**Interactive Isocon Diagram:**
- [ ] Select precursor sample (least-altered reference)
- [ ] Plot Altered (Y) vs Precursor (X) for all elements
- [ ] Identify immobile elements (Ti, Zr, Al, Nb, Th)
- [ ] Fit isocon line through immobiles
- [ ] Calculate mass change factor (M):
  - M = 1: Constant mass
  - M > 1: Mass loss (residual enrichment)
  - M < 1: Mass gain (dilution)
- [ ] Quantify element gains/losses relative to isocon
- [ ] Export gain/loss table (e.g., "+5% K₂O added")

### 3.2 Immobility Testing

- [ ] Plot Zr vs Ti, Al vs Ti, Nb vs Th
- [ ] Linear regression through origin test
- [ ] Visual assessment of immobility
- [ ] Flag potentially mobile "immobile" elements
- [ ] Recommendations for denominator selection

### 3.3 Alteration Indices (Expand Current)

**Currently Have:** AI, CCPI, CIA, WIP, A/CNK, Mg#

**Add:**
- [ ] **SEDEX Alteration Index**:
  ```
  AI = 100 × (FeO + 10×MnO) / (FeO + 10×MnO + MgO)
  ```
- [ ] **3K/Al Molar Ratio** (Sericite saturation):
  ```
  3K/Al = 3 × (K₂O/94.2) / (Al₂O₃/101.96)
  Target: 0.33 = complete sericite saturation
  ```
- [ ] **K/Na Molar Ratio** (Potassic alteration)
- [ ] **Na/Al Molar Ratio** (Sodic alteration - IOCG)
- [ ] **Fe/Al Molar Ratio** (Iron metasomatism)

### 3.4 Alteration Box Plot

**AI vs CCPI Diagram with Fields:**
- [ ] Fresh rock box (low AI, low CCPI)
- [ ] Chlorite trend arrow (high AI, high CCPI)
- [ ] Sericite trend arrow (high AI, moderate CCPI)
- [ ] Diagenetic/metamorphic field
- [ ] Interactive point selection
- [ ] Color by lithology or alteration intensity

---

## STAGE 4: DEPOSIT-SPECIFIC VECTORING TOOLS
**Priority: HIGH - Core value proposition**

### 4.1 Porphyry Cu-Au-Mo Fertility & Vectoring

**Fertility Indicators:**
- [ ] **Sr/Y Ratio** with classification:
  - < 20: Low fertility
  - 20-40: Moderate fertility
  - > 40: High fertility (adakitic)
- [ ] **V/Sc Ratio** with classification:
  - < 10: Reduced/unfertile
  - > 10: Oxidized/fertile
- [ ] **Eu/Eu\* Anomaly** calculation:
  ```
  Eu/Eu* = EuN / sqrt(SmN × GdN)
  ```
  - < 0.6: Negative anomaly (evolved, less fertile)
  - > 0.8: No anomaly (oxidized, fertile)
- [ ] **K/Na Ratio** for alteration zonation
- [ ] **Co/As Ratio** in pyrite (thermal vectoring)

**Visualization:**
- [ ] Sr/Y vs Y diagram with fertility fields
- [ ] V/Sc vs SiO₂ diagram
- [ ] Spatial mapping of fertility ratios

### 4.2 Orogenic Gold Vectoring

- [ ] **Au:Ag Ratio** with classification:
  - > 5:1: Orogenic signature
  - < 1:1: Epithermal signature
- [ ] **3K/Al Saturation** plotting
- [ ] **Pathfinder suite**: Au-As-Sb-W-Bi-Te correlation
- [ ] Base metal absence check (Cu, Zn, Pb low)

### 4.3 Epithermal Vectoring

**High Sulfidation:**
- [ ] Bi/As ratio (increases toward feeder)
- [ ] Alkali depletion index

**Low Sulfidation:**
- [ ] Vertical zonation indicators:
  - Hg-Sb-As-Tl (upper/steam-heated)
  - Au-Ag-Se-K (boiling zone)
  - Zn-Pb-Cu (base metal root)
- [ ] K/Rb ratio for adularia detection

### 4.4 VMS Vectoring

- [ ] **Eu/Eu\* Anomaly** in exhalites
- [ ] **Ba/Sr Ratio** (increases away from vent)
- [ ] **Mn in exhalites** (increases away from vent)
- [ ] **Alteration Box Plot** integration
- [ ] Tl halo mapping

### 4.5 IOCG Discrimination

- [ ] **Na/Al vs K/Al Diagram**:
  - Na-corner: Barren sodic alteration
  - K-corner: Prospective potassic alteration
- [ ] **U-REE-F Association** detection
- [ ] **Co/Ni Ratio** (high Co = IOCG signature)

### 4.6 Ni-Cu-PGE Fertility

- [ ] **Pd/Cu Ratio** (depletion indicator)
- [ ] **Pd/Ti Ratio** (depletion indicator)
- [ ] **Crustal Contamination Ratios**:
  - Th/Yb (elevated = contamination)
  - La/Sm (elevated = contamination)
  - Zr/Y (elevated = contamination)
- [ ] Olivine Ni vs Fo content diagram (Sims & Ramsey trend)

### 4.7 LCT Pegmatite Fractionation

- [ ] **K/Rb Ratio** with zonation:
  - > 200: Barren/distal
  - 30-200: Approaching Li zone
  - < 30: Li fertile zone
  - < 10: Cs zone (most evolved)
- [ ] **Nb/Ta Ratio** (decreases with fractionation)
- [ ] **Zr/Hf Ratio** (decreases with fractionation)
- [ ] **Mg/Li Ratio** in soils (spodumene proxy)

### 4.8 Carbonatite/REE

- [ ] REE pattern visualization (already have)
- [ ] Eu anomaly calculation
- [ ] Nb-Ta-Th-Sr-P-Ba pathfinder suite

### 4.9 Skarn Vectoring

- [ ] **Garnet/Pyroxene Ratio** estimation from chemistry:
  - High ratio: Proximal (high T)
  - Low ratio: Distal (lower T)
- [ ] Fe³⁺/Fe²⁺ ratio for oxidation state

### 4.10 Sediment-Hosted Zn-Pb (MVT/SEDEX)

- [ ] **Mn Halo** mapping (MnO in carbonate)
- [ ] **Tl Anomaly** detection
- [ ] SEDEX Alteration Index plotting

---

## STAGE 5: ROBUST STATISTICAL METHODS & MACHINE LEARNING (GeoCoDA Enhanced)
**Priority: MEDIUM-HIGH - Advanced anomaly detection & classification**

### 5.1 Robust Regression

- [ ] **Least Trimmed Squares (LTS)** regression
- [ ] Background population fitting (ignores outliers)
- [ ] Residual calculation (Actual - Predicted)
- [ ] Residual as "true anomaly" after removing lithology/scavenging
- [ ] Confidence interval bands
- [ ] Per-category robust regression

### 5.2 Anomaly Detection Methods

**Statistical:**
- [ ] Mean + nσ threshold (user-configurable n)
- [ ] Median Absolute Deviation (MAD)
- [ ] IQR-based (box plot fences)
- [ ] Percentile-based cutoffs

**Residual-Based:**
- [ ] Robust regression residuals
- [ ] Mn-scavenging removal (Zn vs Mn residuals)
- [ ] Lithology-corrected anomalies

**Visualization:**
- [ ] Anomaly highlighting on all plots
- [ ] Anomaly probability scores
- [ ] Spatial anomaly maps

### 5.3 Population Separation

- [ ] Multi-population detection in histograms
- [ ] Log-probability plots for population identification
- [ ] Mixture modeling (optional advanced)

### 5.4 Clustering Methods (NEW from GeoCoDA Section 3.4)

**A. Hierarchical Clustering on Logratios**
```
1. Transform to CLRs
2. Compute Euclidean (logratio) distances
3. Apply Ward's method
4. Display dendrogram with group coloring
```
- [ ] Hierarchical clustering on CLR-transformed data (Figure 6 of GeoCoDA)
- [ ] Ward's method as default linkage
- [ ] Dendrogram visualization with phase/group coloring
- [ ] Cutpoint selection for k-cluster solution
- [ ] Cross-tabulation with known classes

**B. K-Means Clustering on Logratios**
```
1. Transform to CLRs (or ALRs with optimal reference)
2. Apply k-means with Euclidean distance
3. Evaluate BSS/TSS ratio for cluster quality
```
- [ ] K-means on CLR-transformed data
- [ ] Elbow plot (BSS/TSS vs k) for optimal cluster selection (Figure 7 of GeoCoDA)
- [ ] Option to use first n principal components
- [ ] Cross-tabulation with known classes

**C. Correspondence Analysis Clustering (Alternative)**
- [ ] Chi-square distances for clustering
- [ ] Power transformation option (chiPower)
- [ ] Useful when data contains zeros

**D. Amalgamation Clustering (Element Grouping)** - *NEW from GeoCoDA Figure 8*
```
Groups elements based on explained logratio variance
Creates dendrogram showing which elements are most similar
```
- [ ] Amalgamation clustering algorithm (Greenacre 2020)
- [ ] Element dendrogram visualization
- [ ] Identifies mineralogical relationships:
  - Similar charge/ionic radius: Na-K-Rb, Er-Yb, Al-Ga
  - Mineralogical control: Fe-Si-Mg (olivine), Ti-Nb (perovskite/ilmenite)
- [ ] Use for suggesting element groupings

### 5.5 Classification Methods (NEW from GeoCoDA Section 3.5)

**A. Multinomial Logistic Regression on Logratios**
```
Predicts categorical response (e.g., rock type, phase) from logratios
Uses stepwise selection with Bonferroni criterion
```
- [ ] Stepwise logratio selection (any PLR, non-overlapping PLRs, or ALRs)
- [ ] Model: logit(p) = β₀ + β₁×log(X₁/Y₁) + β₂×log(X₂/Y₂) + ...
- [ ] Display regression coefficients with standard errors
- [ ] Cross-validation for prediction accuracy
- [ ] Probability contour visualization (Figure 12 of GeoCoDA)

**Example from GeoCoDA (93% accuracy with 2 logratios):**
```
logit(p_eJF) = -228.81 + 14.02×log(Mg/La) + 13.15×log(Mg/V)
logit(p_eJF) = -119.10 + 10.20×log(Mg/La) + 11.03×log(Ni/V)
```

**B. Classification Trees on Logratios**
```
Decision tree using logratio splits
Advantage: Shows critical decision points
```
- [ ] Classification tree using logratios (Figure 13 of GeoCoDA)
- [ ] Alternative: Use raw ratios for easier interpretation (Figure 14)
- [ ] Cross-validation accuracy reporting
- [ ] Visual tree diagram with sample counts at nodes

**Example Rules from GeoCoDA:**
```
IF Mg/La > 8458 THEN predict eJF (140 of 145 correct)
IF Mg/La ≤ 8458 AND Mg/Y < 10.61 THEN predict Other (99 of 100 correct)
```

**C. Random Forests on Logratios**
```
Ensemble of decision trees for robust prediction
Out-of-bag (OOB) accuracy estimation
```
- [ ] Random forest classification on logratio-transformed data
- [ ] Train/test split (e.g., 2/3 - 1/3 stratified)
- [ ] OOB accuracy reporting
- [ ] Variable importance ranking
- [ ] GeoCoDA achieved 88.8% test accuracy, 92.8% OOB accuracy

**D. Variable Selection for Classification**

Three approaches (Coenders & Greenacre 2022):
1. **Any PLR**: Select from all J(J-1)/2 logratios
2. **Non-overlapping PLRs**: Select logratios with no shared elements
3. **ALRs**: Select logratios with same denominator

- [ ] Implement all three selection strategies
- [ ] Compare model complexity vs accuracy trade-offs

---

## STAGE 6: DATA WORKFLOW TOOLS
**Priority: MEDIUM - Practical data handling**

### 6.1 pXRF Data Processing

- [ ] **Drift Standard Analysis**:
  - Detect drift standards in sequence
  - Calculate shift percentage
  - Apply linear time-based correction
- [ ] **Empirical Leveling**:
  - Select calibrator samples (pXRF + Lab pairs)
  - Regression: Lab = m × pXRF + c
  - Apply correction factors per element
  - R² threshold warning (< 0.8 = unreliable)
- [ ] **Element Reliability Screening**:
  - Flag elements with > 20% error
  - Warn about light elements (Li, Be, B, Na)
  - Element suitability matrix

### 6.2 Dataset Merging & Leveling

- [ ] **Quantile Leveling**:
  - Calculate P10, P50, P90 for overlapping samples
  - Adjust datasets to common baseline
- [ ] **Z-Score Normalization**:
  - Transform: Z = (Value - Mean) / SD
  - Merge datasets on relative anomaly basis
- [ ] **Lab Comparison Reports**:
  - Compare same samples from different labs
  - Bias detection and correction factors

### 6.3 Digestion Method Awareness

- [ ] **Method Code Detection**:
  - Aqua Regia: Flag HFSE as "Mobile Only"
  - Four-Acid: Check Zr/Hf ratio for completeness
  - Fusion: Mark as "Total"
- [ ] **Digestion Warnings**:
  - Warn when using AR data for Zr/Ti classification
  - Suggest fusion for REE/LCT exploration
- [ ] Method tracking in column metadata

---

## STAGE 7: ENHANCED VISUALIZATION (GeoCoDA Methods)
**Priority: MEDIUM - User experience**

### 7.1 Compositional Bar Plots (NEW from GeoCoDA Figure 2)

**Nonlinear Scale Compositional Bar Plot:**
```
Transform percentages nonlinearly to show both rare and abundant elements:
1. Multiply by inverse of smallest value → smallest becomes 1
2. Take logarithm → preserves ordering, compresses abundant elements
3. Close to 100% → comparable bar widths for all elements
```
- [ ] Implement nonlinear scale transformation
- [ ] Order elements by increasing mean value (rare on left, abundant on right)
- [ ] Stack bars by sample groups (e.g., rock types, phases)
- [ ] Show average composition as reference bar
- [ ] Color-code elements by geochemical group (major, minor, trace, REE)

### 7.2 Centered Ternary Diagrams (NEW from GeoCoDA Figure 5)

**Standard Ternary:**
- Points cluster in one corner when one component dominates

**Centered Ternary:**
```
1. Divide each amalgamation by its geometric mean
2. Reclose to 100%
3. Results: Points spread across the triangle
4. Grid lines remain straight but scales are nonlinear
```
- [ ] Implement centered ternary transformation
- [ ] Display both standard and centered views
- [ ] Show scale deformation on axes
- [ ] Use for amalgamation visualization (mantle-crustal-kimberlite)

### 7.3 Logratio Biplots (NEW from GeoCoDA Figures 9-10)

**LRA Biplot (PCA on CLRs):**
- [ ] Display samples as points with group symbols
- [ ] Display elements as labeled positions
- [ ] **Interpretation**: Direction from element A to B represents log(B/A)
- [ ] Show convex hulls and/or 99.5% confidence ellipses for groups
- [ ] Label group centroids

**ALR-PCA Biplot:**
- [ ] PCA on ALRs with optimal reference (e.g., Zr)
- [ ] Ratios displayed as X/Zr pointing downward
- [ ] Easier interpretation than CLR biplot

### 7.4 Star Plots / Rose Diagrams (NEW from GeoCoDA Figure 4)

**Element Star Plot by Group:**
```
Radial plot showing relative enrichment/depletion
Each ray = one element
Length = scaled value (e.g., between group min and max median)
```
- [ ] Star plot for element amalgamations
- [ ] Show one star per sample group
- [ ] Color-code amalgamation sectors (mantle/crustal/kimberlite)
- [ ] Interactive hover showing element values

### 7.5 Classification Diagrams with Fields

- [ ] **Alteration Box Plot** (AI vs CCPI with fields)
- [ ] **TAS Diagram** with rock type fields
- [ ] **AFM Ternary** with tholeiitic/calc-alkaline divide
- [ ] **K₂O vs SiO₂** with series fields
- [ ] **Pearce Discrimination Diagrams**:
  - Rb vs (Y+Nb) granites
  - Nb-Y diagram
  - Ti-Zr-Y ternary
  - Th/Yb vs Nb/Yb

### 7.6 Vectoring Diagrams

- [ ] **Sr/Y vs Y** fertility diagram
- [ ] **V/Sc vs SiO₂** oxidation state
- [ ] **Na/Al vs K/Al** IOCG discrimination
- [ ] **K/Rb Fractionation** for pegmatites

### 7.7 Isocon Diagram

- [ ] Interactive precursor selection
- [ ] Isocon line fitting
- [ ] Gain/loss visualization
- [ ] Element labeling

### 7.8 Probability Contour Plots (NEW from GeoCoDA Figure 12)

**For Classification Models:**
- [ ] Plot two logratio axes (e.g., log(Mg/La) vs log(Ni/V))
- [ ] Show probability contours from logistic regression
- [ ] Color samples by predicted vs actual class
- [ ] Highlight misclassified samples

### 7.9 Dendrogram Visualizations

**Sample Dendrogram:**
- [ ] Hierarchical clustering of samples on logratios
- [ ] Color-code by known classes
- [ ] Show cutpoint for k-cluster solution

**Element Dendrogram (Amalgamation Clustering):**
- [ ] Show which elements are most similar
- [ ] Height = logratio variance lost when amalgamating
- [ ] Identify mineralogical groupings

---

## STAGE 8: REPORTING & EXPORT
**Priority: MEDIUM - Professional output**

### 8.1 QA/QC Reports

- [ ] PDF export with control charts
- [ ] Pass/Fail summary tables
- [ ] Batch-level analysis
- [ ] Recommendations

### 8.2 Vectoring Reports

- [ ] Fertility assessment summary
- [ ] Alteration zonation interpretation
- [ ] Spatial trend analysis

### 8.3 Data Export

- [ ] Export with calculated columns
- [ ] CLR-transformed data export
- [ ] QC-flagged data export
- [ ] Leapfrog/QGIS compatible formats

---

## IMPLEMENTATION TIMELINE (Revised with GeoCoDA)

### Phase 1: Complete Logratio Foundation (Weeks 1-4)
**Core GeoCoDA Infrastructure:**
- Complete PLR/ALR/CLR/ILR/SLR transformation suite
- Procrustes correlation for optimal ALR reference selection
- chiPower transformation for zero-heavy data
- Three-way zero classification and handling
- Detection limit UI

**Variance Analysis:**
- Contributed variance calculation
- Explained variance (R²) calculation
- Between-group variance for classification

### Phase 2: QA/QC Module (Weeks 5-7)
- Control sample detection
- CRM control charts
- Blank analysis
- Duplicate analysis (RPD)
- QA/QC dashboard

### Phase 3: GeoCoDA Visualization Suite (Weeks 8-10)
**New Visualization Methods:**
- Compositional bar plots with nonlinear scale
- Centered ternary diagrams
- LRA biplots (PCA on CLRs)
- ALR-PCA biplots
- Star plots / rose diagrams
- Probability contour plots
- Sample and element dendrograms

### Phase 4: Amalgamation System (Weeks 11-12)
- SLR (Summed Logratio) calculations
- Amalgamation builder UI
- Pre-defined geochemical amalgamations
- Amalgamation clustering algorithm
- Element dendrogram visualization

### Phase 5: Mass Balance & Alteration (Weeks 13-14)
- Isocon analysis tool
- Immobility testing
- Additional alteration indices
- Alteration Box Plot

### Phase 6: Deposit Vectoring (Weeks 15-18)
- Porphyry fertility ratios
- Orogenic gold vectoring
- VMS vectoring
- LCT pegmatite fractionation
- IOCG discrimination

### Phase 7: Machine Learning Classification (Weeks 19-21)
**GeoCoDA Classification Methods:**
- Hierarchical clustering on logratios
- K-means clustering with elbow optimization
- Multinomial logistic regression on logratios
- Classification trees (logratio and ratio-based)
- Random forests with variable importance
- Cross-validation framework
- Variable selection (3 strategies)

### Phase 8: Advanced Statistics (Weeks 22-23)
- Robust regression (LTS)
- Anomaly detection methods
- Residual-based analysis
- Population separation

### Phase 9: Data Workflows (Weeks 24-25)
- pXRF processing with drift correction
- Dataset leveling (quantile, Z-score)
- Digestion method tracking

### Phase 10: Polish & Export (Weeks 26-28)
- Classification diagrams with fields
- QA/QC report generation
- Vectoring report templates
- Data export (CLR, flagged, Leapfrog/QGIS)

---

## KEY FORMULAS REFERENCE

### Complete Log-Ratio Transformations (GeoCoDA)
```
PLR: log(xj / xk)                    Pairwise logratio
ALR: log(xj / xD)                    Additive logratio (fixed denominator)
CLR: log(xj / g(x))                  Centered logratio, where g(x) = (∏xi)^(1/J)
ILR: √(J1×J2/(J1+J2)) × log(gm1/gm2) Isometric logratio (geometric means)
SLR: log(Σ group1 / Σ group2)        Summed logratio (amalgamation)
```

### Variance Decomposition (GeoCoDA Table 1)
```
Contributed Variance: How much each PLR adds to total (sums to 100%)
Explained Variance: R² of regressing all logratios on one logratio
Between-Group Variance: How well logratio separates known classes
```

### Procrustes Correlation for ALR Reference
```
Higher correlation = closer to exact logratio geometry
Best: Zr (0.977), Y (0.977), Cr (0.973)
Worst: Ca (0.823), Na (0.835)
```

### chiPower Transformation (for data with zeros)
```
Combines chi-square standardization + Box-Cox power (λ)
As λ → 0: chiPower → LRA (logratio analysis)
Default: λ = 0.25 (fourth-root transform)
```

### Alteration Indices
```
AI = 100 × (K₂O + MgO) / (K₂O + MgO + Na₂O + CaO)
CCPI = 100 × (MgO + FeO) / (MgO + FeO + Na₂O + K₂O)
3K/Al = 3 × (K₂O/94.2) / (Al₂O₃/101.96)
SEDEX AI = 100 × (FeO + 10×MnO) / (FeO + 10×MnO + MgO)
```

### Fertility Ratios
```
Sr/Y > 40: High porphyry fertility
V/Sc > 10: Oxidized/fertile magma
Eu/Eu* = EuN / √(SmN × GdN)
K/Rb < 30: Li-fertile pegmatite
```

### QA/QC
```
RPD = |A - B| / ((A + B) / 2) × 100
Field Duplicate: < 30% RPD
Pulp Duplicate: < 10% RPD
CRM Pass: Within ±2σ of certified mean
```

### Mass Balance
```
Isocon: C^A = M × C^P
M > 1: Mass loss
M < 1: Mass gain
M = 1: Constant mass
```

### Classification Accuracy Benchmarks (from GeoCoDA)
```
Multinomial Logistic Regression: 93% with 2-3 logratios
Classification Trees: 93-97% (cross-validation: 86-93%)
Random Forests: 88.8% test set, 92.8% OOB
Hierarchical Clustering: 66-70% correct cluster assignment
K-Means Clustering: 67-71% correct assignment
```

---

## GeoCoDA WORKFLOW SUMMARY

```
┌─────────────────────┐
│ Compositional Data  │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Which Transformation│
│ PLR/ALR/CLR/ILR/SLR │
└─────────┬───────────┘
          │
    ┌─────┴─────┐
    ▼           ▼
┌─────────┐ ┌─────────────┐
│ Process │ │   Process   │
│Discovery│ │ Validation  │
│(Unsup.) │ │ (Supervised)│
└────┬────┘ └──────┬──────┘
     │             │
     ▼             ▼
┌─────────┐ ┌─────────────┐
│• Viz    │ │• Logistic   │
│• Cluster│ │  Regression │
│• PCA/LRA│ │• Class Trees│
│• Amalgam│ │• Random     │
│• Var Sel│ │  Forests    │
└─────────┘ └─────────────┘
```

**Process Discovery** (Unsupervised Learning):
1. Univariate & bivariate visualization
2. Clustering (hierarchical/k-means on logratios)
3. Knowledge-based amalgamations
4. Dimension reduction (LRA = PCA on CLRs)
5. Variable selection by variance analysis

**Process Validation** (Supervised Learning):
1. Identify discriminating logratios
2. Build classification models
3. Cross-validate prediction accuracy
4. Variable importance ranking

---

## SUCCESS METRICS

1. **Statistical Validity**: All multivariate analyses use CLR-transformed data
2. **QA/QC Integration**: Every dataset has QC assessment before analysis
3. **Deposit Coverage**: All major deposit types have vectoring tools
4. **Workflow Efficiency**: pXRF to interpretation in < 30 minutes
5. **Professional Output**: Publication-ready diagrams and reports

---

## REFERENCES

### Primary Academic Sources (GeoCoDA)

**Core GeoCoDA Papers:**
- Grunsky, E., Greenacre, M., Kjarsgaard, B. (2024). "GeoCoDA: Recognizing and Validating Structural Processes in Geochemical Data. A Workflow on Compositional Data Analysis in Lithogeochemistry." *Applied Computing and Geosciences* 22, 100149.
- Greenacre, M., Grunsky, E., Bacon-Shone, J., et al. (2023). "Aitchison's compositional data analysis 40 years on: a reappraisal." *Statistical Science* 38:386-410.

**Compositional Data Analysis Foundations:**
- Aitchison, J. (1986). *The Statistical Analysis of Compositional Data*. Chapman & Hall, London.
- Aitchison, J. (1999). "Logratios and natural laws in compositional data analysis." *Math. Geol.* 31:563-580.
- Aitchison, J., Greenacre, M. (2002). "Biplots of compositional data." *J. R. Stat. Soc. Ser. C. Appl. Stat.* 51:375-392.

**Logratio Methods:**
- Greenacre, M. (2018). *Compositional Data Analysis in Practice*. Chapman & Hall / CRC Press.
- Greenacre, M. (2019). "Variable selection in compositional data analysis using pairwise logratios." *Math. Geosc.* 51:649-82.
- Greenacre, M. (2020). "Amalgamations are valid in compositional data analysis." *Appl. Comput. Geosci.* 5:100017.
- Coenders, G., Greenacre, M. (2022). "Three approaches to supervised learning for compositional data with pairwise logratios." *J. Appl. Stat.* 49:1-22.

**chiPower Transformation:**
- Greenacre, M. (2023). "The chiPower transformation: a valid alternative to logratio transformation in compositional data analysis." arXiv:2211.06755.

**Zero Replacement:**
- Lubbe, S., Filzmoser, P., Templ, M. (2021). "Comparison of zero replacement strategies for compositional data with large numbers of zeros." *Chemometr. Intell. Lab. Syst.* 210:104248.
- Sanford, R., Pierson, C., Crovelli, R. (1993). "An objective replacement method for censored geochemical data." *Math. Geol.* 25:59-80.

### Geochemical Applications

**Based on "The Geochemical Architect: A Comprehensive Guide to Economic Analysis and Vectoring" and cited works including:**
- Grunsky, E. (1986). "Recognition of alteration in volcanic rocks using statistical analysis of lithogeochemical data." *J. Geochem. Explor.* 25:157-183.
- Grunsky, E., Kjarsgaard, B. (2008). "Classification of distinct eruptive phases of the diamondiferous Star Kimberlite." *Appl. Geochem.* 23:3321-3336.
- Large et al. (2001) - Alteration Box Plot
- Grant (1986) - Isocon Method
- Pearce, T. (1968). "A contribution to the theory of variation diagrams." *Contrib. Miner. Petrol.* 19:142-157.
- McDonough & Sun (1995) - Chondrite Normalization

### Software References

- R Core Team (2021). R: A Language and Environment for Statistical Computing.
- easyCODA R package - https://github.com/michaelgreenacre/CODAinPractice
