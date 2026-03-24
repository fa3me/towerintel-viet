/**
 * TowerIntel PH — MNO Site Data Generator
 * Simulates Nationwide cell sites for Globe, Smart, and DITO
 */

function seededRandom(seed) {
    let s = seed;
    return function () {
        s = (s * 16807 + 0) % 2147483647;
        return (s - 1) / 2147483646;
    };
}

import { PH_MUNICIPALITIES } from './ph-geo.js';

const MNO_CONFIG = {
    Globe: { count: 0, color: [0, 123, 255], seed: 101 },
    Smart: { count: 0, color: [0, 200, 83], seed: 202 },
    DITO: { count: 0, color: [255, 193, 7], seed: 303 },
};

export function generateMNOSites() {
    return []; // Return empty to ensure no phantom sites are generated
    const allSites = [];

    for (const [mno, config] of Object.entries(MNO_CONFIG)) {
        const rand = seededRandom(config.seed);

        for (let i = 0; i < config.count; i++) {
            // Bias towards urban centers (more MNO sites in reality)
            // Using rand() * rand() biases selection towards the start of the list (NCR/Cebu/Davao)
            const mun = PH_MUNICIPALITIES[Math.floor(rand() * rand() * PH_MUNICIPALITIES.length)];

            // Tight jitter: Urban sites are very close to center, Rural up to ~15km
            const spread = mun.type === 'Urban' ? 0.03 : mun.type === 'Suburban' ? 0.08 : 0.15;

            // Grid-like jitter (more realistic than polar circles)
            const lat = mun.lat + (rand() - 0.5) * spread;
            const lng = mun.lng + (rand() - 0.5) * spread;

            allSites.push({
                id: `${mno}-${String(i + 1).padStart(5, '0')}`,
                mno,
                lat, lng,
                type: rand() < 0.1 ? 'Small Cell' : 'Macro',
                color: config.color,
                sourceType: 'CROWDSOURCED'
            });
        }
    }

    return allSites;
}

export const MNO_COLORS = {
    Globe: [0, 123, 255],
    Smart: [0, 200, 83],
    DITO: [255, 193, 7],
};
