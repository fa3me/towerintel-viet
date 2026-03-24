/**
 * TowerIntel PH — WiGle.net Integration
 * Fetches cellular network data from WiGle.net API v2
 */

const WIGLE_SEARCH_API = 'https://api.wigle.net/api/v2/network/search';

// PH Operator Mappings (Same as OpenCelliD for consistency)
const PH_MNO_MAP = {
    '51502': 'Globe',
    '51501': 'Globe',
    '51503': 'Smart',
    '51505': 'Smart',
    '51518': 'Smart',
    '51566': 'DITO',
};

/**
 * Fetch cellular networks from WiGLE for a given bounding box.
 */
export async function fetchWigleCells(bounds, credentials, options = {}) {
    const { apiName, apiToken } = credentials;
    if (!apiName || !apiToken) throw new Error('WiGle credentials missing');

    const params = new URLSearchParams({
        onlycell: 'true',
        latrange1: bounds.south,
        latrange2: bounds.north,
        longrange1: bounds.west,
        longrange2: bounds.east,
        mcc: '515' // Philippines
    });

    const auth = btoa(`${apiName}:${apiToken}`);

    console.log(`📡 Querying WiGle.net for cellular data...`);
    const response = await fetch(`${WIGLE_SEARCH_API}?${params.toString()}`, {
        headers: {
            'Authorization': `Basic ${auth}`,
            'Accept': 'application/json'
        }
    });

    if (!response.ok) {
        const contentType = response.headers.get('content-type') || '';
        let message = response.statusText;
        try {
            const text = await response.text();
            if (contentType.includes('application/json')) {
                const error = JSON.parse(text);
                message = error.message || message;
            } else if (text) {
                message = text.slice(0, 200);
            }
        } catch (_) { /* use statusText */ }
        throw new Error(`WiGle API Error (${response.status}): ${message}`);
    }

    const data = await response.json();
    const results = data.results || [];

    console.log(`📡 WiGle returned ${results.length} cellular results`);

    return results.map(res => {
        const mnoKey = `${res.mcc}${String(res.mnc).padStart(2, '0')}`;
        const mno = PH_MNO_MAP[mnoKey] || `MNO-${res.mnc}`;

        // WiGLE 'signal' is often the best observed signal in dBm
        const rsrp = res.signal || -105;

        // Map qos (0-7) to a rough RSRQ scale (-20 to -3) if it exists
        const rsrq = res.qos ? (-20 + (res.qos * 2.4)) : -12;

        return {
            id: `WIGLE-${res.netid.replace(/:/g, '')}`,
            name: `${mno} ${res.transtype || 'Cell'}`,
            lat: res.tranglat || res.lat,
            lng: res.tranglon || res.lon,
            mno,
            sourceType: `MNO_${mno}`,
            dataset_name: `WiGLE ${mno} (${res.transtype || 'CELL'})`,
            technology: res.transtype || 'Unknown',
            cellId: res.cid,
            lac: res.lac,
            rsrp: Math.round(rsrp),
            rsrq: parseFloat(rsrq.toFixed(1)),
            signal_quality: classifyWigleSignal(rsrp),
            source: 'WiGle.net',
            lastUpdated: res.lastupdt
        };
    });
}

function classifyWigleSignal(rsrp) {
    if (rsrp >= -80) return 'Excellent';
    if (rsrp >= -90) return 'Good';
    if (rsrp >= -100) return 'Fair';
    return 'Poor';
}
