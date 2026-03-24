/**
 * TowerIntel PH — RF Propagation Engine v4
 * Google Earth-Quality Viewshed with DEM Grid Ray Tracing
 * 
 * Approach:
 * 1. Fetch a rectangular DEM grid covering the viewshed area (one batch)
 * 2. For each azimuth, sample terrain at high resolution using the cached grid
 * 3. True ray tracing: check ALL intermediate terrain points along each ray
 * 4. Green = visible (LOS clear), Red = blocked by terrain
 */
import { fetchDEMGrid, getElevation } from './elevation.js';

// ===================== PATH LOSS MODELS =====================

export function fspl(d, f) {
    if (d <= 0 || f <= 0) return 0;
    return 32.45 + 20 * Math.log10(d) + 20 * Math.log10(f);
}

export function cost231Hata(d, f, hb, hm = 1.5, terrain = 'Urban') {
    if (d <= 0 || f <= 0) return 0;
    let aHm;
    if (terrain === 'Urban') {
        aHm = 3.2 * Math.pow(Math.log10(11.75 * hm), 2) - 4.97;
    } else {
        aHm = (1.1 * Math.log10(f) - 0.7) * hm - (1.56 * Math.log10(f) - 0.8);
    }
    const Cm = terrain === 'Urban' ? 3 : 0;
    return 46.3 + 33.9 * Math.log10(f) - 13.82 * Math.log10(hb) - aHm
        + (44.9 - 6.55 * Math.log10(hb)) * Math.log10(d) + Cm;
}

export function threegppUMa(d, f, hb) {
    if (d <= 0 || f <= 0) return 0;
    const d3d = d * 1000;
    const fc = f / 1000;
    if (d3d < 10) return fspl(d, f);
    const dBP = Math.max(4 * (hb - 1) * 0.5 * f * 1e6 / 3e8, 10);
    if (d3d <= dBP) return 28.0 + 22 * Math.log10(d3d) + 20 * Math.log10(fc);
    return 28.0 + 40 * Math.log10(d3d) - 9 * Math.log10(dBP * dBP + (hb - 1.5) ** 2) + 20 * Math.log10(fc);
}

export function threegppUMi(d, f) {
    if (d <= 0 || f <= 0) return 0;
    const d3d = d * 1000;
    const fc = f / 1000;
    if (d3d < 10) return fspl(d, f);
    return 32.4 + 21 * Math.log10(d3d) + 20 * Math.log10(fc);
}

export function threegppRMa(d, f, hb) {
    if (d <= 0 || f <= 0) return 0;
    const d3d = d * 1000;
    const fc = f / 1000;
    if (d3d < 10) return fspl(d, f);
    return 20 * Math.log10(40 * Math.PI * d3d * fc / 3)
        - Math.min(0.03 * hb ** 1.72, 10) * Math.log10(d3d)
        - Math.min(0.044 * hb ** 1.72, 14.77)
        + 0.002 * Math.log10(hb) * d3d;
}

export function autoSelectModel(f, hb, terrain) {
    if (terrain === 'Rural') return 'RMa';
    if (hb <= 25) return 'UMi';
    if (f >= 1500 && f <= 2000) return 'Cost-231';
    return 'UMa';
}

export function getPathLoss(model, d, f, hb, terrain = 'Suburban') {
    switch (model) {
        case 'FSPL': return fspl(d, f);
        case 'Cost-231': return cost231Hata(d, f, hb, 1.5, terrain);
        case 'UMa': return threegppUMa(d, f, hb);
        case 'UMi': return threegppUMi(d, f);
        case 'RMa': return threegppRMa(d, f, hb);
        case 'Auto': return getPathLoss(autoSelectModel(f, hb, terrain), d, f, hb, terrain);
        default: return fspl(d, f);
    }
}

// ===================== COVERAGE RADIUS =====================

