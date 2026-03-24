/**
 * TowerIntel PH — Geohash Grid Layer
 * Renders geohash cells as deck.gl PolygonLayer with color coding per metric.
 * Supports clipping for split-view comparison.
 */

import { PolygonLayer } from '@deck.gl/layers';
import { getCellColor } from '../engine/network-analysis.js';
import { MNO_HEX } from '../config/app-config.js';

/**
 * Create a deck.gl PolygonLayer for geohash grid cells.
 *
 * @param {Array} cells          Output of buildGeohashGrid()
 * @param {Object} options
 * @param {string} options.metric      'rsrp'|'rsrq'|'congestion'|'supply'|'demand'|'marketShare'
 * @param {string} options.layerId     Unique layer ID
 * @param {string} options.clipSide    null | 'left' | 'right' (for comparison mode)
 * @param {number} options.clipX       Normalised clip position 0–1 (for comparison mode)
 * @returns {PolygonLayer}
 */
export function createGeohashLayer(cells, options = {}) {
    const {
        metric = 'rsrp',
        layerId = 'geohash-grid',
        highlightId = null
    } = options;

    if (!cells || cells.length === 0) return null;

    return new PolygonLayer({
        id: layerId,
        data: cells,
        getPolygon: d => d.polygon,
        getFillColor: d => {
            const base = getCellColor(d, metric);
            if (highlightId && d.hash === highlightId) {
                return [255, 214, 0, 180]; // Gold selection
            }
            return base;
        },
        getLineColor: d => (highlightId && d.hash === highlightId) ? [255, 214, 0, 255] : [255, 255, 255, 40],
        getLineWidth: d => (highlightId && d.hash === highlightId) ? 3 : 1,
        lineWidthMinPixels: (highlightId) ? 1 : 0.5,
        filled: true,
        stroked: true,
        pickable: true,
        extruded: false,
        opacity: 0.55,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 80],
        parameters: { depthWrite: false }
    });
}

/**
 * Build a tooltip HTML string for a hovered geohash cell.
 * @param {Object} cell  Cell data from buildGeohashGrid
 * @returns {string}
 */
export function buildGeohashTooltip(cell) {
    if (!cell) return '';

    const marketShare = cell.marketShare || {};
    const mnoRows = Object.entries(cell.mnoBreakdown || {}).map(([mno, data]) => {
        const share = marketShare[mno] || 0;
        const rsrp = data.avgRSRP != null ? `${data.avgRSRP} dBm` : '—';
        const rsrq = data.avgRSRQ != null ? `${data.avgRSRQ} dB` : '—';
        const cong = data.avgCongestion != null ? `${Math.round(data.avgCongestion * 100)}%` : '—';
        return `
            <tr>
                <td style="font-weight:600;color:${getMNOHex(mno)}">${mno}</td>
                <td>${data.count}</td>
                <td>${share}%</td>
                <td>${rsrp}</td>
                <td>${rsrq}</td>
                <td>${cong}</td>
            </tr>`;
    }).join('');

    return `
        <div style="font-family:Inter,sans-serif;font-size:11px;min-width:320px;background:rgba(15,23,42,0.96);color:#e2e8f0;padding:12px 16px;border-radius:10px;border:1px solid rgba(0,229,255,0.25);backdrop-filter:blur(12px);box-shadow:0 8px 32px rgba(0,0,0,0.5);">
            <div style="font-size:13px;font-weight:700;color:#00e5ff;margin-bottom:8px;">📶 Geohash: ${cell.hash}</div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:10px;">
                <div><span style="color:#94a3b8;font-size:9px;">AVG RSRP</span><br><b style="color:${cell.avgRSRP >= -95 ? '#66bb6a' : '#ef5350'}">${cell.avgRSRP} dBm</b></div>
                <div><span style="color:#94a3b8;font-size:9px;">AVG RSRQ</span><br><b style="color:${cell.avgRSRQ >= -10 ? '#42a5f5' : '#ef5350'}">${cell.avgRSRQ} dB</b></div>
                <div><span style="color:#94a3b8;font-size:9px;">CONGESTION</span><br><b style="color:${cell.avgCongestion <= 0.5 ? '#66bb6a' : '#ef5350'}">${Math.round(cell.avgCongestion * 100)}%</b></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:10px;">
                <div><span style="color:#94a3b8;font-size:9px;">SUPPLY</span><br><b>${cell.supply} sites</b></div>
                <div><span style="color:#94a3b8;font-size:9px;">DEMAND</span><br><b style="color:${cell.demand >= 0.6 ? '#ff9800' : '#66bb6a'}">${Math.round(cell.demand * 100)}%</b></div>
                <div><span style="color:#94a3b8;font-size:9px;">DOMINANT</span><br><b style="color:${getMNOHex(cell.dominantMNO)}">${cell.dominantMNO} (${cell.dominantShare}%)</b></div>
            </div>
            ${cell.populationDensity > 0 ? `
            <div style="margin-bottom:10px;padding:6px;background:rgba(255,255,255,0.05);border-radius:6px;">
                <span style="color:#94a3b8;font-size:9px;">👥 POPULATION</span><br>
                <b style="color:${cell.populationDensity >= 5000 ? '#ff9800' : cell.populationDensity >= 2000 ? '#ffeb3b' : '#66bb6a'}">${cell.populationDensity.toLocaleString()} ppl/km²</b>
                ${cell.siteCount === 0 ? '<span style="color:#ef5350;margin-left:8px;font-size:9px;">⚠ UNDERSERVED</span>' : ''}
            </div>
            ` : ''}
            <table style="width:100%;border-collapse:collapse;font-size:10px;">
                <thead>
                    <tr style="color:#94a3b8;border-bottom:1px solid rgba(255,255,255,0.1);">
                        <th style="text-align:left;padding:3px;">MNO</th>
                        <th>Sites</th>
                        <th>Share</th>
                        <th>RSRP</th>
                        <th>RSRQ</th>
                        <th>Cong.</th>
                    </tr>
                </thead>
                <tbody>${mnoRows}</tbody>
            </table>
        </div>
    `;
}

function getMNOHex(mno) {
    return MNO_HEX[mno] || '#9e9e9e';
}
