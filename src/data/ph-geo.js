/**
 * TowerIntel PH — Philippine Geographic Foundation
 */

export const PH_REGIONS = [
    { id: '01', name: 'Ilocos Region' },
    { id: '02', name: 'Cagayan Valley' },
    { id: '03', name: 'Central Luzon' },
    { id: '04A', name: 'CALABARZON' },
    { id: '04B', name: 'MIMAROPA' },
    { id: '05', name: 'Bicol Region' },
    { id: '06', name: 'Western Visayas' },
    { id: '07', name: 'Central Visayas' },
    { id: '08', name: 'Eastern Visayas' },
    { id: '09', name: 'Zamboanga Peninsula' },
    { id: '10', name: 'Northern Mindanao' },
    { id: '11', name: 'Davao Region' },
    { id: '12', name: 'SOCCSKSARGEN' },
    { id: '13', name: 'Caraga' },
    { id: '14', name: 'BARMM' },
    { id: '15', name: 'Cordillera Administrative Region (CAR)' },
    { id: '130000000', name: 'National Capital Region (NCR)' },
];

export const PH_MUNICIPALITIES = [
    { id: '137600000', name: 'Quezon City', region: '130000000', lat: 14.6760, lng: 121.0437, population: 2960048, type: 'Urban' },
    { id: '133900000', name: 'Manila', region: '130000000', lat: 14.5995, lng: 120.9842, population: 1846513, type: 'Urban' },
    { id: '137500000', name: 'Caloocan', region: '130000000', lat: 14.6570, lng: 120.9724, population: 1661584, type: 'Urban' },
    { id: '137400000', name: 'Taguig', region: '130000000', lat: 14.5176, lng: 121.0509, population: 886722, type: 'Urban' },
    { id: '137100001', name: 'Makati', region: '130000000', lat: 14.5547, lng: 121.0244, population: 582602, type: 'Urban' },
    { id: '037700000', name: 'Dingalan', region: '03', lat: 15.3855, lng: 121.3990, population: 27878, type: 'Suburban' }, 
    { id: '037700001', name: 'Baler', region: '03', lat: 15.7594, lng: 121.5622, population: 43552, type: 'Suburban' },
    { id: '037700002', name: 'Casiguran', region: '03', lat: 16.2828, lng: 122.1158, population: 26564, type: 'Rural' },
    { id: '035400000', name: 'San Jose del Monte', region: '03', lat: 14.8142, lng: 121.0450, population: 651813, type: 'Urban' },
    { id: '031400000', name: 'Malolos', region: '03', lat: 14.8521, lng: 120.8144, population: 261189, type: 'Urban' },
    { id: '015500000', name: 'Dagupan City', region: '01', lat: 16.0433, lng: 120.3333, population: 174302, type: 'Urban' },
    { id: '042100000', name: 'Antipolo', region: '04A', lat: 14.5845, lng: 121.1754, population: 887399, type: 'Urban' },
    { id: '112400000', name: 'Davao City', region: '11', lat: 7.1907, lng: 125.4553, population: 1776949, type: 'Urban' },
];

/**
 * Comprehensive List of Airports in the Philippines (CAAP Compliance)
 */
