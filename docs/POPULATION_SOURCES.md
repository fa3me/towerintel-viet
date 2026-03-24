# Population data sources (comparison)

| Source | What it is | Typical resolution | Free? |
|--------|------------|-------------------|--------|
| **WorldPop** | Gridded **population counts** (people per cell), many countries | **100 m** and **1 km** products exist for Vietnam | **Yes** for many academic / non-commercial uses under **CC BY 4.0**; **check** [worldpop.org](https://www.worldpop.org/) for **commercial** licensing |
| **GPW (SEDAC / NASA)** | Gridded population | **~30 arc-seconds** (~1 km at equator) in recent versions | **Free** for many uses; **read** NASA SEDAC terms |
| **GADM** | **Administrative boundaries** (polygons), **not** population rasters | N/A (it’s geography, not people) | **Free** for non-commercial; **commercial** licence available |
| **World Bank `SP.POP.TOTL`** | **One number per country per year** | Not gridded | Open API |

**This app** uses, in order:

1. **`public/data/vn_ppp_2020_1km_Aggregated.tif`** — WorldPop **1 km** Vietnam 2020 (you download it), **or**
2. **Synthetic grid** scaled to World Bank national total — fallback if the TIF is missing.

**Best balance for a browser app:** WorldPop **1 km** (~2 MB) — good detail without multi‑GB 100 m rasters.
