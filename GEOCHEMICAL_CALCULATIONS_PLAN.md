# Geochemical Calculations Engine - Comprehensive Implementation Plan

## Executive Summary

This document outlines the implementation of a robust geochemical calculation engine for the GeoChem Pro application. The system will support element-oxide conversions, standard geochemical ratios, normalization calculations, and custom formula creation.

---

## 1. CALCULATION CATEGORIES

### 1.1 Element-Oxide Conversions

Convert between elemental concentrations and oxide forms using stoichiometric factors.

| Element | Oxide | Factor (Element → Oxide) | Factor (Oxide → Element) |
|---------|-------|--------------------------|--------------------------|
| Si | SiO₂ | 2.1393 | 0.4674 |
| Ti | TiO₂ | 1.6683 | 0.5995 |
| Al | Al₂O₃ | 1.8895 | 0.5293 |
| Fe | Fe₂O₃ | 1.4297 | 0.6994 |
| Fe | FeO | 1.2865 | 0.7773 |
| Fe | Fe₃O₄ | 1.3820 | 0.7236 |
| Mg | MgO | 1.6583 | 0.6030 |
| Ca | CaO | 1.3992 | 0.7147 |
| Na | Na₂O | 1.3480 | 0.7419 |
| K | K₂O | 1.2046 | 0.8302 |
| Mn | MnO | 1.2912 | 0.7745 |
| P | P₂O₅ | 2.2914 | 0.4364 |
| Cr | Cr₂O₃ | 1.4616 | 0.6842 |
| Ba | BaO | 1.1165 | 0.8957 |
| Zr | ZrO₂ | 1.3508 | 0.7403 |
| S | SO₃ | 2.4972 | 0.4005 |
| Ni | NiO | 1.2725 | 0.7858 |
| Co | CoO | 1.2715 | 0.7865 |
| Cu | CuO | 1.2518 | 0.7989 |
| Zn | ZnO | 1.2448 | 0.8034 |
| Pb | PbO | 1.0772 | 0.9283 |

**Special Conversions:**
- FeO ↔ Fe₂O₃: Factor = 1.1113 (FeO to Fe₂O₃) / 0.8998 (Fe₂O₃ to FeO)
- Fe₂O₃T (total iron as Fe₂O₃) to FeOT: × 0.8998

### 1.2 Petrochemical Indices

#### 1.2.1 Mg# (Magnesium Number)
```
Mg# = 100 × [MgO / (MgO + FeOT)]  (molar)

Where:
- Convert wt% to molar: MgO_mol = MgO_wt% / 40.304
- Convert wt% to molar: FeO_mol = FeOT_wt% / 71.844
- If only Fe₂O₃T available: FeOT = Fe₂O₃T × 0.8998
```

#### 1.2.2 A/CNK (Alumina Saturation Index)
```
A/CNK = Al₂O₃_mol / (CaO*_mol + Na₂O_mol + K₂O_mol)

Molecular weights:
- Al₂O₃ = 101.96
- CaO = 56.08
- Na₂O = 61.98
- K₂O = 94.20

Classification:
- Peraluminous: A/CNK > 1.0
- Metaluminous: A/CNK < 1.0 and A/NK > 1.0
- Peralkaline: A/NK < 1.0
```

#### 1.2.3 A/NK
```
A/NK = Al₂O₃_mol / (Na₂O_mol + K₂O_mol)
```

#### 1.2.4 CIA (Chemical Index of Alteration)
```
CIA = [Al₂O₃ / (Al₂O₃ + CaO* + Na₂O + K₂O)] × 100  (molar)

CaO* Calculation (McLennan 1993 method):
1. CaO_corrected = CaO - (P₂O₅ × 10/3)  // Remove apatite contribution
2. If CaO_corrected < Na₂O: CaO* = CaO_corrected
3. If CaO_corrected ≥ Na₂O: CaO* = Na₂O

Interpretation:
- Fresh feldspars: CIA ≈ 50
- Intense weathering (kaolinite): CIA ≈ 100
- Values 50-65: Low weathering
- Values 65-85: Moderate weathering
- Values 85-100: Extreme weathering
```

#### 1.2.5 PIA (Plagioclase Index of Alteration)
```
PIA = [(Al₂O₃ - K₂O) / ((Al₂O₃ - K₂O) + CaO* + Na₂O)] × 100  (molar)
```

