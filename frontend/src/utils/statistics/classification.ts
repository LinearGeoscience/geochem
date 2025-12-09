/**
 * Classification Methods
 * Decision Trees, Random Forests, and Logistic Regression
 * Based on GeoCoDA methodology for logratio-based classification
 */

import {
    ClassificationMethod,
    ClassificationConfig,
    ClassificationResult,
    ConfusionMatrix,
    DecisionTreeNode,
} from '../../types/statistics';

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
}

function std(values: number[]): number {
    if (values.length <= 1) return 0;
    const m = mean(values);
    return Math.sqrt(values.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / (values.length - 1));
}


function shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function stratifiedSplit(
    targets: string[],
    trainFraction: number
): { trainIndices: number[]; testIndices: number[] } {
    const classSamples: Record<string, number[]> = {};

    for (let i = 0; i < targets.length; i++) {
        const cls = targets[i];
        if (!classSamples[cls]) classSamples[cls] = [];
        classSamples[cls].push(i);
    }

    const trainIndices: number[] = [];
    const testIndices: number[] = [];

    for (const indices of Object.values(classSamples)) {
        const shuffled = shuffleArray(indices);
        const nTrain = Math.max(1, Math.floor(shuffled.length * trainFraction));
        trainIndices.push(...shuffled.slice(0, nTrain));
        testIndices.push(...shuffled.slice(nTrain));
    }

    return { trainIndices, testIndices };
}

// =============================================================================
// LOGRATIO TRANSFORMATIONS
// =============================================================================

interface LogratioFeature {
    name: string;
    numerator: string;
    denominator: string;
    values: number[];
}

function generatePLRFeatures(
    data: Record<string, any>[],
    columns: string[]
): LogratioFeature[] {
    const features: LogratioFeature[] = [];

    for (let i = 0; i < columns.length; i++) {
        for (let j = i + 1; j < columns.length; j++) {
            const numerator = columns[i];
            const denominator = columns[j];
            const values: number[] = [];

            for (const row of data) {
                const num = parseFloat(row[numerator]);
                const den = parseFloat(row[denominator]);
                if (!isNaN(num) && !isNaN(den) && num > 0 && den > 0) {
                    values.push(Math.log(num / den));
                } else {
                    values.push(NaN);
                }
            }

            features.push({
                name: `log(${numerator}/${denominator})`,
                numerator,
                denominator,
                values,
            });
        }
    }

    return features;
}

function generateALRFeatures(
    data: Record<string, any>[],
    columns: string[],
    reference: string
): LogratioFeature[] {
    const features: LogratioFeature[] = [];

    for (const col of columns) {
        if (col === reference) continue;

        const values: number[] = [];
        for (const row of data) {
            const num = parseFloat(row[col]);
            const den = parseFloat(row[reference]);
            if (!isNaN(num) && !isNaN(den) && num > 0 && den > 0) {
                values.push(Math.log(num / den));
            } else {
                values.push(NaN);
            }
        }

        features.push({
            name: `log(${col}/${reference})`,
            numerator: col,
            denominator: reference,
            values,
        });
    }

    return features;
}

// =============================================================================
// CONFUSION MATRIX
// =============================================================================

