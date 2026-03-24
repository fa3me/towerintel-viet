import { haversineDistance } from '../data/ph-geo.js';
import { getMismatchThreshold } from '../data/ph-geo.js';
import { createSpatialIndex } from './spatial-index.js';

export const RECONCILIATION_STATUS = {
    VERIFIED: 'Verified',         // Match found within threshold
    MISMATCH: 'Mismatch',         // Match found but distance > threshold
    NEW_SITE: 'New Site',         // In CSV but not in Crowdsourced
    STALE: 'Stale/Competitor',    // In Crowdsourced but not in CSV
    UNKNOWN: 'Unknown'
};

/**
 * Perform spatial reconciliation between Internal Data (uploaded/own) 
 * and Crowdsourced Data (competitor/regulatory).
 */
export function reconcileSites(ownSites, crowdSites) {
    if (!ownSites || ownSites.length === 0) return [];

    // Create spatial index for crowdsourced sites for O(1) local lookup
    const crowdIndex = createSpatialIndex(crowdSites, 0.01); // 1km cells

    ownSites.forEach(own => {
        const threshold = getMismatchThreshold(own.terrain_type);

        // Optimization: Only check sites within 1km of the tower
        const nearbyCrowd = crowdIndex.getNearby(own.lat, own.lng, 1)
            .map(c => ({
                id: c.id,
                mno: c.mno,
                dist: haversineDistance(own.lat, own.lng, c.lat, c.lng)
            }))
            .filter(c => c.dist <= 0.5) // Filter down to 500m
            .sort((a, b) => a.dist - b.dist);

        const nearest = nearbyCrowd[0];
        let status = RECONCILIATION_STATUS.NEW_SITE;
        let delta = null;

        if (nearest && nearest.dist <= threshold) {
            status = RECONCILIATION_STATUS.VERIFIED;
            delta = Math.round(nearest.dist * 1000);
        } else if (nearest && nearest.dist <= 1.0) { // Increased mismatch visibility to 1km
            status = RECONCILIATION_STATUS.MISMATCH;
            delta = Math.round(nearest.dist * 1000);
        } else {
            status = RECONCILIATION_STATUS.NEW_SITE;
        }

        // If it's a "New Site", it likely means it's an ongoing build or not yet in crowdsourced maps
        const finalStatus = status === RECONCILIATION_STATUS.NEW_SITE ? "New/Ongoing Build" : status;

        // Tag the site with reconciliation metadata
        own.reconciliation = {
            status: finalStatus,
            deltaMeters: delta,
            threshold: threshold * 1000,
            nearestCrowdId: nearest?.id || null,
            nearbyMNOs: [...new Set(nearbyCrowd.map(c => c.mno))]
        };
    });

    return ownSites;
}