#### 1.2.6 CIW (Chemical Index of Weathering)
```
CIW = [Al₂O₃ / (Al₂O₃ + CaO* + Na₂O)] × 100  (molar)
```

#### 1.2.7 Fe Number (Fe*)
```
Fe* = FeOT / (FeOT + MgO)  (wt% or molar)
```

#### 1.2.8 ASI (Aluminum Saturation Index)
```
ASI = Al / (Ca - 1.67P + Na + K)  (molar)
```

### 1.3 TAS Classification Support

For igneous rock classification:
```
Total Alkalis = Na₂O + K₂O (wt%)
Silica = SiO₂ (wt%)

Note: Data should be normalized to 100% volatile-free before plotting
```

### 1.4 REE Normalization

#### Chondrite Values (McDonough & Sun 1995 - CI Chondrite)
| Element | Value (ppm) |
|---------|-------------|
| La | 0.237 |
| Ce | 0.613 |
| Pr | 0.0928 |
| Nd | 0.457 |
| Sm | 0.148 |
| Eu | 0.0563 |
| Gd | 0.199 |
| Tb | 0.0361 |
| Dy | 0.246 |
| Ho | 0.0546 |
| Er | 0.160 |
| Tm | 0.0247 |
| Yb | 0.161 |
| Lu | 0.0246 |
| Y | 1.57 |

#### Alternative: Anders & Grevesse (1989) × 1.36
| Element | Value (ppm) |
|---------|-------------|
| La | 0.3100 |
| Ce | 0.8080 |
| Pr | 0.1220 |
| Nd | 0.6000 |
| Sm | 0.2000 |
| Eu | 0.0760 |
| Gd | 0.2670 |
| Tb | 0.0493 |
| Dy | 0.3300 |
| Ho | 0.0755 |
| Er | 0.2160 |
| Tm | 0.0329 |
| Yb | 0.2200 |
| Lu | 0.0339 |

#### REE Ratios
```
(La/Yb)N = (La_sample / La_chondrite) / (Yb_sample / Yb_chondrite)
(La/Sm)N = LREE fractionation indicator
(Gd/Yb)N = HREE fractionation indicator
Eu/Eu* = Eu_N / sqrt(Sm_N × Gd_N)  // Europium anomaly
Ce/Ce* = Ce_N / sqrt(La_N × Pr_N)  // Cerium anomaly
```

### 1.5 Exploration Ratios

#### Base Metal Ratios
```
Cu/Zn ratio - lithogeochemical vectoring
Pb/Zn ratio - metal zonation indicator
Ag/Au ratio - deposit classification
Cu/(Cu+Zn) - VMS deposit indicator
```

#### Gold Pathfinder Ratios
```
As/Sb ratio
Au/Ag ratio
Au/As ratio (when Au detected)
Bi/Te ratio
```

#### Porphyry Indicators
```
Rb/Sr ratio - fractionation indicator
K/Rb ratio - magmatic evolution
Sr/Y ratio - adakite signature
Nb/Ta ratio
Zr/Hf ratio
```

### 1.6 Simple Arithmetic Operations

```
Sum: A + B + C + ...
Difference: A - B
Product: A × B
Ratio: A / B
Log transform: log10(A), ln(A)
Square root: sqrt(A)
Power: A^n
```

---

## 2. TECHNICAL ARCHITECTURE

### 2.1 Calculation Engine Structure

```typescript
// Core types
interface CalculationDefinition {
    id: string;
    name: string;
    category: CalculationCategory;
    description: string;
    formula: FormulaExpression;
    inputs: InputDefinition[];
    outputColumn: string;
    outputUnit: string;
    validationRules: ValidationRule[];
}

type CalculationCategory =
    | 'element-oxide'
    | 'oxide-element'
    | 'petrochemical-index'
    | 'weathering-index'
    | 'ree-normalization'
    | 'exploration-ratio'
    | 'custom';

interface InputDefinition {
    name: string;
    columnMatcher: ColumnMatcher;
    required: boolean;
    unit: 'wt%' | 'ppm' | 'ppb' | 'molar';
    defaultValue?: number;
}

interface ColumnMatcher {
    type: 'exact' | 'pattern' | 'alias' | 'manual';
    value: string | RegExp;
}

interface ValidationRule {
    type: 'range' | 'positive' | 'sum-check' | 'custom';
    params?: any;
    errorMessage: string;
    severity: 'error' | 'warning';
}
```

### 2.2 Formula Expression Engine