function calculateConfusionMatrix(
    predictions: string[],
    actual: string[],
    classes: string[]
): ConfusionMatrix {
    const k = classes.length;
    const matrix: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));

    for (let i = 0; i < predictions.length; i++) {
        const predIdx = classes.indexOf(predictions[i]);
        const actualIdx = classes.indexOf(actual[i]);
        if (predIdx >= 0 && actualIdx >= 0) {
            matrix[actualIdx][predIdx]++;
        }
    }

    // Calculate metrics
    const precision: Record<string, number> = {};
    const recall: Record<string, number> = {};
    const f1Score: Record<string, number> = {};
    const support: Record<string, number> = {};

    let totalCorrect = 0;
    let totalSamples = 0;

    for (let i = 0; i < k; i++) {
        const cls = classes[i];
        const tp = matrix[i][i];
        const fp = matrix.reduce((sum, row, j) => sum + (j !== i ? row[i] : 0), 0);
        const fn = matrix[i].reduce((sum, v, j) => sum + (j !== i ? v : 0), 0);
        const total = matrix[i].reduce((a, b) => a + b, 0);

        precision[cls] = tp + fp > 0 ? tp / (tp + fp) : 0;
        recall[cls] = tp + fn > 0 ? tp / (tp + fn) : 0;
        f1Score[cls] = precision[cls] + recall[cls] > 0
            ? 2 * precision[cls] * recall[cls] / (precision[cls] + recall[cls])
            : 0;
        support[cls] = total;

        totalCorrect += tp;
        totalSamples += total;
    }

    const accuracy = totalSamples > 0 ? totalCorrect / totalSamples : 0;

    // Macro averages
    const macroAvg = {
        precision: mean(Object.values(precision)),
        recall: mean(Object.values(recall)),
        f1Score: mean(Object.values(f1Score)),
    };

    // Weighted averages
    const weights = classes.map(cls => support[cls] / totalSamples);
    const weightedAvg = {
        precision: classes.reduce((sum, cls, i) => sum + precision[cls] * weights[i], 0),
        recall: classes.reduce((sum, cls, i) => sum + recall[cls] * weights[i], 0),
        f1Score: classes.reduce((sum, cls, i) => sum + f1Score[cls] * weights[i], 0),
    };

    return {
        matrix,
        classes,
        accuracy,
        precision,
        recall,
        f1Score,
        support,
        macroAvg,
        weightedAvg,
    };
}

// =============================================================================
// DECISION TREE
// =============================================================================

interface TreeSample {
    features: number[];
    target: string;
    weight: number;
}

function giniImpurity(samples: TreeSample[]): number {
    if (samples.length === 0) return 0;

    const totalWeight = samples.reduce((sum, s) => sum + s.weight, 0);
    if (totalWeight === 0) return 0;

    const classCounts: Record<string, number> = {};
    for (const sample of samples) {
        classCounts[sample.target] = (classCounts[sample.target] || 0) + sample.weight;
    }

    let impurity = 1;
    for (const count of Object.values(classCounts)) {
        const p = count / totalWeight;
        impurity -= p * p;
    }

    return impurity;
}

function findBestSplit(
    samples: TreeSample[],
    featureIndices: number[],
    minSamplesLeaf: number
): { featureIndex: number; threshold: number; gain: number } | null {
    const currentImpurity = giniImpurity(samples);
    let bestGain = 0;
    let bestFeature = -1;
    let bestThreshold = 0;

    for (const featureIndex of featureIndices) {
        // Get unique sorted values for this feature
        const values = [...new Set(samples.map(s => s.features[featureIndex]).filter(v => !isNaN(v)))].sort((a, b) => a - b);

        for (let i = 0; i < values.length - 1; i++) {
            const threshold = (values[i] + values[i + 1]) / 2;

            const leftSamples = samples.filter(s => s.features[featureIndex] <= threshold);
            const rightSamples = samples.filter(s => s.features[featureIndex] > threshold);

            if (leftSamples.length < minSamplesLeaf || rightSamples.length < minSamplesLeaf) {
                continue;
            }

            const leftWeight = leftSamples.reduce((sum, s) => sum + s.weight, 0);
            const rightWeight = rightSamples.reduce((sum, s) => sum + s.weight, 0);
            const totalWeight = leftWeight + rightWeight;

            if (totalWeight === 0) continue;

            const leftImpurity = giniImpurity(leftSamples);
            const rightImpurity = giniImpurity(rightSamples);

            const weightedImpurity = (leftWeight / totalWeight) * leftImpurity +
                (rightWeight / totalWeight) * rightImpurity;
            const gain = currentImpurity - weightedImpurity;

            if (gain > bestGain) {
                bestGain = gain;
                bestFeature = featureIndex;
                bestThreshold = threshold;
            }
        }
    }

    if (bestFeature === -1) return null;

    return { featureIndex: bestFeature, threshold: bestThreshold, gain: bestGain };
}

