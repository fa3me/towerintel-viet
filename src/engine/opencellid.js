/**
 * TowerIntel PH — OpenCelliD Integration
 * Fetches real MNO cell tower data from OpenCelliD API
 * Maps PH MCC/MNC codes to operator names
 */

const OPENCELLID_API = 'https://opencellid.org/cell/getInArea';

// Philippine MCC=515, MNC mappings
const PH_MNO_MAP = {
    '02': 'Globe',    // Globe Telecom
    '01': 'Globe',    // Globe (alt)
    '03': 'Smart',    // Smart Communications
    '05': 'Smart',    // Smart (Sun Cellular)
    '18': 'Smart',    // Smart (Red Mobile)
    '66': 'DITO',     // DITO Telecommunity
};

/**
 * Classify signal strength from raw dBm
 */
function classifySignal(signal) {
    // OpenCelliD often returns 0 for averageSignalStrength — treat as unknown/fair
    if (signal === 0 || signal === null || signal === undefined) return { quality: 'Unknown', rsrp: -90, rsrq: -10 };
    if (signal >= -80) return { quality: 'Excellent', rsrp: signal, rsrq: -5 };
    if (signal >= -90) return { quality: 'Good', rsrp: signal, rsrq: -8 };
    if (signal >= -100) return { quality: 'Fair', rsrp: signal, rsrq: -11 };
    if (signal >= -110) return { quality: 'Poor', rsrp: signal, rsrq: -15 };
    return { quality: 'Very Poor', rsrp: signal, rsrq: -20 };
}

/**
 * Map radio type to technology
 */
function mapRadio(radio) {
    const map = { LTE: '4G LTE', UMTS: '3G', GSM: '2G', NR: '5G NR', CDMA: 'CDMA' };
    return map[radio] || radio || 'Unknown';
}

/**
 * Estimate congestion from range (smaller range = more cells = likely congested)
 */
function estimateCongestion(range, signal) {
    if (range < 500 && signal < -100) return 'High';
    if (range < 1000) return 'Medium';
    return 'Low';
}

/**
 * Fetch cell towers in a bounding box from OpenCelliD
 * @param {Object} bounds - { north, south, east, west } in decimal degrees
 * @param {string} apiKey - OpenCelliD API key
 * @param {Object} options - { radio: 'LTE'|'UMTS'|'GSM'|'NR', limit: number }
 * @returns {Promise<Array>} array of processed tower objects
 */
export async function fetchCellTowers(bounds, apiKey, options = {}) {
    const { radio = 'LTE', limit = 1000 } = options;

    const params = new URLSearchParams({
        token: apiKey,
        BBOX: `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`,
        mcc: '515', // Philippines
        radio,
        limit: String(limit),
        format: 'json'
    });

    const url = `${OPENCELLID_API}?${params.toString()}`;
    console.log(`📡 Fetching OpenCelliD towers (${radio})...`);

    const response = await fetch(url);
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`OpenCelliD API error ${response.status}: ${text}`);
    }

    const data = await response.json();
    const cells = data.cells || [];
    console.log(`📡 Received ${cells.length} cells from OpenCelliD`);

    return cells.map(cell => {
        const mnc = String(cell.mnc).padStart(2, '0');
        const mno = PH_MNO_MAP[mnc] || `MNO-${cell.mnc}`;
        const signal = classifySignal(cell.averageSignalStrength || -100);
        const tech = mapRadio(cell.radio);
        const congestion = estimateCongestion(cell.range || 5000, cell.averageSignalStrength || -100);

        return {
            id: `OCID-${cell.cellid || cell.cid}-${cell.lac}`,
            name: `${mno} ${tech} Cell`,
            lat: cell.lat,
            lng: cell.lon,
            mno,
            sourceType: `MNO_${mno}`,
            dataset_name: `OpenCelliD ${mno} (${tech})`,
            technology: tech,
            radio: cell.radio,
            cellId: cell.cellid || cell.cid,
            lac: cell.lac,
            signal_dbm: cell.averageSignalStrength,
            rsrp: signal.rsrp,
            rsrq: signal.rsrq,
            signal_quality: signal.quality,
            range_m: cell.range,
            congestion,
            samples: cell.samples || 0,
            source: 'OpenCelliD'
        };
    });
}

/**
 * Fetch all tech types for a viewport
 */
export async function fetchAllTechTowers(bounds, apiKey) {
    const techs = ['LTE', 'NR', 'UMTS'];
    const allTowers = [];

    for (const radio of techs) {
        try {
            const towers = await fetchCellTowers(bounds, apiKey, { radio });
            allTowers.push(...towers);
        } catch (e) {
            console.warn(`📡 Failed to fetch ${radio} towers:`, e.message);
        }
    }

    // Deduplicate by cell ID
    const seen = new Set();
    return allTowers.filter(t => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
    });
}
/**
 * Fetch cell towers over a large area by tiling into ~1km² chunks.
 * OpenCelliD limits BBOX to 4,000,000 sq.m (~2km x 2km).
 * We use 0.009° tiles (~1km) to stay well within the limit.
 *
 * @param {Object} bounds - { north, south, east, west }
 * @param {string} apiKey - OpenCelliD API token
 * @param {Object} options - { onProgress: (done, total) => void }
 * @returns {Promise<Array>} Deduplicated array of tower objects
 */
export async function fetchTiledCellTowers(bounds, apiKey, options = {}) {
    const TILE_SIZE = 0.009; // ~1km — keeps BBOX under 4km²
    const { onProgress = () => { } } = options;

    // Build tile grid
    const tiles = [];
    for (let lat = bounds.south; lat < bounds.north; lat += TILE_SIZE) {
        for (let lng = bounds.west; lng < bounds.east; lng += TILE_SIZE) {
            tiles.push({
                south: lat,
                west: lng,
                north: Math.min(lat + TILE_SIZE, bounds.north),
                east: Math.min(lng + TILE_SIZE, bounds.east)
            });
        }
    }

    // Cap tiles to avoid excessive API calls
    const MAX_TILES = 200;
    const tilesToFetch = tiles.slice(0, MAX_TILES);
    if (tiles.length > MAX_TILES) {
        console.warn(`📡 Area too large: ${tiles.length} tiles needed, capping at ${MAX_TILES}`);
    }

    console.log(`📡 Fetching ${tilesToFetch.length} tiles from OpenCelliD...`);
    const allCells = [];
    let done = 0;

    for (const tile of tilesToFetch) {
        try {
            const cells = await fetchCellTowers(tile, apiKey, { radio: 'LTE', limit: 1000 });
            allCells.push(...cells);
        } catch (e) {
            // Skip failed tiles silently (might be empty areas)
            if (!e.message.includes('BBOX')) console.warn(`📡 Tile failed:`, e.message);
        }
        done++;
        onProgress(done, tilesToFetch.length);

        // Small delay to avoid rate limiting
        if (done < tilesToFetch.length) {
            await new Promise(r => setTimeout(r, 150));
        }
    }

    // Deduplicate by cell ID
    const seen = new Set();
    const unique = allCells.filter(t => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
    });

    console.log(`📡 OpenCelliD Tiled Fetch Complete: ${unique.length} unique cells from ${done} tiles`);
    return unique;
}