```typescript
// Safe expression evaluator (no eval())
interface FormulaExpression {
    type: 'constant' | 'variable' | 'operation' | 'function';
    value?: number | string;
    operator?: '+' | '-' | '*' | '/' | '^';
    function?: 'log10' | 'ln' | 'sqrt' | 'abs' | 'min' | 'max' | 'if';
    operands?: FormulaExpression[];
}

// Example: Mg# formula as expression tree
const mgNumberFormula: FormulaExpression = {
    type: 'operation',
    operator: '*',
    operands: [
        { type: 'constant', value: 100 },
        {
            type: 'operation',
            operator: '/',
            operands: [
                { type: 'variable', value: 'MgO_molar' },
                {
                    type: 'operation',
                    operator: '+',
                    operands: [
                        { type: 'variable', value: 'MgO_molar' },
                        { type: 'variable', value: 'FeO_molar' }
                    ]
                }
            ]
        }
    ]
};
```

### 2.3 Molecular Weight Constants

```typescript
const MOLECULAR_WEIGHTS: Record<string, number> = {
    // Elements
    H: 1.008, C: 12.011, N: 14.007, O: 15.999,
    Na: 22.990, Mg: 24.305, Al: 26.982, Si: 28.086,
    P: 30.974, S: 32.065, Cl: 35.453, K: 39.098,
    Ca: 40.078, Ti: 47.867, V: 50.942, Cr: 51.996,
    Mn: 54.938, Fe: 55.845, Co: 58.933, Ni: 58.693,
    Cu: 63.546, Zn: 65.380, Rb: 85.468, Sr: 87.620,
    Y: 88.906, Zr: 91.224, Nb: 92.906, Mo: 95.940,
    Ba: 137.327, La: 138.905, Ce: 140.116, Pb: 207.200,

    // Oxides
    SiO2: 60.084, TiO2: 79.866, Al2O3: 101.961,
    Fe2O3: 159.688, FeO: 71.844, Fe3O4: 231.533,
    MgO: 40.304, CaO: 56.077, Na2O: 61.979,
    K2O: 94.196, MnO: 70.937, P2O5: 141.943,
    Cr2O3: 151.990, NiO: 74.692, BaO: 153.326,
    ZrO2: 123.223, SO3: 80.064,
};
```

---

## 3. DATA HANDLING

### 3.1 Missing Value Handling

```typescript
interface MissingValueStrategy {
    type: 'skip' | 'zero' | 'detection-limit' | 'interpolate' | 'default';
    value?: number;
    detectionLimitColumn?: string;
}

// Detection limit handling
function handleBelowDetection(value: string | number): number | null {
    if (typeof value === 'string') {
        // Handle common detection limit notations
        if (value.startsWith('<')) {
            return parseFloat(value.substring(1)) / 2; // Half DL method
        }
        if (value === 'BDL' || value === 'ND' || value === '-') {
            return null;
        }
    }
    return typeof value === 'number' ? value : null;
}
```

### 3.2 Unit Conversions

```typescript
const UNIT_CONVERSIONS = {
    'ppm_to_wt%': 0.0001,
    'wt%_to_ppm': 10000,
    'ppb_to_ppm': 0.001,
    'ppm_to_ppb': 1000,
    '%_to_decimal': 0.01,
    'decimal_to_%': 100,
};
```

### 3.3 Validation Rules

```typescript
const VALIDATION_RULES = {
    majorOxideSum: {
        check: (data: Record<string, number>) => {
            const sum = ['SiO2', 'TiO2', 'Al2O3', 'Fe2O3', 'FeO', 'MgO',
                        'CaO', 'Na2O', 'K2O', 'MnO', 'P2O5']
                .reduce((acc, ox) => acc + (data[ox] || 0), 0);
            return sum >= 95 && sum <= 105;
        },
        warning: 'Major oxide sum outside 95-105% range'
    },
    positiveValues: {
        check: (value: number) => value >= 0,
        error: 'Negative concentration values are invalid'
    },
    mgNumberRange: {
        check: (value: number) => value >= 0 && value <= 100,
        error: 'Mg# must be between 0 and 100'
    }
};
```

---

## 4. USER INTERFACE DESIGN

### 4.1 Calculation Manager Component

