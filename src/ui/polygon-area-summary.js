/**
 * Compact horizontal strip: population + site counts + tech filter + optional MNO KPI compare.
 * KPIs use Network Intel / MNO upload rows (rsrp, rat, etc.) inside the polygon.
 */

import { MNO_SHORT, MNOS } from '../config/app-config.js';

const KPI_STORAGE_KEY = 'towerintel-vn-pas-show-kpi';

const RAT_OPTIONS = [
    { value: 'all', label: 'All tech' },
    { value: '2g', label: '2G (GSM/EDGE)' },
    { value: '3g', label: '3G (UMTS)' },
    { value: '4g', label: '4G / LTE' },
    { value: '5g', label: '5G (NR)' }
];

function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtNum(n) {
    if (n == null || Number.isNaN(n)) return '—';
    return Number(n).toLocaleString();
}

function fmtMbps(v) {
    if (v == null || Number.isNaN(v)) return '—';
    return `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })} Mbps`;
}

function fmtCongestion(c) {
    if (c == null || Number.isNaN(c)) return '—';
    const x = Number(c);
    const pct = x <= 1 && x >= 0 ? x * 100 : x;
    return `${Math.round(pct)}%`;
}

function fmtDelta(a, b, unit = '', higherIsBetter = true, decimals = 1) {
    if (a == null || b == null || Number.isNaN(Number(a)) || Number.isNaN(Number(b))) return '—';
    const d = Number(a) - Number(b);
    if (Math.abs(d) < 1e-9) return `<span class="pas-delta-neutral">0${unit}</span>`;
    const sign = d > 0 ? '+' : '';
    const better = higherIsBetter ? d > 0 : d < 0;
    const cls = better ? 'pas-delta-good' : 'pas-delta-bad';
    const num = decimals <= 0 ? String(Math.round(d)) : d.toFixed(decimals);
    return `<span class="${cls}">${sign}${num}${unit}</span>`;
}

/**
 * @param {HTMLElement} el
 * @param {object} data
 */
