import { normalizeMNO } from './colocation-engine.js';
import { MNOS, MNO_RGB } from '../config/app-config.js';

/**
 * TowerIntel Vietnam — Network Analysis Engine
 * Aggregates MNO site data into geohash cells and computes
 * RSRP, RSRQ, congestion, supply, demand, and market share per cell.
 * Supports quarterly snapshots for timeline comparison.
 */

import { encode, bucketByGeohash, toPolygon, decode } from './geohash.js';

// ── Quarter helpers ──────────────────────────────────────────────────
function getQuarterLabel(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return 'Unknown';
    const q = Math.ceil((d.getMonth() + 1) / 3);
    return `Q${q} ${d.getFullYear()}`;
}

export function getAvailableQuarters(mnoSites) {
    const quarters = new Set();
    for (const s of mnoSites) {
        const ts = s.imported_at || s.created_at || s.timestamp;
        quarters.add(ts ? getQuarterLabel(ts) : 'Current');
    }
    if (quarters.size === 0) quarters.add('Current');
    return [...quarters].sort();
}

function filterByQuarter(sites, quarter) {
    if (!quarter || quarter === 'All' || quarter === 'Current') return sites;
    return sites.filter(s => {
        const ts = s.imported_at || s.created_at || s.timestamp;
        return getQuarterLabel(ts || new Date()) === quarter;
    });
}

// ── Core grid builder ────────────────────────────────────────────────
/**
 * Build a geohash grid with per-cell, per-MNO metrics.
 *
 * @param {Array} mnoSites      All MNO sites with lat/lng/mno/rsrp/rsrq/congestion
 * @param {Array} ownTowers     Own tower locations for demand context
 * @param {Object} options
 * @param {number} options.precision   Geohash precision (5–7, default 6)
 * @param {string} options.filterMNO   Only include this MNO (or 'All')
 * @param {string} options.quarter     Quarter filter (e.g. 'Q1 2026')
 * @returns {Array}  Array of cell objects ready for deck.gl PolygonLayer
 */
export function buildGeohashGrid(mnoSites, ownTowers = [], options = {}) {
    const {
        precision = 6,
        filterMNO = 'All',
        quarter = 'All'
    } = options;

    // Filter by quarter
    let sites = filterByQuarter(mnoSites, quarter);

    // Filter by MNO if specified
    if (filterMNO && filterMNO !== 'All') {
        sites = sites.filter((s) => normalizeMNO(s.mno) === normalizeMNO(filterMNO));
    }

    if (sites.length === 0) return [];

    // Bucket sites by geohash (optimization: limit sites processed to viewport area if needed, 
    // but for 1000 points, simple bucket is fine)
    const buckets = bucketByGeohash(sites, precision);

    // Bucket own towers to measure own supply
    const ownBuckets = bucketByGeohash(ownTowers, precision);

    // Build cell objects
    const cells = [];
    for (const [hash, cellSites] of buckets) {
        const center = decode(hash);
        const polygon = toPolygon(hash);

        // Per-MNO breakdown
        const mnoBreakdown = {};
        let totalRSRP = 0, totalRSRQ = 0, totalCongestion = 0;
        let rsrpCount = 0, rsrqCount = 0, congestionCount = 0;

        for (const s of cellSites) {
            const mno = normalizeMNO(s.mno) || 'Unknown';
            if (!mnoBreakdown[mno]) {
                mnoBreakdown[mno] = { count: 0, rsrpSum: 0, rsrpN: 0, rsrqSum: 0, rsrqN: 0, congestionSum: 0, congestionN: 0 };
            }
            const mb = mnoBreakdown[mno];
            mb.count++;

            if (s.rsrp != null && !isNaN(s.rsrp)) {
                mb.rsrpSum += s.rsrp; mb.rsrpN++;
                totalRSRP += s.rsrp; rsrpCount++;
            }
            if (s.rsrq != null && !isNaN(s.rsrq)) {
                mb.rsrqSum += s.rsrq; mb.rsrqN++;
                totalRSRQ += s.rsrq; rsrqCount++;
            }

            const cong = parseCongestion(s.congestion);
            if (cong != null) {
                mb.congestionSum += cong; mb.congestionN++;
                totalCongestion += cong; congestionCount++;
            }
        }

        // Aggregated metrics
        // When no RSRP data exists (e.g. uploaded site lists), estimate from density:
        // More sites in a cell implies better coverage infrastructure
        const estimateRSRP = () => {
            const densityBoost = Math.min(supply / 10, 1) * 30; // 0-30 dBm bonus
            return Math.round(-110 + densityBoost); // Range: -110 (1 site) to -80 (10+ sites)
        };
        const avgRSRP = rsrpCount > 0 ? totalRSRP / rsrpCount : estimateRSRP();
        const avgRSRQ = rsrqCount > 0 ? totalRSRQ / rsrqCount : -12;
        const avgCongestion = congestionCount > 0 ? totalCongestion / congestionCount : 0;

        // Supply = total MNO sites in cell
        const supply = cellSites.length;

        // Own supply
        const ownSupply = (ownBuckets.get(hash) || []).length;

        // Demand proxy: higher congestion + more sites suggests high-traffic area
        // Scale 0–1 where 1 = maximum demand
        const demand = Math.min(1, avgCongestion * 0.6 + Math.min(supply / 10, 0.4));

        // Market share per MNO
        const marketShare = {};
        let dominantMNO = 'Unknown';
        let dominantShare = 0;
        for (const [mno, data] of Object.entries(mnoBreakdown)) {
            const share = data.count / supply;
            marketShare[mno] = Math.round(share * 100);
            if (share > dominantShare) {
                dominantShare = share;
                dominantMNO = mno;
            }
            // Compute per-MNO averages
            data.avgRSRP = data.rsrpN > 0 ? Math.round(data.rsrpSum / data.rsrpN) : null;
            data.avgRSRQ = data.rsrqN > 0 ? Math.round(data.rsrqSum / data.rsrqN) : null;
            data.avgCongestion = data.congestionN > 0 ? Math.round(data.congestionSum / data.congestionN * 100) / 100 : null;
        }

        cells.push({
            hash,
            polygon,
            center,
            siteCount: supply,
            ownSupply,
            avgRSRP: Math.round(avgRSRP),
            avgRSRQ: Math.round(avgRSRQ),
            avgCongestion: Math.round(avgCongestion * 100) / 100,
            supply,
            demand: Math.round(demand * 100) / 100,
            dominantMNO,
            dominantShare: Math.round(dominantShare * 100),
            marketShare,
            mnoBreakdown,
        });
    }

    return cells;
}

