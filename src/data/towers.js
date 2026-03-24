/**
 * TowerIntel PH — Tower Asset Data Generator
 * Generates ~500 realistic telecom tower records across NCR (Metro Manila)
 */

// Seeded pseudo-random for reproducibility
function seededRandom(seed) {
    let s = seed;
    return function () {
        s = (s * 16807 + 0) % 2147483647;
        return (s - 1) / 2147483646;
    };
}

import { PH_MUNICIPALITIES } from './ph-geo.js';

const TENANT_OPTIONS = ['Globe', 'Smart', 'DITO'];

/**
 * Generate towers at a nationwide scale
 */
export function generateTowers(count = 5000) {
    return []; // Disable random generation
    const rand = seededRandom(42);
    const towers = [];

    for (let i = 0; i < count; i++) {
        // Pick municipality based on population weight
        const mun = PH_MUNICIPALITIES[Math.floor(rand() * PH_MUNICIPALITIES.length)];

        // Spread wider for nationwide view
        const spread = mun.type === 'Urban' ? 0.02 : mun.type === 'Suburban' ? 0.05 : 0.15;
        const lat = mun.lat + (rand() - 0.5) * spread;
        const lng = mun.lng + (rand() - 0.5) * spread;

        const height = Math.round(30 + rand() * 60);
        const maxTenants = rand() < 0.2 ? 2 : rand() < 0.6 ? 3 : 4;
        const isOngoing = rand() < 0.2; // 20% are ongoing sites

        // Pick actual tenants
        const currentTenantCount = isOngoing ? 1 : Math.min(Math.floor(rand() * (maxTenants + 1)), maxTenants);
        const shuffled = [...TENANT_OPTIONS].sort(() => rand() - 0.5);
        const currentTenants = shuffled.slice(0, currentTenantCount);

        const availableApertures = maxTenants - currentTenantCount;
        let structuralStatus = isOngoing ? 'Limited' : (availableApertures >= 2 ? 'Ready' : (availableApertures === 1 ? 'Limited' : 'Full'));

        towers.push({
            id: `TWR-${String(i + 1).padStart(5, '0')}`,
            name: `${mun.name} Site ${i + 1}`,
            city: mun.name,
            region: mun.region,
            lat,
            lng,
            height_m: height,
            max_tenants: maxTenants,
            current_tenants: currentTenants,
            structural_status: structuralStatus,
            available_apertures: availableApertures,
            terrain_type: mun.type,
            line_of_sight: rand() < 0.6,
            status: isOngoing ? 'Ongoing' : 'Built',
            sourceType: 'SIMULATED',
            confidence: 1.0
        });
    }

    return towers;
}