function buildDecisionTree(
    samples: TreeSample[],
    featureNames: string[],
    maxDepth: number,
    minSamplesLeaf: number,
    minSamplesSplit: number,
    depth: number = 0
): DecisionTreeNode {
    const nodeId = Math.floor(Math.random() * 1000000);

    // Count classes
    const classCounts: Record<string, number> = {};
    for (const sample of samples) {
        classCounts[sample.target] = (classCounts[sample.target] || 0) + sample.weight;
    }

    const prediction = Object.entries(classCounts)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || '';

    const impurity = giniImpurity(samples);

    // Stopping conditions
    if (
        depth >= maxDepth ||
        samples.length < minSamplesSplit ||
        Object.keys(classCounts).length <= 1 ||
        impurity < 0.01
    ) {
        return {
            id: nodeId,
            isLeaf: true,
            prediction,
            samples: samples.length,
            classCounts,
            impurity,
        };
    }

    // Find best split
    const featureIndices = featureNames.map((_, i) => i);
    const split = findBestSplit(samples, featureIndices, minSamplesLeaf);

    if (!split || split.gain < 0.001) {
        return {
            id: nodeId,
            isLeaf: true,
            prediction,
            samples: samples.length,
            classCounts,
            impurity,
        };
    }

    // Split samples
    const leftSamples = samples.filter(s => s.features[split.featureIndex] <= split.threshold);
    const rightSamples = samples.filter(s => s.features[split.featureIndex] > split.threshold);

    return {
        id: nodeId,
        isLeaf: false,
        feature: featureNames[split.featureIndex],
        threshold: split.threshold,
        operator: '<=',
        left: buildDecisionTree(leftSamples, featureNames, maxDepth, minSamplesLeaf, minSamplesSplit, depth + 1),
        right: buildDecisionTree(rightSamples, featureNames, maxDepth, minSamplesLeaf, minSamplesSplit, depth + 1),
        samples: samples.length,
        classCounts,
        impurity,
    };
}

function predictWithTree(tree: DecisionTreeNode, features: number[], featureNames: string[]): string {
    if (tree.isLeaf) {
        return tree.prediction || '';
    }

    const featureIndex = featureNames.indexOf(tree.feature || '');
    if (featureIndex < 0) return tree.prediction || '';

    const value = features[featureIndex];
    if (value <= (tree.threshold || 0)) {
        return tree.left ? predictWithTree(tree.left, features, featureNames) : tree.prediction || '';
    } else {
        return tree.right ? predictWithTree(tree.right, features, featureNames) : tree.prediction || '';
    }
}

function extractDecisionRules(tree: DecisionTreeNode, path: string[] = []): string[] {
    if (tree.isLeaf) {
        const rule = path.length > 0
            ? `IF ${path.join(' AND ')} THEN predict "${tree.prediction}" (n=${tree.samples})`
            : `predict "${tree.prediction}" (n=${tree.samples})`;
        return [rule];
    }

    const rules: string[] = [];

    if (tree.left) {
        rules.push(...extractDecisionRules(tree.left, [...path, `${tree.feature} <= ${tree.threshold?.toFixed(3)}`]));
    }
    if (tree.right) {
        rules.push(...extractDecisionRules(tree.right, [...path, `${tree.feature} > ${tree.threshold?.toFixed(3)}`]));
    }

    return rules;
}

// =============================================================================
// RANDOM FOREST
// =============================================================================

interface RandomForestTree {
    tree: DecisionTreeNode;
    featureNames: string[];
    oobIndices: number[];
}

