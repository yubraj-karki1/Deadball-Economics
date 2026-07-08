"""
Generate a small set of SYNTHETIC set-piece shots for the upload/validate lab.

Each scenario is hand-placed (shot, GK, defenders, attackers in StatsBomb 120x80
coords), then ALL the derived features - zone, distance, angle, marking, wall,
freeze counts and the freeze_players positions - are computed with the exact
same functions extract_v3 uses. So the schema matches the real corpus, the model
scores the rows correctly, and the pitch shows the real defenders/attackers.

Output: production/synthetic_shots.csv  (also copied to public/deadball/)
"""
import os, csv, math, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("ev3", os.path.join(HERE, "extract_v3.py"))
ev3 = importlib.util.module_from_spec(spec); spec.loader.exec_module(ev3)
freeze, marking, wall_size, zone_of, dd, FIELDS = (
    ev3.freeze, ev3.marking, ev3.wall_size, ev3.zone_of, ev3.dd, ev3.FIELDS)


def frame(gk, defs, atks):
    f = [{"location": list(gk), "teammate": False, "position": {"name": "Goalkeeper"}}]
    f += [{"location": list(d), "teammate": False, "position": {"name": "Defender"}} for d in defs]
    f += [{"location": list(a), "teammate": True, "position": {"name": "Forward"}} for a in atks]
    return f


# each scenario: sp type, shot loc, gk, defenders, attackers, delivery + finish + outcome
SCEN = [
    dict(name="Corner far-post inswinger header (goal)", sp="corner", side="right",
         tech="Inswinging", height="High Pass", body="Head", stype="", goal=1, xg=0.19,
         loc=[117, 46], gk=[119, 40],
         d=[[116, 42], [117, 38], [115, 44], [114, 40], [113, 36]],
         a=[[117, 45], [116, 47], [115, 38]]),
    dict(name="Corner near-post outswinger (saved)", sp="corner", side="left",
         tech="Outswinging", height="High Pass", body="Head", stype="", goal=0, xg=0.10,
         loc=[116, 35], gk=[119, 41],
         d=[[115, 36], [116, 38], [114, 34], [117, 40]],
         a=[[116, 34], [115, 37]]),
    dict(name="Corner pen-spot, man-marking header (goal)", sp="corner", side="right",
         tech="Inswinging", height="Low Pass", body="Head", stype="", goal=1, xg=0.13,
         loc=[108, 40], gk=[119, 40],
         d=[[109.5, 40.5], [111, 44.5], [107.5, 37.5], [112, 41], [113, 38]],
         a=[[108, 40], [110, 44], [106, 37]]),
    dict(name="Corner vs zonal line (cleared)", sp="corner", side="right",
         tech="Inswinging", height="High Pass", body="Head", stype="", goal=0, xg=0.08,
         loc=[115, 39], gk=[119, 40],
         d=[[114, 32], [114, 36], [114, 40], [114, 44], [114, 48]],
         a=[[116, 38], [117, 42]]),
    dict(name="Corner, GK off his line (goal)", sp="corner", side="right",
         tech="Inswinging", height="Low Pass", body="Head", stype="", goal=1, xg=0.26,
         loc=[113, 42], gk=[112, 38],
         d=[[114, 40], [115, 44]],
         a=[[113, 42], [112, 45]]),
    dict(name="Corner, crowded box (saved)", sp="corner", side="left",
         tech="Inswinging", height="High Pass", body="Head", stype="", goal=0, xg=0.10,
         loc=[115, 41], gk=[119, 40],
         d=[[116, 40], [115, 38], [114, 42], [117, 44], [113, 39], [116, 36]],
         a=[[115, 41], [116, 43], [114, 45]]),
    dict(name="Direct free kick over the wall (goal)", sp="freekick", side="",
         tech="", height="", body="Right Foot", stype="Free Kick", goal=1, xg=0.07,
         loc=[102, 44], gk=[119, 43],
         d=[[108, 43], [108, 44.5], [108, 42], [108, 45.5]],
         a=[[110, 40]]),
    dict(name="Crossed free kick, far-post header (saved)", sp="freekick", side="",
         tech="Inswinging", height="High Pass", body="Head", stype="", goal=0, xg=0.09,
         loc=[116, 47], gk=[119, 40],
         d=[[115, 44], [116, 42], [114, 46]],
         a=[[117, 47], [116, 49]]),
    dict(name="Throw-in near-post flick-on (goal)", sp="throwin", side="",
         tech="Straight", height="Low Pass", body="Head", stype="", goal=1, xg=0.11,
         loc=[116, 36], gk=[119, 41], throw=12,
         d=[[115, 37], [116, 39], [114, 34]],
         a=[[116, 35], [117, 33]]),
    dict(name="Throw-in second-ball edge shot (blocked)", sp="throwin", side="",
         tech="Straight", height="Ground Pass", body="Right Foot", stype="", goal=0, xg=0.04,
         loc=[100, 38], gk=[117, 40], throw=20,
         d=[[104, 38], [106, 36], [103, 42]],
         a=[[100, 38], [101, 40]]),
]


def build():
    rows = []
    for i, s in enumerate(SCEN):
        loc, gk = s["loc"], s["gk"]
        ff = frame(gk, s["d"], s["a"])
        fdict, _ = freeze({"freeze_frame": ff}, loc)
        mk = marking(ff)
        stype = s["stype"]
        plen = 12 if s["sp"] != "throwin" and s["tech"] else (s.get("throw", ""))
        row = {
            "match_id": 900001 + i, "competition": "Synthetic",
            "setpiece_type": s["sp"], "shot_type": stype, "is_goal": s["goal"],
            "delivery_technique": s["tech"], "delivery_height": s["height"],
            "delivery_length": plen if s["sp"] != "throwin" else "",
            "is_short_delivery": 0,
            "corner_side": s["side"] if s["sp"] == "corner" else "",
            "throw_distance": s.get("throw", "") if s["sp"] == "throwin" else "",
            "body_part": s["body"], "shot_technique": "",
            "is_header": 1 if s["body"] == "Head" else 0,
            "statsbomb_xg": s["xg"],
            "loc_x": loc[0], "loc_y": loc[1],
            "distance_to_goal": round(dd(loc[0], loc[1], 120, 40), 2),
            "angle_to_goal": round(math.degrees(math.atan2(abs(loc[1] - 40), max(0.1, 120 - loc[0]))), 2),
            "centrality": round(abs(loc[1] - 40), 2), "zone": zone_of(loc[0], loc[1]),
            "minute": 20 + i * 6,
            "marking_label": mk[0], "man_ratio": mk[1], "def_x_std": mk[2], "def_y_std": mk[3],
            "wall_size": wall_size(ff, loc) if stype == "Free Kick" else "",
        }
        row.update(fdict)
        rows.append(row)
    return rows


def main():
    rows = build()
    out = os.path.join(HERE, "synthetic_shots.csv")
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS); w.writeheader(); w.writerows(rows)
    # mirror into public/ so the in-app lab can offer it too
    pub = os.path.abspath(os.path.join(HERE, "..", "..", "public", "deadball", "synthetic_shots.csv"))
    if os.path.isdir(os.path.dirname(pub)):
        with open(pub, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=FIELDS); w.writeheader(); w.writerows(rows)
    print(f"wrote {len(rows)} synthetic shots -> {out}")
    for r in rows:
        print(f"  {r['setpiece_type']:8s} {r['zone']:12s} goal={r['is_goal']} "
              f"def_box={r['defenders_in_box']} atk_box={r['attackers_in_box']} marking={r['marking_label']}")


if __name__ == "__main__":
    main()
