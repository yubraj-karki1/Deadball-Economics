"""
Deadball v2 predictor — serves the REAL-data StatsBomb models.

Uses the models trained by production/train_v3.py on the 36,055-shot extract.
Inputs are in StatsBomb pitch coordinates (120 x 80, attacking goal at x=120),
exactly like the training data — so the full-pitch lab feeds real coords with
no SVG remapping.

Guarantees train/serve PARITY: feature encoding (LabelEncoders), numeric
coercion, feature order (saved *_features.pkl) and scaling (*_scaler.pkl) are
replicated from train_v3.py. Verify with:  python3 deadball_v2.py --verify
"""
import os, pickle, math, json, sys, csv, io
from collections import defaultdict
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))


def _first_dir(candidates, probe):
    """Return the first candidate dir that actually contains `probe`.
    Models live under production/models/trained when running from the repo, but
    the repository-page download flattens everything into one folder - so we
    also look right next to this script."""
    for d in candidates:
        if os.path.exists(os.path.join(d, probe)):
            return d
    return candidates[0]


def _first_file(candidates):
    for p in candidates:
        if os.path.exists(p):
            return p
    return candidates[0]


MODEL_DIR = _first_dir(
    [os.path.join(HERE, "production", "models", "trained"), HERE],
    "corner_xg_model.pkl",
)
COUNTS = _first_file([
    os.path.join(HERE, "production", "setpiece_counts.json"),
    os.path.join(HERE, "setpiece_counts.json"),
])

# categorical columns encoded during training (train_v3.CATEG)
CATEG = ["delivery_technique", "delivery_height", "corner_side", "body_part",
         "shot_technique", "zone", "marking_label", "setpiece_type"]

SETPIECE_TO_MODEL = {
    "corner": "corner", "corner-right": "corner", "corner-left": "corner",
    "freekick": "freekick", "freekick-direct": "freekick", "freekick-cross": "freekick",
    "throwin": "throwin", "throw-in": "throwin",
}


def _is_direct_freekick(req, base=None):
    sp = req.get("setpiece_type", "")
    return (base == "freekick" or sp in ("freekick", "freekick-direct")) and (
        sp == "freekick-direct" or req.get("shot_type") == "Free Kick"
    )


def _dist(ax, ay, bx, by):
    return math.hypot(ax - bx, ay - by)


def zone_of(x, y):
    if x >= 114 and y < 40:  return "near-post"
    if x >= 114:             return "far-post"
    if x >= 106:             return "penalty-spot" if 36 <= y <= 44 else "central"
    if x >= 102:             return "central"
    if x >= 96:              return "edge"
    return "second-ball"


