/**
 * TowerIntel PH — CSV Parser Utility
 * Parses site data from CSV strings, handling Lat/Lng, Anchor, and Colo Tenants.
 */

export function parseSiteCSV(csvString, { sourceType = 'MY_ASSETS' } = {}) {
    const lines = csvString.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) return [];

    const headers = lines[0].toLowerCase().split(',').map(h => h.trim());

    // Flexible mappings for common headers
    const mapping = {
        id: headers.findIndex(h => ['id', 'site_id', 'site id', 'tower_id', 'tower id'].includes(h)),
        name: headers.findIndex(h => ['name', 'site_name', 'site name', 'tower_name', 'tower name'].includes(h)),
        lat: headers.findIndex(h => ['lat', 'latitude', 'y', 'lat_dec', 'latitude_dec'].includes(h)),
        lng: headers.findIndex(h => ['lng', 'longitude', 'x', 'lon', 'long', 'lon_dec', 'longitude_dec'].includes(h)),
        anchor: headers.findIndex(h => ['anchor', 'mno', 'operator', 'tenant_1', 'primary_mno'].includes(h)),
        colo: headers.findIndex(h => ['colo', 'colocation', 'tenants', 'other_mno', 'other_operators'].includes(h)),
        height: headers.findIndex(h => ['height', 'height_m', 'tower_height', 'agl'].includes(h)),
        rsrp: headers.findIndex(h => ['rsrp', 'signal', 'signal_strength'].includes(h)),
        rsrq: headers.findIndex(h => ['rsrq', 'quality'].includes(h)),
        congestion: headers.findIndex(h => ['congestion', 'load', 'utilization'].includes(h)),
        population_density: headers.findIndex(h => ['population_density', 'pop_density', 'density'].includes(h))
    };

    if (mapping.lat === -1 || mapping.lng === -1) {
        throw new Error('CSV must contain "lat" and "lng" columns.');
    }

    const sites = [];
    for (let i = 1; i < lines.length; i++) {
        const row = lines[i].split(',').map(val => val.trim());
        if (row.length < headers.length) continue;

        const rawColo = mapping.colo !== -1 ? row[mapping.colo] : '';
        const coloTenants = rawColo ? rawColo.split(';').map(t => t.trim()) : [];

        // Generate ID if missing, otherwise use provided ID
        let id = mapping.id !== -1 ? row[mapping.id] : `TWR-U${String(i + 1).padStart(4, '0')}`;
        // No longer forcing TWR- prefix if ID is provided, to respect source data veracity

        sites.push({
            id: id,
            name: mapping.name !== -1 ? row[mapping.name] : `Uploaded Site ${i}`,
            lat: parseFloat(row[mapping.lat]),
            lng: parseFloat(row[mapping.lng]),
            anchor: mapping.anchor !== -1 ? row[mapping.anchor] : 'Globe',
            current_tenants: coloTenants,
            height_m: mapping.height !== -1 ? parseFloat(row[mapping.height]) : 45,
            available_apertures: 3 - coloTenants.length, // Assume 3 slots max
            rsrp: mapping.rsrp !== -1 ? parseFloat(row[mapping.rsrp]) : null,
            rsrq: mapping.rsrq !== -1 ? parseFloat(row[mapping.rsrq]) : null,
            congestion: mapping.congestion !== -1 ? parseFloat(row[mapping.congestion]) : null,
            population_density: mapping.population_density !== -1 ? parseFloat(row[mapping.population_density]) : null,
            sourceType: sourceType, // Distinguish based on UI selection
            mno: ['Globe', 'Smart', 'DITO', 'Competitor'].includes(sourceType) ? sourceType : null,
            status: 'Built',
            confidence: 1.0
        });
    }

    return sites;
}

/**
 * Generates a sample CSV template for the user
 */
export function getCSVTemplate() {
    return "id,name,lat,lng,anchor,colo,height,rsrp,rsrq,congestion,population_density\nTWR-U001,Sample Site,14.593,120.981,Globe,Smart;DITO,45,-85,-12,0.4,12000\n";
}

/**
 * Trigger download of tower data as CSV
 */
export function exportToCSV(data, fileName = 'tower_export.csv', scoreMap = new Map(), targetMNO = 'All') {
    if (!data || data.length === 0) return;

    // Excel compatibility: Add UTF-8 BOM
    const BOM = '\uFEFF';
    const headers = [
        'ID', 'Name', 'Latitude', 'Longitude', 'Region', 'Province_City', 'Anchor_MNO', 'Tenants', 'Slots_Used', 'Total_Apertures',
        'Composite_Score', 'Best_Target', 'Recommendation', 'GeoContext', 'CAAP_Dist_km', 'Water_Dist_km',
        'Pop_500m', 'Pop_1km', 'Pop_1_5km',
        'Globe_Distance_m', 'Globe_Priority', 'Globe_Dist_Score', 'Globe_Struct_Score', 'Globe_Pop_Score',
        'Smart_Distance_m', 'Smart_Priority', 'Smart_Dist_Score', 'Smart_Struct_Score', 'Smart_Pop_Score',
        'DITO_Distance_m', 'DITO_Priority', 'DITO_Dist_Score', 'DITO_Struct_Score', 'DITO_Pop_Score'
    ];
    const csvRows = [headers.join(',')];

    for (const item of data) {
        const scoreEntry = scoreMap.get(item.id);
        const scores = scoreEntry?.scores || {};

        let finalScore = 0;
        let bestTarget = scoreEntry?.bestTarget || 'None';

        if (targetMNO === 'All') {
            finalScore = scoreEntry?.composite || 0;
        } else {
            finalScore = scores[targetMNO]?.total || 0;
            bestTarget = targetMNO;
        }

        const getMNOData = (mno) => {
            const s = scores[mno] || {};
            const f = s.factors || {};
            return [
                f.nearestDistM ?? '',
                s.label || 'N/A',
                f.distance ?? '',
                f.structural ?? '',
                f.population ?? ''
            ];
        };

        const usedSlots = (item.current_tenants || []).length + (item.anchor ? 1 : 0);
        const totalApertures = item.available_apertures ? (usedSlots + item.available_apertures) : 3;

        const popData = item.population || scoreEntry?.population || {};

        const row = [
            item.id,
            `"${(item.name || '').replace(/"/g, '""')}"`,
            item.lat,
            item.lng,
            item.region || '',
            item.city || '',
            item.anchor || item.mno || '',
            `"${(item.current_tenants || []).join('; ')}"`,
            usedSlots,
            totalApertures,
            finalScore,
            bestTarget,
            `"${(item.recommendation || '').replace(/"/g, '""')}"`,
            item.terrain_type || '',
            item.caap_dist_km || '',
            item.water_dist_km || '',
            popData.radius_500m || 0,
            popData.radius_1km || 0,
            popData.radius_1_5km || 0,
            ...getMNOData('Globe'),
            ...getMNOData('Smart'),
            ...getMNOData('DITO')
        ];
        csvRows.push(row.join(','));
    }

    const csvContent = BOM + csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    // Ensure proper filename with .csv extension
    const safeName = (fileName || 'TowerIntel_Export').replace(/[^a-zA-Z0-9._-]/g, '_');
    const finalName = safeName.endsWith('.csv') ? safeName : `${safeName}.csv`;

    a.href = url;
    a.download = finalName;
    a.style.display = 'none';

    document.body.appendChild(a);
    a.click();

    // Increase cleanup delay to ensure browser fully initiates the download
    // before revoking the blob URL (prevents UUID filenames)
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 2000);
}
