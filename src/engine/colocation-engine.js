/**
 * TowerIntel Vietnam — Colocation Scoring Engine
 * Performance-optimized: pre-groups sites by MNO for O(N) lookup
 */

import { haversineDistance } from '../data/vn-geo.js';
import { MNOS } from '../config/app-config.js';
import { createSpatialIndex } from './spatial-index.js';

export const ULTRA_REDUNDANT_THRESHOLD_KM = 0.1; // 100m

/**
 * Get the MNO/operator name from a site object (checks multiple fields)
 */
function getSiteMNO(site) {
    return site.mno || site.anchor || site.operator || '';
}

/**
 * Standardize MNO names for logic comparison
 */
export function normalizeMNO(name) {
    if (!name) return '';
    const n = name.toLowerCase().trim();
    if (n.includes('viettel')) return 'Viettel';
    if (n.includes('vina') || n.includes('vnpt')) return 'Vinaphone';
    if (n.includes('mobi')) return 'Mobifone';
    if (n.includes('vietnamobile') || n.includes('vnmobile') || n.includes('beeline')) return 'Vietnamobile';
    if (n.includes('globe')) return 'Viettel';
    if (n.includes('smart') || n.includes('sun') || n.includes('pldt')) return 'Vinaphone';
    if (n.includes('dito') || n.includes('mislatel')) return 'Mobifone';
    if (n.includes('competitor')) return 'Competitor';
    return n.charAt(0).toUpperCase() + n.slice(1);
}

/**
 * Orchestrate colocation scoring for all towers.
 * Now synchronous: assumes terrain/population is pre-calculated in processData.
 */
export function calculateScores(towers, mnoSites, coverageGrids, ownSites = [], settings = null) {
    // Spatial index for fast neighbor lookup
    const spatialIndex = createSpatialIndex(mnoSites, 0.05); // ~5km cells

    // PRE-GROUP all known sites by normalized MNO name (O(N) once, not O(N²))
    const sitesByMNO = Object.fromEntries(MNOS.map((m) => [m, []]));

    for (const s of mnoSites) {
        const mno = normalizeMNO(getSiteMNO(s));
        if (sitesByMNO[mno]) sitesByMNO[mno].push(s);
    }

    for (const t of towers) {
        const mno = normalizeMNO(getSiteMNO(t));
        if (sitesByMNO[mno]) sitesByMNO[mno].push(t);
    }

    console.log(`📊 Colocation engine: processing ${towers.length} towers against ${mnoSites.length} indexed sites.`);

    return towers.map(tower => {
        const scores = {};
        let bestScore = -1;
        let bestTarget = 'None';

        const owner = normalizeMNO(getSiteMNO(tower));
        const tenants = (tower.current_tenants || []).map(normalizeMNO);
        if (owner) tenants.push(owner);

        // Use cached population data from processData
        const popData = tower.population || { radius_1km: 0, terrain_type: 'Rural' };

        // REFINED TERRAIN: Combine population density with site density
        const popTerrain = popData.terrain_type || tower.terrain_type || 'Rural';

        // Internal Assets Improvement: If it's our site, evaluate terrain based 
        // on our OWN site grid density (Anchor MNO)
        const isInternalAsset = tower.dataset_name === 'Own Assets';
        const siteDensityTerrain = calculateSiteDensityTerrain(tower, spatialIndex, isInternalAsset ? owner : null);

        // Refined terrain for colocation scoring only — do not overwrite tower.terrain_type
        // (population-based Geo Context must match catchment ring thresholds).
        let finalTerrain = popTerrain;
        if (siteDensityTerrain === 'Dense Urban') finalTerrain = 'Dense Urban';
        else if (siteDensityTerrain === 'Urban' && popTerrain === 'Rural') finalTerrain = 'Suburban';
        else if (siteDensityTerrain === 'Rural' && popTerrain === 'Urban') finalTerrain = 'Suburban';
        else if (siteDensityTerrain === 'Rural' && popTerrain === 'Rural') finalTerrain = 'Rural';

        for (const targetMNO of MNOS) {
            if (targetMNO === owner || tenants.includes(targetMNO)) {
                scores[targetMNO] = { total: 0, label: 'Already On-site', factors: { nearestDistM: 0 } };
                continue;
            }

            const score = calculateSingleScore(tower, targetMNO, sitesByMNO[targetMNO], popData, finalTerrain, settings);
            scores[targetMNO] = score;

            if (score.total > bestScore) {
                bestScore = score.total;
                bestTarget = targetMNO;
            }
        }

        return {
            towerId: tower.id,
            scores,
            bestTarget,
            composite: Math.max(0, bestScore),
            population: popData,
            refinedTerrain: finalTerrain
        };
    });
}

