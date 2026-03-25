/**
 * Split KPI panel for MNO comparison inside a user-drawn polygon.
 */
import { MNOS } from '../config/app-config.js';

function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function colHtml(label, val, color = '#e2e8f0') {
    return `
        <div class="pcc-stat">
            <span class="pcc-stat-lbl">${esc(label)}</span>
            <span class="pcc-stat-val" style="color:${color}">${val}</span>
        </div>`;
}

function sideHtml(title, mno, stats, mnoOptions) {
    const opts = mnoOptions.map((m) => `<option value="${esc(m)}" ${m === mno ? 'selected' : ''}>${esc(m)}</option>`).join('');
    const fmt = (v, suf = '') => (v == null || Number.isNaN(v)) ? '—' : `${v}${suf}`;

    const rows = (stats.sites || []).slice(0, 80).map((s) => `
        <tr>
            <td>${esc(s.name || s.id)}</td>
            <td>${fmt(s.rsrp, '')}</td>
            <td>${fmt(s.rsrq, '')}</td>
            <td>${s.sinr != null && Number.isFinite(Number(s.sinr)) ? esc(String(s.sinr)) : '—'}</td>
        </tr>
    `).join('');

    return `
        <div class="pcc-side">
            <div class="pcc-side-head">
                <h4 class="pcc-side-title" style="color:${title === 'Left' ? '#00e5ff' : '#00e676'}">${esc(title)}</h4>
                <select class="pcc-mno-select filter-select" data-side="${esc(title)}">
                    ${opts}
                </select>
            </div>
            <div class="pcc-kpis">
                ${colHtml('Sites', stats.siteCount ?? 0, '#fff')}
                ${colHtml('Avg RSRP', fmt(stats.avgRsrp, ' dBm'), '#00e5ff')}
                ${colHtml('Avg RSRQ', fmt(stats.avgRsrq, ' dB'), '#ce93d8')}
                ${colHtml('Avg SINR', fmt(stats.avgSinr, ' dB'), '#ffd600')}
                ${colHtml('Avg DL', stats.avgDownloadMbps != null ? `${stats.avgDownloadMbps} Mbps` : '—', '#4fc3f7')}
                ${colHtml('Avg UL', stats.avgUploadMbps != null ? `${stats.avgUploadMbps} Mbps` : '—', '#4dd0e1')}
                ${colHtml('Avg congestion', stats.avgCongestion != null ? `${Math.round(stats.avgCongestion <= 1 ? stats.avgCongestion * 100 : stats.avgCongestion)}%` : '—', '#ff9800')}
                ${colHtml('Market share', `${stats.marketShare ?? 0}%`, '#94a3b8')}
            </div>
            <div class="pcc-table-wrap">
                <table class="pcc-table">
                    <thead><tr><th>Site</th><th>RSRP</th><th>RSRQ</th><th>SINR</th></tr></thead>
                    <tbody>${rows || '<tr><td colspan="4" style="opacity:0.5">No sites in area</td></tr>'}</tbody>
                </table>
            </div>
        </div>
    `;
}

const RAT_OPTIONS = [
    { value: 'all', label: 'All tech' },
    { value: '2g', label: '2G (GSM/EDGE)' },
    { value: '3g', label: '3G (UMTS)' },
    { value: '4g', label: '4G / LTE' },
    { value: '5g', label: '5G (NR)' }
];

/**
 * @param {HTMLElement} container
 * @param {Object} opts
 * @param {string} opts.mnoA
 * @param {string} opts.mnoB
 * @param {Object} opts.statsA
 * @param {Object} opts.statsB
 * @param {string} [opts.ratFilter]
 * @param {Function} [opts.onRatFilterChange]
 * @param {Function} opts.onMnoAChange
 * @param {Function} opts.onMnoBChange
 * @param {Function} opts.onClearPolygon
 * @param {Function} opts.onClose
 */
