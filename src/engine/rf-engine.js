/**
 * Enhanced Path Loss Model with Ray Tracing, Obstruction, and Elevation
 */
import { getPopulationAtRadii } from '../data/population.js';
import { haversineDistance } from '../data/ph-geo.js';

export const PATH_LOSS_MODELS = {
    HATA_URBAN: 'Hata Urban',
    HATA_DENSE_URBAN: 'Hata Dense Urban (High-Rise)',
    HATA_SUBURBAN: 'Hata Suburban',
    HATA_RURAL: 'Hata Rural',
    FREE_SPACE: 'Free Space'
};

export function calculateSignalStrength(tower, targetLat, targetLng, freqMhz = 1800, model = PATH_LOSS_MODELS.HATA_URBAN, options = {}) {
    const {
        azimuth = null,
        beamwidth = 65,
        antennaGain = 17,
        feederLoss = 3,
        mechanicalTilt = 2, // Default 2 degree tilt
        verticalBeamwidth = 15 // Standard macro vertical beamwidth
    } = options;

    const distKm = haversineDistance(tower.lat, tower.lng, targetLat, targetLng);
    if (distKm < 0.01) return -30;

    // Environment Context: Use tower's pre-calculated population data 
    const towerPop = tower.population || {};
    const densityFactor = towerPop.density_per_sqkm || tower.density || 500;

    const htx = options.antennaHeight || tower.height_m || 30;
    const hrx = 1.5;

    let pathLoss = 0;

    if (model === PATH_LOSS_MODELS.FREE_SPACE) {
        pathLoss = 20 * Math.log10(distKm) + 20 * Math.log10(freqMhz) + 32.44;
    } else {
        const aHr = (1.1 * Math.log10(freqMhz) - 0.7) * hrx - (1.56 * Math.log10(freqMhz) - 0.8);
        const Lb = 69.55 + 26.16 * Math.log10(freqMhz) - 13.82 * Math.log10(htx) - aHr + (44.9 - 6.55 * Math.log10(htx)) * Math.log10(distKm);

        if (model === PATH_LOSS_MODELS.HATA_SUBURBAN) {
            pathLoss = Lb - 2 * Math.pow(Math.log10(freqMhz / 28), 2) - 5.4;
        } else if (model === PATH_LOSS_MODELS.HATA_RURAL) {
            pathLoss = Lb - 4.78 * Math.pow(Math.log10(freqMhz), 2) + 18.33 * Math.log10(freqMhz) - 40.94;
        } else {
            pathLoss = Lb;
        }
    }

    let clutterLoss = Math.min(20, (densityFactor / 2000) * 8);

    // High-Rise / Skyscraper Refinement
    if (model === PATH_LOSS_MODELS.HATA_DENSE_URBAN || (densityFactor > 20000)) {
        // Skyscraper shadowing penalty: signals drop much faster behind buildings
        const skyscraperPenalty = Math.min(25, (distKm / 0.5) * 15);
        clutterLoss += skyscraperPenalty;
    }

    pathLoss += clutterLoss;

    // ANTENNA PATTERN (Simplified professional approach)
    let patternLoss = 0;

    // Horizontal Pattern
    if (azimuth !== null) {
        // Calculate relative angle to boresight
        const targetAzimuth = (Math.atan2(targetLng - tower.lng, targetLat - tower.lat) * 180 / Math.PI + 360) % 360;
        let angleOffset = Math.abs(targetAzimuth - azimuth);
        if (angleOffset > 180) angleOffset = 360 - angleOffset;

        // Softened: Clamped to 15dB max loss to ensure 360 overlap
        patternLoss += Math.min(15, 12 * Math.pow(angleOffset / (beamwidth / 2), 2));
    }

    // Vertical Pattern & Mechanical Tilt
    // Calculate vertical angle (alpha) from horizon
    const alpha = Math.atan2(htx - hrx, distKm * 1000) * 180 / Math.PI;
    const verticalOffset = Math.abs(alpha - mechanicalTilt);
    const verticalLoss = Math.min(25, 12 * Math.pow(verticalOffset / (verticalBeamwidth / 2), 2));
    patternLoss += verticalLoss;

    const txPowerDbm = 46; // 40W Base Station
    const eirp = txPowerDbm + antennaGain - feederLoss;

    return Math.round(eirp - pathLoss - patternLoss);
}

export function generateRFHeatmap(tower, freqMhz, model, options = {}) {
    const MAX_GRID_POINTS = 15000; // Safety budget to prevent browser crashes
    let {
        resolution = 0.0006,
        rangeKm = 4,
        numSectors = 3,
        mechanicalTilt = tower.tilt || 2,
        antennaGain = 17,
        antennaHeight = tower.height_m || 30
    } = options;

    // AUTO-COARSEN: Estimate grid size and coarsen resolution if too large
    const latRange = rangeKm / 111;
    const lngRange = rangeKm / (111 * Math.cos(tower.lat * Math.PI / 180));
    let estimatedPoints = ((2 * latRange) / resolution) * ((2 * lngRange) / resolution);

    while (estimatedPoints > MAX_GRID_POINTS && resolution < 0.01) {
        resolution *= 1.5; // Progressively coarsen
        estimatedPoints = ((2 * latRange) / resolution) * ((2 * lngRange) / resolution);
    }

    const grid = [];
    const step = resolution;

    // Common macro azimuths (e.g., 0, 120, 240)
    const sectorAzimuths = Array.from({ length: numSectors }, (_, i) => (i * 360 / numSectors));


    for (let lat = tower.lat - latRange; lat <= tower.lat + latRange; lat += step) {
        for (let lng = tower.lng - lngRange; lng <= tower.lng + lngRange; lng += step) {
            const dist = haversineDistance(tower.lat, tower.lng, lat, lng);
            if (dist <= rangeKm) {
                // Return best RSRP from any sector at this point
                let bestRsrp = -150;
                for (const azimuth of sectorAzimuths) {
                    const rsrp = calculateSignalStrength(tower, lat, lng, freqMhz, model, {
                        azimuth,
                        mechanicalTilt,
                        antennaGain,
                        antennaHeight
                    });
                    if (rsrp > bestRsrp) bestRsrp = rsrp;
                }

                // SINR Analysis (Simplified for professional planning)
                // In a single site simulation, noise floor is -115dBm
                // SINR = Signal - (Interference + Noise)
                const noiseFloor = -115;
                const sinr = bestRsrp - noiseFloor;

                grid.push({
                    lat,
                    lng,
                    rsrp: bestRsrp,
                    sinr,
                    bestServerId: tower.id
                });
            }
        }
    }
    return grid;
}