function buildRandomForest(
    samples: TreeSample[],
    featureNames: string[],
    nEstimators: number,
    maxDepth: number,
    minSamplesLeaf: number,
    maxFeaturesFraction: number
): RandomForestTree[] {
    const forest: RandomForestTree[] = [];
    const n = samples.length;

    for (let t = 0; t < nEstimators; t++) {
        // Bootstrap sampling
        const bootstrapIndices: number[] = [];
        const usedIndices = new Set<number>();

        for (let i = 0; i < n; i++) {
            const idx = Math.floor(Math.random() * n);
            bootstrapIndices.push(idx);
            usedIndices.add(idx);
        }

        const bootstrapSamples = bootstrapIndices.map(i => samples[i]);

        // Out-of-bag indices
        const oobIndices = Array.from({ length: n }, (_, i) => i).filter(i => !usedIndices.has(i));

        // Random feature subset
        const nFeatures = Math.max(1, Math.floor(featureNames.length * maxFeaturesFraction));
        const shuffledFeatures = shuffleArray(featureNames.map((_, i) => i));
        const selectedFeatureIndices = shuffledFeatures.slice(0, nFeatures);
        const selectedFeatureNames = selectedFeatureIndices.map(i => featureNames[i]);

        // Build tree on subset
        const tree = buildDecisionTree(
            bootstrapSamples,
            selectedFeatureNames,
            maxDepth,
            minSamplesLeaf,
            2
        );

        forest.push({ tree, featureNames: selectedFeatureNames, oobIndices });
    }

    return forest;
}

function predictWithForest(
    forest: RandomForestTree[],
    features: number[],
    allFeatureNames: string[]
): { prediction: string; votes: Record<string, number> } {
    const votes: Record<string, number> = {};

    for (const { tree, featureNames } of forest) {
        // Map features to tree's feature subset
        const treeFeatures = featureNames.map(name => {
            const idx = allFeatureNames.indexOf(name);
            return idx >= 0 ? features[idx] : NaN;
        });

        const pred = predictWithTree(tree, treeFeatures, featureNames);
        votes[pred] = (votes[pred] || 0) + 1;
    }

    const prediction = Object.entries(votes)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || '';

    return { prediction, votes };
}

function calculateFeatureImportance(
    forest: RandomForestTree[],
    allFeatureNames: string[]
): { feature: string; importance: number; stdDev: number }[] {
    const importances: Record<string, number[]> = {};

    for (const name of allFeatureNames) {
        importances[name] = [];
    }

    for (const { tree } of forest) {
        const treeImportance = calculateTreeImportance(tree);
        for (const [feature, importance] of Object.entries(treeImportance)) {
            if (importances[feature]) {
                importances[feature].push(importance);
            }
        }
    }

    const result = allFeatureNames.map(feature => ({
        feature,
        importance: mean(importances[feature] || [0]),
        stdDev: std(importances[feature] || [0]),
    }));

    // Normalize
    const totalImportance = result.reduce((sum, r) => sum + r.importance, 0);
    if (totalImportance > 0) {
        for (const r of result) {
            r.importance /= totalImportance;
        }
    }

    return result.sort((a, b) => b.importance - a.importance);
}

function calculateTreeImportance(tree: DecisionTreeNode): Record<string, number> {
    const importance: Record<string, number> = {};

    function traverse(node: DecisionTreeNode, samples: number) {
        if (node.isLeaf || !node.feature) return;

        const leftSamples = node.left?.samples || 0;
        const rightSamples = node.right?.samples || 0;
        const impurityDecrease = (node.impurity || 0) * samples -
            (node.left?.impurity || 0) * leftSamples -
            (node.right?.impurity || 0) * rightSamples;

        importance[node.feature] = (importance[node.feature] || 0) + impurityDecrease;

        if (node.left) traverse(node.left, leftSamples);
        if (node.right) traverse(node.right, rightSamples);
    }

    traverse(tree, tree.samples);
    return importance;
}

// =============================================================================
// LOGISTIC REGRESSION
// =============================================================================


function softmax(scores: number[]): number[] {
    const maxScore = Math.max(...scores);
    const exps = scores.map(s => Math.exp(s - maxScore));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map(e => e / sum);
}

interface LogisticModel {
    classes: string[];
    coefficients: { class: string; intercept: number; features: Record<string, number> }[];
    featureNames: string[];
}

