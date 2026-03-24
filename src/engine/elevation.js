/**
 * TowerIntel PH — Elevation Module v2
 * High-resolution DEM grid fetching with interpolation
 * 
 * Instead of fetching individual points, this module fetches a
 * rectangular grid of elevations covering the entire viewshed area,
 * then provides fast lookups via bilinear interpolation.
 * 
 * This dramatically reduces API calls: 1 grid fetch instead of 22+ batch calls.
 * Uses Open-Meteo Elevation API (free, no key needed)
 */

const ELEVATION_API = 'https://api.open-meteo.com/v1/elevation';
const cache = new Map();

// Delay helper for rate limiting
const delay = (ms) => new Promise(r => setTimeout(r, ms));

// Fetch with timeout (8 seconds default)
function fetchWithTimeout(url, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

/**
 * Get elevation for a single point (with caching)
 */
export async function getElevation(lat, lng) {
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    if (cache.has(key)) return cache.get(key);

    try {
        const res = await fetchWithTimeout(`${ELEVATION_API}?latitude=${lat}&longitude=${lng}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.reason || 'API error');
        const elev = data.elevation?.[0];
        if (elev != null) {
            cache.set(key, elev);
            return elev;
        }
        return null;
    } catch (e) {
        console.warn('⛰️ Elevation lookup failed:', lat.toFixed(4), lng.toFixed(4), e.message);
        return null;
    }
}

/**
 * Batch elevation with retry + throttling
 * @param {Array<{lat: number, lng: number}>} points
 * @returns {Promise<number[]>}
 */
export async function getElevationBatch(points) {
    if (!points || points.length === 0) return [];

    const results = new Array(points.length).fill(null);
    const uncached = [];
    const uncachedIndices = [];

    // Check cache
    points.forEach((p, i) => {
        const key = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
        if (cache.has(key)) {
            results[i] = cache.get(key);
        } else {
            uncached.push(p);
            uncachedIndices.push(i);
        }
    });

    if (uncached.length === 0) return results;

    // Batch in groups of 80 (conservative to avoid URL length limits)
    const BATCH_SIZE = 80;
    let failCount = 0;

    for (let start = 0; start < uncached.length; start += BATCH_SIZE) {
        const batch = uncached.slice(start, start + BATCH_SIZE);
        const lats = batch.map(p => p.lat.toFixed(4)).join(',');
        const lngs = batch.map(p => p.lng.toFixed(4)).join(',');

        // Retry up to 3 times with backoff
        let success = false;
        for (let retry = 0; retry < 3 && !success; retry++) {
            try {
                if (retry > 0) {
                    const backoff = 1000 * Math.pow(2, retry);
                    console.log(`⏳ Retry ${retry}/3 after ${backoff}ms...`);
                    await delay(backoff);
                }

                const res = await fetchWithTimeout(`${ELEVATION_API}?latitude=${lats}&longitude=${lngs}`);
                if (!res.ok) {
                    if (res.status === 429 || res.status === 403) {
                        console.warn(`⛰️ Rate limited (${res.status}), waiting...`);
                        await delay(2000 * (retry + 1));
                        continue;
                    }
                    throw new Error(`HTTP ${res.status}`);
                }

                const data = await res.json();
                if (data.error) {
                    console.warn('⛰️ API error:', data.reason);
                    await delay(2000);
                    continue;
                }

                const elevations = data.elevation || [];
                batch.forEach((p, j) => {
                    const elev = elevations[j];
                    const idx = uncachedIndices[start + j];
                    if (elev != null) {
                        const key = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
                        cache.set(key, elev);
                        results[idx] = elev;
                    }
                });
                success = true;
            } catch (e) {
                console.warn(`⛰️ Batch elevation failed (attempt ${retry + 1}):`, e.message);
                failCount++;
            }
        }

        // Small delay between batches to avoid rate limiting
        if (start + BATCH_SIZE < uncached.length) {
            await delay(200);
        }
    }

    if (failCount > 0) {
        console.warn(`⛰️ ${failCount} batch(es) failed — some elevations may be null`);
    }

    return results;
}

/**
 * Fetch a regular DEM grid covering the viewshed area
 * This is much more efficient than point-by-point lookups
 * 
 * @param {number} centerLat - Tower latitude
 * @param {number} centerLng - Tower longitude
 * @param {number} radiusKm - Max viewshed radius in km
 * @param {number} gridRes - Grid resolution in meters (default 100m)
 * @returns {Promise<Object>} DEM grid with lookup function
 */
export async function fetchDEMGrid(centerLat, centerLng, radiusKm, gridRes = 100) {
    // Calculate grid bounds from center + radius
    const radiusM = radiusKm * 1000;
    const latPerM = 1 / 111320;                       // ~111km per degree latitude
    const lngPerM = 1 / (111320 * Math.cos(centerLat * Math.PI / 180));

    const latSpan = radiusM * latPerM;  // radius in degrees lat
    const lngSpan = radiusM * lngPerM;  // radius in degrees lng

    const minLat = centerLat - latSpan;
    const maxLat = centerLat + latSpan;
    const minLng = centerLng - lngSpan;
    const maxLng = centerLng + lngSpan;

    // Build a regular grid of points at ~gridRes resolution
    const latStep = gridRes * latPerM;
    const lngStep = gridRes * lngPerM;

    const gridLats = [];
    const gridLngs = [];
    for (let lat = minLat; lat <= maxLat; lat += latStep) gridLats.push(lat);
    for (let lng = minLng; lng <= maxLng; lng += lngStep) gridLngs.push(lng);

    const numRows = gridLats.length;
    const numCols = gridLngs.length;
    const totalPoints = numRows * numCols;

    console.log(`⛰️ DEM Grid: ${numRows}×${numCols} = ${totalPoints} points at ${gridRes}m resolution`);

    // Generate all grid points
    const allPoints = [];
    for (let r = 0; r < numRows; r++) {
        for (let c = 0; c < numCols; c++) {
            allPoints.push({ lat: gridLats[r], lng: gridLngs[c] });
        }
    }

    // Fetch all elevations
    const elevations = await getElevationBatch(allPoints);

    // Build 2D grid
    const grid = [];
    for (let r = 0; r < numRows; r++) {
        grid[r] = [];
        for (let c = 0; c < numCols; c++) {
            grid[r][c] = elevations[r * numCols + c];
        }
    }

    // Count valid values
    const validCount = elevations.filter(e => e != null).length;
    const validPct = ((validCount / totalPoints) * 100).toFixed(1);
    console.log(`⛰️ DEM Grid: ${validCount}/${totalPoints} valid elevations (${validPct}%)`);

    // Fill null cells with nearest neighbor average
    for (let r = 0; r < numRows; r++) {
        for (let c = 0; c < numCols; c++) {
            if (grid[r][c] == null) {
                const neighbors = [];
                for (let dr = -1; dr <= 1; dr++) {
                    for (let dc = -1; dc <= 1; dc++) {
                        const nr = r + dr, nc = c + dc;
                        if (nr >= 0 && nr < numRows && nc >= 0 && nc < numCols && grid[nr][nc] != null) {
                            neighbors.push(grid[nr][nc]);
                        }
                    }
                }
                grid[r][c] = neighbors.length > 0
                    ? neighbors.reduce((a, b) => a + b, 0) / neighbors.length
                    : 0;
            }
        }
    }

    /**
     * Bilinear interpolation lookup
     * @param {number} lat
     * @param {number} lng
     * @returns {number} interpolated elevation in meters
     */
    function lookup(lat, lng) {
        // Convert lat/lng to fractional grid indices
        const rFrac = (lat - minLat) / latStep;
        const cFrac = (lng - minLng) / lngStep;

        // Clamp to grid bounds
        const r0 = Math.max(0, Math.min(numRows - 2, Math.floor(rFrac)));
        const c0 = Math.max(0, Math.min(numCols - 2, Math.floor(cFrac)));
        const r1 = r0 + 1;
        const c1 = c0 + 1;

        const rF = rFrac - r0;
        const cF = cFrac - c0;

        // Bilinear interpolation
        const q00 = grid[r0]?.[c0] ?? 0;
        const q01 = grid[r0]?.[c1] ?? 0;
        const q10 = grid[r1]?.[c0] ?? 0;
        const q11 = grid[r1]?.[c1] ?? 0;

        return q00 * (1 - rF) * (1 - cF)
            + q01 * (1 - rF) * cF
            + q10 * rF * (1 - cF)
            + q11 * rF * cF;
    }

    return {
        lookup,
        grid,
        bounds: { minLat, maxLat, minLng, maxLng },
        resolution: gridRes,
        rows: numRows, cols: numCols,
        totalPoints, validCount
    };
}
