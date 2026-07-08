"""
Train set-piece xG models on the v3 real extract (with inferred marking + wall).
Reports honest metrics + P(shot) + per-set-piece VALUE from setpiece_counts.json.
Saves {corner,freekick,throwin,setpiece}_xg_{model,scaler,features,encoders}.pkl
into production/models/trained/  (footylytics naming; overwrites the v2 ones).
"""
import os, pickle, json
import numpy as np, pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.metrics import roc_auc_score, log_loss, brier_score_loss
import xgboost as xgb

HERE = os.path.dirname(os.path.abspath(__file__))
CSV = os.path.join(HERE, "setpiece_shots_v3.csv")
CNT = os.path.join(HERE, "setpiece_counts.json")
OUT = os.path.join(HERE, "models", "trained"); os.makedirs(OUT, exist_ok=True)

CATEG = ["delivery_technique", "delivery_height", "corner_side", "body_part",
         "shot_technique", "zone", "marking_label", "setpiece_type"]
NUM = ["delivery_length", "throw_distance", "is_short_delivery", "is_header",
       "loc_x", "loc_y", "distance_to_goal", "angle_to_goal", "centrality", "minute",
       "gk_x", "gk_y", "gk_dist_from_line", "gk_off_center", "nearest_defender_dist",
       "defenders_in_box", "defenders_in_6yard", "attackers_in_box", "n_freeze",
       "man_ratio", "def_x_std", "def_y_std", "wall_size"]  # statsbomb_xg excluded

PARAMS = {"corner": dict(n_estimators=500, max_depth=5, learning_rate=0.05),
          "freekick": dict(n_estimators=400, max_depth=4, learning_rate=0.05),
          "throwin": dict(n_estimators=300, max_depth=4, learning_rate=0.05),
          "setpiece": dict(n_estimators=1000, max_depth=6, learning_rate=0.03)}
COMMON = dict(subsample=0.8, colsample_bytree=0.8, min_child_weight=5, gamma=0.2,
              reg_alpha=0.5, reg_lambda=2.0, objective="binary:logistic",
              eval_metric="auc", random_state=42, early_stopping_rounds=40)

def encode(df):
    enc = {}
    for c in CATEG:
        if c in df.columns:
            le = LabelEncoder()
            df[c + "_enc"] = le.fit_transform(df[c].fillna("none").astype(str).replace("", "none"))
            enc[c] = le
    return enc

def features_for(kind, df):
    feats = []
    for c in CATEG:
        col = c + "_enc"
        if col not in df.columns: continue
        if c == "setpiece_type" and kind != "setpiece": continue
        feats.append(col)
    feats += [c for c in NUM if c in df.columns]
    return feats

def prep_numeric(df, feats):
    X = df[feats].copy()
    for c in feats:
        X[c] = pd.to_numeric(X[c], errors="coerce").fillna(0.0)
    return X.values.astype(np.float64)

def train_one(kind, df, enc, counts):
    sub = df[df.setpiece_type.isin(["corner","freekick","throwin"])] if kind=="setpiece" else df[df.setpiece_type==kind]
    sub = sub.copy(); n, g = len(sub), int(sub.is_goal.sum())
    if n < 200: print(f"[skip] {kind}: {n} rows"); return None
    feats = features_for(kind, sub)
    X = prep_numeric(sub, feats); y = sub.is_goal.values.astype(int)
    scaler = StandardScaler(); Xs = scaler.fit_transform(X)
    X_tr, X_te, y_tr, y_te = train_test_split(Xs, y, test_size=0.20, random_state=42, stratify=y)
    X_tr, X_va, y_tr, y_va = train_test_split(X_tr, y_tr, test_size=0.20, random_state=42, stratify=y_tr)
    model = xgb.XGBClassifier(**{**PARAMS[kind], **COMMON})
    model.fit(X_tr, y_tr, eval_set=[(X_va, y_va)], verbose=False)
    p = model.predict_proba(X_te)[:, 1]
    auc, ll, br = roc_auc_score(y_te, p), log_loss(y_te, p), brier_score_loss(y_te, p)
    for suf, obj in [("model", model), ("scaler", scaler), ("features", feats), ("encoders", enc)]:
        pickle.dump(obj, open(os.path.join(OUT, f"{kind}_xg_{suf}.pkl"), "wb"))
    imp = sorted(zip(feats, model.feature_importances_), key=lambda t: -t[1])[:8]
    # per-set-piece value
    pv = ""
    if kind in counts and counts[kind]["taken"]:
        c = counts[kind]; pv = f"  P(shot)={c['shots']/c['taken']:.2%}  xG/set-piece={c['xg_sum']/c['taken']:.4f}"
    print(f"\n=== {kind.upper()} ===  rows {n} goals {g} ({g/n:.2%}) feats {len(feats)}{pv}")
    print(f"  trees {model.best_iteration}  AUC {auc:.4f}  logloss {ll:.4f}  Brier {br:.4f}")
    print("  top: " + ", ".join(f"{k}={v:.3f}" for k, v in imp))
    return dict(kind=kind, rows=n, goals=g, base=g/n, features=len(feats),
                best_iter=int(model.best_iteration), auc=auc, logloss=ll, brier=br,
                p_shot=(counts.get(kind,{}).get("shots",0)/counts[kind]["taken"]) if counts.get(kind,{}).get("taken") else None,
                xg_per_setpiece=(counts.get(kind,{}).get("xg_sum",0)/counts[kind]["taken"]) if counts.get(kind,{}).get("taken") else None,
                top=[[k, float(v)] for k, v in imp])

def main():
    df = pd.read_csv(CSV, low_memory=False)
    counts = json.load(open(CNT)) if os.path.exists(CNT) else {}
    print(f"Loaded {len(df)} shots. {df.setpiece_type.value_counts().to_dict()}")
    if "marking_label" in df: print("marking:", df["marking_label"].value_counts(dropna=False).to_dict())
    enc = encode(df); res = {}
    for kind in ["corner","freekick","throwin","setpiece"]:
        r = train_one(kind, df, enc, counts)
        if r: res[kind] = r
    json.dump({"models": res, "counts": counts}, open(os.path.join(HERE,"train_metrics_v3.json"),"w"), indent=2)
    print(f"\nSaved -> {OUT}")

if __name__ == "__main__":
    main()
