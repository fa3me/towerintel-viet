import { MNOS, MNO_HEX } from '../config/app-config.js';

/**
 * TowerIntel Vietnam — Network Intelligence Panel
 * Floating panel for selecting metric, MNO, geohash precision,
 * and launching the comparison slider.
 */

import { getLegendEntries } from '../engine/network-analysis.js';

/**
 * Render the network intel panel.
 *
 * @param {HTMLElement} container   #network-intel-panel element
 * @param {Object} opts
 * @param {string} opts.metric         Current metric name
 * @param {number} opts.precision      Current geohash precision
 * @param {Object} opts.summary        { totalCells, avgRSRP, avgRSRQ, avgCongestion, worstAreas[] }
 * @param {boolean} opts.comparing     Whether comparison mode is active
 * @param {Function} opts.onMetricChange   (metric: string) => void
 * @param {Function} opts.onPrecisionChange (precision: number) => void
 * @param {Function} opts.onMNOFilterChange (mnos: string[]) => void
 * @param {Function} opts.onCompareToggle   (active: boolean) => void
 * @param {Function} opts.onClose           () => void
 */
export function renderNetworkIntelPanel(container, opts = {}) {
    const {
        metric = 'rsrp',
        precision = 6,
        summary = {},
        comparing = false,
        onMetricChange = () => { },
        onPrecisionChange = () => { },
        onMNOFilterChange = () => { },
        onCompareToggle = () => { },
        onClose = () => { },
        onClearSelection = () => { },
        selectedCell = null
    } = opts;

    const legendItems = getLegendEntries(metric);

    container.innerHTML = `
        <div class="ni-header">
            <div class="ni-title">
                <span class="ni-icon">📶</span>
                <span>Network Intelligence</span>
            </div>
            <button class="ni-close" title="Close panel">&times;</button>
        </div>

        <div class="ni-body">
            <!-- Metric Selector -->
            <div class="ni-section">
                <label class="ni-label">Analysis Mode</label>
                <select class="ni-select ni-metric-select">
                    <option value="rsrp"    ${metric === 'rsrp' ? 'selected' : ''}>📡 Coverage (RSRP)</option>
                    <option value="rsrq"    ${metric === 'rsrq' ? 'selected' : ''}>📊 Quality (RSRQ)</option>
                    <option value="congestion" ${metric === 'congestion' ? 'selected' : ''}>🔥 Congestion</option>
                    <option value="supply"  ${metric === 'supply' ? 'selected' : ''}>🏗️ Supply (Sites)</option>
                    <option value="demand"  ${metric === 'demand' ? 'selected' : ''}>📈 Demand</option>
                    <option value="marketShare" ${metric === 'marketShare' ? 'selected' : ''}>🏆 Market Share</option>
                    <option value="population" ${metric === 'population' ? 'selected' : ''}>👥 Population Density</option>
                </select>
            </div>

            <!-- Precision Slider -->
            <div class="ni-section">
                <label class="ni-label">Grid Resolution: <span class="ni-precision-val" style="color:#ce93d8;">${precisionLabel(precision)}</span></label>
                <input type="range" class="ni-precision-slider" min="5" max="8" value="${precision}" step="1" style="width:100%; accent-color:#9c27b0;">
                <div class="ni-precision-labels" style="display:flex; justify-content:space-between; font-size:9px; color:#64748b; margin-top:4px;">
                    <span>City</span>
                    <span>Neighborhood</span>
                    <span>Street</span>
                    <span>Building</span>
                </div>
            </div>

            <!-- MNO Filter -->
            <div class="ni-section">
                <label class="ni-label">MNO Filter</label>
                <div class="ni-mno-filters">
                    ${MNOS.map((m) => `<label class="ni-chip" style="border-color:${MNO_HEX[m] || '#94a3b8'}"><input type="checkbox" value="${m}" checked> ${m}</label>`).join('')}
                </div>
            </div>

            <!-- Compare Button -->
            <div class="ni-section">
                <button class="ni-compare-btn ${comparing ? 'active' : ''}">
                    ${comparing ? '✕ Exit Comparison' : '⇔ Compare MNO / Timeline'}
                </button>
            </div>

            <!-- Legend -->
            <div class="ni-section ni-legend">
                <label class="ni-label">Legend</label>
                ${legendItems.map(e => `
                    <div class="ni-legend-item">
                        <span class="ni-legend-swatch" style="background:${e.color};"></span>
                        <span>${e.label}</span>
                    </div>
                `).join('')}
            </div>

            <!-- Summary Stats -->
            <!-- Summary Stats -->
            ${selectedCell ? `
            <div class="ni-section ni-summary selected-cell">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <label class="ni-label" style="margin:0; color:#ffd600;">Cell Detail: ${selectedCell.hash}</label>
                    <button class="ni-clear-sel" style="background:none; border:none; color:#00e5ff; font-size:10px; cursor:pointer; padding:0;">✕ Clear</button>
                </div>
                <div class="ni-stats-grid">
                    <div class="ni-stat">
                        <span class="ni-stat-val" style="color:#00e5ff;">${selectedCell.avgRSRP}</span>
                        <span class="ni-stat-lbl">dBm (Avg)</span>
                    </div>
                    <div class="ni-stat">
                        <span class="ni-stat-val" style="color:#00c853;">${Math.round(selectedCell.avgCongestion * 100)}%</span>
                        <span class="ni-stat-lbl">Congestion</span>
                    </div>
                    <div class="ni-stat">
                        <span class="ni-stat-val" style="color:#ce93d8;">${selectedCell.avgRSRQ}</span>
                        <span class="ni-stat-lbl">RSRQ</span>
                    </div>
                    <div class="ni-stat">
                        <span class="ni-stat-val">${selectedCell.supply}</span>
                        <span class="ni-stat-lbl">Sites</span>
                    </div>
                </div>
                
                <div class="ni-mno-table-container" style="margin-top:12px; font-size:10px;">
                    <table style="width:100%; border-collapse:collapse;">
                        <thead>
                            <tr style="color:#64748b; border-bottom:1px solid rgba(255,255,255,0.05); text-align:left;">
                                <th style="padding:4px 0;">MNO</th>
                                <th>RSRP</th>
                                <th>Share</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${Object.entries(selectedCell.mnoBreakdown || {}).map(([mno, data]) => `
                                <tr>
                                    <td style="padding:6px 0; font-weight:600; color:${getMNOHex(mno)}">${mno}</td>
                                    <td>${data.avgRSRP || '—'} dBm</td>
                                    <td>${selectedCell.marketShare[mno] || 0}%</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
            ` : (summary.totalCells ? `
            <div class="ni-section ni-summary">
                <label class="ni-label">Analysis Summary</label>
                <div class="ni-stats-grid">
                    <div class="ni-stat">
                        <span class="ni-stat-val">${summary.totalCells.toLocaleString()}</span>
                        <span class="ni-stat-lbl">Grid Cells</span>
                    </div>
                    ${metric === 'population' ? `
                    <div class="ni-stat">
                        <span class="ni-stat-val">${summary.avgPopDensity ? summary.avgPopDensity.toLocaleString() : '—'}</span>
                        <span class="ni-stat-lbl">Avg Density/km²</span>
                    </div>
                    <div class="ni-stat">
                        <span class="ni-stat-val" style="color:#ef5350;">${summary.maxPopDensity ? summary.maxPopDensity.toLocaleString() : '—'}</span>
                        <span class="ni-stat-lbl">Max Density/km²</span>
                    </div>
                    <div class="ni-stat">
                        <span class="ni-stat-val" style="color:#ff9800;">${summary.underservedCount || 0}</span>
                        <span class="ni-stat-lbl">Underserved</span>
                    </div>
                    ` : `
                    <div class="ni-stat">
                        <span class="ni-stat-val">${summary.avgRSRP || '—'}</span>
                        <span class="ni-stat-lbl">Avg RSRP</span>
                    </div>
                    <div class="ni-stat">
                        <span class="ni-stat-val">${summary.avgCongestion || '—'}</span>
                        <span class="ni-stat-lbl">Avg Cong.</span>
                    </div>
                    <div class="ni-stat">
                        <span class="ni-stat-val">${summary.totalSites || '—'}</span>
                        <span class="ni-stat-lbl">Total Sites</span>
                    </div>
                    `}
                </div>
                ${metric === 'population' && summary.underservedCount > 0 ? `
                    <div class="ni-worst">
                        <div class="ni-worst-title">⚠ ${summary.underservedCount} underserved areas (≥500 ppl/km², 0 sites)</div>
                    </div>
                ` : (summary.worstAreas && summary.worstAreas.length > 0 ? `
                    <div class="ni-worst">
                        <div class="ni-worst-title">⚠ Coverage Gaps</div>
                        ${summary.worstAreas.slice(0, 3).map(a => `
                            <div class="ni-worst-item">
                                <span>${a.hash}</span>
                                <span style="color:#ef5350;">${a.avgRSRP} dBm</span>
                            </div>
                        `).join('')}
                    </div>
                ` : '')}
            </div>
            ` : `
            <div class="ni-section ni-empty">
                <p>Upload MNO site data or sync OpenCelliD to see network analysis.</p>
            </div>
            `)}
        </div>
    `;

    // ── Event bindings ───────────────────────────────────────────────
    container.querySelector('.ni-close').addEventListener('click', onClose);

    container.querySelector('.ni-metric-select').addEventListener('change', (e) => {
        onMetricChange(e.target.value);
    });

    container.querySelector('.ni-precision-slider').addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        const label = container.querySelector('.ni-precision-val');
        if (label) label.textContent = precisionLabel(val);
        onPrecisionChange(val);
    });

    const mnoCheckboxes = container.querySelectorAll('.ni-mno-filters input');
    mnoCheckboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            const selected = [...mnoCheckboxes].filter(c => c.checked).map(c => c.value);
            onMNOFilterChange(selected);
        });
    });

    container.querySelector('.ni-compare-btn').addEventListener('click', () => {
        onCompareToggle(!comparing);
    });

    const clearBtn = container.querySelector('.ni-clear-sel');
    if (clearBtn) {
        clearBtn.addEventListener('click', onClearSelection);
    }
}

function getMNOHex(mno) {
    return MNO_HEX[mno] || '#94a3b8';
}

function precisionLabel(p) {
    if (p <= 5) return 'City (~4.9 km)';
    if (p <= 6) return 'Neighborhood (~1.2 km)';
    if (p <= 7) return 'Street (~153 m)';
    return 'Building (~38 m)';
}

/**
 * Compute summary statistics from a geohash grid.
 * @param {Array} cells  Output of buildGeohashGrid
 * @returns {Object}
 */
export function computeSummary(cells) {
    if (!cells || cells.length === 0) return {};

    let totalRSRP = 0, totalCong = 0, totalSites = 0;
    let totalPopDensity = 0, maxPopDensity = 0, popCellCount = 0, underservedCount = 0, totalPop = 0;
    for (const c of cells) {
        totalRSRP += c.avgRSRP;
        totalCong += c.avgCongestion;
        totalSites += c.siteCount;
        if (c.populationDensity > 0) {
            totalPopDensity += c.populationDensity;
            totalPop += (c.populationCount || 0);
            popCellCount++;
            if (c.populationDensity > maxPopDensity) maxPopDensity = c.populationDensity;
            if (c.siteCount === 0 && c.populationDensity >= 500) underservedCount++;
        }
    }

    const sorted = [...cells].sort((a, b) => a.avgRSRP - b.avgRSRP);

    return {
        totalCells: cells.length,
        avgRSRP: Math.round(totalRSRP / cells.length),
        avgCongestion: `${Math.round((totalCong / cells.length) * 100)}%`,
        totalSites,
        worstAreas: sorted.slice(0, 5),
        // Population stats
        avgPopDensity: popCellCount > 0 ? Math.round(totalPopDensity / popCellCount) : 0,
        maxPopDensity,
        underservedCount,
        totalPopulation: totalPop
    };
}
