"""Analysis endpoints that need the scientific Python stack.

POST /api/analysis/models  supervised models scored by hole / block cross-validation
GET  /api/analysis/models/available  which model kinds can run (optional packages)

The frontend sends the columns itself (analytical values, rows in sequence
order) rather than relying on the backend's copy of the dataset, which holds
raw values and may be out of date.
"""
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.supervised import CvSpec, ModelSpec, available_models, run_models

router = APIRouter()


class ModelIn(BaseModel):
    kind: str
    name: str = ""
    features: Optional[List[str]] = None
    monotone: Optional[Dict[str, int]] = None
    depth: int = 2
    n_trees: int = 200
    learning_rate: float = 0.05
    l1_ratio: float = 0.5
    C: float = 1.0


class CvIn(BaseModel):
    kind: str = "block"
    block_length: int = 12
    buffer: int = 2
    repeats: int = 10


class ModelsRequest(BaseModel):
    features: Dict[str, List[Optional[float]]]
    target: List[Optional[float]]
    threshold: float
    models: List[ModelIn]
    cv: CvIn = Field(default_factory=CvIn)
    groups: Optional[List[Optional[str]]] = None
    seed: int = 42


@router.get("/models/available")
def models_available():
    return available_models()


@router.post("/models")
def models(req: ModelsRequest):
    avail = available_models()
    missing = sorted({m.kind for m in req.models if not avail.get(m.kind, False)})
    if missing:
        raise HTTPException(status_code=501, detail=(
            f"Not installed for {', '.join(missing)}: run "
            "backend\\venv\\Scripts\\python -m pip install -r backend\\requirements-ml.txt and restart GeoChem"))
    n = len(req.target)
    if any(len(v) != n for v in req.features.values()):
        raise HTTPException(status_code=400, detail="Every feature needs one value per target row")

    def nan(v):
        return float("nan") if v is None else v

    try:
        return run_models(
            {k: [nan(x) for x in v] for k, v in req.features.items()},
            [nan(x) for x in req.target], req.threshold,
            [ModelSpec(**m.model_dump()) for m in req.models], CvSpec(**req.cv.model_dump()),
            groups=req.groups, seed=req.seed,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