function trainLogisticRegression(
    samples: TreeSample[],
    featureNames: string[],
    classes: string[],
    maxIter: number = 100,
    learningRate: number = 0.1
): LogisticModel {
    const k = classes.length;
    const p = featureNames.length;

    // Initialize coefficients
    const coefficients: { class: string; intercept: number; features: Record<string, number> }[] = [];

    for (const cls of classes) {
        const features: Record<string, number> = {};
        for (const name of featureNames) {
            features[name] = 0;
        }
        coefficients.push({ class: cls, intercept: 0, features });
    }

    // Gradient descent for multinomial logistic regression
    for (let iter = 0; iter < maxIter; iter++) {
        for (const sample of samples) {
            // Calculate probabilities
            const scores = coefficients.map(coef => {
                let score = coef.intercept;
                for (let j = 0; j < p; j++) {
                    if (!isNaN(sample.features[j])) {
                        score += coef.features[featureNames[j]] * sample.features[j];
                    }
                }
                return score;
            });

            const probs = softmax(scores);

            // Update coefficients
            for (let c = 0; c < k; c++) {
                const isTarget = classes[c] === sample.target ? 1 : 0;
                const error = (isTarget - probs[c]) * sample.weight;

                coefficients[c].intercept += learningRate * error;
                for (let j = 0; j < p; j++) {
                    if (!isNaN(sample.features[j])) {
                        coefficients[c].features[featureNames[j]] += learningRate * error * sample.features[j];
                    }
                }
            }
        }

        // Decrease learning rate
        learningRate *= 0.99;
    }

    return { classes, coefficients, featureNames };
}

function predictWithLogistic(
    model: LogisticModel,
    features: number[]
): { prediction: string; probabilities: Record<string, number> } {
    const scores = model.coefficients.map(coef => {
        let score = coef.intercept;
        for (let j = 0; j < model.featureNames.length; j++) {
            if (!isNaN(features[j])) {
                score += coef.features[model.featureNames[j]] * features[j];
            }
        }
        return score;
    });

    const probs = softmax(scores);
    const probabilities: Record<string, number> = {};
    for (let i = 0; i < model.classes.length; i++) {
        probabilities[model.classes[i]] = probs[i];
    }

    const maxIdx = probs.indexOf(Math.max(...probs));
    return { prediction: model.classes[maxIdx], probabilities };
}

// =============================================================================
// MAIN CLASSIFICATION FUNCTION
// =============================================================================