export function calculateCoverageRadius(params) {
    const {
        height_m = 30, frequency_mhz = 1800, tx_power_dbm = 43,
        model = 'Auto', terrain_type = 'Suburban', rsrp_threshold = -100,
        site_elevation_m = 0
    } = params;
    const effectiveHeight = site_elevation_m + height_m;
    const eirp = tx_power_dbm + 18 - 3;
    const maxPL = eirp - rsrp_threshold;
    let lo = 0.01, hi = 50.0, mid;
    for (let i = 0; i < 50; i++) {
        mid = (lo + hi) / 2;
        if (getPathLoss(model, mid, frequency_mhz, effectiveHeight, terrain_type) < maxPL) lo = mid;
        else hi = mid;
    }
    return parseFloat(mid.toFixed(3));
}

// ===================== VIEWSHED ENGINE =====================

const DEG_TO_RAD = Math.PI / 180;
const EARTH_RADIUS = 6371000;

function movePoint(lat, lng, distanceM, bearingDeg) {
    const d = distanceM / EARTH_RADIUS;
    const b = bearingDeg * DEG_TO_RAD;
    const lat1 = lat * DEG_TO_RAD;
    const lng1 = lng * DEG_TO_RAD;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
    const lng2 = lng1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    return { lat: lat2 / DEG_TO_RAD, lng: lng2 / DEG_TO_RAD };
}

/**
 * Google Earth-quality Viewshed with DEM Grid Ray Tracing
 * 
 * KEY DIFFERENCES from v3:
 * 1. Fetches a full DEM grid ONCE (not per-point API calls)
 * 2. Uses bilinear interpolation for O(1) elevation lookups
 * 3. Samples terrain along each ray at grid resolution (~100m)
 * 4. For each OUTPUT cell, traces ray through many fine-grained
 *    intermediate terrain samples to detect obstructions
 * 
 * @param {Object} tower - { lat, lng, height_m, elevation_m }
 * @param {Object} params - propagation parameters
 * @param {number} numAzimuths - output azimuths (72 = every 5°)
 * @param {number} numOutputSteps - output distance steps (30)
 * @returns {Promise<Object>} viewshed result with points, stats
 */
