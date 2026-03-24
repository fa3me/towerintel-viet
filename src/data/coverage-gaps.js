/**
 * TowerIntel PH — Coverage Gap / Signal Strength Generator
 * Produces an RSRP signal strength grid for each MNO across NCR
 * Areas far from MNO sites receive weaker signals, creating "dead zones"
 */

import { haversineDistance } from './ph-geo.js';

/**
 * Generate signal strength grid for a specific MNO
 * @param {Array} mnoSites - Array of MNO site objects with lat/lng
 * @param {number} resolution - Grid cell size in degrees (~0.005 ≈ 500m)
 * @returns {Array} Grid points with RSRP values
 */
export function generateCoverageGrid(mnoSites, resolution = 0.005) {
    return []; // Disable automatic grid generation to remove phantom sites
    const grid = [];
    // Define bounds based on PHP NCR region broadly
    const minLat = 14.35, maxLat = 14.75;
    const minLng = 120.90, maxLng = 121.15;

    for (let lat = minLat; lat <= maxLat; lat += resolution) {
        for (let lng = minLng; lng <= maxLng; lng += resolution) {
            // Find nearby MNO sites that might have real metrics
            let minDist = Infinity;
            let realRSRP = null;
            let realRSRQ = null;
            let realCongestion = null;

            for (const site of mnoSites) {
                const dist = haversineDistance(lat, lng, site.lat, site.lng);
                if (dist < minDist) {
                    minDist = dist;
                    // If site has real data, capture it if within a reasonable influence radius (e.g. 500m)
                    if (dist < 0.5 && site.rsrp !== undefined && site.rsrp !== null) {
                        realRSRP = site.rsrp;
                        realRSRQ = site.rsrq;
                        realCongestion = site.congestion;
                    }
                }
            }

            // Model RSRP: Use real data if available, otherwise fallback to distance-based proxy
            let rsrp;
            if (realRSRP !== null) {
                rsrp = realRSRP;
            } else {
                // RSRP ranges: Excellent (-80 to -65), Good (-95 to -80), Fair (-105 to -95), Poor (< -105)
                if (minDist < 0.3) rsrp = -70 - Math.random() * 5;
                else if (minDist < 0.8) rsrp = -85 - Math.random() * 5;
                else if (minDist < 1.5) rsrp = -100 - Math.random() * 5;
                else rsrp = -115 - Math.random() * 10;
            }

            grid.push({
                lat, lng,
                rsrp: Math.round(rsrp),
                rsrq: realRSRQ,
                congestion: realCongestion,
                distance_to_nearest: Math.round(minDist * 100) / 100,
                is_dead_zone: rsrp < -110,
            });
        }
    }

    return grid;
}

/**
 * Get coverage quality label from RSRP value
 */
export function getRSRPLabel(rsrp) {
    if (rsrp >= -80) return 'Excellent';
    if (rsrp >= -95) return 'Good';
    if (rsrp >= -105) return 'Fair';
    if (rsrp >= -115) return 'Poor';
    return 'Dead Zone';
}

/**
 * Get coverage color from RSRP value (for heatmap)
 */
export function getRSRPColor(rsrp) {
    if (rsrp >= -80) return [0, 255, 0, 180];       // Green - Excellent
    if (rsrp >= -95) return [144, 238, 144, 150];    // Light green - Good
    if (rsrp >= -105) return [255, 255, 0, 130];     // Yellow - Fair
    if (rsrp >= -115) return [255, 140, 0, 130];     // Orange - Poor
    return [255, 0, 0, 150];                          // Red - Dead zone
}