// ── Helpers ──────────────────────────────────────────────────────────
function parseCongestion(val) {
    if (val == null) return null;
    if (typeof val === 'number') return val;
    const s = String(val).toLowerCase();
    if (s === 'high') return 0.9;
    if (s === 'medium') return 0.5;
    if (s === 'low') return 0.2;
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
}

// ── Color scales ─────────────────────────────────────────────────────
const MNO_COLORS = { ...MNO_RGB, Unknown: [158, 158, 158] };

export function getMNOColor(mno) {
    return MNO_COLORS[normalizeMNO(mno)] || MNO_COLORS.Unknown;
}

/**
 * Get fill color for a cell based on selected metric.
 * @param {Object} cell  Cell object from buildGeohashGrid
 * @param {string} metric  One of: rsrp, rsrq, congestion, supply, demand, marketShare
 * @returns {[number, number, number, number]}  RGBA
 */
export function getCellColor(cell, metric = 'rsrp') {
    switch (metric) {
        case 'rsrp': return rsrpColor(cell.avgRSRP);
        case 'rsrq': return rsrqColor(cell.avgRSRQ);
        case 'congestion': return congestionColor(cell.avgCongestion);
        case 'supply': return supplyColor(cell.supply);
        case 'demand': return demandColor(cell.demand);
        case 'marketShare': return marketShareColor(cell);
        case 'population': return populationColor(cell.populationDensity || 0);
        default: return [128, 128, 128, 100];
    }
}

function rsrpColor(v) {
    // -60 (excellent) → -130 (dead)
    if (v >= -75) return [0, 230, 118, 170];     // Bright green
    if (v >= -85) return [102, 187, 106, 160];    // Green
    if (v >= -95) return [255, 235, 59, 150];     // Yellow
    if (v >= -105) return [255, 152, 0, 150];      // Orange
    if (v >= -115) return [244, 67, 54, 160];      // Red
    return [183, 28, 28, 170];                     // Dark red
}

function rsrqColor(v) {
    if (v >= -5) return [33, 150, 243, 170];     // Bright blue
    if (v >= -8) return [100, 181, 246, 160];    // Light blue
    if (v >= -11) return [255, 235, 59, 150];     // Yellow
    if (v >= -15) return [255, 152, 0, 150];      // Orange
    return [244, 67, 54, 160];                     // Red
}

function congestionColor(v) {
    if (v <= 0.2) return [0, 230, 118, 140];      // Low — green
    if (v <= 0.4) return [178, 255, 89, 140];     // Low-mid
    if (v <= 0.6) return [255, 235, 59, 150];     // Mid — yellow
    if (v <= 0.8) return [255, 152, 0, 160];      // High — orange
    return [244, 67, 54, 170];                     // Very high  — red
}

function supplyColor(count) {
    const t = Math.min(count / 15, 1);             // 15+ sites = max
    return [
        Math.round(33 + t * 200),
        Math.round(150 - t * 80),
        Math.round(243 - t * 180),
        Math.round(80 + t * 100)
    ];
}

