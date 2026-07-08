"""
Set-piece extractor v3 (production, full corpus).

Adds on top of v2:
  * inferred DEFENSIVE SETUP (zonal/man/mixed) + man_ratio + defender spread,
    from freeze-frame defender vs attacker coordinates.
  * inferred WALL SIZE for direct free kicks (opponents on the ball->goal line).
  * delivery height + short flag (pass.height / pass.length).
  * P(shot): counts set-pieces TAKEN (corner/FK/throw pass events) and the
    resulting shots + StatsBomb-xG sum -> per-set-piece VALUE.

Writes incrementally (survives interruption):
  production/setpiece_shots_v3.csv          (one row per set-piece shot)
  production/setpiece_counts.json           (taken / shots / xg_sum per type)

Usage: python3 extract_v3.py [MAX_MATCHES]   (default = all men's)
"""
import json, urllib.request, math, csv, sys, os
from collections import defaultdict

BASE = "https://raw.githubusercontent.com/statsbomb/open-data/master/data"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_CSV = os.path.join(HERE, "setpiece_shots_v3.csv")
OUT_CNT = os.path.join(HERE, "setpiece_counts.json")
MAX = int(sys.argv[1]) if len(sys.argv) > 1 else 100000

SP_SHOT = {"From Corner": "corner", "From Free Kick": "freekick", "From Throw In": "throwin"}
PASS_TAKEN = {"Corner": "corner", "Free Kick": "freekick", "Throw-in": "throwin"}

def fetch(u):
    r = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"})
    return json.load(urllib.request.urlopen(r, timeout=60))

def dd(ax, ay, bx, by): return math.hypot(ax - bx, ay - by)

def zone_of(x, y):
    if x >= 114 and y < 40:  return "near-post"
    if x >= 114:             return "far-post"
    if x >= 106:             return "penalty-spot" if 36 <= y <= 44 else "central"
    if x >= 102:             return "central"
    if x >= 96:              return "edge"
    return "second-ball"

def marking(ff):
    """Infer zonal/man/mixed from freeze frame. Returns (label, man_ratio, x_std, y_std)."""
    defs = [p["location"] for p in ff if not p.get("teammate") and p.get("position", {}).get("name") != "Goalkeeper"]
    atks = [p["location"] for p in ff if p.get("teammate")]
    bd = [p for p in defs if 102 <= p[0] <= 120 and 18 <= p[1] <= 62]
    ba = [p for p in atks if 102 <= p[0] <= 120 and 18 <= p[1] <= 62]
    if len(bd) < 3 or len(ba) < 1:
        return "", "", "", ""
    # goal-side pairing: defender within 2.5m of an attacker AND closer to goal
    paired = 0
    for d in bd:
        near = min(((dd(d[0], d[1], a[0], a[1]), a) for a in ba), key=lambda t: t[0])
        if near[0] <= 2.5 and d[0] >= near[1][0] - 0.5:  # goal is at x=120
            paired += 1
    r = paired / len(bd)
    xs = [p[0] for p in bd]; ys = [p[1] for p in bd]
    xstd = (sum((x - sum(xs)/len(xs))**2 for x in xs)/len(xs))**0.5
    ystd = (sum((y - sum(ys)/len(ys))**2 for y in ys)/len(ys))**0.5
    lab = "man" if r >= 0.6 else ("zonal" if r <= 0.3 else "mixed")
    return lab, round(r, 3), round(xstd, 2), round(ystd, 2)

def wall_size(ff, ball):
    """Count opponents on the ball->goal line (direct FK wall)."""
    gx, gy = 120.0, 40.0
    bx, by = ball
    vx, vy = gx - bx, gy - by
    L = math.hypot(vx, vy) or 1.0
    ux, uy = vx / L, vy / L
    n = 0
    for p in ff:
        if p.get("teammate"): continue
        if p.get("position", {}).get("name") == "Goalkeeper": continue
        px, py = p["location"]
        t = (px - bx) * ux + (py - by) * uy       # projection along ball->goal
        if t <= 0 or t > L: continue               # must be in front, before goal
        perp = abs((px - bx) * (-uy) + (py - by) * ux)
        if perp <= 1.5:                            # within ~1.5m of the line
            n += 1
    return n

