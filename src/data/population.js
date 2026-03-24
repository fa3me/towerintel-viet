/**
 * TowerIntel Vietnam — population layer.
 *
 * Priority:
 * 1) WorldPop **1 km** GeoTIFF in `public/data/vn_ppp_2020_1km_Aggregated.tif` (see public/data/WORLDPOP_README.md)
 * 2) Synthetic grid scaled to World Bank national total (fallback)
 *
 * Note: GADM = boundaries only (not population). GPW ≈1 km. WorldPop offers 100 m but files are huge for browsers.
 */

import { VIETNAM_BOUNDS, WB_COUNTRY_ISO3, WB_POP_INDICATOR } from '../config/app-config.js';
import { isPointInVietnamLand } from './vn-geo.js';

let cells = null;
let isLoading = false;
let loadPromise = null;
const cache = new Map();

/** @type {{ data: Float32Array, width: number, height: number, oX: number, oY: number, rX: number, rY: number } | null} */
let worldpopRaster = null;

/** 'worldpop-1km' | 'synthetic-wb' */
let populationDataSource = 'synthetic-wb';

let worldBankNationalPop = null;
let worldBankYear = null;

const WORLDPOP_PUBLIC_PATH = import.meta.env.VITE_WORLDPOP_TIF_URL || '/data/vn_ppp_2020_1km_Aggregated.tif';

/**
 * Latest total population from World Bank API (Vietnam) — used for meta when using synthetic fallback;
 * when WorldPop loads, we also set totals from raster sum.
 */
export async function fetchWorldBankVietnamPopulation() {
    const url = `https://api.worldbank.org/v2/country/${WB_COUNTRY_ISO3}/indicator/${WB_POP_INDICATOR}?format=json&per_page=50`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`World Bank HTTP ${res.status}`);
    const data = await res.json();
    const rows = data?.[1];
    if (!Array.isArray(rows) || rows.length === 0) return { population: null, year: null };
    for (const row of rows) {
        const v = row.value;
        const y = row.date ? parseInt(row.date, 10) : null;
        if (v != null && Number.isFinite(Number(v)) && Number(v) > 0) {
            return { population: Math.round(Number(v)), year: y };
        }
    }
    return { population: null, year: null };
}

/**
 * Geographic size of one GeoTIFF pixel in km² from resolution in degrees (WorldPop, etc.).
 * Vietnam uses WorldPop **~1 km** cells — not 20 m BIL pixels (do not use 0.0004 km² here).
 */
function geoTiffPixelAreaKm2(latDeg, rXDeg, rYDeg) {
    const kmPerDegLat = 111;
    const kmPerDegLng = 111 * Math.cos((latDeg * Math.PI) / 180);
    return Math.abs(rXDeg) * kmPerDegLng * Math.abs(rYDeg) * kmPerDegLat;
}

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** ~2 km between cell centers — synthetic fallback only */
const GRID_STEP_DEG = 0.018;

function hubWeight(lat, lng) {
    const hubs = [
        [21.03, 105.85],
        [10.82, 106.63],
        [16.05, 108.22],
        [12.25, 109.18]
    ];
    const n = (Math.sin(lat * 491.7 + lng * 317.1) + 1) * 0.25;
    let w = 0.35 + n;
    for (const [hlat, hlng] of hubs) {
        const dx = (lat - hlat) * 111;
        const dy = (lng - hlng) * 111 * Math.cos((lat * Math.PI) / 180);
        const d = Math.sqrt(dx * dx + dy * dy);
        w += 3 * Math.exp(-d / 120);
    }
    return w;
}

function buildSyntheticGrid(nationalPop) {
    const { west, south, east, north } = VIETNAM_BOUNDS;
    const target = nationalPop && nationalPop > 0 ? nationalPop : 100_000_000;
    const weights = [];
    const step = GRID_STEP_DEG;
    for (let lat = south + step / 2; lat < north; lat += step) {
        for (let lng = west + step / 2; lng < east; lng += step) {
            if (!isPointInVietnamLand(lat, lng)) continue;
            weights.push({ lat, lng, w: hubWeight(lat, lng) });
        }
    }
    if (weights.length === 0) {
        console.warn('⚠️ No land grid cells; falling back to sparse random sample');
        return buildSparseFallbackGrid(target);
    }
    const sumW = weights.reduce((s, x) => s + x.w, 0);
    const out = weights.map(({ lat, lng, w }) => ({
        lat,
        lng,
        population: (target * w) / sumW
    }));
    out.sort((a, b) => a.lat - b.lat);
    console.log(`📊 Synthetic land grid: ${out.length.toLocaleString()} cells (step ≈ ${step}°)`);
    return out;
}