export async function computeViewshed(tower, params, numAzimuths = 72, numOutputSteps = 30) {
    const {
        height_m = 30, frequency_mhz = 1800, tx_power_dbm = 43,
        model = 'Auto', terrain_type = 'Suburban',
    } = params;

    // ============================================
    // PHASE 0: Get tower ground elevation
    // ============================================
    let siteElevation = tower.elevation_m;
    if (siteElevation == null || siteElevation <= 0) {
        console.log('⛰️ Fetching tower ground elevation...');
        siteElevation = await getElevation(tower.lat, tower.lng);
        if (siteElevation == null) siteElevation = 0;
    }

    const towerHeight = tower.height_m || height_m;
    const antennaASL = siteElevation + towerHeight;
    console.log(`📡 Viewshed v4:`);
    console.log(`   Tower: ${tower.lat.toFixed(5)}, ${tower.lng.toFixed(5)}`);
    console.log(`   Ground: ${siteElevation}m ASL | Tower: ${towerHeight}m AGL | Antenna: ${antennaASL}m ASL`);

    const maxRadiusKm = calculateCoverageRadius({ ...params, site_elevation_m: siteElevation });
    const maxRadiusM = maxRadiusKm * 1000;
    console.log(`   Max radius: ${maxRadiusKm.toFixed(1)} km`);

    const eirp = tx_power_dbm + 18 - 3;

    // ============================================
    // PHASE 1: Fetch DEM Grid (one-shot)
    // ============================================
    // Grid resolution: ~100m for radius < 5km, ~200m for larger
    const gridRes = maxRadiusKm < 5 ? 100 : 200;
    console.log(`⛰️ Fetching DEM grid at ${gridRes}m resolution...`);

    let dem;
    try {
        dem = await fetchDEMGrid(tower.lat, tower.lng, maxRadiusKm, gridRes);
        console.log(`⛰️ DEM Grid ready: ${dem.rows}×${dem.cols} = ${dem.totalPoints} cells, ${dem.validCount} valid`);
    } catch (e) {
        console.error('⛰️ DEM grid fetch failed:', e.message);
        throw new Error('Could not fetch terrain data. Please try again in a few minutes.');
    }

    // ============================================
    // PHASE 2: Ray trace along each azimuth
    // ============================================
    // For each output cell, trace the ray from antenna through
    // fine-grained intermediate points (every ~gridRes meters)
    const outputStepSize = maxRadiusM / numOutputSteps;

    // Fine-grained ray sampling at grid resolution
    const raySampleStep = gridRes; // sample terrain every gridRes meters

    const results = [];
    let visibleCount = 0;
    let coveredCount = 0;
    let minTerrain = Infinity, maxTerrain = -Infinity, sumTerrain = 0, nTerrain = 0;

    for (let azIdx = 0; azIdx < numAzimuths; azIdx++) {
        const az = (360 / numAzimuths) * azIdx;

        // Build the full terrain profile along this azimuth at fine resolution
        const numRaySamples = Math.ceil(maxRadiusM / raySampleStep);
        const terrainProfile = []; // { dist, elev } for ray tracing

        for (let s = 1; s <= numRaySamples; s++) {
            const dist = s * raySampleStep;
            if (dist > maxRadiusM) break;
            const pt = movePoint(tower.lat, tower.lng, dist, az);
            const elev = dem.lookup(pt.lat, pt.lng);
            terrainProfile.push({ dist, elev, lat: pt.lat, lng: pt.lng });

            // Track terrain stats
            minTerrain = Math.min(minTerrain, elev);
            maxTerrain = Math.max(maxTerrain, elev);
            sumTerrain += elev;
            nTerrain++;
        }

        // For each output cell along this azimuth
        for (let s = 1; s <= numOutputSteps; s++) {
            const targetDist = s * outputStepSize;
            const targetPt = movePoint(tower.lat, tower.lng, targetDist, az);
            const targetElev = dem.lookup(targetPt.lat, targetPt.lng);

            // Earth curvature at target
            const curvatureAtTarget = (targetDist * targetDist) / (2 * EARTH_RADIUS * (4 / 3));
            const targetGroundASL = targetElev - curvatureAtTarget;
            const receiverASL = targetGroundASL + 1.5;

            // ---- RAY TRACE through ALL fine-grained terrain samples ----
            let isBlocked = false;

            // Check all terrain profile points up to this target distance
            for (let p = 0; p < terrainProfile.length; p++) {
                const sample = terrainProfile[p];
                if (sample.dist >= targetDist) break; // past target

                const sampleCurvature = (sample.dist * sample.dist) / (2 * EARTH_RADIUS * (4 / 3));
                const sampleGroundASL = sample.elev - sampleCurvature;

                // Ray height at this intermediate distance
                // Linear interpolation from antenna (dist=0, h=antennaASL)
                // to receiver (dist=targetDist, h=receiverASL)
                const fraction = sample.dist / targetDist;
                const rayASL = antennaASL + (receiverASL - antennaASL) * fraction;

                // If terrain at this point is above the ray → BLOCKED
                if (sampleGroundASL > rayASL) {
                    isBlocked = true;
                    break;
                }
            }

            const isVisible = !isBlocked;

            // RF signal calculation
            let rsrp = -999;
            let hasCoverage = false;
            if (isVisible) {
                visibleCount++;
                const effectiveH = Math.max(antennaASL - targetElev, 5);
                const pl = getPathLoss(model, targetDist / 1000, frequency_mhz, effectiveH, terrain_type);
                rsrp = eirp - pl;
                hasCoverage = rsrp >= -120;
                if (hasCoverage) coveredCount++;
            }

            // Polygon wedge cell corners
            const azStep = 360 / numAzimuths;
            const innerDist = (s - 1) * outputStepSize;
            const outerDist = targetDist;
            const azStart = az - azStep / 2;
            const azEnd = az + azStep / 2;

            const c1 = movePoint(tower.lat, tower.lng, innerDist || 10, azStart);
            const c2 = movePoint(tower.lat, tower.lng, innerDist || 10, azEnd);
            const c3 = movePoint(tower.lat, tower.lng, outerDist, azEnd);
            const c4 = movePoint(tower.lat, tower.lng, outerDist, azStart);

            results.push({
                lat: targetPt.lat, lng: targetPt.lng,
                azimuth: az,
                distance_m: targetDist,
                distance_km: targetDist / 1000,
                terrain_elevation: targetElev,
                isVisible, isBlocked, hasCoverage, rsrp,
                color: isVisible
                    ? (hasCoverage ? [0, 200, 83, 140] : [0, 200, 83, 50])
                    : [244, 67, 54, 120],
                polygon: [
                    [c1.lng, c1.lat], [c2.lng, c2.lat],
                    [c3.lng, c3.lat], [c4.lng, c4.lat],
                    [c1.lng, c1.lat],
                ]
            });
        }
    }

    const avgTerrain = nTerrain > 0 ? sumTerrain / nTerrain : siteElevation;
    const totalPoints = results.length;

    console.log(`⛰️ Terrain: min=${minTerrain.toFixed(0)}m, max=${maxTerrain.toFixed(0)}m, avg=${avgTerrain.toFixed(0)}m`);
    console.log(`   Antenna advantage: ${(antennaASL - avgTerrain).toFixed(0)}m above avg`);
    console.log(`📊 Results: ${visibleCount} visible, ${totalPoints - visibleCount} blocked, ${coveredCount} with signal`);

    return {
        points: results,
        stats: {
            total: totalPoints,
            visible: visibleCount,
            covered: coveredCount,
            blocked: totalPoints - visibleCount,
            visibilityPct: ((visibleCount / totalPoints) * 100).toFixed(1),
            coveragePct: ((coveredCount / totalPoints) * 100).toFixed(1),
            siteElevation, antennaASL, towerHeight,
            minTerrain: Math.round(minTerrain),
            maxTerrain: Math.round(maxTerrain),
            avgTerrain: Math.round(avgTerrain),
            demResolution: gridRes,
            demSize: `${dem.rows}×${dem.cols}`,
        },
        towerInfo: {
            lat: tower.lat, lng: tower.lng,
            siteElevation, antennaASL, towerHeight,
            maxRadiusKm, model, frequency_mhz, terrain_type
        }
    };
}