export function performClassification(
    data: Record<string, any>[],
    config: ClassificationConfig
): ClassificationResult {
    const {
        method,
        targetColumn,
        featureColumns,
        useLogratios = false,
        logratioType = 'plr',
        alrReference,
        maxDepth = 10,
        minSamplesLeaf = 5,
        minSamplesSplit = 10,
        nEstimators = 100,
        maxFeaturesFraction = 0.5,
        crossValidationFolds: _crossValidationFolds = 5,
        trainTestSplit = 0.7,
        stratify = true,
    } = config;
    void _crossValidationFolds; // Reserved for future cross-validation implementation

    // Extract targets
    const targets: string[] = [];
    const validIndices: number[] = [];

    for (let i = 0; i < data.length; i++) {
        const target = data[i][targetColumn];
        if (target !== null && target !== undefined && target !== '') {
            targets.push(String(target));
            validIndices.push(i);
        }
    }

    if (targets.length < 10) {
        return createEmptyClassificationResult(method, targetColumn, data.length);
    }

    const classes = [...new Set(targets)].sort();

    // Generate features
    let featureNames: string[];
    let featureMatrix: number[][];

    if (useLogratios) {
        let logratioFeatures: LogratioFeature[];

        if (logratioType === 'alr' && alrReference) {
            logratioFeatures = generateALRFeatures(data, featureColumns, alrReference);
        } else {
            logratioFeatures = generatePLRFeatures(data, featureColumns);
        }

        featureNames = logratioFeatures.map(f => f.name);
        featureMatrix = validIndices.map(idx =>
            logratioFeatures.map(f => f.values[idx])
        );
    } else {
        featureNames = featureColumns;
        featureMatrix = validIndices.map(idx =>
            featureColumns.map(col => {
                const val = parseFloat(data[idx][col]);
                return isNaN(val) ? 0 : val;
            })
        );
    }

    // Train/test split
    const validTargets = validIndices.map((_, i) => targets[i]);
    const { trainIndices, testIndices } = stratify
        ? stratifiedSplit(validTargets, trainTestSplit)
        : { trainIndices: validIndices.slice(0, Math.floor(validIndices.length * trainTestSplit)).map((_, i) => i), testIndices: validIndices.slice(Math.floor(validIndices.length * trainTestSplit)).map((_, i) => i) };

    // Create samples
    const trainSamples: TreeSample[] = trainIndices.map(i => ({
        features: featureMatrix[i],
        target: validTargets[i],
        weight: 1,
    }));

    const testSamples: TreeSample[] = testIndices.map(i => ({
        features: featureMatrix[i],
        target: validTargets[i],
        weight: 1,
    }));

    // Train model and predict based on method
    let trainPredictions: string[] = [];
    let testPredictions: string[] = [];
    let decisionTree: DecisionTreeNode | undefined;
    let decisionRules: string[] | undefined;
    let featureImportance: ClassificationResult['featureImportance'];
    let coefficients: ClassificationResult['coefficients'];
    let oobAccuracy: number | undefined;

    switch (method) {
        case 'decision-tree':
            decisionTree = buildDecisionTree(trainSamples, featureNames, maxDepth, minSamplesLeaf, minSamplesSplit);
            decisionRules = extractDecisionRules(decisionTree);
            trainPredictions = trainSamples.map(s => predictWithTree(decisionTree!, s.features, featureNames));
            testPredictions = testSamples.map(s => predictWithTree(decisionTree!, s.features, featureNames));
            featureImportance = calculateFeatureImportance([{ tree: decisionTree, featureNames, oobIndices: [] }], featureNames);
            break;

        case 'random-forest':
            const forest = buildRandomForest(trainSamples, featureNames, nEstimators, maxDepth, minSamplesLeaf, maxFeaturesFraction);
            trainPredictions = trainSamples.map(s => predictWithForest(forest, s.features, featureNames).prediction);
            testPredictions = testSamples.map(s => predictWithForest(forest, s.features, featureNames).prediction);
            featureImportance = calculateFeatureImportance(forest, featureNames);

            // OOB accuracy
            const oobPredictions: { idx: number; votes: Record<string, number> }[] = [];
            for (const { tree, featureNames: treeFeatures, oobIndices } of forest) {
                for (const idx of oobIndices) {
                    const features = treeFeatures.map(name => {
                        const i = featureNames.indexOf(name);
                        return i >= 0 ? featureMatrix[idx][i] : NaN;
                    });
                    const pred = predictWithTree(tree, features, treeFeatures);

                    let existing = oobPredictions.find(p => p.idx === idx);
                    if (!existing) {
                        existing = { idx, votes: {} };
                        oobPredictions.push(existing);
                    }
                    existing.votes[pred] = (existing.votes[pred] || 0) + 1;
                }
            }

            let oobCorrect = 0;
            for (const { idx, votes } of oobPredictions) {
                const pred = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0];
                if (pred === validTargets[idx]) oobCorrect++;
            }
            oobAccuracy = oobPredictions.length > 0 ? oobCorrect / oobPredictions.length : undefined;
            break;

        case 'logistic-regression':
        case 'multinomial-logistic':
            const logisticModel = trainLogisticRegression(trainSamples, featureNames, classes);
            trainPredictions = trainSamples.map(s => predictWithLogistic(logisticModel, s.features).prediction);
            testPredictions = testSamples.map(s => predictWithLogistic(logisticModel, s.features).prediction);
            coefficients = logisticModel.coefficients;

            // Feature importance from coefficients
            const avgCoefMagnitude: Record<string, number> = {};
            for (const name of featureNames) {
                avgCoefMagnitude[name] = mean(coefficients.map(c => Math.abs(c.features[name])));
            }
            const totalMagnitude = Object.values(avgCoefMagnitude).reduce((a, b) => a + b, 0);
            featureImportance = featureNames.map(name => ({
                feature: name,
                importance: totalMagnitude > 0 ? avgCoefMagnitude[name] / totalMagnitude : 0,
            })).sort((a, b) => b.importance - a.importance);
            break;

        default:
            trainPredictions = trainSamples.map(() => classes[0]);
            testPredictions = testSamples.map(() => classes[0]);
    }

    // Calculate confusion matrices
    const trainActual = trainSamples.map(s => s.target);
    const testActual = testSamples.map(s => s.target);

    const trainConfusionMatrix = calculateConfusionMatrix(trainPredictions, trainActual, classes);
    const testConfusionMatrix = calculateConfusionMatrix(testPredictions, testActual, classes);

    // Map predictions back to full data
    const predictionsFull: (string | null)[] = new Array(data.length).fill(null);
    for (let i = 0; i < validIndices.length; i++) {
        const origIdx = validIndices[i];
        if (trainIndices.includes(i)) {
            predictionsFull[origIdx] = trainPredictions[trainIndices.indexOf(i)];
        } else if (testIndices.includes(i)) {
            predictionsFull[origIdx] = testPredictions[testIndices.indexOf(i)];
        }
    }

    // Selected logratios
    let selectedLogratios: ClassificationResult['selectedLogratios'];
    if (useLogratios && featureImportance) {
        selectedLogratios = featureImportance.slice(0, 10).map(fi => {
            const match = fi.feature.match(/log\((.+)\/(.+)\)/);
            return {
                numerator: match?.[1] || '',
                denominator: match?.[2] || '',
                importance: fi.importance,
            };
        });
    }

    return {
        method,
        targetColumn,
        classes,
        predictions: predictionsFull,
        trainConfusionMatrix,
        testConfusionMatrix,
        oobAccuracy,
        featureImportance,
        selectedFeatures: featureImportance?.slice(0, 10).map(fi => fi.feature),
        selectedLogratios,
        coefficients,
        decisionTree,
        decisionRules,
    };
}

