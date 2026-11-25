"""Supervised models scored with honest cross-validation.

Neighbouring samples down a hole are alike, so a random train/test split
lets a model "see" the test samples through their neighbours and flatters
it. Here every model is scored only on samples it never trained on, with
the test samples' neighbours also held back:

- ``hole``: leave whole holes (or other groups) out, one fold per group.
- ``block``: contiguous blocks of ``block_length`` samples in sequence
  order, with ``buffer`` samples either side removed from training,
  repeated for ``repeats`` block offsets; the out-of-fold scores of each
  repeat are converted to ranks (0-1) and averaged.

Models: elastic-net logistic regression (standardised features), random
forest, and gradient-boosted trees (XGBoost) with optional monotone
constraints. The training-data score is always reported beside the
cross-validated one: a large gap means the model memorised the samples.

scikit-learn and xgboost are optional dependencies (requirements-ml.txt);
``available_models`` says which can run.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Sequence

import numpy as np


def available_models() -> Dict[str, bool]:
    out = {"logistic": False, "random_forest": False, "xgboost": False}
    try:
        import sklearn  # noqa: F401
        out["logistic"] = out["random_forest"] = True
    except ImportError:
        pass
    try:
        import xgboost  # noqa: F401
        out["xgboost"] = True
    except ImportError:
        pass
    return out


@dataclass
class ModelSpec:
    kind: str                      # 'logistic' | 'random_forest' | 'xgboost'
    name: str = ""
    features: Optional[List[str]] = None   # None = all features
    monotone: Optional[Dict[str, int]] = None  # feature -> +1 / -1 / 0 (xgboost)
    depth: int = 2
    n_trees: int = 200
    learning_rate: float = 0.05
    l1_ratio: float = 0.5
    C: float = 1.0


@dataclass
class CvSpec:
    kind: str = "block"            # 'block' | 'hole'
    block_length: int = 12
    buffer: int = 2
    repeats: int = 10


def auc(y: np.ndarray, s: np.ndarray) -> float:
    """Mann-Whitney AUC with average ranks for ties; NaN if one class is empty."""
    y = np.asarray(y).astype(bool)
    npos, nneg = int(y.sum()), int((~y).sum())
    if npos == 0 or nneg == 0:
        return float("nan")
    order = np.argsort(s, kind="mergesort")
    ranks = np.empty(len(s))
    sv = np.asarray(s)[order]
    i = 0
    while i < len(sv):
        j = i
        while j + 1 < len(sv) and sv[j + 1] == sv[i]:
            j += 1
        ranks[order[i:j + 1]] = (i + j + 2) / 2.0
        i = j + 1
    return float((ranks[y].sum() - npos * (npos + 1) / 2) / (npos * nneg))


def _rank_pct(v: np.ndarray) -> np.ndarray:
    order = np.argsort(v, kind="mergesort")
    r = np.empty(len(v))
    sv = v[order]
    i = 0
    while i < len(sv):
        j = i
        while j + 1 < len(sv) and sv[j + 1] == sv[i]:
            j += 1
        r[order[i:j + 1]] = (i + j + 2) / 2.0
        i = j + 1
    return r / len(v)


def make_model(spec: ModelSpec, y_train: np.ndarray, feature_names: Sequence[str], seed: int):
    if spec.kind == "logistic":
        from sklearn.linear_model import LogisticRegression
        from sklearn.pipeline import make_pipeline
        from sklearn.preprocessing import StandardScaler
        return make_pipeline(StandardScaler(), LogisticRegression(
            penalty="elasticnet", solver="saga", l1_ratio=spec.l1_ratio, C=spec.C,
            class_weight="balanced", max_iter=5000, random_state=seed))
    if spec.kind == "random_forest":
        from sklearn.ensemble import RandomForestClassifier
        return RandomForestClassifier(n_estimators=max(50, spec.n_trees), max_depth=spec.depth or None,
                                      min_samples_leaf=3, class_weight="balanced", random_state=seed, n_jobs=-1)
    if spec.kind == "xgboost":
        from xgboost import XGBClassifier
        pos = max(int(y_train.sum()), 1)
        kw = dict(n_estimators=spec.n_trees, max_depth=spec.depth, learning_rate=spec.learning_rate,
                  subsample=0.8, colsample_bytree=0.8, min_child_weight=3, reg_lambda=1.0,
                  scale_pos_weight=float((y_train == 0).sum() / pos), eval_metric="auc",
                  random_state=seed, n_jobs=4, verbosity=0)
        if spec.monotone:
            kw["monotone_constraints"] = "(" + ",".join(str(int(spec.monotone.get(f, 0))) for f in feature_names) + ")"
        return XGBClassifier(**kw)
    raise ValueError(f"Unknown model kind: {spec.kind}")


def _fit_predict(spec: ModelSpec, names: Sequence[str], seed: int) -> Callable[[np.ndarray, np.ndarray, np.ndarray], np.ndarray]:
    def fp(xa: np.ndarray, ya: np.ndarray, xb: np.ndarray) -> np.ndarray:
        if ya.sum() < 3 or ya.sum() == len(ya):
            return np.zeros(len(xb))
        return make_model(spec, ya, names, seed).fit(xa, ya).predict_proba(xb)[:, 1]
    return fp


def out_of_fold(fit_predict, X: np.ndarray, y: np.ndarray, cv: CvSpec, groups: Optional[np.ndarray]) -> np.ndarray:
    """Out-of-fold scores (rows already in sequence order)."""
    n = len(y)
    if cv.kind == "hole":
        if groups is None:
            raise ValueError("Leave-hole-out needs a hole column")
        oof = np.zeros(n)
        for g in np.unique(groups):
            te = groups == g
            oof[te] = fit_predict(X[~te], y[~te], X[te])
        return oof
    L = max(2, int(cv.block_length))
    reps = max(1, int(cv.repeats))
    out = np.zeros(n)
    for r in range(reps):
        grp = (np.arange(n) + (r * L) // reps) // L
        oof = np.zeros(n)
        for g in np.unique(grp):
            te = grp == g
            idx = np.where(te)[0]
            trn = ~te
            trn[max(idx.min() - cv.buffer, 0):min(idx.max() + cv.buffer + 1, n)] = False
            oof[te] = fit_predict(X[trn], y[trn], X[te])
        out += _rank_pct(oof)
    return out / reps


def importance(model, names: Sequence[str]) -> List[Dict[str, float]]:
    est = model.steps[-1][1] if hasattr(model, "steps") else model
    if hasattr(est, "feature_importances_"):
        vals = np.asarray(est.feature_importances_, float)
    elif hasattr(est, "coef_"):
        vals = np.asarray(est.coef_, float).ravel()
    else:
        return []
    order = np.argsort(-np.abs(vals))
    return [{"feature": names[i], "value": float(vals[i])} for i in order]


@dataclass
class ModelResult:
    name: str
    kind: str
    features: List[str]
    cv_auc: float
    train_auc: float
    oof: List[Optional[float]]
    importance: List[Dict[str, float]] = field(default_factory=list)


def run_models(features: Dict[str, Sequence[float]], target: Sequence[float], threshold: float,
               models: List[ModelSpec], cv: CvSpec, groups: Optional[Sequence] = None, seed: int = 42) -> Dict:
    """Rows are in sequence order. Rows with any missing feature or target are left out (oof = None)."""
    names_all = list(features.keys())
    X_all = np.column_stack([np.asarray(features[k], float) for k in names_all]) if names_all else np.zeros((len(target), 0))
    t = np.asarray(target, float)
    ok = np.isfinite(t) & np.all(np.isfinite(X_all), axis=1)
    y = (t[ok] >= threshold).astype(int)
    g = np.asarray([str(v) for v in groups])[ok] if groups is not None else None
    results = []
    for spec in models:
        names = spec.features or names_all
        cols = [names_all.index(f) for f in names]
        X = X_all[ok][:, cols]
        fp = _fit_predict(spec, names, seed)
        oof = out_of_fold(fp, X, y, cv, g)
        full = make_model(spec, y, names, seed).fit(X, y) if 0 < y.sum() < len(y) else None
        train_scores = full.predict_proba(X)[:, 1] if full is not None else np.zeros(len(y))
        oof_full: List[Optional[float]] = [None] * len(t)
        for k, i in enumerate(np.where(ok)[0]):
            oof_full[int(i)] = float(oof[k])
        results.append(ModelResult(
            name=spec.name or spec.kind, kind=spec.kind, features=list(names),
            cv_auc=auc(y, oof), train_auc=auc(y, train_scores), oof=oof_full,
            importance=importance(full, names) if full is not None else [],
        ).__dict__)
    return {"n": int(ok.sum()), "n_target": int(y.sum()), "models": results}
