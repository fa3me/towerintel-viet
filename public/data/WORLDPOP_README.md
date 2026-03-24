# WorldPop population grid (Vietnam)

## Recommended file (free, ~2 MB)

1. Download **WorldPop** unconstrained **1 km** population count GeoTIFF for Vietnam (2020):

   **https://data.worldpop.org/GIS/Population/Global_2000_2020_1km/2020/VNM/vnm_ppp_2020_1km_Aggregated.tif**

2. Save it **exactly** as (include the **`.tif`** extension — on Windows turn on “File name extensions” so it isn’t saved as `vn_ppp_2020_1km_Aggregated.tif.txt`):

   `public/data/vn_ppp_2020_1km_Aggregated.tif`

3. Restart the dev server. The app loads this file at runtime (same-origin `fetch`).

## License & attribution

WorldPop data are typically licensed **CC BY 4.0**. You must **credit WorldPop** and link to their project.  
See: https://www.worldpop.org/ — use the citation they request for your product (research vs commercial may differ).

**Commercial use:** confirm terms on https://www.worldpop.org/ — a commercial licence may be required for some uses.

## Why not ship the TIF in Git?

The file is ~2 MB binary. You may commit it or add `*.tif` to `.gitignore` and download in CI/deploy.

## Higher resolution (100 m)

WorldPop also publishes **~100 m** rasters for Vietnam; files are **much larger** and are **not** loaded by default in this SPA. Use **1 km** for web, or pre-tile / host rasters on a map server for 100 m.

## Map layer vs “true” 1 km spacing

- The **GeoTIFF** is **1 km** per pixel (WorldPop’s grid).
- The **Population Density** overlay does **not** draw every pixel (that would be millions of polygons and slow the browser). It **subsamples** the raster to a capped number of tiles (default ~200k; override with `VITE_POP_MAP_MAX_CELLS` in `.env`).
- When subsampling uses a step **N** &gt; 1, tile **centers** are about **N × 1 km** apart — e.g. **~3–4 km** if N ≈ 3–4. Each tile is a **rectangle** covering **N×N** km² (population in that block is **summed**).
- **Click / radius population** (Geo Context, landbank, etc.) still uses the **full** raster in `getPopulationAtRadii`, not the thinned map tiles.
