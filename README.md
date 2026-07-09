# Deadball Economics

A Next.js, React, and TypeScript set-piece xG lab for exploring corners, free kicks, throw-ins, shot placement, keeper position, defensive walls, and direct free-kick craft.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## App Structure

- `app/deadball-lab.tsx` - interactive set-piece lab UI
- `lib/deadball.ts` - TypeScript xG, grid, marking, wall, freeze-frame, and direct free-kick craft engine
- `app/api/calculate_xg/route.ts` - shot xG endpoint
- `app/api/calculate_xg_grid/route.ts` - heatmap endpoint
- `app/api/health/route.ts` - health endpoint

## Notes

The app runs fully in the Next.js/TypeScript runtime. Direct free kicks support signed curve, dip, knuckle, shot speed, wall size, wall distance, and wall shift controls.