function createEmptyClassificationResult(
    method: ClassificationMethod,
    targetColumn: string,
    n: number
): ClassificationResult {
    return {
        method,
        targetColumn,
        classes: [],
        predictions: new Array(n).fill(null),
    };
}

// =============================================================================
// CROSS-VALIDATION
// =============================================================================

export function crossValidate(
    data: Record<string, any>[],
    config: ClassificationConfig,
    nFolds: number = 5
): { accuracy: number; stdDev: number; foldAccuracies: number[] } {
    const targets = data
        .map(d => d[config.targetColumn])
        .filter(t => t !== null && t !== undefined);

    const indices = Array.from({ length: targets.length }, (_, i) => i);
    const shuffled = shuffleArray(indices);

    const foldSize = Math.floor(shuffled.length / nFolds);
    const foldAccuracies: number[] = [];

    for (let fold = 0; fold < nFolds; fold++) {
        const testStart = fold * foldSize;
        const testEnd = fold === nFolds - 1 ? shuffled.length : (fold + 1) * foldSize;
        const testIndicesSet = new Set(shuffled.slice(testStart, testEnd));

        const trainData = data.filter((_, i) => !testIndicesSet.has(i));
        const testData = data.filter((_, i) => testIndicesSet.has(i));

        const result = performClassification(trainData, { ...config, trainTestSplit: 1.0 });

        // Evaluate on test data
        let correct = 0;
        let total = 0;

        for (let i = 0; i < testData.length; i++) {
            const actual = testData[i][config.targetColumn];
            if (actual === null || actual === undefined) continue;

            // Simple prediction using trained model
            const pred = result.predictions[i];
            if (pred === String(actual)) correct++;
            total++;
        }

        foldAccuracies.push(total > 0 ? correct / total : 0);
    }

    return {
        accuracy: mean(foldAccuracies),
        stdDev: std(foldAccuracies),
        foldAccuracies,
    };
}