export const PH_AIRPORTS = [
    // International
    { name: 'NAIA (Manila)', lat: 14.5086, lng: 121.0194, type: 'International' },
    { name: 'Mactan-Cebu International', lat: 10.3075, lng: 123.9794, type: 'International' },
    { name: 'Clark International', lat: 15.1858, lng: 120.5597, type: 'International' },
    { name: 'Davao International', lat: 7.1253, lng: 125.6458, type: 'International' },
    { name: 'Iloilo International', lat: 10.8328, lng: 122.4933, type: 'International' },
    { name: 'General Santos International', lat: 6.0580, lng: 125.0961, type: 'International' },
    { name: 'Laoag International', lat: 18.1783, lng: 120.5319, type: 'International' },
    { name: 'Zamboanga International', lat: 6.9225, lng: 122.0592, type: 'International' },
    { name: 'Bicol International', lat: 13.1133, lng: 123.6761, type: 'International' },
    { name: 'Puerto Princesa International', lat: 9.7420, lng: 118.7589, type: 'International' },
    { name: 'Bohol-Panglao International', lat: 9.5667, lng: 123.7667, type: 'International' },
    { name: 'Kalibo International', lat: 11.6792, lng: 122.3758, type: 'International' },

    // Principal Class 1
    { name: 'Bacolod-Silay', lat: 10.7761, lng: 122.9925, type: 'Class 1' },
    { name: 'Butuan', lat: 8.9511, lng: 125.4786, type: 'Class 1' },
    { name: 'Cauayan', lat: 16.9322, lng: 121.7522, type: 'Class 1' },
    { name: 'Cotabato', lat: 7.1642, lng: 124.2144, type: 'Class 1' },
    { name: 'Dipolog', lat: 8.6011, lng: 123.3442, type: 'Class 1' },
    { name: 'Dumaguete', lat: 9.3339, lng: 123.3008, type: 'Class 1' },
    { name: 'Laguindingan (CDO)', lat: 8.6122, lng: 124.4564, type: 'Class 1' },
    { name: 'Legazpi', lat: 13.1539, lng: 123.7303, type: 'Class 1' },
    { name: 'Naga', lat: 13.5847, lng: 123.2725, type: 'Class 1' },
    { name: 'Pagadian', lat: 7.8283, lng: 123.4650, type: 'Class 1' },
    { name: 'Roxas', lat: 11.5983, lng: 122.7533, type: 'Class 1' },
    { name: 'San Jose (Mindoro)', lat: 12.3611, lng: 121.0472, type: 'Class 1' },
    { name: 'Tacloban', lat: 11.2269, lng: 125.0286, type: 'Class 1' },
    { name: 'Tuguegarao', lat: 17.6411, lng: 121.7317, type: 'Class 1' },
    { name: 'Virac', lat: 13.5786, lng: 124.2047, type: 'Class 1' },

    // Principal Class 2
    { name: 'Basco', lat: 20.4514, lng: 121.9700, type: 'Class 2' },
    { name: 'Busuanga (Coron)', lat: 12.1222, lng: 120.1003, type: 'Class 2' },
    { name: 'Calbayog', lat: 12.0733, lng: 124.5447, type: 'Class 2' },
    { name: 'Camiguin', lat: 9.2525, lng: 124.7117, type: 'Class 2' },
    { name: 'Catarman', lat: 12.5028, lng: 124.6367, type: 'Class 2' },
    { name: 'Cuyo', lat: 10.8528, lng: 121.0700, type: 'Class 2' },
    { name: 'Jolo', lat: 6.0089, lng: 121.0094, type: 'Class 2' },
    { name: 'Marinduque', lat: 13.3592, lng: 121.8411, type: 'Class 2' },
    { name: 'Masbate', lat: 12.3686, lng: 123.6339, type: 'Class 2' },
    { name: 'Ormoc', lat: 11.0556, lng: 124.5647, type: 'Class 2' },
    { name: 'Ozamiz', lat: 8.1792, lng: 123.8433, type: 'Class 2' },
    { name: 'San Vicente', lat: 10.5186, lng: 119.2514, type: 'Class 2' },
    { name: 'Siargao', lat: 9.8594, lng: 126.0153, type: 'Class 2' },
    { name: 'Surigao', lat: 9.7583, lng: 125.4800, type: 'Class 2' },
    { name: 'Tablas', lat: 12.0983, lng: 122.0286, type: 'Class 2' },
    { name: 'Tandag', lat: 9.0700, lng: 126.1719, type: 'Class 2' },

    // Community & Others
    { name: 'Alabat', lat: 14.1203, lng: 122.0211, type: 'Community' },
    { name: 'Bagabag', lat: 16.5186, lng: 121.2514, type: 'Community' },
    { name: 'Baler', lat: 15.7292, lng: 121.5033, type: 'Community' },
    { name: 'Bantayan', lat: 11.1611, lng: 123.7789, type: 'Community' },
    { name: 'Biliran', lat: 11.5086, lng: 124.4308, type: 'Community' },
    { name: 'Bislig', lat: 8.1969, lng: 126.3217, type: 'Community' },
    { name: 'Borongan', lat: 11.6781, lng: 125.4744, type: 'Community' },
    { name: 'Bulan', lat: 12.6842, lng: 123.8767, type: 'Community' },
    { name: 'Calapan', lat: 13.4258, lng: 121.2017, type: 'Community' },
    { name: 'Catbalogan', lat: 11.8011, lng: 124.8117, type: 'Community' },
    { name: 'Daet', lat: 14.1306, lng: 122.9817, type: 'Community' },
    { name: 'Guiuan', lat: 11.0353, lng: 125.7417, type: 'Community' },
    { name: 'Hilongos', lat: 10.3703, lng: 124.7508, type: 'Community' },
    { name: 'Iba', lat: 15.3267, lng: 119.9678, type: 'Community' },
    { name: 'Jomalig', lat: 14.6869, lng: 122.4286, type: 'Community' },
    { name: 'Lubang', lat: 13.8553, lng: 120.1067, type: 'Community' },
    { name: 'Maasin', lat: 10.1833, lng: 124.8167, type: 'Community' },
    { name: 'Mamburao', lat: 13.2039, lng: 120.6053, type: 'Community' },
    { name: 'Mati', lat: 6.9536, lng: 126.2736, type: 'Community' },
    { name: 'Palanan', lat: 17.0628, lng: 122.4244, type: 'Community' },
    { name: 'Pinamalayan', lat: 13.0253, lng: 121.5014, type: 'Community' },
    { name: 'Plaridel', lat: 14.8872, lng: 120.8525, type: 'Community' },
    { name: 'Romblon', lat: 12.5833, lng: 122.2667, type: 'Community' },
    { name: 'San Carlos', lat: 10.5111, lng: 123.4611, type: 'Community' },
    { name: 'Siquijor', lat: 9.2131, lng: 123.4686, type: 'Community' },
    { name: 'Ubay', lat: 10.0531, lng: 124.4719, type: 'Community' },
    { name: 'Wasig', lat: 12.5333, lng: 121.4833, type: 'Community' },
    { name: 'Itbayat', lat: 20.7208, lng: 121.8417, type: 'Community' },
    { name: 'Dingalan (Landing Strip)', lat: 15.3900, lng: 121.4000, type: 'Landing Strip' }
];

