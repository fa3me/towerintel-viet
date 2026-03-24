/**
 * TowerIntel PH — Multi-Source Sync Engine
 * Orchestrates data fetching from various open network databases.
 * OpenCelliD uses real API with tiled fetching; other sources are still simulated.
 */

import { fetchTiledCellTowers } from './opencellid.js';
import { fetchWigleCells } from './wigle.js';
import { generateCrowdsourcedData } from './data-generator.js';

/**
 * Sync orchestrator for multiple network data sources.
 * 
 * @param {Object} bounds - Bounding box { north, south, east, west }
 * @param {Array} sources - List of source IDs to sync
 * @param {Object} keys - API keys { opencellid: string }
 * @param {Object} callbacks - { onProgress: (msg) => void }
 * @returns {Promise<Array>} Combined and deduplicated data points
 */
export async function syncMultipleSources(bounds, sources = ['opencellid'], keys = {}, callbacks = {}, options = {}) {
    const allResults = [];
    const { onProgress = () => { } } = callbacks;
    const { isLand = null } = options;

    console.log(`📡 Starting Multi-Source Sync for: ${sources.join(', ')}`);

    for (const source of sources) {
        switch (source) {
            case 'opencellid':
                if (keys.opencellid && keys.opencellid !== 'dummy-key') {
                    onProgress(`📡 Fetching real data from OpenCelliD...`);
                    try {
                        const cells = await fetchTiledCellTowers(bounds, keys.opencellid, {
                            onProgress: (done, total) => {
                                onProgress(`📡 OpenCelliD: tile ${done}/${total}...`);
                            }
                        });
                        // Mark all cells with proper sourceType for category assignment
                        cells.forEach(c => {
                            c.source = 'OpenCelliD';
                            c.sourceType = `MNO_${c.mno}`;
                        });
                        allResults.push(...cells);
                        onProgress(`✅ OpenCelliD: ${cells.length} real cell towers fetched`);
                    } catch (e) {
                        console.error('📡 OpenCelliD fetch failed:', e);
                        onProgress(`❌ OpenCelliD failed: ${e.message}`);
                    }
                } else {
                    // No real key — fallback to simulation
                    onProgress(`📡 Simulating OpenCelliD data (no API key)...`);
                    const simData = await simulateSource(bounds, 'OpenCelliD', 300, 'default', { isLand });
                    allResults.push(...simData);
                }
                break;

            case 'wigle':
                if (keys.wigle && keys.wigle.apiName) {
                    onProgress(`📡 Fetching real data from WiGle.net...`);
                    try {
                        const cells = await fetchWigleCells(bounds, keys.wigle);
                        allResults.push(...cells);
                        onProgress(`✅ WiGle.net: ${cells.length} signal points fetched`);
                    } catch (e) {
                        console.error('📡 WiGle fetch failed:', e);
                        onProgress(`❌ WiGle failed: ${e.message}`);
                    }
                } else {
                    onProgress(`📡 Simulating WiGle.net data (no API credentials)...`);
                    allResults.push(...await simulateSource(bounds, 'Wigle.net', 400, 'low_density', { isLand }));
                }
                break;

            case 'beacondb':
                onProgress(`📡 Simulating BeaconDB data...`);
                allResults.push(...await simulateSource(bounds, 'BeaconDB', 200, 'urban_clusters', { isLand }));
                break;

            case 'opensignal_sim':
                onProgress(`📡 Simulating OpenSignal data...`);
                allResults.push(...await simulateSource(bounds, 'OpenSignal', 600, 'heatmaps', { isLand }));
                break;

            case 'cellmapper_sim':
                onProgress(`📡 Simulating CellMapper data...`);
                allResults.push(...await simulateSource(bounds, 'CellMapper', 500, 'tower_centroids', { isLand }));
                break;
        }
    }

    // Simple deduplication by ID
    const seen = new Set();
    const final = allResults.filter(p => {
        const key = `${p.id}-${p.source}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    console.log(`📡 Multi-Source Sync Complete. Total unique points: ${final.length}`);
    return final;
}

/**
 * Simulated source adapter using the data generator (for sources without real API).
 */
async function simulateSource(bounds, sourceName, count, pattern = 'default', options = {}) {
    const center = {
        lat: (bounds.north + bounds.south) / 2,
        lng: (bounds.east + bounds.west) / 2
    };

    let generatorOptions = { radius: 0.1, isLand: options.isLand };

    switch (pattern) {
        case 'heatmaps':
            count = 800; generatorOptions.numClusters = 8; break;
        case 'tower_centroids':
            count = 400; generatorOptions.numClusters = 3; break;
        case 'low_density':
            count = 200; generatorOptions.numClusters = 2; break;
        case 'urban_clusters':
            count = 500; generatorOptions.numClusters = 5; break;
    }

    const points = generateCrowdsourcedData(center, count, generatorOptions);
    return points.map(p => ({
        ...p,
        source: sourceName,
        sourceType: `STRATEGIC_${sourceName}`,
        dataset_name: `${sourceName} Intel`
    }));
}
