/**
 * TowerIntel Vietnam — geographic helpers (airports, cities).
 */
import vnMainland from './vn-mainland.json';

export const VN_REGIONS = [
    { id: 'NW', name: 'Northwest' },
    { id: 'NE', name: 'Northeast' },
    { id: 'RR', name: 'Red River Delta' },
    { id: 'NC', name: 'North Central Coast' },
    { id: 'SC', name: 'South Central Coast' },
    { id: 'CH', name: 'Central Highlands' },
    { id: 'SE', name: 'Southeast' },
    { id: 'MK', name: 'Mekong Delta' }
];

export const VN_MUNICIPALITIES = [
    { id: 'hn', name: 'Hanoi', region: 'RR', lat: 21.0285, lng: 105.8542, population: 5000000, type: 'Urban' },
    { id: 'hcm', name: 'Ho Chi Minh City', region: 'SE', lat: 10.8231, lng: 106.6297, population: 9000000, type: 'Urban' },
    { id: 'dn', name: 'Da Nang', region: 'SC', lat: 16.0544, lng: 108.2022, population: 1200000, type: 'Urban' },
    { id: 'hp', name: 'Hai Phong', region: 'RR', lat: 20.8449, lng: 106.6881, population: 2000000, type: 'Urban' },
    { id: 'ct', name: 'Can Tho', region: 'MK', lat: 10.0452, lng: 105.7469, population: 1200000, type: 'Urban' },
    { id: 'bd', name: 'Bien Hoa', region: 'SE', lat: 10.9447, lng: 106.8243, population: 1000000, type: 'Urban' },
    { id: 'hue', name: 'Hue', region: 'NC', lat: 16.4637, lng: 107.5909, population: 450000, type: 'Urban' },
    { id: 'nha', name: 'Nha Trang', region: 'SC', lat: 12.2388, lng: 109.1967, population: 400000, type: 'Urban' },
    { id: 'vt', name: 'Vung Tau', region: 'SE', lat: 10.3460, lng: 107.0843, population: 500000, type: 'Urban' },
    { id: 'qn', name: 'Quy Nhon', region: 'SC', lat: 13.7765, lng: 109.2237, population: 450000, type: 'Urban' }
];

/** Major airports — Vietnam */
export const VN_AIRPORTS = [
    { name: 'Noi Bai International (Hanoi)', lat: 21.2211, lng: 105.8019, type: 'International' },
    { name: 'Tan Son Nhat International (SGN)', lat: 10.8188, lng: 106.6519, type: 'International' },
    { name: 'Da Nang International', lat: 16.0439, lng: 108.1990, type: 'International' },
    { name: 'Cam Ranh International', lat: 11.9981, lng: 109.2194, type: 'International' },
    { name: 'Phu Quoc International', lat: 10.2270, lng: 103.9671, type: 'International' },
    { name: 'Cat Bi International (Hai Phong)', lat: 20.8194, lng: 106.7247, type: 'International' },
    { name: 'Phu Bai International (Hue)', lat: 16.4019, lng: 107.7031, type: 'International' },
    { name: 'Can Tho International', lat: 10.0851, lng: 105.7119, type: 'International' },
    { name: 'Van Don International', lat: 21.1177, lng: 107.4140, type: 'International' },
    { name: 'Lien Khuong (Da Lat)', lat: 11.7500, lng: 108.3667, type: 'Domestic' },
    { name: 'Buon Ma Thuot', lat: 12.6683, lng: 108.1203, type: 'Domestic' },
    { name: 'Vinh International', lat: 18.7376, lng: 105.6708, type: 'Domestic' }
];

export const VN_COASTAL_POINTS = [
    { name: 'Ha Long Bay', lat: 20.9101, lng: 107.1839 },
    { name: 'Mekong Delta', lat: 9.5, lng: 105.5 }
];

export function getNearestAirport(lat, lng) {
    let minDist = Infinity;
    let nearestName = 'N/A';
    for (const airport of VN_AIRPORTS) {
        const d = haversineDistance(lat, lng, airport.lat, airport.lng);
        if (d < minDist) {
            minDist = d;
            nearestName = airport.name;
        }
    }
    return {
        name: nearestName,
        distKm: minDist === Infinity ? 0 : Number(minDist.toFixed(2))
    };
}

export function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function enrichSiteMetadata(lat, lng) {
    let nearest = null;
    let minDist = Infinity;
    for (const mun of VN_MUNICIPALITIES) {
        const dLat = lat - mun.lat;
        const dLng = lng - mun.lng;
        const distSq = dLat * dLat + dLng * dLng;
        if (distSq < minDist) {
            minDist = distSq;
            nearest = mun;
        }
    }
    if (nearest) return { city: nearest.name, region: nearest.region, terrain_type: nearest.type };
    return { city: 'Unknown', region: 'All', terrain_type: 'Suburban' };
}

export function getNearestMunicipality(lat, lng) {
    let nearest = null;
    let minDist = Infinity;
    for (const mun of VN_MUNICIPALITIES) {
        const d = haversineDistance(lat, lng, mun.lat, mun.lng);
        if (d < minDist) {
            minDist = d;
            nearest = mun;
        }
    }
    if (!nearest) return { regionName: '', provinceCity: '' };
    const regionRow = VN_REGIONS.find((r) => r.id === nearest.region);
    return {
        regionName: regionRow ? regionRow.name : '',
        provinceCity: nearest.name
    };
}

/** Ray-casting point-in-ring ([lng,lat] positions). */
function pipPointInRing(point, vs) {
    const x = point[0];
    const y = point[1];
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const xi = vs[i][0];
        const yi = vs[i][1];
        const xj = vs[j][0];
        const yj = vs[j][1];
        const intersect =
            (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
        if (intersect) inside = !inside;
    }
    return inside;
}

function pointInPolygonCoords(pt, rings) {
    if (!rings?.length || !rings[0]?.length) return false;
    if (!pipPointInRing(pt, rings[0])) return false;
    for (let i = 1; i < rings.length; i++) {
        if (pipPointInRing(pt, rings[i])) return false;
    }
    return true;
}

function pointInMultiPolygon(pt, coordinates) {
    for (const poly of coordinates) {
        if (pointInPolygonCoords(pt, poly)) return true;
    }
    return false;
}

/**
 * True if (lat,lng) lies inside simplified Vietnam mainland / territorial polygon (GeoJSON).
 * Used to keep synthetic population, landbank, and sync points off sea & neighboring countries.
 */
export function isPointInVietnamLand(lat, lng) {
    const pt = [lng, lat];
    const geom = vnMainland.geometry;
    if (!geom) return false;
    if (geom.type === 'Polygon') return pointInPolygonCoords(pt, geom.coordinates);
    if (geom.type === 'MultiPolygon') return pointInMultiPolygon(pt, geom.coordinates);
    return false;
}
