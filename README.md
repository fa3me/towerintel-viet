# TowerIntel Vietnam

Geospatial tower intelligence for Vietnam: **World Bank** national population (`SP.POP.TOTL` for `VNM`), synthetic in-country grid, operators **Viettel / Vinaphone / Mobifone / Vietnamobile**, and optional **Supabase** sign-in with owner approval for **view** and **download** (CSV + PDF).

## Population data (WorldPop)

For **real** gridded counts, download WorldPop **1 km** Vietnam 2020 GeoTIFF (~2 MB) and place it as:

`public/data/vn_ppp_2020_1km_Aggregated.tif`

See **`public/data/WORLDPOP_README.md`** and **`docs/POPULATION_SOURCES.md`**.  
If the file is missing, the app falls back to a **synthetic** grid scaled to the **World Bank** national total.

## Local dev

```bash
npm install
npm run dev
```

Without Supabase env vars, the app runs **without login** (full access for development).

## Production auth (Supabase)

1. Create a Supabase project; enable **Email** auth.
2. Copy `.env.example` to `.env.local` and set:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_OWNER_EMAIL` — your login email (full access + **Access approvals** button).
3. In the Supabase SQL editor, run `supabase/migrations/001_profiles.sql` after replacing `YOUR_OWNER_EMAIL` with the same address as `VITE_OWNER_EMAIL`.
4. Deploy or run `npm run build` and host `dist/`.

New users get `approved_view` / `approved_download` = false until the owner toggles them in **Access approvals**.

## Build

```bash
npm run build
```

Output: `dist/`.