```
┌─────────────────────────────────────────────────────────────────┐
│  Calculation Manager                                     [×]    │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐ ┌─────────────────────────────────────┐  │
│  │ Categories       │ │ Available Calculations              │  │
│  │ ───────────────  │ │ ─────────────────────────────────── │  │
│  │ ▼ Element-Oxide  │ │ ☐ Si → SiO₂                         │  │
│  │   • Si → SiO₂    │ │ ☐ Fe → Fe₂O₃                        │  │
│  │   • Fe → Fe₂O₃   │ │ ☐ Fe → FeO                          │  │
│  │   • Al → Al₂O₃   │ │ ☐ Ca → CaO                          │  │
│  │   • ...          │ │ ☐ Mg → MgO                          │  │
│  │ ▼ Oxide-Element  │ │                                     │  │
│  │ ▼ Petrochemical  │ │ [Select All] [Clear All]            │  │
│  │   • Mg#          │ └─────────────────────────────────────┘  │
│  │   • A/CNK        │                                          │
│  │   • A/NK         │ ┌─────────────────────────────────────┐  │
│  │   • Fe*          │ │ Configuration                       │  │
│  │ ▼ Weathering     │ │ ─────────────────────────────────── │  │
│  │   • CIA          │ │ Calculation: Mg# (Magnesium Number) │  │
│  │   • CIW          │ │                                     │  │
│  │   • PIA          │ │ Required Inputs:                    │  │
│  │ ▼ REE Normal.    │ │   MgO (wt%):  [SiO2_pct    ▼]      │  │
│  │   • Chondrite    │ │   FeOT (wt%): [Fe2O3_pct  ▼]       │  │
│  │   • PAAS         │ │               ☑ Convert Fe₂O₃ to FeO│  │
│  │ ▼ Exploration    │ │                                     │  │
│  │   • Cu/Zn        │ │ Output Column: [Mg_number    ]      │  │
│  │   • Rb/Sr        │ │                                     │  │
│  │ ▼ Custom         │ │ Missing Values: [Half DL     ▼]     │  │
│  │   + New Formula  │ │                                     │  │
│  └──────────────────┘ │ [Preview] [Add to Queue]            │  │
│                       └─────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│  Calculation Queue                                              │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ # │ Calculation     │ Output Column │ Status    │ Action  │ │
│  │───┼─────────────────┼───────────────┼───────────┼─────────│ │
│  │ 1 │ Mg#             │ Mg_number     │ Ready     │ [×]     │ │
│  │ 2 │ CIA             │ CIA_index     │ Ready     │ [×]     │ │
│  │ 3 │ La/Yb_N         │ LaYb_N        │ Warning ⚠ │ [×]     │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  [Execute All Calculations]        [Clear Queue]               │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Custom Formula Builder

```
┌─────────────────────────────────────────────────────────────────┐
│  Custom Formula Builder                                         │
├─────────────────────────────────────────────────────────────────┤
│  Formula Name: [Cu_Zn_Ratio                        ]           │
│                                                                 │
│  Formula Expression:                                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ {Cu_ppm} / {Zn_ppm}                                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Available Columns:        Operators:      Functions:           │
│  ┌───────────────┐        ┌─────────┐     ┌───────────┐        │
│  │ Cu_ppm        │        │ +  -    │     │ log10()   │        │
│  │ Zn_ppm        │        │ *  /    │     │ ln()      │        │
│  │ Pb_ppm        │        │ ^  ( )  │     │ sqrt()    │        │
│  │ Au_ppb        │        └─────────┘     │ abs()     │        │
│  │ SiO2_pct      │                        │ min()     │        │
│  │ ...           │                        │ max()     │        │
│  └───────────────┘                        │ if()      │        │
│  [Insert Column]                          └───────────┘        │
│                                           [Insert Function]     │
│                                                                 │
│  Preview (first 5 rows):                                        │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ Row │ Cu_ppm │ Zn_ppm │ Result                            │ │
│  │ 1   │ 150    │ 300    │ 0.50                              │ │
│  │ 2   │ 200    │ 180    │ 1.11                              │ │
│  │ 3   │ 85     │ 250    │ 0.34                              │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  Output Column: [Cu_Zn_Ratio        ]                          │
│  Description:   [Copper to zinc ratio for vectoring]           │
│                                                                 │
│  [Validate Formula]  [Save to Library]  [Execute]              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. IMPLEMENTATION PHASES

### Phase 1: Core Engine (Week 1-2)
1. Create `calculationStore.ts` with Zustand
2. Implement molecular weight constants and conversion factors
3. Build safe formula expression evaluator (no eval)
4. Create validation framework
5. Unit tests for all calculations

