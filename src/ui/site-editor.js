/**
 * TowerIntel PH — Site Editor Modal
 * Replaces ugly browser prompt() dialogs with a premium in-app editor.
 */

/**
 * Show a beautiful modal to edit site properties.
 * @param {Object} site - The tower/site object to edit
 * @param {Function} onSave - Callback with the updated field map: { height_m, lat, lng, ... }
 */
export function showSiteEditorModal(site, onSave) {
    // Remove any existing modal
    const existing = document.getElementById('site-editor-overlay');
    if (existing) existing.remove();

    // Build editable fields from the site object
    const fields = [
        { key: 'name', label: 'Site Name', type: 'text', value: site.name || '' },
        { key: 'id', label: 'Site ID', type: 'text', value: site.id || '', readonly: true },
        { key: 'height_m', label: 'Height (m)', type: 'number', value: site.height_m || '' },
        { key: 'lat', label: 'Latitude', type: 'number', value: site.lat || '', step: '0.00001' },
        { key: 'lng', label: 'Longitude', type: 'number', value: site.lng || '', step: '0.00001' },
        {
            key: 'structural_status', label: 'Status', type: 'select', value: site.structural_status || 'Ready',
            options: ['Ready', 'Under Construction', 'Decommissioned', 'Planned', 'Active']
        },
        {
            key: 'current_tenants', label: 'Tenants', type: 'text',
            value: Array.isArray(site.current_tenants) ? site.current_tenants.join(', ') : (site.current_tenants || ''),
            placeholder: 'Globe, Smart, DITO'
        },
    ];

    // Collect any extra custom properties (from uploaded files)
    if (site.properties && typeof site.properties === 'object') {
        for (const [k, v] of Object.entries(site.properties)) {
            if (['lat', 'lng', 'height', 'height_m', 'name', 'id'].includes(k.toLowerCase())) continue;
            fields.push({ key: `prop_${k}`, label: k.replace(/_/g, ' '), type: 'text', value: v || '', isCustom: true, originalKey: k });
        }
    }

    const overlay = document.createElement('div');
    overlay.id = 'site-editor-overlay';
    overlay.innerHTML = `
        <div class="se-backdrop"></div>
        <div class="se-modal">
            <div class="se-header">
                <div>
                    <h3 class="se-title">Edit Site</h3>
                    <span class="se-subtitle">${site.id || 'Unknown'}</span>
                </div>
                <button class="se-close" id="se-close-btn">&times;</button>
            </div>
            <div class="se-body">
                ${fields.map(f => `
                    <div class="se-field">
                        <label class="se-label">${f.label}</label>
                        ${f.type === 'select' ? `
                            <select class="se-input" data-key="${f.key}" ${f.readonly ? 'disabled' : ''}>
                                ${f.options.map(o => `<option value="${o}" ${o === f.value ? 'selected' : ''}>${o}</option>`).join('')}
                            </select>
                        ` : `
                            <input class="se-input" 
                                type="${f.type}" 
                                data-key="${f.key}" 
                                value="${String(f.value).replace(/"/g, '&quot;')}" 
                                ${f.readonly ? 'disabled' : ''}
                                ${f.step ? `step="${f.step}"` : ''}
                                ${f.placeholder ? `placeholder="${f.placeholder}"` : ''}
                            />
                        `}
                    </div>
                `).join('')}
            </div>
            <div class="se-footer">
                <button class="se-btn se-btn-cancel" id="se-cancel-btn">Cancel</button>
                <button class="se-btn se-btn-save" id="se-save-btn">Save Changes</button>
            </div>
        </div>
    `;

    // Inject styles if not already present
    if (!document.getElementById('site-editor-styles')) {
        const style = document.createElement('style');
        style.id = 'site-editor-styles';
        style.textContent = `
            .se-backdrop {
                position: fixed; inset: 0;
                background: rgba(0,0,0,0.6);
                backdrop-filter: blur(4px);
                z-index: 99998;
            }
            .se-modal {
                position: fixed;
                top: 50%; left: 50%;
                transform: translate(-50%, -50%);
                width: min(440px, 90vw);
                max-height: 85vh;
                background: #0f172a;
                border: 1px solid rgba(0,229,255,0.25);
                border-radius: 16px;
                box-shadow: 0 25px 50px rgba(0,0,0,0.5), 0 0 40px rgba(0,229,255,0.08);
                z-index: 99999;
                display: flex; flex-direction: column;
                overflow: hidden;
                animation: se-slide-up 0.25s ease-out;
            }
            @keyframes se-slide-up {
                from { opacity: 0; transform: translate(-50%, -46%); }
                to   { opacity: 1; transform: translate(-50%, -50%); }
            }
            .se-header {
                display: flex; justify-content: space-between; align-items: center;
                padding: 18px 22px 14px;
                border-bottom: 1px solid rgba(255,255,255,0.06);
            }
            .se-title {
                margin: 0; font-size: 17px; font-weight: 700; color: #fff;
                letter-spacing: 0.3px;
            }
            .se-subtitle {
                font-size: 11px; color: #64748b; font-weight: 500;
            }
            .se-close {
                background: none; border: none; color: #64748b;
                font-size: 22px; cursor: pointer; padding: 4px 8px;
                border-radius: 8px; transition: all 0.15s;
            }
            .se-close:hover { background: rgba(255,255,255,0.06); color: #fff; }
            .se-body {
                padding: 16px 22px;
                overflow-y: auto;
                flex: 1;
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 12px;
            }
            .se-field {
                display: flex; flex-direction: column; gap: 4px;
            }
            .se-field:first-child {
                grid-column: 1 / -1;
            }
            .se-label {
                font-size: 10px; font-weight: 600; color: #94a3b8;
                text-transform: uppercase; letter-spacing: 0.8px;
            }
            .se-input {
                background: rgba(255,255,255,0.04);
                border: 1px solid rgba(255,255,255,0.1);
                border-radius: 8px;
                padding: 9px 12px;
                color: #e2e8f0;
                font-size: 13px;
                font-family: inherit;
                outline: none;
                transition: border-color 0.2s, box-shadow 0.2s;
                width: 100%;
                box-sizing: border-box;
            }
            .se-input:focus {
                border-color: rgba(0,229,255,0.5);
                box-shadow: 0 0 0 3px rgba(0,229,255,0.08);
            }
            .se-input:disabled {
                opacity: 0.4; cursor: not-allowed;
            }
            .se-input::placeholder { color: #475569; }
            select.se-input {
                appearance: none;
                background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2394a3b8' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
                background-repeat: no-repeat;
                background-position: right 10px center;
                padding-right: 28px;
            }
            .se-footer {
                display: flex; justify-content: flex-end; gap: 10px;
                padding: 14px 22px 18px;
                border-top: 1px solid rgba(255,255,255,0.06);
            }
            .se-btn {
                padding: 9px 20px; border-radius: 8px;
                font-size: 13px; font-weight: 600; cursor: pointer;
                border: none; transition: all 0.15s;
            }
            .se-btn-cancel {
                background: rgba(255,255,255,0.06); color: #94a3b8;
            }
            .se-btn-cancel:hover { background: rgba(255,255,255,0.1); color: #fff; }
            .se-btn-save {
                background: linear-gradient(135deg, #00e5ff, #0091ea);
                color: #0f172a; font-weight: 700;
            }
            .se-btn-save:hover {
                box-shadow: 0 4px 15px rgba(0,229,255,0.3);
                transform: translateY(-1px);
            }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(overlay);

    // Focus first editable input
    setTimeout(() => {
        const firstInput = overlay.querySelector('.se-input:not([disabled])');
        if (firstInput) firstInput.focus();
    }, 100);

    // Event handlers
    const close = () => overlay.remove();

    overlay.querySelector('.se-backdrop').addEventListener('click', close);
    document.getElementById('se-close-btn').addEventListener('click', close);
    document.getElementById('se-cancel-btn').addEventListener('click', close);

    document.getElementById('se-save-btn').addEventListener('click', () => {
        const updates = {};
        const customProps = {};

        overlay.querySelectorAll('.se-input').forEach(input => {
            const key = input.dataset.key;
            if (input.disabled) return;

            const val = input.value.trim();
            if (key.startsWith('prop_')) {
                // Custom property
                const origField = fields.find(f => f.key === key);
                if (origField) customProps[origField.originalKey] = val;
            } else if (key === 'current_tenants') {
                updates[key] = val.split(',').map(t => t.trim()).filter(t => t);
            } else if (key === 'height_m' || key === 'lat' || key === 'lng') {
                const num = parseFloat(val);
                if (!isNaN(num)) updates[key] = num;
            } else {
                updates[key] = val;
            }
        });

        if (Object.keys(customProps).length > 0) {
            updates.properties = { ...(site.properties || {}), ...customProps };
        }

        close();
        if (onSave) onSave(updates);
    });

    // ESC key to close
    const escHandler = (e) => {
        if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);
}