export const PH_COASTAL_POINTS = [
    { name: 'Manila Bay', lat: 14.5, lng: 120.8 },
    { name: 'Dingalan Bay', lat: 15.3855, lng: 121.4100 }
];

/**
 * Get nearest CAAP airport and distance in km for a given point.
 * Used for all site types (towers, MNO, heatmap) so airport distance shows everywhere.
 */
export function getNearestAirport(lat, lng) {
    let minDist = Infinity;
    let nearestName = 'N/A';
    for (const airport of PH_AIRPORTS) {
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

/**
 * Haversine distance calculation
 */
export function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function enrichSiteMetadata(lat, lng) {
    let nearest = null;
    let minDist = Infinity;
    for (const mun of PH_MUNICIPALITIES) {
        const dLat = lat - mun.lat;
        const dLng = lng - mun.lng;
        const distSq = dLat * dLat + dLng * dLng;
        if (distSq < minDist) { minDist = distSq; nearest = mun; }
    }
    if (nearest) return { city: nearest.name, region: nearest.region, terrain_type: nearest.type };
    return { city: 'Unknown', region: 'All', terrain_type: 'Suburban' };
}

/**
 * Get nearest municipality and region name for a point (for landbank export Region/Province_City).
 */
export function getNearestMunicipality(lat, lng) {
    let nearest = null;
    let minDist = Infinity;
    for (const mun of PH_MUNICIPALITIES) {
        const d = haversineDistance(lat, lng, mun.lat, mun.lng);
        if (d < minDist) {
            minDist = d;
            nearest = mun;
        }
    }
    if (!nearest) return { regionName: '', provinceCity: '' };
    const regionRow = PH_REGIONS.find(r => r.id === nearest.region);
    return {
        regionName: regionRow ? regionRow.name : '',
        provinceCity: nearest.name
    };
}