function buildSparseFallbackGrid(target) {
    const { west, south, east, north } = VIETNAM_BOUNDS;
    const weights = [];
    let attempts = 0;
    const nCells = 80000;
    while (weights.length < nCells && attempts < nCells * 50) {
        attempts++;
        const lat = south + Math.random() * (north - south);
        const lng = west + Math.random() * (east - west);
        if (!isPointInVietnamLand(lat, lng)) continue;
        weights.push({ lat, lng, w: hubWeight(lat, lng) });
    }
    const sumW = weights.reduce((s, x) => s + x.w, 0);
    const out = weights.map(({ lat, lng, w }) => ({
        lat,
        lng,
        population: (target * w) / sumW
    }));
    out.sort((a, b) => a.lat - b.lat);
    return out;
}

/** Max polygons drawn for the population map layer (full raster can be millions of pixels). */
const POP_MAP_MAX_CELLS = Number(import.meta.env.VITE_POP_MAP_MAX_CELLS) || 200_000;

/**
 * Geographic rectangle for one raster block (handles negative rY / rX from GeoTIFF).
 */
function rasterBlockPolygon(oX, oY, rX, rY, ix, iy, sx, sy) {
    const lng1 = oX + ix * rX;
    const lng2 = oX + (ix + sx) * rX;
    const lat1 = oY + iy * rY;
    const lat2 = oY + (iy + sy) * rY;
    const minLng = Math.min(lng1, lng2);
    const maxLng = Math.max(lng1, lng2);
    const minLat = Math.min(lat1, lat2);
    const maxLat = Math.max(lat1, lat2);
    return [
        [minLng, minLat],
        [maxLng, minLat],
        [maxLng, maxLat],
        [minLng, maxLat],
        [minLng, minLat]
    ];
}

/**
 * Downsample WorldPop raster to cells for the map (cap ~POP_MAP_MAX_CELLS).
 * Each cell is a **sum** over an sx×sy block of 1 km pixels; spacing between centers is
 * ~step km when step>1 (performance tradeoff). Analytics (`getPopulationAtRadii`) still use the full raster.
 */
function rasterToMapCells(r) {
    const { data, width, height, oX, oY, rX, rY } = r;
    const step = Math.max(1, Math.floor(Math.sqrt((width * height) / POP_MAP_MAX_CELLS)));
    const out = [];
    for (let iy = 0; iy < height; iy += step) {
        for (let ix = 0; ix < width; ix += step) {
            const sx = Math.min(step, width - ix);
            const sy = Math.min(step, height - iy);
            let sum = 0;
            for (let yy = iy; yy < iy + sy; yy++) {
                for (let xx = ix; xx < ix + sx; xx++) {
                    const v = data[yy * width + xx];
                    if (v > 0 && isFinite(v)) sum += v;
                }
            }
            if (sum <= 0) continue;
            const plng = oX + (ix + sx / 2) * rX;
            const plat = oY + (iy + sy / 2) * rY;
            if (!isPointInVietnamLand(plat, plng)) continue;
            const polygon = rasterBlockPolygon(oX, oY, rX, rY, ix, iy, sx, sy);
            const kmPerDegLat = 111;
            const kmPerDegLng = 111 * Math.cos((plat * Math.PI) / 180);
            const blockWkm = Math.abs(sx * rX) * kmPerDegLng;
            const blockHkm = Math.abs(sy * rY) * kmPerDegLat;
            const blockAreaKm2 = Math.max(blockWkm * blockHkm, 1e-6);
            out.push({
                lat: plat,
                lng: plng,
                population: sum,
                polygon,
                /** Geographic area of this subsampled block (for per-km² density tint) */
                blockAreaKm2
            });
        }
    }
    out.sort((a, b) => a.lat - b.lat);
    return out;
}