### Phase 2: Built-in Calculations (Week 2-3)
1. Element-oxide conversions (all standard pairs)
2. Petrochemical indices (Mg#, A/CNK, A/NK, Fe*)
3. Weathering indices (CIA, CIW, PIA)
4. REE normalization with multiple standards
5. Exploration ratios

### Phase 3: UI Components (Week 3-4)
1. CalculationManager main component
2. Category browser with search
3. Column mapping interface
4. Custom formula builder
5. Calculation queue with batch execution

### Phase 4: Integration (Week 4-5)
1. Integration with appStore for data persistence
2. Calculated column highlighting in DataView
3. Undo/redo for calculations
4. Export calculated columns
5. Save/load calculation templates

### Phase 5: Advanced Features (Week 5-6)
1. Column auto-detection for common names
2. Batch calculation profiles
3. Calculation dependency graphs
4. Error reporting and diagnostics
5. Documentation and help system

---

## 6. FILE STRUCTURE

```
frontend/src/
├── features/
│   └── calculations/
│       ├── CalculationManager.tsx      # Main UI component
│       ├── CategoryBrowser.tsx         # Left panel category tree
│       ├── CalculationConfig.tsx       # Right panel configuration
│       ├── CustomFormulaBuilder.tsx    # Custom formula UI
│       ├── CalculationQueue.tsx        # Queue management
│       └── CalculationPreview.tsx      # Result preview
├── store/
│   └── calculationStore.ts             # Zustand store
├── utils/
│   └── calculations/
│       ├── constants.ts                # Molecular weights, factors
│       ├── elementOxide.ts             # Conversion functions
│       ├── petrochemical.ts            # Index calculations
│       ├── weathering.ts               # Weathering indices
│       ├── reeNormalization.ts         # REE functions
│       ├── explorationRatios.ts        # Pathfinder ratios
│       ├── formulaParser.ts            # Safe expression parser
│       ├── formulaEvaluator.ts         # Expression tree evaluator
│       └── validation.ts               # Data validation
└── types/
    └── calculations.ts                 # TypeScript interfaces
```

---

## 7. TESTING STRATEGY

### 7.1 Unit Tests
- All conversion factors verified against published values
- Edge cases: zero, negative, null, undefined inputs
- Formula parser with complex expressions
- Validation rules

### 7.2 Integration Tests
- Full calculation workflow
- Column mapping with various naming conventions
- Batch calculation execution
- Data persistence

### 7.3 Reference Data Tests
- Compare calculated values against published examples
- Cross-reference with established geochemistry software (ioGAS, GCDkit)

---

## 8. REFERENCES

- [JCU Element-to-Oxide Conversion Factors](https://www.jcu.edu.au/advanced-analytical-centre/resources/element-to-stoichiometric-oxide-conversion-factors)
- [Washington University Element-Oxide Conversions](https://meteorites.wustl.edu/goodstuff/oxides.htm)
- [Chemostratigraphy - CIA Index](https://chemostratigraphy.com/chemical-index-of-alteration-nesbitt-young-1982/)
- [Washington University REE Chondrite Values](https://meteorites.wustl.edu/goodstuff/ree-chon.htm)
- [TAS Classification Wikipedia](https://en.wikipedia.org/wiki/TAS_classification)
- [MDPI - Indicator Minerals and Pathfinder Elements](https://www.mdpi.com/2075-163X/12/4/394)
- McDonough, W.F. & Sun, S.-S. (1995) Chemical Geology
- Nesbitt, H.W. & Young, G.M. (1982) Nature
- Le Bas, M.J. et al. (1986) Journal of Petrology

---

## 9. POTENTIAL LIBRARIES

### Recommended: Custom Implementation
For geochemistry-specific calculations, a custom implementation is recommended because:
1. Geochemistry formulas are domain-specific and straightforward
2. No external dependencies = smaller bundle, no version conflicts
3. Full control over precision and rounding
4. Easier to audit and validate

### Optional Supporting Libraries
- **mathjs** (npm): For complex custom formulas if needed
- **decimal.js** (npm): For high-precision decimal arithmetic
- **molecular-formula** (npm): For parsing chemical formulas if extending functionality

---

## 10. SECURITY CONSIDERATIONS

1. **No eval()**: Use AST-based expression evaluation
2. **Input sanitization**: Validate all numeric inputs
3. **Column name validation**: Prevent injection in column references
4. **Rate limiting**: Prevent DoS via complex formulas
5. **Memory limits**: Cap array sizes for calculations
