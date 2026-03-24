/**
 * TowerIntel PH — RF Propagation Panel UI v2
 * Controls for height, frequency, power, model selection
 * With elevation-aware Viewshed Analysis
 */
import { FREQUENCY_PRESETS, PROPAGATION_MODELS, calculateCoverageRadius, computeViewshed } from '../engine/propagation.js';

export function renderPropagationPanel(container, { tower, onApply, onViewshed, onClose }) {
    const defaults = {
        height_m: tower?.height_m || 30,
        frequency_mhz: 1800,
        tx_power_dbm: 43,
        model: 'Auto',
        terrain_type: tower?.terrain_type || 'Suburban',
        rsrp_threshold: -100,
        site_elevation_m: tower?.elevation_m || 0,
    };

    const initialRadius = calculateCoverageRadius(defaults);

    container.innerHTML = `
    <div class="prop-panel" style="
        background: rgba(10,15,30,0.97); border: 1px solid rgba(0,229,255,0.3);
        border-radius: 12px; padding: 16px; color: #fff; font-size: 12px;
        max-height: 80vh; overflow-y: auto;
    ">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <h3 style="margin: 0; color: #00e5ff; font-size: 14px;">📡 RF Propagation</h3>
            <button id="prop-close" style="background:none;border:none;color:#ff5252;cursor:pointer;font-size:18px;">✕</button>
        </div>

        ${tower ? `<div style="background:rgba(0,229,255,0.08);padding:8px;border-radius:8px;margin-bottom:12px;">
            <b style="color:#00e5ff;">${tower.name || tower.id}</b><br>
            <span style="color:#94a3b8;font-size:10px;">${tower.lat?.toFixed(5)}, ${tower.lng?.toFixed(5)}</span>
            <span style="color:#64748b;font-size:9px;margin-left:8px;">⛰️ ${defaults.site_elevation_m}m ASL</span>
        </div>` : ''}

        <div class="prop-control" style="margin-bottom: 10px;">
            <label style="color:#94a3b8;font-size:10px;">Antenna Height: <b id="height-val" style="color:#fff;">${defaults.height_m}m</b></label>
            <input type="range" id="prop-height" min="10" max="120" value="${defaults.height_m}" style="width:100%;accent-color:#00e5ff;">
            <div style="color:#64748b;font-size:8px;">Effective height (AGL + ASL): <b id="effective-h">${defaults.height_m + defaults.site_elevation_m}m</b></div>
        </div>

        <div class="prop-control" style="margin-bottom: 10px;">
            <label style="color:#94a3b8;font-size:10px;">Frequency</label>
            <select id="prop-freq" class="filter-select" style="font-size:11px;height:28px;">
                ${FREQUENCY_PRESETS.map(f => `<option value="${f.value}" ${f.value === defaults.frequency_mhz ? 'selected' : ''}>${f.label}</option>`).join('')}
            </select>
        </div>

        <div class="prop-control" style="margin-bottom: 10px;">
            <label style="color:#94a3b8;font-size:10px;">Tx Power: <b id="power-val" style="color:#fff;">${defaults.tx_power_dbm} dBm</b></label>
            <input type="range" id="prop-power" min="30" max="49" value="${defaults.tx_power_dbm}" style="width:100%;accent-color:#ffd600;">
        </div>

        <div class="prop-control" style="margin-bottom: 10px;">
            <label style="color:#94a3b8;font-size:10px;">Propagation Model</label>
            <select id="prop-model" class="filter-select" style="font-size:11px;height:28px;">
                ${PROPAGATION_MODELS.map(m => `<option value="${m.value}" ${m.value === defaults.model ? 'selected' : ''}>${m.label}</option>`).join('')}
            </select>
        </div>

        <div class="prop-control" style="margin-bottom: 10px;">
            <label style="color:#94a3b8;font-size:10px;">Terrain</label>
            <select id="prop-terrain" class="filter-select" style="font-size:11px;height:28px;">
                <option value="Urban" ${defaults.terrain_type === 'Urban' ? 'selected' : ''}>Urban</option>
                <option value="Suburban" ${defaults.terrain_type === 'Suburban' ? 'selected' : ''}>Suburban</option>
                <option value="Rural" ${defaults.terrain_type === 'Rural' ? 'selected' : ''}>Rural</option>
            </select>
        </div>

        <div style="background:rgba(0,200,83,0.1);padding:10px;border-radius:8px;margin:12px 0;text-align:center;border:1px solid rgba(0,200,83,0.3);">
            <div style="color:#94a3b8;font-size:10px;">Estimated Coverage Radius</div>
            <div id="prop-radius" style="font-size:24px;font-weight:800;color:#00e676;">${initialRadius.toFixed(1)} km</div>
            <div id="prop-model-used" style="color:#64748b;font-size:9px;">Model: Auto • Elevation: ${defaults.site_elevation_m}m ASL</div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px;">
            <button id="prop-apply-one" class="mno-btn active" style="border:none;font-size:11px;padding:8px;">
                Apply to Site
            </button>
            <button id="prop-apply-all" class="mno-btn" style="border-color:#ffd600;color:#ffd600;font-size:11px;padding:8px;">
                Apply to All
            </button>
        </div>
        <button id="prop-viewshed" class="mno-btn" style="width:100%;border-color:#00e676;color:#00e676;font-size:11px;padding:10px;background:rgba(0,200,83,0.1);">
            🏔️ Analyze Viewshed (Elevation-Aware)
        </button>
        <div id="viewshed-status" style="color:#64748b;font-size:9px;text-align:center;margin-top:6px;"></div>
    </div>`;

    // --- Event Handlers ---
    const getParams = () => ({
        height_m: parseInt(container.querySelector('#prop-height').value),
        frequency_mhz: parseInt(container.querySelector('#prop-freq').value),
        tx_power_dbm: parseInt(container.querySelector('#prop-power').value),
        model: container.querySelector('#prop-model').value,
        terrain_type: container.querySelector('#prop-terrain').value,
        site_elevation_m: defaults.site_elevation_m,
    });

    const updateRadius = () => {
        const params = getParams();
        const radius = calculateCoverageRadius(params);
        container.querySelector('#prop-radius').textContent = `${radius.toFixed(1)} km`;
        container.querySelector('#prop-model-used').textContent = `Model: ${params.model} • Elevation: ${params.site_elevation_m}m ASL`;
        container.querySelector('#height-val').textContent = `${params.height_m}m`;
        container.querySelector('#effective-h').textContent = `${params.height_m + params.site_elevation_m}m`;
        container.querySelector('#power-val').textContent = `${params.tx_power_dbm} dBm`;
    };

    container.querySelector('#prop-height').addEventListener('input', updateRadius);
    container.querySelector('#prop-power').addEventListener('input', updateRadius);
    container.querySelector('#prop-freq').addEventListener('change', updateRadius);
    container.querySelector('#prop-model').addEventListener('change', updateRadius);
    container.querySelector('#prop-terrain').addEventListener('change', updateRadius);

    container.querySelector('#prop-close').addEventListener('click', () => {
        container.innerHTML = '';
        if (onClose) onClose();
    });

    container.querySelector('#prop-apply-one').addEventListener('click', () => {
        if (!tower) return alert('Select a tower first');
        const params = getParams();
        if (onApply) onApply({ towers: [tower], params, mode: 'single' });
    });

    container.querySelector('#prop-apply-all').addEventListener('click', () => {
        const params = getParams();
        if (onApply) onApply({ towers: null, params, mode: 'all' });
    });

    // Viewshed Analysis — True Ray Tracing
    container.querySelector('#prop-viewshed').addEventListener('click', async () => {
        if (!tower) return alert('Select a tower first');
        const statusEl = container.querySelector('#viewshed-status');
        const btn = container.querySelector('#prop-viewshed');
        btn.disabled = true;
        btn.textContent = '⏳ Fetching terrain DEM...';
        statusEl.textContent = 'Loading elevation grid → ray tracing 72 azimuths with terrain obstruction checks...';
        statusEl.style.color = '#64748b';

        try {
            const params = getParams();
            const result = await computeViewshed(tower, params, 72, 30);
            const { stats } = result;
            statusEl.innerHTML = `
                <div style="text-align:left;padding:4px 0;">
                    <b style="color:#00e676;">✅ Viewshed Complete</b><br>
                    <span style="color:#94a3b8;font-size:8px;">⛰️ Tower: ${stats.siteElevation}m ASL + ${stats.towerHeight}m = <b>${stats.antennaASL}m</b> antenna</span><br>
                    <span style="color:#94a3b8;font-size:8px;">🏔️ Terrain: ${stats.minTerrain}m – ${stats.maxTerrain}m (avg ${stats.avgTerrain}m) | DEM: ${stats.demSize} @ ${stats.demResolution}m</span><br>
                    <span style="color:#00e676;">👁 Visible: ${stats.visibilityPct}%</span> (${stats.visible}/${stats.total})<br>
                    <span style="color:#f44336;">🚫 Blocked: ${stats.blocked} points by terrain</span><br>
                    <span style="color:#00e5ff;">📡 RF Coverage: ${stats.coveragePct}%</span> (${stats.covered} pts)
                </div>`;
            statusEl.style.color = '#fff';
            if (onViewshed) onViewshed(result);
        } catch (e) {
            statusEl.textContent = `❌ ${e.message}`;
            statusEl.style.color = '#ff5252';
        } finally {
            btn.disabled = false;
            btn.textContent = '🏔️ Analyze Viewshed (Ray Trace)';
        }
    });
}