class DeadballV2:
    def __init__(self):
        self.models, self.scalers, self.feats, self.encs, self.loaded = {}, {}, {}, {}, {}
        for kind in ("corner", "freekick", "throwin", "setpiece"):
            self._load(kind)
        # P(shot) per set-piece type -> for the set-piece VALUE layer
        self.p_shot = {}
        try:
            c = json.load(open(COUNTS))
            for k, v in c.items():
                if v.get("taken"):
                    self.p_shot[k] = v["shots"] / v["taken"]
        except Exception:
            pass

    def _load(self, kind):
        try:
            p = os.path.join(MODEL_DIR, kind)
            with open(f"{p}_xg_model.pkl", "rb") as f:    self.models[kind] = pickle.load(f)
            with open(f"{p}_xg_scaler.pkl", "rb") as f:   self.scalers[kind] = pickle.load(f)
            with open(f"{p}_xg_features.pkl", "rb") as f: self.feats[kind] = pickle.load(f)
            with open(f"{p}_xg_encoders.pkl", "rb") as f: self.encs[kind] = pickle.load(f)
            self.loaded[kind] = True
        except Exception as e:
            self.loaded[kind] = False
            print(f"[v2] could not load {kind}: {e}", file=sys.stderr)

    # ---- freeze-frame geometry from explicit players (mirrors extract_v3.freeze) ----
    def _freeze(self, shot, gk, defenders, attackers):
        f = {"gk_x": 0, "gk_y": 0, "gk_dist_from_line": 0, "gk_off_center": 0,
             "nearest_defender_dist": 0, "defenders_in_box": 0, "defenders_in_6yard": 0,
             "attackers_in_box": 0, "n_freeze": 0}
        n = 0
        if gk:
            n += 1
            f["gk_x"], f["gk_y"] = gk[0], gk[1]
            f["gk_dist_from_line"] = 120 - gk[0]
            f["gk_off_center"] = abs(gk[1] - 40)
        for dx, dy in (defenders or []):
            n += 1
            if 102 <= dx <= 120 and 18 <= dy <= 62: f["defenders_in_box"] += 1
            if dx >= 114 and 30 <= dy <= 50:         f["defenders_in_6yard"] += 1
        for ax, ay in (attackers or []):
            n += 1
            if 102 <= ax <= 120 and 18 <= ay <= 62:  f["attackers_in_box"] += 1
        if defenders and shot[0] is not None:
            f["nearest_defender_dist"] = round(min(_dist(shot[0], shot[1], dx, dy) for dx, dy in defenders), 2)
        f["n_freeze"] = n
        return f

    # ---- inferred marking (mirrors extract_v3.marking) ----
    def _marking(self, defenders, attackers):
        bd = [p for p in (defenders or []) if 102 <= p[0] <= 120 and 18 <= p[1] <= 62]
        ba = [p for p in (attackers or []) if 102 <= p[0] <= 120 and 18 <= p[1] <= 62]
        if len(bd) < 3 or len(ba) < 1:
            return "", "", "", ""
        paired = 0
        for d in bd:
            near = min(((_dist(d[0], d[1], a[0], a[1]), a) for a in ba), key=lambda t: t[0])
            if near[0] <= 2.5 and d[0] >= near[1][0] - 0.5:
                paired += 1
        r = paired / len(bd)
        xs = [p[0] for p in bd]; ys = [p[1] for p in bd]
        xstd = (sum((v - sum(xs)/len(xs))**2 for v in xs)/len(xs))**0.5
        ystd = (sum((v - sum(ys)/len(ys))**2 for v in ys)/len(ys))**0.5
        lab = "man" if r >= 0.6 else ("zonal" if r <= 0.3 else "mixed")
        return lab, round(r, 3), round(xstd, 2), round(ystd, 2)

    # ---- inferred wall size (mirrors extract_v3.wall_size) ----
    def _wall(self, shot, defenders):
        gx, gy = 120.0, 40.0; bx, by = shot
        vx, vy = gx - bx, gy - by; L = math.hypot(vx, vy) or 1.0
        ux, uy = vx / L, vy / L; n = 0
        for px, py in (defenders or []):
            t = (px - bx) * ux + (py - by) * uy
            if t <= 0 or t > L: continue
            if abs((px - bx) * (-uy) + (py - by) * ux) <= 1.5: n += 1
        return n

    def _raw_row(self, req):
        """Build a raw feature dict (column -> value) in the SAME schema as the CSV."""
        sp = req.get("setpiece_type", "corner")
        kind = SETPIECE_TO_MODEL.get(sp, "corner")
        base = "corner" if kind == "corner" else ("freekick" if kind == "freekick" else ("throwin" if kind == "throwin" else sp))
        x, y = float(req["shot_x"]), float(req["shot_y"])
        gk = req.get("gk")
        defenders = req.get("defenders") or []
        attackers = req.get("attackers") or []
        body = req.get("body_part", "")
        dlen = req.get("delivery_length", 0) or 0
        mk = self._marking(defenders, attackers)
        is_direct_fk = _is_direct_freekick(req, base)
        row = {
            "setpiece_type": base,
            "delivery_technique": req.get("delivery_technique", ""),
            "delivery_height": req.get("delivery_height", ""),
            "delivery_length": dlen,
            "is_short_delivery": 1 if (dlen and float(dlen) < 8) else 0,
            "corner_side": req.get("corner_side", "") if base == "corner" else "",
            "throw_distance": req.get("throw_distance", 0) if base == "throwin" else 0,
            "body_part": body,
            "shot_technique": req.get("shot_technique", ""),
            "is_header": 1 if body == "Head" else 0,
            "loc_x": x, "loc_y": y,
            "distance_to_goal": round(_dist(x, y, 120, 40), 2),
            "angle_to_goal": round(math.degrees(math.atan2(abs(y - 40), max(0.1, 120 - x))), 2),
            "centrality": round(abs(y - 40), 2),
            "zone": zone_of(x, y),
            "minute": req.get("minute", 45),
            "marking_label": mk[0], "man_ratio": mk[1], "def_x_std": mk[2], "def_y_std": mk[3],
            "wall_size": self._wall([x, y], defenders) if is_direct_fk else "",
        }
        row.update(self._freeze([x, y], gk, defenders, attackers))
        return kind, row

    def _vectorize(self, kind, row):
        feats = self.feats[kind]; encs = self.encs[kind]
        vec = []
        for name in feats:
            if name.endswith("_enc"):
                base = name[:-4]
                le = encs.get(base)
                val = row.get(base, "")
                sval = "none" if (val is None or val == "" or (isinstance(val, float) and math.isnan(val))) else str(val)
                if le is not None:
                    classes = list(le.classes_)
                    if sval in classes:
                        vec.append(int(le.transform([sval])[0]))
                    elif "none" in classes:
                        vec.append(int(le.transform(["none"])[0]))
                    else:
                        vec.append(0)
                else:
                    vec.append(0)
            else:
                v = row.get(name, 0)
                try:
                    v = float(v)
                    if math.isnan(v): v = 0.0
                except (TypeError, ValueError):
                    v = 0.0
                vec.append(v)
        return np.array([vec], dtype=np.float64)

    def predict_grid(self, req):
        """xG over a grid of shot positions (GK/defenders/delivery held fixed)
        for the heatmap overlay. Single batched predict_proba for speed."""
        kind = SETPIECE_TO_MODEL.get(req.get("setpiece_type", "corner"), "corner")
        if not self.loaded.get(kind):
            return {"error": f"model {kind} not loaded"}
        xs = [round(88 + i * 2.5, 1) for i in range(13)]   # 88 .. 118
        ys = [round(14 + j * 3.0, 1) for j in range(23)]   # 14 .. 80
        vecs, cells = [], []
        for gx in xs:
            for gy in ys:
                _, row = self._raw_row({**req, "shot_x": gx, "shot_y": gy})
                vecs.append(self._vectorize(kind, row)[0])
                cells.append((gx, gy))
        X = np.array(vecs, dtype=np.float64)
        Xs = self.scalers[kind].transform(X)
        p = self.models[kind].predict_proba(Xs)[:, 1]
        return {"grid": [{"x": c[0], "y": c[1], "xg": round(float(v), 4)} for c, v in zip(cells, p)],
                "xs": xs, "ys": ys}

    def predict(self, req):
        kind, row = self._raw_row(req)
        if not self.loaded.get(kind):
            return {"error": f"model {kind} not loaded"}
        X = self._vectorize(kind, row)
        Xs = self.scalers[kind].transform(X)
        xg = float(self.models[kind].predict_proba(Xs)[0, 1])
        # ---- set-piece VALUE layer: P(shot|type) x shot xG ----
        # Direct FKs: the delivery IS the shot, so P(shot)=1 and value == shot xG.
        base = row["setpiece_type"]
        is_direct_fk = _is_direct_freekick(req, base)
        p_shot = 1.0 if is_direct_fk else self.p_shot.get(base)
        setpiece_value = round(xg * p_shot, 4) if p_shot is not None else None
        return {
            "xg": round(xg, 4),                       # shot xG at the landing point
            "p_shot": round(p_shot, 4) if p_shot is not None else None,
            "setpiece_value": setpiece_value,         # xG per set piece taken
            "model_used": f"ml_{kind}_real",
            "setpiece_type": base,
            "zone": row["zone"],
            "marking_label": row["marking_label"],
            "distance_to_goal": row["distance_to_goal"],
            "features_used": len(self.feats[kind]),
            "derived": {k: row[k] for k in ("gk_dist_from_line", "gk_off_center",
                        "nearest_defender_dist", "defenders_in_box", "attackers_in_box",
                        "n_freeze", "man_ratio", "wall_size")},
        }