export function renderPolygonComparePanel(container, opts = {}) {
    if (!container) return;
    const {
        mnoA = MNOS[0],
        mnoB = MNOS[1],
        statsA = {},
        statsB = {},
        ratFilter = 'all',
        onRatFilterChange = () => {},
        onMnoAChange = () => {},
        onMnoBChange = () => {},
        onClearPolygon = () => {},
        onClose = () => {}
    } = opts;

    const mnos = [...MNOS];
    const ratOptsHtml = RAT_OPTIONS.map(
        (o) => `<option value="${esc(o.value)}" ${o.value === ratFilter ? 'selected' : ''}>${esc(o.label)}</option>`
    ).join('');

    if (!document.getElementById('polygon-compare-panel-styles')) {
        const st = document.createElement('style');
        st.id = 'polygon-compare-panel-styles';
        st.textContent = `
            #polygon-compare-dock {
                position: absolute; left: 12px; right: 12px; bottom: 88px; z-index: 55;
                max-height: 42vh; display: flex; flex-direction: column;
                background: rgba(15, 23, 42, 0.96); border: 1px solid rgba(0,229,255,0.25);
                border-radius: 14px; box-shadow: 0 -8px 32px rgba(0,0,0,0.45);
                font-family: Inter, system-ui, sans-serif; overflow: hidden;
            }
            #polygon-compare-dock .pcc-head {
                display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
                padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.08);
                flex-shrink: 0; flex-wrap: wrap;
            }
            #polygon-compare-dock .pcc-head h3 { margin: 0; font-size: 14px; color: #fff; }
            #polygon-compare-dock .pcc-head-sub { font-size: 10px; color: #64748b; margin-top: 2px; }
            #polygon-compare-dock .pcc-head-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-left: auto; }
            #polygon-compare-dock .pcc-rat-label { font-size: 10px; color: #94a3b8; display: flex; align-items: center; gap: 6px; }
            #polygon-compare-dock .pcc-rat-select { font-size: 10px; padding: 4px 8px; background: #0b1121; color: #e2e8f0; border: 1px solid #334155; border-radius: 6px; max-width: 140px; }
            #polygon-compare-dock .pcc-actions { display: flex; gap: 8px; }
            #polygon-compare-dock .pcc-btn {
                font-size: 11px; padding: 6px 10px; border-radius: 8px; cursor: pointer; border: 1px solid #334155;
                background: rgba(255,255,255,0.05); color: #e2e8f0;
            }
            #polygon-compare-dock .pcc-btn:hover { border-color: #00e5ff; color: #00e5ff; }
            #polygon-compare-dock .pcc-split { display: grid; grid-template-columns: 1fr 1fr; gap: 0; min-height: 0; flex: 1; }
            #polygon-compare-dock .pcc-side { border-right: 1px solid rgba(255,255,255,0.06); padding: 10px 12px; min-width: 0; display: flex; flex-direction: column; }
            #polygon-compare-dock .pcc-side:last-child { border-right: none; }
            #polygon-compare-dock .pcc-side-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
            #polygon-compare-dock .pcc-side-title { margin: 0; font-size: 12px; }
            #polygon-compare-dock .pcc-mno-select { font-size: 10px; padding: 4px 6px; max-width: 120px; background: #0b1121; color: #e2e8f0; border: 1px solid #334155; border-radius: 6px; }
            #polygon-compare-dock .pcc-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 8px; }
            #polygon-compare-dock .pcc-stat { background: rgba(0,0,0,0.2); border-radius: 8px; padding: 6px 8px; }
            #polygon-compare-dock .pcc-stat-lbl { display: block; font-size: 8px; color: #64748b; text-transform: uppercase; }
            #polygon-compare-dock .pcc-stat-val { font-size: 12px; font-weight: 700; }
            #polygon-compare-dock .pcc-table-wrap { flex: 1; overflow: auto; max-height: 22vh; border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; }
            #polygon-compare-dock .pcc-table { width: 100%; border-collapse: collapse; font-size: 9px; color: #cbd5e1; }
            #polygon-compare-dock .pcc-table th { position: sticky; top: 0; background: #0f172a; text-align: left; padding: 6px 8px; color: #94a3b8; border-bottom: 1px solid #334155; }
            #polygon-compare-dock .pcc-table td { padding: 4px 8px; border-bottom: 1px solid rgba(255,255,255,0.04); }
        `;
        document.head.appendChild(st);
    }

    container.innerHTML = `
        <div id="polygon-compare-dock">
            <div class="pcc-head">
                <div>
                    <h3>MNO compare — drawn area</h3>
                    <div class="pcc-head-sub">Split map: drag handle. KPIs use uploaded site rows inside the polygon; filter by radio generation here.</div>
                </div>
                <div class="pcc-head-right">
                    <label class="pcc-rat-label">Radio
                        <select id="pcc-rat-filter" class="pcc-rat-select" title="Filter MNO upload rows by RAT / technology column">
                            ${ratOptsHtml}
                        </select>
                    </label>
                    <div class="pcc-actions">
                        <button type="button" class="pcc-btn" id="pcc-clear-poly">Clear polygon</button>
                        <button type="button" class="pcc-btn" id="pcc-close-dock">Close</button>
                    </div>
                </div>
            </div>
            <div class="pcc-split">
                ${sideHtml('Left', mnoA, statsA, mnos)}
                ${sideHtml('Right', mnoB, statsB, mnos)}
            </div>
        </div>
    `;

    container.querySelector('#pcc-clear-poly')?.addEventListener('click', onClearPolygon);
    container.querySelector('#pcc-close-dock')?.addEventListener('click', onClose);

    const ratSel = container.querySelector('#pcc-rat-filter');
    ratSel?.addEventListener('change', () => onRatFilterChange(ratSel.value));

    const selA = container.querySelector('.pcc-mno-select[data-side="Left"]');
    const selB = container.querySelector('.pcc-mno-select[data-side="Right"]');
    selA?.addEventListener('change', () => onMnoAChange(selA.value));
    selB?.addEventListener('change', () => onMnoBChange(selB.value));
}

export function removePolygonComparePanel(container) {
    if (container) container.innerHTML = '';
}