function calculateSingleScore(tower, mno, mnoSitesForMNO, popData, refinedTerrain, settings = null) {
    const factors = {};
    const nearestDistKm = findNearestDistance(tower, mnoSitesForMNO);
    const nearestDistM = Math.round(nearestDistKm * 1000);

    const terrain = refinedTerrain || popData.terrain_type || tower.terrain_type || 'Suburban';

    // REDUNDANCY CHECK: If a site exists within 100m, it's NOT a target.
    // However, findNearestDistance now filters these out to find the NEXT nearest.
    // If findNearestDistance returned 25km it means NO neighbors exist > 100m.
    if (nearestDistKm <= ULTRA_REDUNDANT_THRESHOLD_KM) {
        return {
            total: 0,
            label: 'Already On-site',
            factors: { ...factors, nearestDistM, status: 'Already Covered' }
        };
    }

    // ---- DISTANCE-BASED SCORING (single ≥ threshold per terrain) ----
    // Nearest competitor MNO distance must be ≥ minKm for colocation potential (user-defined in Settings).
    // Defaults: Dense Urban 350m, Urban 500m, Suburban 750m, Rural 1.5km.

    const defaultMinByTerrain = {
        'Dense Urban': 0.35,
        'Urban': 0.5,
        'Suburban': 0.75,
        'Rural': 1.5
    };
    const dt = settings?.scoring?.distanceThresholds?.[mno]?.[terrain];
    const rawMin = dt?.minKm ?? dt?.highKm ?? dt?.lowKm;
    const minKm = Number(rawMin) > 0
        ? Number(rawMin)
        : (defaultMinByTerrain[terrain] ?? defaultMinByTerrain['Suburban']);

    let distanceScore;
    if (nearestDistKm < minKm) {
        // Too close to competitor site → low colocation potential
        const ratio = minKm > 0 ? nearestDistKm / minKm : 0;
        distanceScore = Math.min(35, Math.round(10 + ratio * 25));
        factors.status = 'Below threshold (nearby)';
    } else {
        // At or beyond minimum separation → colocation potential; scale with extra distance
        const extraKm = Math.min(4, nearestDistKm - minKm);
        distanceScore = 55 + Math.round((extraKm / 4) * 45);
        factors.status = 'Colocation potential';
    }
    distanceScore = Math.min(100, distanceScore);

    let structScore = tower.structural_status === 'Ready' ? 100 : (tower.structural_status === 'Limited' ? 50 : 0);
    factors.structural = structScore;

    const popKey = settings?.scoring?.popRadiusKey || 'radius_1km';
    const popVal = popData[popKey] ?? popData.radius_1km ?? 0;
    const pst = settings?.scoring?.popScoreThresholds || { high: 30000, mid: 10000, low: 2000 };
    let popScore = popVal > pst.high ? 100 : (popVal > pst.mid ? 70 : (popVal > pst.low ? 40 : 10));
    factors.population = popScore;

    const w = settings?.scoring?.weights || { distance: 0.70, structural: 0.10, population: 0.20 };
    const wd = Number(w.distance ?? 0.70);
    const ws = Number(w.structural ?? 0.10);
    const wp = Number(w.population ?? 0.20);
    const total = Math.round(distanceScore * wd + structScore * ws + popScore * wp);

    let label;
    if (total >= 70) label = 'High Priority';
    else if (total >= 45) label = 'Medium Priority';
    else if (total >= 25) label = 'Low Priority';
    else label = 'Redundant';

    return { total, label, factors: { ...factors, nearestDistM } };
}


function findNearestDistance(tower, mnoSites) {
    if (!mnoSites || mnoSites.length === 0) return 25; // 25km = far
    let minDist = Infinity;
    for (const site of mnoSites) {
        if (!site.lat || !site.lng || site.id === tower.id) continue;
        const dist = haversineDistance(tower.lat, tower.lng, site.lat, site.lng);
        // Consistency: skip sites within our redundancy radius (100m)
        // This avoids scoring 0 because of a duplicate record or already-coworked site.
        if (dist > ULTRA_REDUNDANT_THRESHOLD_KM && dist < minDist) minDist = dist;
    }
    return minDist === Infinity ? 25 : minDist;
}

/**
 * Improvement: Reverse engineer terrain from MNO site density
 * Dense Urban < 350m, Urban <= 500m, Suburban <= 900m, Rural > 900m
 * Optional targetMNO: filters search to specific operator (for internal asset benchmarking)
 */
function calculateSiteDensityTerrain(tower, spatialIndex, targetMNO = null) {
    // Get all sites within 10km to find the 4 nearest
    let nearby = spatialIndex.getNearby(tower.lat, tower.lng, 10);

    if (targetMNO) {
        nearby = nearby.filter(s => normalizeMNO(getSiteMNO(s)) === targetMNO);
    }

    if (nearby.length < 2) return 'Rural';

    const distances = nearby
        .map(s => haversineDistance(tower.lat, tower.lng, s.lat, s.lng))
        .filter(d => d > 0.001) // ignore self
        .sort((a, b) => a - b);

    if (distances.length === 0) return 'Rural';

    // Take average of up to 4 nearest neighbors
    const neighborsCount = Math.min(4, distances.length);
    const avgDistM = (distances.slice(0, neighborsCount).reduce((a, b) => a + b, 0) / neighborsCount) * 1000;

    if (avgDistM < 350) return 'Dense Urban';
    if (avgDistM <= 500) return 'Urban';
    if (avgDistM <= 900) return 'Suburban';
    return 'Rural';
}