// ===================== SIMPLE COVERAGE RINGS =====================

export function generateCoverageRings(tower, params) {
    const siteElev = tower.elevation_m || 0;
    const thresholds = [
        { rsrp: -80, color: [0, 200, 83, 100], label: 'Excellent' },
        { rsrp: -90, color: [0, 230, 118, 80], label: 'Good' },
        { rsrp: -100, color: [255, 214, 0, 60], label: 'Fair' },
        { rsrp: -110, color: [255, 145, 0, 50], label: 'Poor' },
        { rsrp: -120, color: [244, 67, 54, 40], label: 'Edge' },
    ];
    return thresholds.map(t => ({
        center: [tower.lng, tower.lat],
        radiusKm: calculateCoverageRadius({ ...params, rsrp_threshold: t.rsrp, site_elevation_m: siteElev }),
        radiusM: calculateCoverageRadius({ ...params, rsrp_threshold: t.rsrp, site_elevation_m: siteElev }) * 1000,
        color: t.color, label: `${t.label} (${t.rsrp} dBm)`, rsrp: t.rsrp
    }));
}

// ===================== PRESETS =====================

export const FREQUENCY_PRESETS = [
    { label: '700 MHz (LTE B28)', value: 700 },
    { label: '850 MHz (LTE B5)', value: 850 },
    { label: '900 MHz (LTE B8)', value: 900 },
    { label: '1800 MHz (LTE B3)', value: 1800 },
    { label: '2100 MHz (LTE B1)', value: 2100 },
    { label: '2600 MHz (LTE B7)', value: 2600 },
    { label: '3500 MHz (5G n78)', value: 3500 },
];

export const PROPAGATION_MODELS = [
    { label: 'Auto (Best Fit)', value: 'Auto' },
    { label: 'Free Space (FSPL)', value: 'FSPL' },
    { label: 'Cost-231 Hata', value: 'Cost-231' },
    { label: '3GPP UMa (Urban Macro)', value: 'UMa' },
    { label: '3GPP UMi (Urban Micro)', value: 'UMi' },
    { label: '3GPP RMa (Rural Macro)', value: 'RMa' },
];