# ---------------- validation (shared by api_server.py + deadball_server.py) ----------------
SHOT_CAP = 1000  # cap the per-shot navigator payload; metrics still use every row


def _vf(v):
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return None


def _auc(ys, ps):
    """ROC-AUC via the Mann-Whitney rank statistic (handles ties)."""
    data = sorted(zip(ps, ys))
    n = len(data); npos = sum(ys); nneg = n - npos
    if npos == 0 or nneg == 0:
        return None
    ranks = [0.0] * n; i = 0
    while i < n:
        j = i
        while j < n and data[j][0] == data[i][0]:
            j += 1
        avg = (i + 1 + j) / 2.0
        for k in range(i, j):
            ranks[k] = avg
        i = j
    sum_pos = sum(ranks[k] for k in range(n) if data[k][1] == 1)
    return round((sum_pos - npos * (npos + 1) / 2.0) / (npos * nneg), 4)


def _metrics(ys, ps):
    n = len(ys)
    if n == 0:
        return None
    goals = int(sum(ys)); mean_p = sum(ps) / n; actual = goals / n
    brier = sum((p - y) ** 2 for p, y in zip(ps, ys)) / n
    eps = 1e-15
    ll = -sum(y * math.log(min(1 - eps, max(eps, p))) + (1 - y) * math.log(min(1 - eps, max(eps, 1 - p)))
              for p, y in zip(ps, ys)) / n
    return {"n": n, "goals": goals, "actual_rate": round(actual, 4),
            "pred_rate": round(mean_p, 4),
            "calibration": round(mean_p / actual, 3) if actual > 0 else None,
            "brier": round(brier, 4), "log_loss": round(ll, 4), "auc": _auc(ys, ps)}


