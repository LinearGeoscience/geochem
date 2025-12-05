# Principles of Geochemical Analysis

## 1. QA/QC and Data Integrity
Before any interpretation, data quality must be assured.
- **Precision**: monitored via **Duplicates** (Field, Pulp, Coarse Reject). Use Thompson-Howarth plots to quantify error at different concentration levels.
- **Accuracy**: monitored via **Certified Reference Materials (CRMs)**. Control charts (Shewhart) should track bias over time.
- **Contamination**: monitored via **Blanks**. Any value > 2x detection limit in a blank requires investigation.

## 2. Analytical Methods & Digestion
Understanding the method is crucial for interpretation.
- **4-Acid Digestion** (HF-HNO3-HClO4-HCl): "Near-total" digestion. Dissolves most silicates but may lose volatile elements (As, Sb, Hg) and may not fully digest resistant minerals (Zircon, Chromite, Barite).
- **Aqua Regia** (HNO3-HCl): Partial digestion. Good for sulphides and carbonates but does not dissolve silicate lattices. Excellent for pathfinders (As, Sb, Hg, Au).
- **Fusion (Lithium Borate)**: Total digestion. Essential for major elements and resistive elements (Zr, Hf, REE).
- **XRF**: Non-destructive, good for major elements and some traces (Zr, Ba, Cr). Portable XRF (pXRF) requires rigorous calibration and matrix correction.

## 3. Statistical Analysis in Geochemistry

### Distributions: Normal vs. Log-Normal
Geochemical data is rarely normally distributed.
- **Log-Normal Law**: Trace element concentrations often follow a log-normal distribution (Ahrens, 1954).
- **Implication**: Standard statistical tests (t-tests, ANOVA) assume normality. **Always log-transform** trace element data before applying these tests or calculating Pearson correlation coefficients.
- **Visual Checks**: Use Histograms and Q-Q plots. A straight line on a log-scale Q-Q plot indicates log-normality.

### Censored Data (Values < Detection Limit)
Data reported as "< LDL" (Lower Detection Limit) is "left-censored".
- **Do NOT**: Delete these values or set them to zero.
- **Avoid**: Simple substitution (e.g., LDL/2) for datasets with >15% censoring, as it introduces bias.
- **Best Practice**: Use **Kaplan-Meier** survival analysis or **Maximum Likelihood Estimation (MLE)** to estimate summary statistics (mean, std dev) without fabricating data.

### Log-Log Plots vs. Linear Plots
- **Linear Plots**: Dominated by high-grade outliers (nugget effect). Can obscure trends in the background/low-grade population.
- **Log-Log Plots**: Compress the dynamic range, allowing visualization of trends across orders of magnitude. Essential for identifying power-law relationships and distinguishing background from anomalous populations.

## 4. Data Normalization and Element Mobility

### Closure Problem
Geochemical data is compositional (sums to 100%). An increase in one component mathematically forces a decrease in others (spurious negative correlation).
- **Solution**: Use **Log-Ratio Transformations** (clr, ilr) for multivariate analysis (PCA, Clustering).

### Pearce Element Ratios (PER)
Used to test material transfer hypotheses (e.g., fractionation, alteration) by normalizing to a **Conserved Element** (immobile).
- **Conserved Elements**: Typically Ti, Zr, Al, Nb, Th (depending on rock type and alteration intensity).
- **Method**:
    1. Identify a conserved element (e.g., Zr).
    2. Convert oxides/elements to molar values.
    3. Ratio all variables to the conserved element (e.g., K/Zr, Al/Zr).
    4. Plot ratios to identify material addition/loss lines (e.g., Sericitization vector).

### Isocon Diagrams (Grant, 1986)
A graphical method to quantify mass/volume change during alteration.
- **Plot**: Concentration in Altered Rock ($C^A$) vs. Concentration in Least Altered Equivalent ($C^O$).
- **Isocon Line**: A line through the origin connecting immobile elements (Ti, Zr, Al, etc.).
- **Slope**: Defines the net mass change.
    - Slope = 1: Constant Mass.
    - Slope > 1: Mass Loss (Residual enrichment of immobile elements).
    - Slope < 1: Mass Gain (Dilution of immobile elements).
- **Gains/Losses**: Elements plotting above the isocon are enriched; below are depleted.

## 5. Levelling Geochemical Data
When combining datasets from different labs, years, or methods (e.g., pXRF vs. Lab Assay):
1.  **Common Standards**: If available, use CRMs analyzed in both batches to calculate a linear shift factor.
2.  **Quantile-Quantile (Q-Q) Levelling**: If populations are spatially overlapping and geologically similar, match the quantiles of the two distributions to derive a transformation function.
3.  **Z-Score Normalization**: Transform data to standard deviations from the mean ($Z = (x - \mu) / \sigma$) for each dataset before merging. Useful for pattern recognition but loses absolute concentration values.
