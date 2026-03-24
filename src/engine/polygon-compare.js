/**
 * Point-in-polygon and helpers for MNO compare-by-area.
 */

import { normalizeMNO } from './colocation-engine.js';
import { haversineDistance } from '../data/vn-geo.js';
import { MNOS } from '../config/app-config.js';

/** Column names that may carry RAT / technology (uploads + network intel). */
const RAT_FIELD_KEYS = [
    'rat', 'radio', 'technology', 'tech', 'network_type', 'network', 'generation',
    'cell_type', 'Radio', 'RAT', 'NETWORK', 'Network', 'cellTechnology'
];

/**
 * Raw technology string from a site row (CSV/network intel upload).
 * @param {object} site
 * @returns {string}
 */
export function getSiteTechnologyRaw(site) {
    if (!site || typeof site !== 'object') return '';
    for (const k of RAT_FIELD_KEYS) {
        const v = site[k];
        if (v != null && v !== '') return String(v).trim();
    }
    return '';
}

/**
 * Map free-text RAT to bucket: '2g' | '3g' | '4g' | '5g' | 'unknown'
 * @param {string} raw
 */
export function bucketRadioTechnology(raw) {
    if (!raw || typeof raw !== 'string') return 'unknown';
    const s = raw.toLowerCase().replace(/\s+/g, '');
    if (!s) return 'unknown';
    if (/(^|[^a-z])(5g|nr|nr5g|newradio|5gnr)([^a-z]|$)/i.test(s) || s.includes('5g')) return '5g';
    if (/(lte|4g|e-utran|eutran|lte-a|lteadvanced)/i.test(s)) return '4g';
    if (/(umts|3g|wcdma|hsdpa|hspa|hspa\+|td-scdma)/i.test(s)) return '3g';
    if (/(gsm|2g|edge|gprs|gprs\/edge)/i.test(s)) return '2g';
    if (s === '4g' || s === 'lte') return '4g';
    if (s === '3g') return '3g';
    if (s === '2g') return '2g';
    if (s === '5g') return '5g';
    return 'unknown';
}

/**
 * @param {object} site
 * @param {string} ratFilter  'all' | '2g' | '3g' | '4g' | '5g'
 */
export function siteMatchesRatFilter(site, ratFilter) {
    if (!ratFilter || ratFilter === 'all') return true;
    const b = bucketRadioTechnology(getSiteTechnologyRaw(site));
    if (b === 'unknown') return false;
    return b === ratFilter;
}

/**
 * @param {Array<object>} sites
 * @param {string} ratFilter
 */
export function filterSitesByRadioTechnology(sites, ratFilter) {
    if (!sites?.length) return [];
    if (!ratFilter || ratFilter === 'all') return sites;
    return sites.filter((s) => siteMatchesRatFilter(s, ratFilter));
}