export function renderPolygonAreaSummary(el, data = {}) {
    if (!el) return;
    const {
        visible = false,
        totalPopulation = 0,
        avgDensity = null,
        areaKm2 = 0,
        cellsInside = 0,
        counts = {},
        statsLeft = {},
        statsRight = {},
        mnoLeft = 'Viettel',
        mnoRight = 'Vinaphone',
        ratFilter = 'all',
        omittedByTech = 0,
        ourAssetsCount = 0,
        onRatFilterChange = null
    } = data;

    if (!visible) {
        el.innerHTML = '';
        el.style.display = 'none';
        return;
    }

    el.style.display = 'block';

    const chipParts = MNOS.map((m) => `${MNO_SHORT[m] || m.slice(0, 2)} <strong>${fmtNum(counts[m] ?? 0)}</strong>`);
    const our = Number(ourAssetsCount) || 0;
    // sitesAll for MNO stats excludes Own Assets portfolio rows; Σ = those MNO sites + Our towers in polygon
    const mnoTotal = counts.total ?? 0;
    const tot = mnoTotal + our;

    const areaStr = areaKm2 > 0 ? `${areaKm2 < 100 ? areaKm2.toFixed(2) : Math.round(areaKm2)} km²` : '—';
    const densStr = avgDensity != null ? `${fmtNum(avgDensity)}/km²` : '—';

    const SL = statsLeft;
    const SR = statsRight;

    const rsrpL = SL.avgRsrp != null ? `${SL.avgRsrp} dBm` : '—';
    const rsrpR = SR.avgRsrp != null ? `${SR.avgRsrp} dBm` : '—';
    const rsrqL = SL.avgRsrq != null ? `${SL.avgRsrq} dB` : '—';
    const rsrqR = SR.avgRsrq != null ? `${SR.avgRsrq} dB` : '—';
    const sinrL = SL.avgSinr != null ? `${SL.avgSinr} dB` : '—';
    const sinrR = SR.avgSinr != null ? `${SR.avgSinr} dB` : '—';
    const dlL = fmtMbps(SL.avgDownloadMbps);
    const dlR = fmtMbps(SR.avgDownloadMbps);
    const ulL = fmtMbps(SL.avgUploadMbps);
    const ulR = fmtMbps(SR.avgUploadMbps);
    const congL = fmtCongestion(SL.avgCongestion);
    const congR = fmtCongestion(SR.avgCongestion);
    const msL = SL.marketShare != null ? `${SL.marketShare}%` : '—';
    const msR = SR.marketShare != null ? `${SR.marketShare}%` : '—';

    const dRsrp = fmtDelta(SL.avgRsrp, SR.avgRsrp, ' dBm', true, 1);
    const dRsrq = fmtDelta(SL.avgRsrq, SR.avgRsrq, ' dB', true, 1);
    const dSinr = fmtDelta(SL.avgSinr, SR.avgSinr, ' dB', true, 1);
    const dDl = fmtDelta(SL.avgDownloadMbps, SR.avgDownloadMbps, ' Mbps', true, 1);
    const dUl = fmtDelta(SL.avgUploadMbps, SR.avgUploadMbps, ' Mbps', true, 1);
    const dCong = fmtDelta(
        SL.avgCongestion != null ? (SL.avgCongestion <= 1 ? SL.avgCongestion * 100 : SL.avgCongestion) : null,
        SR.avgCongestion != null ? (SR.avgCongestion <= 1 ? SR.avgCongestion * 100 : SR.avgCongestion) : null,
        ' pts',
        false
    );
    const dMs = fmtDelta(SL.marketShare, SR.marketShare, ' pts', true, 0);

    const ratOpts = RAT_OPTIONS.map(
        (o) => `<option value="${esc(o.value)}" ${o.value === ratFilter ? 'selected' : ''}>${esc(o.label)}</option>`
    ).join('');

    const omitLine =
        ratFilter !== 'all' && omittedByTech > 0
            ? `<div class="pas-omit">${fmtNum(omittedByTech)} site(s) in area omitted (no RAT / non-matching tech).</div>`
            : '';

    el.innerHTML = `
        <div class="pas-inner pas-inner-compact">
            <div class="pas-row pas-row-top">
                <div class="pas-title">Area summary</div>
                <div class="pas-controls">
                    <label class="pas-tech-label">Radio
                        <select id="pas-rat-filter" class="pas-select" title="Filter uploaded Network Intel / MNO rows by RAT column">
                            ${ratOpts}
                        </select>
                    </label>
                    <label class="pas-kpi-toggle">
                        <input type="checkbox" id="pas-show-kpi" />
                        KPI compare
                    </label>
                </div>
            </div>

            <div class="pas-row pas-row-chips" title="Population from grid; sites from layers inside polygon (respects tech filter)">
                <span class="pas-chip">Pop <strong>${fmtNum(totalPopulation)}</strong></span>
                <span class="pas-chip">Density <strong>${esc(densStr)}</strong></span>
                <span class="pas-chip">Area <strong>${esc(areaStr)}</strong></span>
                <span class="pas-chip">Cells <strong>${fmtNum(cellsInside)}</strong></span>
                <span class="pas-chip pas-chip-sites" title="MNO uploads by operator, then Our portfolio towers; Σ = MNO sites in polygon + Our (RAT filter on MNO rows)">${chipParts.join(' · ')} · Our <strong>${fmtNum(our)}</strong> · Σ <strong>${fmtNum(tot)}</strong></span>
            </div>
            ${omitLine}

            <div class="pas-kpi-block" id="pas-kpi-block">
                <div class="pas-kpi-head">Network KPIs — <span class="pas-mno-pill pas-mno-l">${esc(mnoLeft)}</span> vs <span class="pas-mno-pill pas-mno-r">${esc(mnoRight)}</span> <span class="pas-kpi-sub">(uploaded fields: RSRP, RSRQ, SINR, speeds, congestion)</span></div>
                <div class="pas-kpi-table-wrap">
                    <table class="pas-table pas-table-kpi">
                        <thead>
                            <tr>
                                <th>Metric</th>
                                <th>${esc(mnoLeft)}</th>
                                <th>${esc(mnoRight)}</th>
                                <th>Δ</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr><td>RSRP Ø</td><td>${esc(rsrpL)}</td><td>${esc(rsrpR)}</td><td>${dRsrp}</td></tr>
                            <tr><td>RSRQ Ø</td><td>${esc(rsrqL)}</td><td>${esc(rsrqR)}</td><td>${dRsrq}</td></tr>
                            <tr><td>SINR Ø</td><td>${esc(sinrL)}</td><td>${esc(sinrR)}</td><td>${dSinr}</td></tr>
                            <tr><td>Download Ø</td><td>${esc(dlL)}</td><td>${esc(dlR)}</td><td>${dDl}</td></tr>
                            <tr><td>Upload Ø</td><td>${esc(ulL)}</td><td>${esc(ulR)}</td><td>${dUl}</td></tr>
                            <tr><td>Congestion Ø</td><td>${esc(congL)}</td><td>${esc(congR)}</td><td>${dCong}</td></tr>
                            <tr><td>Market share</td><td>${esc(msL)}</td><td>${esc(msR)}</td><td>${dMs}</td></tr>
                        </tbody>
                    </table>
                </div>
                <div class="pas-hint pas-hint-kpi">
                    Map CSV columns to <code>rat</code> / <code>technology</code> / <code>network_type</code> when uploading. KPI averages use rows inside the polygon; empty cells mean no data for that field.
                </div>
            </div>
        </div>
    `;

    const cb = el.querySelector('#pas-show-kpi');
    const kpiBlock = el.querySelector('#pas-kpi-block');
    if (cb && kpiBlock) {
        const saved = localStorage.getItem(KPI_STORAGE_KEY);
        cb.checked = saved === null ? true : saved === 'true';
        kpiBlock.style.display = cb.checked ? 'block' : 'none';
        cb.addEventListener('change', () => {
            localStorage.setItem(KPI_STORAGE_KEY, String(cb.checked));
            kpiBlock.style.display = cb.checked ? 'block' : 'none';
        });
    }

    const sel = el.querySelector('#pas-rat-filter');
    if (sel && typeof onRatFilterChange === 'function') {
        sel.addEventListener('change', () => onRatFilterChange(sel.value));
    }
}

export function clearPolygonAreaSummary(el) {
    if (!el) return;
    el.innerHTML = '';
    el.style.display = 'none';
}
