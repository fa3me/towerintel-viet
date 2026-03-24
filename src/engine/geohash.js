/**
 * TowerIntel PH — Geohash Encoder/Decoder
 * Pure JS implementation — no external dependency.
 * Encodes lat/lng into geohash strings, decodes back, and produces polygons for deck.gl.
 */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
const BASE32_INV = {};
for (let i = 0; i < BASE32.length; i++) BASE32_INV[BASE32[i]] = i;

/**
 * Encode latitude/longitude to a geohash string.
 * @param {number} lat  Latitude (-90..90)
 * @param {number} lng  Longitude (-180..180)
 * @param {number} precision  Number of characters (1–12, default 6 ≈ 1.2km × 0.6km)
 * @returns {string}
 */
export function encode(lat, lng, precision = 6) {
    let latMin = -90, latMax = 90;
    let lngMin = -180, lngMax = 180;
    let hash = '';
    let bit = 0;
    let ch = 0;
    let isLng = true;

    while (hash.length < precision) {
        if (isLng) {
            const mid = (lngMin + lngMax) / 2;
            if (lng >= mid) { ch = ch | (1 << (4 - bit)); lngMin = mid; }
            else { lngMax = mid; }
        } else {
            const mid = (latMin + latMax) / 2;
            if (lat >= mid) { ch = ch | (1 << (4 - bit)); latMin = mid; }
            else { latMax = mid; }
        }
        isLng = !isLng;
        bit++;
        if (bit === 5) {
            hash += BASE32[ch];
            bit = 0;
            ch = 0;
        }
    }
    return hash;
}

/**
 * Decode a geohash string to { lat, lng } center point.
 * @param {string} hash
 * @returns {{ lat: number, lng: number }}
 */
export function decode(hash) {
    const b = bounds(hash);
    return {
        lat: (b.sw.lat + b.ne.lat) / 2,
        lng: (b.sw.lng + b.ne.lng) / 2
    };
}

/**
 * Get the bounding box of a geohash cell.
 * @param {string} hash
 * @returns {{ sw: { lat, lng }, ne: { lat, lng } }}
 */
export function bounds(hash) {
    let latMin = -90, latMax = 90;
    let lngMin = -180, lngMax = 180;
    let isLng = true;

    for (const c of hash) {
        const val = BASE32_INV[c];
        for (let bit = 4; bit >= 0; bit--) {
            if (isLng) {
                const mid = (lngMin + lngMax) / 2;
                if (val & (1 << bit)) lngMin = mid;
                else lngMax = mid;
            } else {
                const mid = (latMin + latMax) / 2;
                if (val & (1 << bit)) latMin = mid;
                else latMax = mid;
            }
            isLng = !isLng;
        }
    }
    return { sw: { lat: latMin, lng: lngMin }, ne: { lat: latMax, lng: lngMax } };
}

/**
 * Get coordinate polygon for a geohash cell (for deck.gl PolygonLayer).
 * Returns array of [lng, lat] pairs forming a closed rectangle.
 * @param {string} hash
 * @returns {Array<[number, number]>}
 */
export function toPolygon(hash) {
    const b = bounds(hash);
    return [
        [b.sw.lng, b.sw.lat],
        [b.ne.lng, b.sw.lat],
        [b.ne.lng, b.ne.lat],
        [b.sw.lng, b.ne.lat],
        [b.sw.lng, b.sw.lat]  // close the ring
    ];
}

/**
 * Get all 8 neighbor geohash strings.
 * @param {string} hash
 * @returns {string[]}
 */
export function neighbors(hash) {
    const { lat, lng } = decode(hash);
    const b = bounds(hash);
    const dlat = b.ne.lat - b.sw.lat;
    const dlng = b.ne.lng - b.sw.lng;
    const precision = hash.length;

    const offsets = [
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1], [0, 1],
        [1, -1], [1, 0], [1, 1]
    ];

    return offsets.map(([dy, dx]) =>
        encode(lat + dy * dlat, lng + dx * dlng, precision)
    );
}

/**
 * Encode all sites into geohash buckets.
 * @param {Array} sites  Array of { lat, lng, ... }
 * @param {number} precision
 * @returns {Map<string, Array>}  geohash → array of sites
 */
export function bucketByGeohash(sites, precision = 6) {
    const buckets = new Map();
    for (const site of sites) {
        if (!site.lat || !site.lng) continue;
        const hash = encode(site.lat, site.lng, precision);
        if (!buckets.has(hash)) buckets.set(hash, []);
        buckets.get(hash).push(site);
    }
    return buckets;
}
