/**
 * Mock Ground Truth Data based on crowd-sourced patterns (nPerf/OpenCellID)
 * Helps validate simulation vs. real-world observations
 */
import { haversineDistance } from '../data/ph-geo.js';

export function getGroundTruthCoverage(tower, rangeKm = 3) {
    const grid = [];
    const resolution = 0.005; // Coarser for ground truth
    const latRange = rangeKm / 111;
    const lngRange = rangeKm / (111 * Math.cos(tower.lat * Math.PI / 180));

    for (let lat = tower.lat - latRange; lat <= tower.lat + latRange; lat += resolution) {
        for (let lng = tower.lng - lngRange; lng <= tower.lng + lngRange; lng += resolution) {
            const dist = haversineDistance(tower.lat, tower.lng, lat, lng);
            if (dist <= rangeKm) {
                // Crowd-sourced data is often "patchy" and has higher loss in urban areas
                const isUrban = true;
                const baseRsrp = -70 - (dist * 25); // Faster drop-off
                const noise = (Math.random() - 0.5) * 10; // Random fluctuations typical in real data

                grid.push({
                    lat,
                    lng,
                    rsrp: Math.round(baseRsrp + noise),
                    isGroundTruth: true
                });
            }
        }
    }
    return grid;
}
