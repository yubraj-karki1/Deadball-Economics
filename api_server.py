"""
Deadball Economics - standalone set-piece xG app.

A self-contained FastAPI server + browser UI backed by the REAL-data StatsBomb
set-piece models (the same v3 pickles the course platform uses). Reproduces the
full-pitch lab: a 105 x 68 m pitch where you drag the ball, keeper, defenders
and attackers and read the shot xG, the set-piece value, the inferred marking,
an xG heatmap and the physics post-shot xG (PSxG).

Run it:
    pip install -r requirements.txt
    python api_server.py
then open http://localhost:8000 (it opens automatically).

Everything the models need is already in this folder:
    production/models/trained/*.pkl   - the trained models (corner/FK/throw/unified)
    production/setpiece_counts.json   - the 217,795 "set pieces taken" counts (P(shot))
    production/setpiece_shots_v3.csv  - the 36,055-shot training corpus
    deadball_v2.py                    - the calculator (train/serve parity guaranteed)
"""
import os
import io
import csv
import math
import threading
import webbrowser
from collections import defaultdict

import numpy as np
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from typing import List, Optional, Any, Dict

from deadball_v2 import DeadballV2, validate_csv

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "8000"))

app = FastAPI(title="Deadball Economics - Set-piece xG", version="3.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

# Load the models once at import (fast: the pickles are small).
ENGINE = DeadballV2()


# ---- request schema (coordinates are StatsBomb 120 x 80; the UI converts) ----
class XGRequest(BaseModel):
    setpiece_type: str = "corner-right"
    shot_x: float
    shot_y: float
    gk: Optional[List[float]] = None
    defenders: List[List[float]] = []
    attackers: List[List[float]] = []
    delivery_technique: str = ""
    delivery_height: str = ""
    delivery_length: float = 0
    corner_side: str = ""
    throw_distance: float = 0
    body_part: str = "Head"
    shot_technique: str = ""
    shot_type: str = ""
    minute: int = 45


class GridRequest(BaseModel):
    setpiece_type: str = "corner-right"
    gk: Optional[List[float]] = None
    defenders: List[List[float]] = []
    attackers: List[List[float]] = []
    delivery_technique: str = ""
    delivery_height: str = ""
    corner_side: str = ""
    body_part: str = "Head"
    shot_type: str = ""


@app.on_event("startup")
async def _startup():
    loaded = [k for k, v in ENGINE.loaded.items() if v]
    print(f"[OK] Deadball models loaded: {loaded}")
    print(f"[OK] P(shot) per type: "
          + ", ".join(f"{k}={v:.3f}" for k, v in ENGINE.p_shot.items()))
    print(f"Open http://localhost:{PORT}")

    def _open():
        import time
        time.sleep(1.5)
        try:
            webbrowser.open(f"http://localhost:{PORT}")
        except Exception:
            pass
    threading.Thread(target=_open, daemon=True).start()


@app.get("/")
async def index():
    return FileResponse(os.path.join(HERE, "main.html"))


@app.get("/style.css")
async def css():
    return FileResponse(os.path.join(HERE, "style.css"), media_type="text/css")


@app.get("/script.js")
async def js():
    return FileResponse(os.path.join(HERE, "script.js"),
                        media_type="application/javascript")


@app.get("/favicon.ico")
async def favicon():
    return Response(status_code=204)


@app.get("/health")
async def health():
    return {"status": "healthy",
            "models_loaded": {k: v for k, v in ENGINE.loaded.items()},
            "p_shot": ENGINE.p_shot}


@app.post("/calculate_xg")
async def calculate_xg(req: XGRequest) -> Dict[str, Any]:
    """Shot xG + set-piece value + inferred marking for one scenario."""
    return ENGINE.predict(req.model_dump())


@app.post("/calculate_xg_grid")
async def calculate_xg_grid(req: GridRequest) -> Dict[str, Any]:
    """xG over a grid of shot positions (GK/defenders fixed) - the heatmap."""
    return ENGINE.predict_grid(req.model_dump())


# ---------------- validate uploaded match data ----------------
@app.post("/validate")
async def validate(req: Request) -> Dict[str, Any]:
    """POST a CSV (v3 schema: setpiece_type + is_goal + feature columns) as the
    body. Returns calibration / Brier / log-loss / ROC-AUC vs the real goals +
    a per-shot list. Shared with the in-app engine via deadball_v2.validate_csv."""
    raw = (await req.body()).decode("utf-8", "replace")
    return validate_csv(ENGINE, raw)


@app.get("/sample_validation.csv")
async def sample_validation():
    p = os.path.join(HERE, "production", "sample_validation.csv")
    if os.path.exists(p):
        return FileResponse(p, media_type="text/csv")
    return Response(status_code=404)


@app.get("/synthetic_shots.csv")
async def synthetic_shots():
    p = os.path.join(HERE, "production", "synthetic_shots.csv")
    if os.path.exists(p):
        return FileResponse(p, media_type="text/csv")
    return Response(status_code=404)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