def validate_rows(engine, rows):
    """Run the trained models over uploaded shot rows (v3 schema) and score them
    against the actual is_goal. Returns overall + per-type metrics and a capped
    per-shot list (model xG + fields to place each shot on the pitch)."""
    by_kind = defaultdict(list)
    skipped = 0
    for i, r in enumerate(rows):
        sp = (r.get("setpiece_type") or "").strip()
        kind = SETPIECE_TO_MODEL.get(sp)
        if kind not in ("corner", "freekick", "throwin") or not engine.loaded.get(kind):
            skipped += 1; continue
        try:
            y = int(float(r.get("is_goal", "")))
        except (TypeError, ValueError):
            skipped += 1; continue
        by_kind[kind].append((i, r, y))

    all_y, all_p, by_type, shot_map = [], [], {}, {}
    for kind, items in by_kind.items():
        X = np.array([engine._vectorize(kind, r)[0] for _, r, _ in items], dtype=np.float64)
        Xs = engine.scalers[kind].transform(X)
        ps = engine.models[kind].predict_proba(Xs)[:, 1].tolist()
        ys = [y for _, _, y in items]
        by_type[kind] = _metrics(ys, ps)
        all_y += ys; all_p += ps
        for (i, r, y), p in zip(items, ps):
            shot_map[i] = {
                "sp": (r.get("setpiece_type") or "").strip(),
                "loc_x": _vf(r.get("loc_x")), "loc_y": _vf(r.get("loc_y")),
                "gk_x": _vf(r.get("gk_x")), "gk_y": _vf(r.get("gk_y")),
                "dist": _vf(r.get("distance_to_goal")),
                "zone": r.get("zone", ""), "mark": r.get("marking_label", ""),
                "tech": r.get("delivery_technique", ""), "height": r.get("delivery_height", ""),
                "body": r.get("body_part", ""), "side": r.get("corner_side", ""),
                "def_box": _vf(r.get("defenders_in_box")), "atk_box": _vf(r.get("attackers_in_box")),
                "players": r.get("freeze_players", ""),  # real box positions (StatsBomb coords)
                "is_goal": y, "sb_xg": _vf(r.get("statsbomb_xg")),
                "xg": round(float(p), 4),
                "p_shot": 1.0 if _is_direct_freekick(r, kind) else engine.p_shot.get(kind),
                "shot_type": r.get("shot_type", ""),
                "wall_size": _vf(r.get("wall_size")),
            }
    shots = [shot_map[i] for i in sorted(shot_map)[:SHOT_CAP]]
    return {"n": len(all_y), "skipped": skipped, "overall": _metrics(all_y, all_p),
            "by_type": by_type, "shots": shots, "shots_total": len(all_y)}


