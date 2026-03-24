/**
 * TowerIntel Vietnam — Water Distance Module
 * Uses Turf.js to compute the distance from any point to the nearest
 * Vietnam boundary edge (simplified GeoJSON).
 */
import { point, lineString } from '@turf/helpers';
import pointToLineDistance from '@turf/point-to-line-distance';
import coastlineData from '../data/vn-mainland.json';

let coastlineLines = null;
let initFailed = false;

/**
 * Convert the MultiPolygon boundary into a set of LineStrings once (lazy init).
 */
function initCoastlineLines() {
    if (coastlineLines) return;
    if (initFailed) return;

    try {
        coastlineLines = [];
        const coords = coastlineData.geometry.coordinates;

        for (const polygon of coords) {
            for (const ring of polygon) {
                if (ring.length >= 2) {
                    try {
                        coastlineLines.push(lineString(ring));
                    } catch (e) {
                        // Skip degenerate rings
                    }
                }
            }
        }
        console.log(`🌊 Coastline initialized: ${coastlineLines.length} line segments from ${coords.length} islands`);
    } catch (e) {
        console.error('❌ Failed to initialize coastline data:', e);
        initFailed = true;
        coastlineLines = null;
    }
}

/**
 * Calculate the minimum distance (in km) from a lat/lng point to the
 * nearest coastline edge using Turf.js.
 *
 * @param {number} lat - Latitude of the point
 * @param {number} lng - Longitude of the point
 * @returns {number} Distance in km to the nearest coastline
 */
export function distanceToCoastline(lat, lng) {
    try {
        initCoastlineLines();

        if (!coastlineLines || coastlineLines.length === 0) {
            return Infinity; // Fallback if coastline data unavailable
        }

        const pt = point([lng, lat]);
        let minDist = Infinity;

        for (const line of coastlineLines) {
            const d = pointToLineDistance(pt, line, { units: 'kilometers' });
            if (d < minDist) minDist = d;
            // Early exit: if we're basically on the coast, no need to keep checking
            if (minDist < 0.1) break;
        }

        return minDist;
    } catch (e) {
        console.warn('⚠️ Water distance calculation error for', lat, lng, e);
        return Infinity;
    }
}

/**
 * Batch-calculate water distances for an array of sites.
 *
 * @param {Array<{lat: number, lng: number}>} sites - Array of site objects
 * @returns {Map<string, number>} Map of "lat,lng" -> distance in km
 */
export function batchWaterDistance(sites) {
    initCoastlineLines();

    const results = new Map();
    for (const site of sites) {
        const key = `${site.lat},${site.lng}`;
        if (!results.has(key)) {
            results.set(key, distanceToCoastline(site.lat, site.lng));
        }
    }
    return results;
}