async function tryLoadWorldPopGeoTiff() {
    try {
        const res = await fetch(WORLDPOP_PUBLIC_PATH);
        if (!res.ok) {
            console.info(`[population] WorldPop TIF not found (${res.status}): ${WORLDPOP_PUBLIC_PATH}`);
            return false;
        }
        const { fromArrayBuffer } = await import('geotiff');
        const buf = await res.arrayBuffer();
        const tiff = await fromArrayBuffer(buf);
        const image = await tiff.getImage();
        const width = image.getWidth();
        const height = image.getHeight();
        const [oX, oY] = image.getOrigin();
        const [rX, rY] = image.getResolution();
        const rasters = await image.readRasters();
        const raw = rasters[0];
        const data = raw instanceof Float32Array ? raw : new Float32Array(raw);

        let total = 0;
        for (let i = 0; i < data.length; i++) {
            const v = data[i];
            if (v > 0 && isFinite(v)) total += v;
        }

        worldpopRaster = { data, width, height, oX, oY, rX, rY };
        worldBankNationalPop = Math.round(total);
        worldBankYear = 2020;
        populationDataSource = 'worldpop-1km';
        cells = rasterToMapCells(worldpopRaster);
        const midLat = oY + (height / 2) * rY;
        const approxKm2 = geoTiffPixelAreaKm2(midLat, rX, rY);
        console.log(
            `✅ WorldPop 1 km raster: ${width}×${height} px, sum ≈ ${worldBankNationalPop.toLocaleString()} · map cells ${cells.length.toLocaleString()} · pixel ≈ ${approxKm2.toFixed(3)} km² @ mid-lat (radii use counts per cell, not 20 m × 0.0004)`
        );
        return true;
    } catch (e) {
        console.warn('[population] WorldPop load failed:', e?.message || e);
        worldpopRaster = null;
        return false;
    }
}

async function _doLoad() {
    if (cells) return cells;
    if (isLoading) return loadPromise;
    isLoading = true;
    cache.clear();
    try {
        console.log('📡 Loading Vietnam population…');
        const wb = await fetchWorldBankVietnamPopulation();
        const ok = await tryLoadWorldPopGeoTiff();
        if (!ok) {
            populationDataSource = 'synthetic-wb';
            worldBankNationalPop = wb.population;
            worldBankYear = wb.year;
            if (wb.population) {
                console.log(`✅ World Bank Vietnam population (scaling synthetic grid): ${wb.population.toLocaleString()} (${wb.year || 'year n/a'})`);
            } else {
                console.warn('⚠️ World Bank population unavailable — using fallback total for grid scaling');
            }
            cells = buildSyntheticGrid(wb.population || 100_000_000);
            console.log(`✅ Population grid ready (synthetic): ${cells.length} cells`);
        }
    } catch (err) {
        console.error('❌ Population load failed:', err);
        populationDataSource = 'synthetic-wb';
        cells = buildSyntheticGrid(100_000_000);
    } finally {
        isLoading = false;
    }
    return cells;
}

export function preloadPopulationData() {
    if (!loadPromise) loadPromise = _doLoad();
    return loadPromise;
}

export function getWorldBankPopulationMeta() {
    return {
        population: worldBankNationalPop,
        year: worldBankYear,
        source: populationDataSource
    };
}

export function getPopulationGridCells() {
    return cells || [];
}