/** Drop consecutive clicks that are effectively the same point (double-clicks, jitter). */
export function dedupePolygonVertices(vertices, minKm = 0.004) {
    if (!vertices?.length) return [];
    const out = [[Number(vertices[0][0]), Number(vertices[0][1])]];
    for (let i = 1; i < vertices.length; i++) {
        const lng = Number(vertices[i][0]);
        const lat = Number(vertices[i][1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        const prev = out[out.length - 1];
        if (haversineDistance(prev[1], prev[0], lat, lng) < minKm) continue;
        out.push([lng, lat]);
    }
    return out;
}

/**
 * @param {number} lng
 * @param {number} lat
 * @param {Array<[number, number]>} ring  [lng, lat][] — closed or open
 */
export function pointInPolygonLngLat(lng, lat, ring) {
    if (!ring || ring.length < 3) return false;
    const r = [...ring];
    const f = r[0];
    const l = r[r.length - 1];
    if (f[0] === l[0] && f[1] === l[1]) r.pop();

    let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const xi = r[i][0];
        const yi = r[i][1];
        const xj = r[j][0];
        const yj = r[j][1];
        const intersect = ((yi > lat) !== (yj > lat)) &&
            (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

/** Close ring by repeating first vertex at end (for PolygonLayer). */
export function closeCompareRing(vertices) {
    if (!vertices || vertices.length < 3) return null;
    const v = vertices.map(p => [Number(p[0]), Number(p[1])]);
    const f = v[0];
    const l = v[v.length - 1];
    if (f[0] === l[0] && f[1] === l[1]) return v;
    return [...v, [f[0], f[1]]];
}

export function filterGeohashCellsByPolygon(cells, ring) {
    if (!ring || ring.length < 3 || !cells?.length) return cells || [];
    return cells.filter((c) => {
        if (!c.center || typeof c.center.lng !== 'number' || typeof c.center.lat !== 'number') return false;
        return pointInPolygonLngLat(c.center.lng, c.center.lat, ring);
    });
}

/** First numeric field present on site (Mbps etc.). */
function pickNumericField(s, keys) {
    for (const k of keys) {
        if (s[k] === undefined || s[k] === null || s[k] === '') continue;
        const v = typeof s[k] === 'number' ? s[k] : parseFloat(String(s[k]).replace(/,/g, ''));
        if (Number.isFinite(v)) return v;
    }
    return null;
}

/**
 * @param {Array<object>} sitesInPolygon  sites with lat, lng, mno, rsrp, rsrq, sinr, congestion, optional speeds
 * @param {string} mno  Viettel | Vinaphone | Mobifone | Vietnamobile
 * @param {{ ratFilter?: string }} [options]  ratFilter: 'all' | '2g' | '3g' | '4g' | '5g' — uses RAT columns from uploads
 */
export function aggregateMnoKpisInPolygon(sitesInPolygon, mno, options = {}) {
    const ratFilter = options.ratFilter || 'all';
    const target = normalizeMNO(mno);
    const sites = filterSitesByRadioTechnology(sitesInPolygon, ratFilter);
    const mine = sites.filter((s) => normalizeMNO(s.mno || '') === target);
    const totalAll = sites.length;

    let rsrpSum = 0, rsrpN = 0;
    let rsrqSum = 0, rsrqN = 0;
    let sinrSum = 0, sinrN = 0;
    let congSum = 0, congN = 0;
    let dlSum = 0, dlN = 0;
    let ulSum = 0, ulN = 0;

    const DL_KEYS = ['download_mbps', 'download_speed', 'dl_mbps', 'avg_download', 'download', 'dl_speed', 'speed_download'];
    const UL_KEYS = ['upload_mbps', 'upload_speed', 'ul_mbps', 'avg_upload', 'upload', 'ul_speed', 'speed_upload'];

    for (const s of mine) {
        const rsrp = Number(s.rsrp);
        if (Number.isFinite(rsrp)) {
            rsrpSum += rsrp;
            rsrpN++;
        }
        const rsrq = Number(s.rsrq);
        if (Number.isFinite(rsrq)) {
            rsrqSum += rsrq;
            rsrqN++;
        }
        const sinr = Number(s.sinr);
        if (Number.isFinite(sinr)) {
            sinrSum += sinr;
            sinrN++;
        }
        const c = typeof s.congestion === 'number' ? s.congestion : parseFloat(s.congestion);
        if (Number.isFinite(c)) {
            congSum += c;
            congN++;
        }
        const dl = pickNumericField(s, DL_KEYS);
        if (dl != null) {
            dlSum += dl;
            dlN++;
        }
        const ul = pickNumericField(s, UL_KEYS);
        if (ul != null) {
            ulSum += ul;
            ulN++;
        }
    }

    const marketShare = totalAll > 0 ? Math.round((mine.length / totalAll) * 100) : 0;

    return {
        siteCount: mine.length,
        avgRsrp: rsrpN ? Math.round(rsrpSum / rsrpN) : null,
        avgRsrq: rsrqN ? Math.round((rsrqSum / rsrqN) * 10) / 10 : null,
        avgSinr: sinrN ? Math.round((sinrSum / sinrN) * 10) / 10 : null,
        avgCongestion: congN ? Math.round((congSum / congN) * 100) / 100 : null,
        avgDownloadMbps: dlN ? Math.round((dlSum / dlN) * 10) / 10 : null,
        avgUploadMbps: ulN ? Math.round((ulSum / ulN) * 10) / 10 : null,
        marketShare,
        totalSitesInArea: totalAll,
        sites: mine.slice(0, 150).map((s) => ({
            id: s.id,
            name: s.name || s.id,
            lat: s.lat,
            lng: s.lng,
            rsrp: s.rsrp,
            rsrq: s.rsrq,
            sinr: s.sinr
        }))
    };
}

export function collectSitesInPolygon(allSites, ring) {
    if (!ring || ring.length < 3 || !allSites?.length) return [];
    return allSites.filter((s) => {
        const lat = Number(s.lat);
        const lng = Number(s.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
        return pointInPolygonLngLat(lng, lat, ring);
    });
}

/** Planar-equivalent area (km²) for a small geographic ring — OK for city-scale polygons. */
export function approximatePolygonAreaKm2(ring) {
    if (!ring || ring.length < 3) return 0;
    const r = [...ring];
    const f = r[0];
    const l = r[r.length - 1];
    if (f[0] === l[0] && f[1] === l[1]) r.pop();
    if (r.length < 3) return 0;
    const lat0 = r.reduce((s, p) => s + p[1], 0) / r.length;
    const mx = 111.32 * Math.cos((lat0 * Math.PI) / 180);
    const my = 110.574;
    let sum = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const xi = r[i][0] * mx;
        const yi = r[i][1] * my;
        const xj = r[j][0] * mx;
        const yj = r[j][1] * my;
        sum += xi * yj - xj * yi;
    }
    return Math.abs(sum / 2);
}

/**
 * Sum population / density from grid cells whose lat/lng fall inside the ring.
 * @param {Array<{lat:number,lng:number,population?:number,density?:number}>} grid
 */
export function aggregatePopulationInPolygon(grid, ring) {
    if (!ring?.length || !grid?.length) {
        return {
            totalPopulation: 0,
            cellsInside: 0,
            avgDensity: null,
            areaKm2: approximatePolygonAreaKm2(ring)
        };
    }
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    const r = [...ring];
    const f = r[0];
    const l = r[r.length - 1];
    if (f[0] === l[0] && f[1] === l[1]) r.pop();
    for (const p of r) {
        minLng = Math.min(minLng, p[0]);
        maxLng = Math.max(maxLng, p[0]);
        minLat = Math.min(minLat, p[1]);
        maxLat = Math.max(maxLat, p[1]);
    }
    let totalPop = 0;
    let popWDensity = 0;
    let cellsInside = 0;
    for (const c of grid) {
        const lat = Number(c.lat);
        const lng = Number(c.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) continue;
        if (!pointInPolygonLngLat(lng, lat, ring)) continue;
        const p = Number(c.population) || 0;
        const d = Number(c.density) || 0;
        totalPop += p;
        if (p > 0 && d >= 0) popWDensity += p * d;
        cellsInside++;
    }
    const avgDensity = totalPop > 0 && popWDensity > 0 ? Math.round(popWDensity / totalPop) : null;
    const areaKm2 = approximatePolygonAreaKm2(ring);
    return { totalPopulation: Math.round(totalPop), cellsInside, avgDensity, areaKm2 };
}

/** Count MNO sites inside polygon by normalized operator name. */
export function countMnoSitesByOperatorInPolygon(allSites, ring, options = {}) {
    let sites = collectSitesInPolygon(allSites, ring);
    sites = filterSitesByRadioTechnology(sites, options.ratFilter || 'all');
    const counts = { Competitor: 0, Other: 0 };
    for (const op of MNOS) counts[op] = 0;
    for (const s of sites) {
        const m = normalizeMNO(s.mno || '');
        if (MNOS.includes(m)) counts[m]++;
        else if (m === 'Competitor') counts.Competitor++;
        else counts.Other++;
    }
    counts.total = sites.length;
    return counts;
}

/**
 * Own portfolio towers (category "towers" / MY_ASSETS) inside ring — separate from MNO upload G/S/D counts.
 */
export function countOurPortfolioTowersInPolygon(towers, ring) {
    if (!ring || ring.length < 3 || !towers?.length) return 0;
    const getCat = (name) => {
        try {
            return (typeof localStorage !== 'undefined' && localStorage.getItem(`category-${name}`)) || 'towers';
        } catch {
            return 'towers';
        }
    };
    let n = 0;
    for (const t of towers) {
        const lat = Number(t.lat);
        const lng = Number(t.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const cat = getCat(t.dataset_name);
        const isOurPortfolio = cat === 'towers' || t.sourceType === 'MY_ASSETS';
        if (!isOurPortfolio) continue;
        if (!pointInPolygonLngLat(lng, lat, ring)) continue;
        n++;
    }
    return n;
}