def validate_csv(engine, csv_text):
    try:
        rows = list(csv.DictReader(io.StringIO(csv_text or "")))
    except Exception as e:
        return {"error": f"could not parse CSV: {e}"}
    if not rows:
        return {"error": "no rows found - expected a CSV with a header row"}
    if "setpiece_type" not in rows[0] or "is_goal" not in rows[0]:
        return {"error": "CSV must have 'setpiece_type' and 'is_goal' columns (v3 schema)"}
    return validate_rows(engine, rows)


# ---------------- parity verification ----------------
def _verify(n=400):
    import pandas as pd
    from sklearn.preprocessing import LabelEncoder, StandardScaler  # noqa
    csv = os.path.join(HERE, "production", "setpiece_shots_v3.csv")
    df = pd.read_csv(csv, low_memory=False)
    v2 = DeadballV2()

    # Reference path: replicate train_v3 feature prep on the SAME rows,
    # predict with the same model, compare to the serving predict().
    import importlib.util
    spec = importlib.util.spec_from_file_location("tr", os.path.join(HERE, "production", "train_v3.py"))
    tr = importlib.util.module_from_spec(spec); spec.loader.exec_module(tr)
    enc = tr.encode(df)  # global encoders identical to training

    worst = 0.0
    checked = 0
    for kind in ("corner", "freekick", "throwin"):
        sub = df[df.setpiece_type == kind].head(n)
        feats = tr.features_for(kind, sub)
        X = tr.prep_numeric(sub, feats)
        Xs = v2.scalers[kind].transform(X)
        ref = v2.models[kind].predict_proba(Xs)[:, 1]
        for i, (_, r) in enumerate(sub.iterrows()):
            req = {
                "setpiece_type": kind,
                "shot_x": r["loc_x"], "shot_y": r["loc_y"],
                "delivery_technique": r.get("delivery_technique", ""),
                "delivery_height": r.get("delivery_height", ""),
                "delivery_length": r.get("delivery_length", 0),
                "corner_side": r.get("corner_side", ""),
                "throw_distance": r.get("throw_distance", 0),
                "body_part": r.get("body_part", ""),
                "shot_technique": r.get("shot_technique", ""),
                "minute": r.get("minute", 45),
                "gk": [r["gk_x"], r["gk_y"]] if str(r.get("gk_x", "")) not in ("", "nan") else None,
                # reconstruct counts directly (serving path recomputes from players;
                # here we validate the vector/scaler/model path, so pass derived via a shim)
            }
            out = v2.predict(req)
            # serving recomputes freeze feats from players we don't have per-row here,
            # so compare only the model/scaler/encoder path by vectorizing the raw row:
            _, row = v2._raw_row(req)
            # inject the CSV's stored freeze/marking values for a like-for-like check
            for c in ("gk_dist_from_line", "gk_off_center", "nearest_defender_dist",
                      "defenders_in_box", "defenders_in_6yard", "attackers_in_box", "n_freeze",
                      "gk_x", "gk_y", "marking_label", "man_ratio", "def_x_std", "def_y_std",
                      "wall_size", "is_short_delivery", "delivery_height"):
                if c in r and str(r[c]) not in ("", "nan"):
                    row[c] = r[c]
            Xv = v2._vectorize(kind, row)
            xg_serv = float(v2.models[kind].predict_proba(v2.scalers[kind].transform(Xv))[0, 1])
            worst = max(worst, abs(xg_serv - ref[i]))
            checked += 1
        print(f"  {kind}: checked {len(sub)} rows")
    print(f"\nPARITY: {checked} rows, max |serving - training| = {worst:.6f}")
    print("PASS" if worst < 1e-6 else ("CLOSE" if worst < 1e-3 else "MISMATCH"))


if __name__ == "__main__":
    if "--verify" in sys.argv:
        _verify()
    else:
        v2 = DeadballV2()
        print("loaded:", v2.loaded)
        demo = {"setpiece_type": "corner", "shot_x": 116, "shot_y": 44,
                "delivery_technique": "Inswinging", "corner_side": "right",
                "body_part": "Head", "gk": [119, 40],
                "defenders": [[115, 42], [117, 40], [113, 38]],
                "attackers": [[116, 43], [115, 45]]}
        print(json.dumps(v2.predict(demo), indent=2))