def freeze(shot, loc):
    ff = shot.get("freeze_frame") or []
    f = {"gk_x": "", "gk_y": "", "gk_dist_from_line": "", "gk_off_center": "",
         "nearest_defender_dist": "", "defenders_in_box": 0, "defenders_in_6yard": 0,
         "attackers_in_box": 0, "n_freeze": len(ff)}
    opp, gk = [], None
    box_d, box_a = [], []   # actual box player coordinates (StatsBomb 120x80)
    for p in ff:
        pl = p.get("location", [None, None])
        if pl[0] is None: continue
        if p.get("teammate"):
            if 102 <= pl[0] <= 120 and 18 <= pl[1] <= 62:
                f["attackers_in_box"] += 1; box_a.append([round(pl[0], 1), round(pl[1], 1)])
        else:
            if p.get("position", {}).get("name") == "Goalkeeper": gk = pl
            else:
                opp.append(pl)
                if 102 <= pl[0] <= 120 and 18 <= pl[1] <= 62:
                    f["defenders_in_box"] += 1; box_d.append([round(pl[0], 1), round(pl[1], 1)])
                if pl[0] >= 114 and 30 <= pl[1] <= 50: f["defenders_in_6yard"] += 1
    if gk:
        f["gk_x"], f["gk_y"] = round(gk[0], 2), round(gk[1], 2)
        f["gk_dist_from_line"] = round(120 - gk[0], 2); f["gk_off_center"] = round(abs(gk[1] - 40), 2)
    if opp and loc[0] is not None:
        f["nearest_defender_dist"] = round(min(dd(loc[0], loc[1], o[0], o[1]) for o in opp), 2)
    # real box positions for the pitch view (capped so the CSV cell stays small)
    f["freeze_players"] = json.dumps({"d": box_d[:14], "a": box_a[:14]})
    return f, ff

FIELDS = ["match_id", "competition", "setpiece_type", "shot_type", "is_goal",
          "delivery_technique", "delivery_height", "delivery_length", "is_short_delivery",
          "corner_side", "throw_distance", "body_part", "shot_technique", "is_header",
          "statsbomb_xg", "loc_x", "loc_y", "distance_to_goal", "angle_to_goal", "centrality",
          "zone", "minute", "gk_x", "gk_y", "gk_dist_from_line", "gk_off_center",
          "nearest_defender_dist", "defenders_in_box", "defenders_in_6yard", "attackers_in_box",
          "n_freeze", "marking_label", "man_ratio", "def_x_std", "def_y_std", "wall_size",
          "freeze_players"]

def main():
    comps = fetch(f"{BASE}/competitions.json")
    male = [c for c in comps if c.get("competition_gender") == "male"]
    male.sort(key=lambda c: str(c.get("season_name", "")), reverse=True)
    mids = []
    meta = {}
    for c in male:
        try: ms = fetch(f"{BASE}/matches/{c['competition_id']}/{c['season_id']}.json")
        except Exception: continue
        for m in ms:
            if m["match_id"] not in meta:
                meta[m["match_id"]] = c["competition_name"]; mids.append(m["match_id"])
        if len(mids) >= MAX: break
    mids = mids[:MAX]
    print(f"Extracting {len(mids)} men's matches ...", flush=True)

    counts = defaultdict(lambda: {"taken": 0, "shots": 0, "xg_sum": 0.0})
    fh = open(OUT_CSV, "w", newline=""); w = csv.DictWriter(fh, fieldnames=FIELDS); w.writeheader()
    nrows = done = fails = 0
    for mid in mids:
        try: events = fetch(f"{BASE}/events/{mid}.json")
        except Exception: fails += 1; continue
        by_id = {e["id"]: e for e in events}
        for e in events:
            et = e.get("type", {}).get("name")
            # count set-pieces TAKEN (pass events) for P(shot)
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
                "angle_to_goal": round(math.degrees(math.atan2(abs(loc[1]-40), max(0.1, 120-loc[0]))), 2),
                "centrality": round(abs(loc[1]-40), 2), "zone": zone_of(loc[0], loc[1]),
                "minute": e.get("minute", 0),
                "marking_label": mk[0], "man_ratio": mk[1], "def_x_std": mk[2], "def_y_std": mk[3],
                "wall_size": wall_size(ff, loc) if stype == "Free Kick" else "",
            }
            row.update(fdict)
            w.writerow(row); nrows += 1
        done += 1
        if done % 100 == 0:
            fh.flush()
            with open(OUT_CNT, "w") as cf: json.dump(dict(counts), cf, indent=2)
            print(f"  {done}/{len(mids)} matches, {nrows} shots, {fails} fails", flush=True)
    fh.close()
    with open(OUT_CNT, "w") as cf: json.dump(dict(counts), cf, indent=2)

    # ---- summary ----
    print("\n" + "=" * 60)
    print(f"DONE: {nrows} set-piece shots from {done} matches ({fails} fails)")
    print("=" * 60)
    for sp in ("corner", "freekick", "throwin"):
        c = counts[sp]; taken = c["taken"] or 1
        pshot = c["shots"] / taken
        val = c["xg_sum"] / taken
        print(f"{sp:9s}: taken {c['taken']:5d}  shots {c['shots']:5d}  "
              f"P(shot|sp)={pshot:5.2%}  xG/set-piece={val:.4f}")
    print(f"\nsaved -> {OUT_CSV}\ncounts -> {OUT_CNT}")

if __name__ == "__main__":
    main()