function demandColor(v) {
    // 0 = cool blue, 1 = hot red
    if (v <= 0.25) return [66, 165, 245, 120];
    if (v <= 0.50) return [255, 235, 59, 140];
    if (v <= 0.75) return [255, 152, 0, 160];
    return [244, 67, 54, 180];
}

function marketShareColor(cell) {
    const base = MNO_COLORS[cell.dominantMNO] || MNO_COLORS.Unknown;
    const alpha = Math.round(80 + (cell.dominantShare / 100) * 120); // 80–200
    return [...base, alpha];
}

function populationColor(density) {
    // Philippine density context:
    // Rural: ≤500/km², Suburban: 500-2000, Urban: 2000-10000, Metro: >10000
    if (density <= 0) return [30, 30, 50, 40];          // Empty — near transparent
    if (density <= 100) return [33, 150, 243, 80];        // Very sparse — faint blue
    if (density <= 500) return [66, 165, 245, 120];       // Rural — light blue
    if (density <= 2000) return [0, 230, 118, 150];        // Suburban — green
    if (density <= 5000) return [255, 235, 59, 160];       // Urban — yellow
    if (density <= 10000) return [255, 152, 0, 170];       // Dense urban — orange
    return [244, 67, 54, 190];                             // Metro core — red
}

/**
 * Get the legend entries for a given metric.
 * @param {string} metric
 * @returns {Array<{ label: string, color: string }>}
 */
export function getLegendEntries(metric) {
    switch (metric) {
        case 'rsrp': return [
            { label: '≥ -75 dBm (Excellent)', color: 'rgba(0,230,118,0.8)' },
            { label: '-75 to -85 (Good)', color: 'rgba(102,187,106,0.75)' },
            { label: '-85 to -95 (Fair)', color: 'rgba(255,235,59,0.7)' },
            { label: '-95 to -105 (Poor)', color: 'rgba(255,152,0,0.7)' },
            { label: '-105 to -115 (Very Poor)', color: 'rgba(244,67,54,0.75)' },
            { label: '< -115 (Dead Zone)', color: 'rgba(183,28,28,0.8)' },
        ];
        case 'rsrq': return [
            { label: '≥ -5 dB (Excellent)', color: 'rgba(33,150,243,0.8)' },
            { label: '-5 to -8 (Good)', color: 'rgba(100,181,246,0.75)' },
            { label: '-8 to -11 (Fair)', color: 'rgba(255,235,59,0.7)' },
            { label: '-11 to -15 (Poor)', color: 'rgba(255,152,0,0.7)' },
            { label: '< -15 (Very Poor)', color: 'rgba(244,67,54,0.75)' },
        ];
        case 'congestion': return [
            { label: '≤ 20% (Low)', color: 'rgba(0,230,118,0.7)' },
            { label: '20–40%', color: 'rgba(178,255,89,0.7)' },
            { label: '40–60% (Medium)', color: 'rgba(255,235,59,0.7)' },
            { label: '60–80%', color: 'rgba(255,152,0,0.75)' },
            { label: '> 80% (High)', color: 'rgba(244,67,54,0.8)' },
        ];
        case 'supply': return [
            { label: '1–3 sites', color: 'rgba(33,150,243,0.5)' },
            { label: '4–7 sites', color: 'rgba(103,130,200,0.6)' },
            { label: '8–12 sites', color: 'rgba(173,100,143,0.7)' },
            { label: '13+ sites', color: 'rgba(233,70,63,0.8)' },
        ];
        case 'demand': return [
            { label: 'Low', color: 'rgba(66,165,245,0.6)' },
            { label: 'Medium', color: 'rgba(255,235,59,0.7)' },
            { label: 'High', color: 'rgba(255,152,0,0.75)' },
            { label: 'Very High', color: 'rgba(244,67,54,0.8)' },
        ];
        case 'marketShare': return MNOS.map((m) => {
            const [r, g, b] = MNO_RGB[m] || [158, 158, 158];
            return { label: `${m} dominant`, color: `rgba(${r},${g},${b},0.7)` };
        });
        case 'population': return [
            { label: '≤ 100/km² (Sparse)', color: 'rgba(33,150,243,0.5)' },
            { label: '100–500 (Rural)', color: 'rgba(66,165,245,0.6)' },
            { label: '500–2,000 (Suburban)', color: 'rgba(0,230,118,0.7)' },
            { label: '2,000–5,000 (Urban)', color: 'rgba(255,235,59,0.75)' },
            { label: '5,000–10,000 (Dense)', color: 'rgba(255,152,0,0.8)' },
            { label: '> 10,000 (Metro Core)', color: 'rgba(244,67,54,0.85)' },
        ];
        default: return [];
    }
}