function lowerBound(targetLat) {
    let lo = 0;
    let hi = cells.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (cells[mid].lat < targetLat) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/**
 * Sum population inside 500 m / 1 km / 1.5 km disks using full WorldPop raster.
 * Cell values are **population counts per grid cell** (ppp product), ~1 km spacing from GeoTIFF rX/rY —
 * not density × 20 m pixel area (0.0004 km²).
 */
function sumRadiiFromWorldPop(lat, lng) {
    const { data, width, height, oX, oY, rX, rY } = worldpopRaster;
    // ~0.025° ≈ 2.8 km lat — bbox must fully cover 1.5 km haversine disk (incl. diagonal corners)
    const m = 0.025;
    const colLo = (lng - m - oX) / rX;
    const colHi = (lng + m - oX) / rX;
    const rowLo = (lat - m - oY) / rY;
    const rowHi = (lat + m - oY) / rY;
    const ixMin = Math.max(0, Math.floor(Math.min(colLo, colHi)));
    const ixMax = Math.min(width - 1, Math.ceil(Math.max(colLo, colHi)));
    const iyMin = Math.max(0, Math.floor(Math.min(rowLo, rowHi)));
    const iyMax = Math.min(height - 1, Math.ceil(Math.max(rowLo, rowHi)));

    let sum500 = 0;
    let sum1km = 0;
    let sum15km = 0;

    for (let iy = iyMin; iy <= iyMax; iy++) {
        for (let ix = ixMin; ix <= ixMax; ix++) {
            const plng = oX + (ix + 0.5) * rX;
            const plat = oY + (iy + 0.5) * rY;
            const d = haversineKm(lat, lng, plat, plng);
            const v = data[iy * width + ix];
            if (!v || v <= 0 || !isFinite(v)) continue;
            if (d <= 0.5) sum500 += v;
            if (d <= 1.0) sum1km += v;
            if (d <= 1.5) sum15km += v;
        }
    }
    return { sum500, sum1km, sum15km };
}

export async function getPopulationAtRadii(lat, lng) {
    if (!cells) await preloadPopulationData();
    if (!cells || cells.length === 0) {
        return { density_per_sqkm: 0, radius_500m: 0, radius_1km: 0, radius_1_5km: 0, terrain_type: 'Rural' };
    }
    const cacheKey = `${lat.toFixed(4)}|${lng.toFixed(4)}|${populationDataSource}|v500imp`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    let sum500 = 0;
    let sum1km = 0;
    let sum15km = 0;

    if (worldpopRaster) {
        const s = sumRadiiFromWorldPop(lat, lng);
        sum500 = s.sum500;
        sum1km = s.sum1km;
        sum15km = s.sum15km;
        // 1 km grid: query points can fall between cell centers → no pixel within 500 m → sum500=0.
        // Impute using disk area ratio A(500m)/A(1km) = 0.25² = 0.25 (uniform-density approximation).
        if (sum500 === 0 && sum1km > 0) {
            sum500 = sum1km * 0.25;
        }
    } else {
        const LAT_BAND = 0.022;
        const startIdx = lowerBound(lat - LAT_BAND);
        const endIdx = lowerBound(lat + LAT_BAND);
        const lngFactor = Math.cos((lat * Math.PI) / 180);
        const LNG_BAND = LAT_BAND / (lngFactor || 1);

        const R = 6371;
        for (let i = startIdx; i < endIdx; i++) {
            const c = cells[i];
            const dLng = c.lng - lng;
            if (dLng < -LNG_BAND || dLng > LNG_BAND) continue;
            const popVal = c.population ?? 0;
            const dLatRad = ((c.lat - lat) * Math.PI) / 180;
            const dLngRad = (dLng * Math.PI) / 180;
            const a =
                Math.sin(dLatRad / 2) * Math.sin(dLatRad / 2) +
                Math.cos((lat * Math.PI) / 180) * Math.cos((c.lat * Math.PI) / 180) * Math.sin(dLngRad / 2) * Math.sin(dLngRad / 2);
            const c_rad = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            const distKm = R * c_rad;
            if (distKm <= 0.5) sum500 += popVal;
            if (distKm <= 1.0) sum1km += popVal;
            if (distKm <= 1.5) sum15km += popVal;
        }

        const cellAreaKm2 = (GRID_STEP_DEG * 111) * (GRID_STEP_DEG * 111 * lngFactor);

        if (sum500 === 0 && sum1km > 0) {
            sum500 = Math.round(sum1km * (0.5 * 0.5) / (1 * 1));
        }

        if (sum500 === 0 && sum1km === 0 && sum15km === 0) {
            let best = null;
            let bestD = Infinity;
            for (let j = 0; j < cells.length; j++) {
                const c = cells[j];
                const d = haversineKm(lat, lng, c.lat, c.lng);
                if (d < bestD) {
                    bestD = d;
                    best = c;
                }
            }
            if (best && bestD < 30) {
                const p = best.population ?? 0;
                const share = (rKm) => Math.min(p, p * ((Math.PI * rKm * rKm) / cellAreaKm2));
                sum500 = Math.round(share(0.5));
                sum1km = Math.round(share(1.0));
                sum15km = Math.round(share(1.5));
            }
        }
    }

    const density = sum1km / Math.PI;
    let terrain;
    if (sum1km >= 9000) terrain = 'Dense Urban';
    else if (sum1km >= 5000) terrain = 'Urban';
    else if (sum1km >= 3000) terrain = 'Suburban';
    else terrain = 'Rural';

    const result = {
        density_per_sqkm: Math.round(density),
        radius_500m: Math.round(sum500),
        radius_1km: Math.round(sum1km),
        radius_1_5km: Math.round(sum15km),
        terrain_type: terrain
    };
    cache.set(cacheKey, result);
    return result;
}
