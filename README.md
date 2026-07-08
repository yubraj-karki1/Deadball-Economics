# Deadball Economics — Set-piece xG (standalone)

A self-contained copy of the Deadball set-piece lab: a **FastAPI server + browser
UI** backed by the real-data StatsBomb models. Drag the ball, keeper, defenders
and attackers on a **105 × 68 m** pitch and read the **shot xG**, the
**set-piece value** (goals per set piece taken), the **inferred marking**, an
**xG heatmap**, and the **physics post-shot xG (PSxG)**.

Everything the app needs is already in this folder — no download or API key.

## Run it

```bash
pip install -r requirements.txt
python api_server.py
```

The server starts on **http://localhost:8000** and opens your browser
automatically. (Set a different port with `PORT=8010 python api_server.py`.)

## What you'll see

- **Shot xG** — given a shot *is* taken from where you drop the ball, how likely
  it is a goal. Predicted per-shot by the trained model.
- **Set-piece value** = P(shot) × shot xG — what one set piece is *worth* before
  you know a shot even happens (most produce none, so this is much lower).
- **Combined** = shot xG × PSxG — chance quality × finish quality.
- **Breakdown** — for corners, the measured zone / swing / height / finish /
  marking modifiers, then the value and combined chain.
- **xG heatmap** — the model's xG at every landing point (GK/defenders fixed).
- **Voronoi** — which player owns each patch of grass.
- **PSxG (GK biomechanics)** — the physics post-shot model shown as a 12-zone
  danger grid: the ball and keeper race to the same point. Ball time = distance ÷
  shot speed; keeper time = 0.15 s reaction + max(sideways ÷ 4.0, up ÷ 2.5).
  StatsBomb has no ball velocity, so **shot speed is an assumed slider**.
- **Validate match data** — upload a CSV of set-piece shots and the model scores
  every shot against the real outcome (calibration, Brier, log-loss, ROC-AUC), or
  score the bundled **women's holdout** (see below).

## Validate the model on new data

The **Validate match data** panel runs the trained models over any CSV in the
same schema as `production/setpiece_shots_v3.csv` (needs at least `setpiece_type`,
`is_goal`, and the feature columns) and reports:

- **Calibration** — mean predicted xG ÷ actual goal rate (1.00 = perfect)
- **Brier** and **log-loss** — probability accuracy (lower is better)
- **ROC-AUC** — ranking quality (~0.77–0.80 = matches the training holdout)

`production/sample_validation.csv` is a ready-made **genuine holdout**: set-piece
shots from **women's** StatsBomb competitions. The models trained only on men's
matches, so this data is completely unseen — a fair test of generalisation. Click
"Use bundled women's holdout" in the panel, or regenerate/extend it with
`python production/extract_validation.py [MAX_MATCHES]`.

## Files

**Run the app**
- `api_server.py` — FastAPI entry point (serves the UI + `/calculate_xg`, `/calculate_xg_grid`)
- `deadball_v2.py` — the calculator (loads the pickles; train/serve parity guaranteed)
- `main.html`, `style.css`, `script.js` — the browser pitch UI
- `production/models/trained/*.pkl` — the trained models (model / scaler / features / encoders) for corner, freekick, throwin and the unified model
- `production/setpiece_counts.json` — the 217,795 "set pieces taken" counts → P(shot) per type

**The data**
- `production/setpiece_shots_v3.csv` — the **36,055-shot** training corpus
  (2,646 men's matches: Euro 2024, World Cups 2018/22, La Liga, Bundesliga,
  Ligue 1, and more). One row per set-piece-resulting shot: delivery technique
  (inswing/outswing), height, zone, body part, GK & defender freeze-frame
  geometry, inferred marking, `is_goal`.
- `production/psxg_shots.csv` — on-target shots with 3-D goal-frame end-location
  (for the placement PSxG experiments).
- `production/sample_validation.csv` — the **women's holdout** validation set
  (unseen matches, same schema), plus `production/extract_validation.py` to
  regenerate or extend it.

**Retrain / reproduce**
- `production/train_v3.py` — retrains the corner/FK/throw/unified models from
  `setpiece_shots_v3.csv` → the `production/models/trained/*.pkl` files.
- `production/extract_v3.py` — re-extracts the corpus from StatsBomb open data
  (needs `pip install statsbombpy`; slow, downloads thousands of matches).
- `python deadball_v2.py --verify` — checks serving matches training to 1e-6.

```bash
# retrain from the shipped CSV (fast; a minute or two)
cd production && python train_v3.py

# verify the served xG matches the training pipeline exactly
python deadball_v2.py --verify
```

## Coordinates

The UI is a real **105 × 68 m** pitch (goal at x=105, centre y=34). The trained
models expect **StatsBomb 120 × 80** coordinates, so the browser converts
(`x·120/105`, `y·80/68`) only at the moment it calls the API — the whole UI
stays in metres. This matches the Geometry of Pressure course's pitch exactly.

## The numbers behind it

| Set piece | Taken | Shots | Goals | P(shot) | Conversion | Value |
|-----------|-------|-------|-------|---------|------------|-------|
| Corner | 26,325 | 10,348 | 891 | 39.3% | 8.6% | 0.034 |
| Free kick | 77,344 | 14,312 | 1,347 | 18.5% | 9.4% | 0.017 |
| Throw-in | 114,126 | 11,395 | 1,084 | 10.0% | 9.5% | 0.009 |
| **All** | **217,795** | **36,055** | **3,322** | 16.6% | 9.2% | 0.015 |

The models train on the **36,055 shots**; the **217,795 taken** is only the
denominator that turns shot xG into set-piece value.
