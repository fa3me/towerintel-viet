/**
 * TowerIntel Vietnam — Synthetic Data Generator
 * Generates voluminous and realistic crowdsourced network data 
 * with spatial clustering and metric correlation.
 */

/**
 * Generate a batch of synthetic crowdsourced data points.
 * 
 * @param {Object} center - { lat, lng } center of generation
 * @param {number} count - Number of points to generate
 * @param {Object} options - Custom generation parameters
 * @returns {Array} Array of point objects compatible with the geohash engine
 */
export function generateCrowdsourcedData(center, count = 500, options = {}) {
    const {
        radius = 0.1, // ~11km spread
        numClusters = 5,
        mnoProfiles = {
            Viettel: { concentration: 0.4, signalBias: 5, color: '#00e5ff' },
            Vinaphone: { concentration: 0.35, signalBias: 0, color: '#00c853' },
            Mobifone: { concentration: 0.15, signalBias: -5, color: '#ff9100' },
            Vietnamobile: { concentration: 0.1, signalBias: -5, color: '#ab47bc' }
        },
        isLand = null // Optional (lat, lng) => boolean
    } = options;

    const points = [];
    const clusters = [];

    // 1. Create hotspots (urban centers)
    const mnos = Object.keys(mnoProfiles);
    for (let i = 0; i < numClusters; i++) {
        let lat, lng, onLand;
        let attempts = 0;
        do {
            lat = center.lat + (Math.random() - 0.5) * radius * 1.2;
            lng = center.lng + (Math.random() - 0.5) * radius * 1.2;
            onLand = isLand ? isLand(lat, lng) : true;
            attempts++;
        } while (!onLand && attempts < 10);

        clusters.push({
            lat, lng,
            radius: radius * (0.15 + Math.random() * 0.25),
            primaryMNO: mnos[i % mnos.length],
            density: 0.6 + Math.random() * 0.4
        });
    }

    // 2. Generate points following cluster distribution
    for (let i = 0; i < count; i++) {
        // Decide if this point belongs to a cluster or is "rural" noise
        const cluster = Math.random() > 0.15 ? clusters[Math.floor(Math.random() * clusters.length)] : null;

        let lat, lng, onLand;
        let attempts = 0;
        let distFactor = 1.0;

        do {
            if (cluster) {
                // Gaussian-like concentration around cluster center
                const angle = Math.random() * Math.PI * 2;
                const dist = Math.pow(Math.random(), 0.7) * cluster.radius;
                lat = cluster.lat + Math.cos(angle) * dist;
                lng = cluster.lng + Math.sin(angle) * dist;
                distFactor = dist / cluster.radius;
            } else {
                // Uniform distribution for background noise
                lat = center.lat + (Math.random() - 0.5) * radius * 2;
                lng = center.lng + (Math.random() - 0.5) * radius * 2;
                distFactor = 0.8 + Math.random() * 0.2;
            }
            onLand = isLand ? isLand(lat, lng) : true;
            attempts++;
        } while (!onLand && attempts < 5);

        if (!onLand && isLand) continue; // Skip if still not on land after retries

        // 3. Select MNO (clusters favor their primary MNO)
        let mno;
        if (cluster && Math.random() > 0.3) {
            mno = cluster.primaryMNO;
        } else {
            mno = mnos[Math.floor(Math.random() * mnos.length)];
        }

        const profile = mnoProfiles[mno];

        // 4. Derive metrics with correlation
        // Density correlation: closer to cluster center = higher signal (usually) but higher congestion
        const proximity = 1 - distFactor; // 1 = center, 0 = edge

        // RSRP: -70 (excellent near tower) to -115 (dead zone far from tower)
        // Proximity 1 = near cluster center → strong signal; proximity 0 = edge → weaker
        const baseRSRP = -90 + (proximity * 25) + ((Math.random() - 0.3) * 15) + profile.signalBias;
        const rsrp = Math.min(-65, Math.max(-120, Math.round(baseRSRP)));

        // RSRQ: -5 (excellent) to -20 (poor). Correlates with RSRP.
        const rsrq = -18 + ((rsrp + 115) / 50) * 12 + (Math.random() * 3);

        // Congestion: 0.1 (low) to 0.95 (high). Correlates with proximity (urban density).
        const baseCong = cluster ? (cluster.density * 0.4 + proximity * 0.5) : (0.1 + Math.random() * 0.2);
        const congestion = Math.min(0.95, Math.max(0.05, baseCong + (Math.random() * 0.1)));

        points.push({
            id: `INTEL-${mno}-${Date.now()}-${i}`,
            name: `${mno} Intelligence Node`,
            lat,
            lng,
            mno,
            rsrp,
            rsrq: Math.round(rsrq * 10) / 10,
            congestion: Math.round(congestion * 100) / 100,
            sourceType: 'STRATEGIC_Discovery',
            imported_at: new Date().toISOString()
        });
    }

    return points;
}
