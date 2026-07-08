"""
Validation-set extractor - a genuine HOLDOUT for the Deadball models.

The models were trained on every *male* StatsBomb competition (see extract_v3.py).
So this pulls *female* competitions instead - matches the models have never seen -
and writes them in the exact same schema as setpiece_shots_v3.csv. Upload the
result in the app's "Validate match data" panel to see how the model holds up on
unseen shots.

Usage: python3 extract_validation.py [MAX_MATCHES]   (default 250)
Output: production/sample_validation.csv
"""
import json, urllib.request, math, csv, sys, os
from collections import defaultdict

BASE = "https://raw.githubusercontent.com/statsbomb/open-data/master/data"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_CSV = os.path.join(HERE, "sample_validation.csv")
MAX = int(sys.argv[1]) if len(sys.argv) > 1 else 250
GENDER = "female"

# --- reuse the exact feature logic from extract_v3 ---
import importlib.util
_spec = importlib.util.spec_from_file_location("ev3", os.path.join(HERE, "extract_v3.py"))
ev3 = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(ev3)
fetch, dd, zone_of, marking, wall_size, freeze = (
    ev3.fetch, ev3.dd, ev3.zone_of, ev3.marking, ev3.wall_size, ev3.freeze)
SP_SHOT, PASS_TAKEN, FIELDS = ev3.SP_SHOT, ev3.PASS_TAKEN, ev3.FIELDS


def main():
    comps = fetch(f"{BASE}/competitions.json")
    sel = [c for c in comps if c.get("competition_gender") == GENDER]
    sel.sort(key=lambda c: str(c.get("season_name", "")), reverse=True)
    mids, meta = [], {}
    for c in sel:
        try:
            ms = fetch(f"{BASE}/matches/{c['competition_id']}/{c['season_id']}.json")
        except Exception:
            continue
        for m in ms:
            if m["match_id"] not in meta:
                meta[m["match_id"]] = c["competition_name"]; mids.append(m["match_id"])
        if len(mids) >= MAX:
            break
    mids = mids[:MAX]
    print(f"Extracting {len(mids)} {GENDER} (holdout) matches ...", flush=True)

    counts = defaultdict(lambda: {"taken": 0, "shots": 0, "xg_sum": 0.0})
    fh = open(OUT_CSV, "w", newline=""); w = csv.DictWriter(fh, fieldnames=FIELDS); w.writeheader()
    nrows = done = fails = 0
    for mid in mids:
        try:
            events = fetch(f"{BASE}/events/{mid}.json")
        except Exception:
            fails += 1; continue
        by_id = {e["id"]: e for e in events}
        for e in events:
            et = e.get("type", {}).get("name")
            if et == "Pass":
                pt = e.get("pass", {}).get("type", {}).get("name")
                if pt in PASS_TAKEN: counts[PASS_TAKEN[pt]]["taken"] += 1
                continue
            if et != "Shot": continue
            sp = SP_SHOT.get(e.get("play_pattern", {}).get("name", ""))
            if not sp: continue
            shot = e.get("shot", {}); loc = e.get("location", [None, None])
            if loc[0] is None: continue
            kp = by_id.get(shot.get("key_pass_id"), {}); pobj = kp.get("pass", {})
            pstart = kp.get("location", [None, None]); plen = pobj.get("length")
            fdict, ff = freeze(shot, loc)
            mk = marking(ff)
            stype = shot.get("type", {}).get("name", "")
            xg = shot.get("statsbomb_xg", 0.0)
            counts[sp]["shots"] += 1; counts[sp]["xg_sum"] += xg
            row = {
                "match_id": mid, "competition": meta.get(mid, ""), "setpiece_type": sp,
                "shot_type": stype, "is_goal": 1 if shot.get("outcome", {}).get("name") == "Goal" else 0,
                "delivery_technique": pobj.get("technique", {}).get("name", ""),
                "delivery_height": pobj.get("height", {}).get("name", ""),
                "delivery_length": round(plen, 1) if plen else "",
                "is_short_delivery": 1 if (plen and plen < 8) else 0,
                "corner_side": ("right" if pstart[1] is not None and pstart[1] < 40 else "left") if sp == "corner" and pstart[1] is not None else "",
                "throw_distance": round(plen, 1) if sp == "throwin" and plen else "",
                "body_part": shot.get("body_part", {}).get("name", ""),
                "shot_technique": shot.get("technique", {}).get("name", ""),
                "is_header": 1 if shot.get("body_part", {}).get("name") == "Head" else 0,
                "statsbomb_xg": round(xg, 4),
                "loc_x": loc[0], "loc_y": loc[1],
                "distance_to_goal": round(dd(loc[0], loc[1], 120, 40), 2),
                "angle_to_goal": round(math.degrees(math.atan2(abs(loc[1] - 40), max(0.1, 120 - loc[0]))), 2),
                "centrality": round(abs(loc[1] - 40), 2), "zone": zone_of(loc[0], loc[1]),
                "minute": e.get("minute", 0),
                "marking_label": mk[0], "man_ratio": mk[1], "def_x_std": mk[2], "def_y_std": mk[3],
                "wall_size": wall_size(ff, loc) if stype == "Free Kick" else "",
            }
            row.update(fdict)
            w.writerow(row); nrows += 1
        done += 1
        if done % 50 == 0:
            fh.flush()
            print(f"  {done}/{len(mids)} matches, {nrows} shots, {fails} fails", flush=True)
    fh.close()

    print("\n" + "=" * 60)
    print(f"DONE: {nrows} set-piece shots from {done} {GENDER} matches ({fails} fails)")
    for sp in ("corner", "freekick", "throwin"):
        c = counts[sp]; g = 0
        print(f"{sp:9s}: shots {c['shots']:5d}")
    print(f"saved -> {OUT_CSV}")


if __name__ == "__main__":
    main()
