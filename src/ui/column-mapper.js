/**
 * TowerIntel PH — Column Mapper Modal
 * Presents a UI for the user to map their uploaded sheet's columns to required Site fields.
 */

export function showColumnMapperModal({ headers, data, filename, fileSource }, onConfirm) {
    // Generate an overlay
    const overlay = document.createElement('div');
    overlay.className = 'column-mapper-overlay';
    Object.assign(overlay.style, {
        position: 'fixed',
        top: '0', left: '0', width: '100%', height: '100%',
        backgroundColor: 'rgba(0,0,0,0.85)',
        zIndex: '10000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'Inter', sans-serif"
    });

    // Auto-detect mappings based on common column names
    const detectColumn = (possibleNames) => {
        const lowerHeaders = headers.map(h => h.toLowerCase().trim());
        for (const possible of possibleNames) {
            const idx = lowerHeaders.findIndex(h => h === possible || h.includes(possible));
            if (idx !== -1) return headers[idx];
        }
        return ''; // not found
    };

    const detectedLat = detectColumn(['lat', 'latitude', 'y', 'lat_dec']);
    const detectedLng = detectColumn(['long', 'lng', 'longitude', 'x', 'lon_dec']);
    const detectedId = detectColumn(['id', 'serial', 'site id', 'tower id', 'code']);
    const detectedName = detectColumn(['name', 'site', 'tower name', 'desc']);
    const detectedAnchor = detectColumn(['anchor', 'mno', 'operator', 'tenant_1']);
    const detectedColo = detectColumn(['colo', 'colocation', 'tenants', 'other']);

    const modal = document.createElement('div');
    modal.className = 'column-mapper-modal';
    Object.assign(modal.style, {
        backgroundColor: '#0f172a',
        border: '1px solid #1e293b',
        borderRadius: '12px',
        padding: '24px',
        width: '450px',
        maxWidth: '90%',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
        color: '#f8fafc'
    });

    const buildOptions = (selectedVal) => {
        let opts = `<option value="">-- Ignore --</option>`;
        headers.forEach(h => {
            const isSelected = h === selectedVal ? 'selected' : '';
            opts += `<option value="${h}" ${isSelected}>${h}</option>`;
        });
        return opts;
    };

    modal.innerHTML = `
        <h2 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: #fff;">Map Columns</h2>
        <p style="margin: 0 0 20px 0; font-size: 13px; color: #94a3b8;">
            Select which columns in  <strong>${filename}</strong> correspond to the required properties.
            Other columns will be saved as extra properties.
        </p>

        <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 24px;">
            <div style="display: flex; flex-direction: column; gap: 4px;">
                <label style="font-size: 12px; font-weight: 500; color: #cbd5e1;">Site ID / Serial</label>
                <select id="cmap-id" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid #334155; background: #1e293b; color: #fff; font-size: 13px; outline: none;">
                    ${buildOptions(detectedId)}
                </select>
            </div>

            <div style="display: flex; flex-direction: column; gap: 4px;">
                <label style="font-size: 12px; font-weight: 500; color: #cbd5e1;">Site Name</label>
                <select id="cmap-name" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid #334155; background: #1e293b; color: #fff; font-size: 13px; outline: none;">
                    ${buildOptions(detectedName)}
                </select>
            </div>

            <div style="display: flex; gap: 12px;">
                <div style="display: flex; flex-direction: column; gap: 4px; flex: 1;">
                    <label style="font-size: 12px; font-weight: 500; color: #cbd5e1;">Latitude <span style="color: #ef4444;">*</span></label>
                    <select id="cmap-lat" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid #ef4444; background: #1e293b; color: #fff; font-size: 13px; outline: none;">
                        ${buildOptions(detectedLat)}
                    </select>
                </div>

                <div style="display: flex; flex-direction: column; gap: 4px; flex: 1;">
                    <label style="font-size: 12px; font-weight: 500; color: #cbd5e1;">Longitude <span style="color: #ef4444;">*</span></label>
                    <select id="cmap-lng" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid #ef4444; background: #1e293b; color: #fff; font-size: 13px; outline: none;">
                        ${buildOptions(detectedLng)}
                    </select>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <label style="font-size: 12px; font-weight: 500; color: #cbd5e1;">Anchor / MNO</label>
                    <select id="cmap-anchor" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid #334155; background: #1e293b; color: #fff; font-size: 13px; outline: none;">
                        ${buildOptions(detectedAnchor)}
                    </select>
                </div>

                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <label style="font-size: 12px; font-weight: 500; color: #cbd5e1;">Colo Tenants (CSV)</label>
                    <select id="cmap-colo" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid #334155; background: #1e293b; color: #fff; font-size: 13px; outline: none;">
                        ${buildOptions(detectedColo)}
                    </select>
                </div>
            </div>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 8px;">
            <button id="cmap-cancel" style="padding: 8px 16px; border-radius: 6px; border: 1px solid #334155; background: transparent; color: #cbd5e1; cursor: pointer; font-weight: 500; font-size: 13px; transition: all 0.2s;">Cancel</button>
            <button id="cmap-confirm" style="padding: 8px 16px; border-radius: 6px; border: none; background: #00e5ff; color: #0b1121; cursor: pointer; font-weight: 600; font-size: 13px; transition: all 0.2s;">Import Data</button>
        </div>
        <p id="cmap-error" style="color: #ef4444; font-size: 12px; margin-top: 12px; display: none;">Latitude and Longitude columns must be selected.</p>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const closeModal = () => {
        if (document.body.contains(overlay)) {
            document.body.removeChild(overlay);
        }
    };

    document.getElementById('cmap-cancel').addEventListener('click', closeModal);

    document.getElementById('cmap-confirm').addEventListener('click', () => {
        const idCol = document.getElementById('cmap-id').value;
        const nameCol = document.getElementById('cmap-name').value;
        const latCol = document.getElementById('cmap-lat').value;
        const lngCol = document.getElementById('cmap-lng').value;
        const anchorCol = document.getElementById('cmap-anchor').value;
        const coloCol = document.getElementById('cmap-colo').value;

        if (!latCol || !lngCol) {
            document.getElementById('cmap-error').style.display = 'block';
            return;
        }

        closeModal();

        // Perform the mapping
        const processedSites = data.map((row, index) => {
            let lat = parseFloat(row[latCol]);
            let lng = parseFloat(row[lngCol]);

            if (isNaN(lat) || isNaN(lng)) return null;

            // Extract colo tenants if available
            const rawColo = coloCol && row[coloCol] ? String(row[coloCol]) : '';
            const coloTenants = rawColo ? rawColo.split(/[;,]/).map(t => t.trim()).filter(Boolean) : [];

            let anchor = anchorCol && row[anchorCol] ? String(row[anchorCol]).trim() : '';

            // If sourceType implies an MNO and Anchor is empty, use the source type
            let stAnchor = '';
            if (['Globe', 'Smart', 'DITO', 'Competitor'].includes(fileSource)) stAnchor = fileSource;
            if (fileSource && fileSource.startsWith('MNO_')) stAnchor = fileSource.replace('MNO_', '');

            if (!anchor && stAnchor) anchor = stAnchor;
            if (!anchor) anchor = 'Globe'; // sensible default

            // Create base properties object (for all extra columns)
            const properties = { ...row };

            return {
                id: idCol && row[idCol] ? String(row[idCol]).trim() : `TWR-U${String(index + 1).padStart(4, '0')}`,
                name: nameCol && row[nameCol] ? String(row[nameCol]).trim() : `Uploaded Site ${index + 1}`,
                lat: lat,
                lng: lng,
                anchor: anchor,
                current_tenants: coloTenants,
                height_m: properties['height'] || properties['height_m'] ? parseFloat(properties['height'] || properties['height_m']) : 45,
                available_apertures: 3 - coloTenants.length,
                rsrp: null,
                rsrq: null,
                congestion: null,
                population_density: null,
                sourceType: fileSource,
                mno: stAnchor || null,
                status: 'Built',
                confidence: 1.0,
                properties: properties // Store all raw columns
            };
        }).filter(site => site !== null);

        onConfirm(processedSites);
    });
}
