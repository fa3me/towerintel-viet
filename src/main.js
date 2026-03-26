import { Deck, MapController, WebMercatorViewport } from '@deck.gl/core';
import { MapboxOverlay } from '@deck.gl/mapbox';
import maplibregl from 'maplibre-gl';
import { ScatterplotLayer } from '@deck.gl/layers';

import { generateCoverageGrid } from './data/coverage-gaps.js';
import { getPopulationAtRadii, preloadPopulationData } from './data/population.js';

import { calculateScores, normalizeMNO } from './engine/colocation-engine.js';
import { loadFromDB, saveToDB, clearDB, deleteFromDB } from './data/db.js';
import { exportToCSV } from './engine/csv-parser.js';
import { readHeadersAndData } from './engine/excel-reader.js';
import { showColumnMapperModal } from './ui/column-mapper.js';
import { showSiteEditorModal } from './ui/site-editor.js';
import { showSaveLocationModal } from './ui/save-location-modal.js';
import { VN_AIRPORTS, haversineDistance, getNearestAirport, getNearestMunicipality, isPointInVietnamLand } from './data/vn-geo.js';
import { MNOS, INITIAL_MAP_VIEW } from './config/app-config.js';
import {
    createTowerLayer,
    createMNOLayer,
    createCoverageHeatmap,
    createPopulationHexagons,
    createArcLayer,
    createPopulationRings,
    createMeasureLayer,
    createSearchRingLayer,
    createRawRasterLayer,
    createPotentialLandbankLayer,
    createPolygonCompareDrawLayers
} from './layers/map-layers.js';

import { parseKML, kmlToGeoJSON } from './engine/kml-parser.js';

import { renderDashboard } from './ui/dashboard.js';
import { renderFilters, categoryFromSourceType } from './ui/filters.js';
import { renderPitchDeck } from './ui/pitch-deck.js';

import { PATH_LOSS_MODELS, generateRFHeatmap } from './engine/rf-engine.js';

// Network Intel imports
import { buildGeohashGrid, getAvailableQuarters } from './engine/network-analysis.js';
import { createGeohashLayer, buildGeohashTooltip } from './layers/geohash-layer.js';
import { renderNetworkIntelPanel, computeSummary } from './ui/network-intel-panel.js';
import { createComparisonSlider } from './ui/comparison-slider.js';
import { encode as ghEncode, toPolygon as ghToPolygon, decode as ghDecode, neighbors as ghNeighbors } from './engine/geohash.js';
import { generateCrowdsourcedData } from './engine/data-generator.js';
import { syncMultipleSources } from './engine/sync-engine.js';
import {
    filterGeohashCellsByPolygon,
    closeCompareRing,
    collectSitesInPolygon,
    aggregateMnoKpisInPolygon,
    dedupePolygonVertices
} from './engine/polygon-compare.js';
import { renderPolygonComparePanel, removePolygonComparePanel } from './ui/polygon-compare-panel.js';
import { clearPolygonAreaSummary } from './ui/polygon-area-summary.js';
import { initAuthGate, canDownloadCsv, canUpload, getCurrentAccessState } from './auth/auth-gate.js';

/** @typedef {{ coordFormat?: string, terrainPopRadiusKey?: string, terrainThresholds?: { denseUrban?: number, urban?: number, suburban?: number }, scoring?: object }} TiSettings */

const SETTINGS_STORAGE_KEY = 'towerintel-viet-settings';

function defaultDistanceThresholdsByTerrain() {
    // Single ≥ distance (km): nearest MNO must be at least this far for colocation potential
    return {
        'Dense Urban': { minKm: 0.35 },
        'Urban': { minKm: 0.5 },
        'Suburban': { minKm: 0.75 },
        'Rural': { minKm: 1.5 }
    };
}

function cloneDistThresholdsForAllMNOs() {
    const t = defaultDistanceThresholdsByTerrain();
    const json = JSON.stringify(t);
    const o = {};
    for (const m of MNOS) o[m] = JSON.parse(json);
    return o;
}

function getDefaultSettings() {
    return {
        coordFormat: 'DD',
        terrainPopRadiusKey: 'radius_1km',
        terrainThresholds: { denseUrban: 9000, urban: 5000, suburban: 3000 },
        scoring: {
            distanceThresholds: cloneDistThresholdsForAllMNOs(),
            popRadiusKey: 'radius_1km',
            popScoreThresholds: { high: 30000, mid: 10000, low: 2000 },
            weights: { distance: 0.70, structural: 0.10, population: 0.20 }
        }
    };
}

function deepMergeSettings(base, patch) {
    const out = JSON.parse(JSON.stringify(base));
    if (!patch || typeof patch !== 'object') return out;
    if (patch.coordFormat) out.coordFormat = patch.coordFormat;
    if (patch.terrainPopRadiusKey) out.terrainPopRadiusKey = patch.terrainPopRadiusKey;
    if (patch.terrainThresholds) Object.assign(out.terrainThresholds, patch.terrainThresholds);
    if (patch.scoring) {
        if (patch.scoring.popRadiusKey) out.scoring.popRadiusKey = patch.scoring.popRadiusKey;
        if (patch.scoring.popScoreThresholds) Object.assign(out.scoring.popScoreThresholds, patch.scoring.popScoreThresholds);
        if (patch.scoring.weights) Object.assign(out.scoring.weights, patch.scoring.weights);
        if (patch.scoring.distanceThresholds) {
            for (const mno of MNOS) {
                if (!patch.scoring.distanceThresholds[mno]) continue;
                for (const terr of ['Dense Urban', 'Urban', 'Suburban', 'Rural']) {
                    const pRow = patch.scoring.distanceThresholds[mno][terr];
                    if (pRow && typeof pRow === 'object') {
                        const merged = {
                            ...out.scoring.distanceThresholds[mno][terr],
                            ...pRow
                        };
                        // Migrate legacy band { lowKm, highKm } → single minKm
                        if (merged.minKm == null || !Number.isFinite(Number(merged.minKm))) {
                            const legacy = Number(merged.highKm ?? merged.lowKm);
                            if (Number.isFinite(legacy) && legacy > 0) merged.minKm = legacy;
                        }
                        delete merged.lowKm;
                        delete merged.highKm;
                        out.scoring.distanceThresholds[mno][terr] = merged;
                    }
                }
            }
        }
    }
    return out;
}

function migrateLoadedDistanceThresholds(s) {
    const def = defaultDistanceThresholdsByTerrain();
    if (!s?.scoring?.distanceThresholds) return;
    for (const mno of MNOS) {
        for (const terr of ['Dense Urban', 'Urban', 'Suburban', 'Rural']) {
            const row = s.scoring.distanceThresholds[mno]?.[terr];
            if (!row || typeof row !== 'object') continue;
            if (row.minKm != null && Number.isFinite(Number(row.minKm))) {
                delete row.lowKm;
                delete row.highKm;
                continue;
            }
            const legacy = Number(row.highKm ?? row.lowKm);
            row.minKm = Number.isFinite(legacy) && legacy > 0 ? legacy : (def[terr]?.minKm ?? 0.5);
            delete row.lowKm;
            delete row.highKm;
        }
    }
}

function loadSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!raw) return getDefaultSettings();
        const merged = deepMergeSettings(getDefaultSettings(), JSON.parse(raw));
        migrateLoadedDistanceThresholds(merged);
        return merged;
    } catch {
        return getDefaultSettings();
    }
}

function saveSettings(s) {
    try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(s));
    } catch (e) {
        console.warn('saveSettings failed', e);
    }
}

function terrainFromPopulation(popVal, settings) {
    const t = settings?.terrainThresholds || {};
    const p = Number(popVal) || 0;
    if (p >= (t.denseUrban ?? 9000)) return 'Dense Urban';
    if (p >= (t.urban ?? 5000)) return 'Urban';
    if (p >= (t.suburban ?? 3000)) return 'Suburban';
    return 'Rural';
}

/**
 * Landbank candidates store `terrain` from compute time; Settings thresholds can change later.
 * Urban/Dense filter must re-classify from stored WorldPop sums + *current* thresholds (not stale p.terrain).
 */
function landbankTerrainFromCandidate(p) {
    return terrainFromPopulation(p.population_1km ?? 0, state.settings);
}

function passesLandbankUrbanOnly(p, urbanOnly) {
    if (!urbanOnly) return true;
    const tt = landbankTerrainFromCandidate(p);
    return tt === 'Urban' || tt === 'Dense Urban';
}

/**
 * Min-pop threshold vs WorldPop: `p.population` is terrain-specific (often radius_500m for Urban).
 * On a 1 km grid, sample points between cell centers can have **no** pixel within 500 m → 500 m sum = 0
 * while 1 km sum is huge — those points were incorrectly filtered out. Use max of the three ring sums.
 */
function landbankPopulationForMinFilter(p) {
    return Math.max(p.population_500m ?? 0, p.population_1km ?? 0, p.population_1_5km ?? 0);
}

function recomputeTerrainForAllSites() {
    const key = 'radius_1km';
    const apply = (s) => {
        if (!s || !s.population) return;
        const popVal = Number(s.population[key] ?? s.population.radius_1km ?? 0);
        const tt = terrainFromPopulation(popVal, state.settings);
        s.terrain_type = tt;
        s.population.terrain_type = tt;
    };
    state.towers.forEach(apply);
    state.mnoSites.forEach(apply);
}

function pad2(n) {
    return String(Math.floor(Math.abs(n))).padStart(2, '0');
}

/** Cursor / UI: format one coordinate component */
function formatCoordComponent(value, isLat, format) {
    const f = format || 'DD';
    const hemi = isLat ? (value >= 0 ? 'N' : 'S') : (value >= 0 ? 'E' : 'W');
    const v = Math.abs(value);
    if (f === 'DD') return `${v.toFixed(5)}° ${hemi}`;
    if (f === 'DMS') {
        const d = Math.floor(v);
        const mFloat = (v - d) * 60;
        const m = Math.floor(mFloat);
        const s = (mFloat - m) * 60;
        return `${d}° ${pad2(m)}′ ${s.toFixed(2)}″ ${hemi}`;
    }
    if (f === 'DDM') {
        const d = Math.floor(v);
        const min = (v - d) * 60;
        return `${d}° ${min.toFixed(3)}′ ${hemi}`;
    }
    return `${v.toFixed(5)}° ${hemi}`;
}

function cursorCoordDisplay(lat, lng) {
    const cf = state.settings?.coordFormat || 'DD';
    if (cf === 'DD') return `Lat: ${Number(lat).toFixed(5)}, Lng: ${Number(lng).toFixed(5)}`;
    return `LAT: ${formatCoordComponent(lat, true, cf)}  LNG: ${formatCoordComponent(lng, false, cf)}`;
}

function syncCompassFromViewState(viewState) {
    const arrow = document.getElementById('compass-arrow');
    const degEl = document.getElementById('compass-deg');
    if (!arrow || !degEl || !viewState) return;
    const brg = viewState.bearing || 0;
    arrow.style.transform = `rotate(${-brg}deg)`;
    degEl.textContent = `${Math.round(brg)}°`;
}

// Track current DeckGL view so dashboard stats can be limited to viewport
let currentViewState = null;

// --- INITIAL STATE ---
let state = {
    towers: [],
    mnoSites: [],
    datasets: [],
    activeDatasets: new Set(),
    coverageGrid: [],
    rfSimulationGrid: [],
    groundTruthGrid: [],
    populationGrid: [],
    scores: new Map(),
    measurePoints: [],
    lastMeasureSegment: null, // Leaflet-style: completed line stays visible, next click starts new measure
    _lastMeasureSegmentAt: 0,  // timestamp when lastSegment was set (avoid double-fire clearing it)
    isMeasureMode: false,
    searchPin: null, // { lat, lng, createdAt } for coordinate search
    searchPinExpiresAt: 0, // epoch ms; 0 = not set
    filters: {
        targetMNO: 'All',
        satellite: false,
        priorityHighlight: null,
        towerFilterColumn: '',      // Our Towers: user-chosen column (empty = no filter)
        towerFilterValue: 'All',    // Our Towers: selected value for that column
        mnoFilterColumn: '',       // MNO Sites: user-chosen column
        mnoFilterValue: 'All',     // MNO Sites: selected value for that column
        landbankMinPopulation: 2000, // Potential landbank: minimum population within cell
        landbankUrbanOnly: true,     // Potential landbank: restrict to Urban / Dense Urban
        layers: { towers: true, mno: true, heatmap: false, population: false, strategy: true, searchRings: true, networkIntel: false, potentialLandbankAreas: true }
    },
    selectedTower: null,
    highlightId: null,
    searchRingsGeoJSON: null,
    rasters: {
        globeRSRP: {
            visible: false,
            isLoading: false,
            data: [],
            url: '/rasters/globe_rsrp_davao.json',
            bounds: { west: 125.59019295037956, south: 7.074009155280282, east: 125.63349453271599, north: 7.100583718688269 }
        }
    },
    isPegmanMode: false,
    // Potential Landbank Areas: high-pop areas with 2–3 MNO missing (computed from populationGrid + mnoSites)
    potentialLandbankAreas: [],
    // Network Intel state
    geohashGrid: [],
    geohashGridRight: [],
    networkIntel: {
        metric: 'rsrp',
        precision: 6,
        mnoFilter: [...MNOS],
        comparing: false,
        sliderPos: 0.5,
        left: { mno: 'All', quarter: 'Current' },
        right: { mno: 'Vinaphone', quarter: 'Current' }
    },
    /** User-drawn polygon for MNO KPI compare (split map + dock panel) */
    polygonCompare: {
        drawMode: false,
        vertices: [],
        ring: null,
        panelOpen: false,
        mnoA: 'Viettel',
        mnoB: 'Vinaphone',
        /** 'all' | '2g' | '3g' | '4g' | '5g' — filter uploaded site rows by RAT/technology column */
        ratFilter: 'all',
        _lastVertexAt: 0
    },
    /** @type {TiSettings | null} */
    settings: null,
    filterOptions: null
};

let deck = null;
let map = null;
/** Second MapLibre map for split compare (right strip); destroyed when compare closes */
let mapRight = null;
/** Deck.gl layers on mapRight via official overlay (same camera + container as basemap — fixes tile vs vector drift). */
let mapRightDeckOverlay = null;
/** Bound in init() — overlay handlers (getDeckTooltip / handleMapClick live inside init). */
let getDeckTooltipForMapOverlay = null;
let handleMapClickForMapOverlay = null;
let comparisonSlider = null;
/** Backup of paint properties temporarily overridden by Pegman highlight mode. */
let pegmanHighlightBackup = new Map();

function isPegmanHighlightTargetLayer(layer) {
    if (!layer || !layer.id) return false;
    const id = String(layer.id).toLowerCase();
    if (layer.type === 'line') {
        return /road|street|highway|motorway|transport|path|bridge|tunnel/.test(id);
    }
    if (layer.type === 'symbol') {
        return /road|street|highway|place|poi|label|transit/.test(id);
    }
    return false;
}

function setPegmanStreetHighlight(enabled) {
    if (!map || !map.getStyle) return;
    const style = map.getStyle();
    const layers = style?.layers || [];

    if (enabled) {
        pegmanHighlightBackup = new Map();
        for (const layer of layers) {
            if (!isPegmanHighlightTargetLayer(layer)) continue;
            const backup = {};
            if (layer.type === 'line') {
                backup['line-color'] = map.getPaintProperty(layer.id, 'line-color');
                backup['line-width'] = map.getPaintProperty(layer.id, 'line-width');
                backup['line-opacity'] = map.getPaintProperty(layer.id, 'line-opacity');
                map.setPaintProperty(layer.id, 'line-color', '#00e5ff');
                map.setPaintProperty(layer.id, 'line-width', ['interpolate', ['linear'], ['zoom'], 5, 1.4, 10, 2.2, 15, 3.2]);
                map.setPaintProperty(layer.id, 'line-opacity', 0.95);
            } else if (layer.type === 'symbol') {
                backup['text-color'] = map.getPaintProperty(layer.id, 'text-color');
                backup['text-halo-color'] = map.getPaintProperty(layer.id, 'text-halo-color');
                backup['text-halo-width'] = map.getPaintProperty(layer.id, 'text-halo-width');
                map.setPaintProperty(layer.id, 'text-color', '#ffd166');
                map.setPaintProperty(layer.id, 'text-halo-color', '#0b1121');
                map.setPaintProperty(layer.id, 'text-halo-width', 1.5);
            }
            pegmanHighlightBackup.set(layer.id, backup);
        }
        return;
    }

    for (const [layerId, backup] of pegmanHighlightBackup.entries()) {
        if (!map.getLayer(layerId)) continue;
        for (const [prop, value] of Object.entries(backup)) {
            if (value == null) continue;
            map.setPaintProperty(layerId, prop, value);
        }
    }
    pegmanHighlightBackup.clear();
}

/** Push #map-canvas CSS size into left Deck before reading viewports (avoids stale width vs split strip). */
function syncCompareDeckLayoutFromDom() {
    const cl = document.getElementById('map-canvas');
    if (deck && cl && cl.clientWidth > 0 && cl.clientHeight > 0) {
        deck.setProps({ width: cl.clientWidth, height: cl.clientHeight });
    }
}

/**
 * Geographic bounds [[west,south],[east,north]] visible in the left strip.
 * Use #map-canvas CSS size + currentViewState (same inputs as the interactive Deck) — not
 * deck.getViewports(), which can lag one frame after split/resize and yield the wrong bbox
 * (right pane jumps to Parañaque, etc.).
 */
function getCompareLeftGeographicBounds() {
    if (!currentViewState) return null;
    const cl = document.getElementById('map-canvas');
    if (!cl || cl.clientWidth < 16 || cl.clientHeight < 16) return null;
    const vs = stripTransitionFields(currentViewState);
    const vp = new WebMercatorViewport({
        width: cl.clientWidth,
        height: cl.clientHeight,
        longitude: vs.longitude,
        latitude: vs.latitude,
        zoom: vs.zoom,
        pitch: vs.pitch ?? 0,
        bearing: vs.bearing ?? 0
    });
    const flat = vp.getBounds();
    if (!Array.isArray(flat) || flat.length < 4) return null;
    const [w, s, e, n] = flat;
    if (![w, s, e, n].every(Number.isFinite)) return null;
    return [[w, s], [e, n]];
}

/** @param {object|number[]} c MapLibre LngLat or [lng,lat] */
function lngLatLikeToTuple(c) {
    if (!c) return null;
    if (Array.isArray(c) && c.length >= 2) return [Number(c[0]), Number(c[1])];
    if (typeof c.lng === 'number' && typeof c.lat === 'number') return [c.lng, c.lat];
    return null;
}

/**
 * Fit the same geographic bounds into the right strip using MapLibre's own camera math.
 * Never reuse the left pane's center+zoom on the right (wrong aspect → wrong city).
 * Deck layers on the right use MapboxOverlay and follow mapRight automatically on each render.
 */
function applyMapRightCameraToBounds(bounds, vs) {
    if (!mapRight || !bounds) return false;
    const bearing = vs.bearing ?? 0;
    const pitch = vs.pitch ?? 0;
    const jumpBase = { duration: 0, bearing, pitch };
    const pad = { top: 0, bottom: 0, left: 0, right: 0 };

    try {
        if (typeof mapRight.cameraForBounds === 'function') {
            const cam = mapRight.cameraForBounds(bounds, {
                padding: pad,
                bearing,
                pitch,
                maxZoom: 24
            });
            if (cam) {
                const center = lngLatLikeToTuple(cam.center);
                if (center && Number.isFinite(cam.zoom)) {
                    mapRight.jumpTo({
                        ...jumpBase,
                        center,
                        zoom: cam.zoom,
                        bearing: cam.bearing ?? bearing,
                        pitch: cam.pitch ?? pitch
                    });
                    return true;
                }
            }
        }
    } catch (e) {
        console.warn('applyMapRightCameraToBounds cameraForBounds', e);
    }

    try {
        mapRight.fitBounds(bounds, {
            duration: 0,
            linear: true,
            padding: pad,
            bearing,
            pitch
        });
        return true;
    } catch (e) {
        console.warn('applyMapRightCameraToBounds fitBounds', e);
    }

    const mr = document.getElementById('map-right');
    if (!mr || mr.clientWidth < 16 || mr.clientHeight < 16) return false;
    try {
        const fitted = new WebMercatorViewport({
            width: mr.clientWidth,
            height: mr.clientHeight,
            longitude: vs.longitude,
            latitude: vs.latitude,
            zoom: vs.zoom,
            pitch: vs.pitch ?? 0,
            bearing: vs.bearing ?? 0
        }).fitBounds(bounds);
        mapRight.jumpTo({
            ...jumpBase,
            center: [fitted.longitude, fitted.latitude],
            zoom: fitted.zoom
        });
        return true;
    } catch (e2) {
        console.warn('applyMapRightCameraToBounds WebMercator fallback', e2);
    }
    return false;
}

function stripTransitionFields(obj) {
    const o = { ...obj };
    delete o.transitionDuration;
    delete o.transitionInterpolator;
    delete o.transitionEasing;
    delete o.transitionInterruption;
    return o;
}

/** Legacy hook: compare mode syncs MapLibre in syncCompareBasemaps; right Deck is MapboxOverlay on mapRight. */
function syncMirroredDeckViewState(_viewState) {
    if (state.networkIntel.comparing) {
        syncCompareBasemaps();
    }
}

/** Raster DEM + satellite (same as main map). Idempotent per map instance. */
function attachAuxiliaryBasemapLayers(mapInstance) {
    if (!mapInstance || mapInstance.getSource('google-satellite')) return;
    mapInstance.addSource('google-satellite', {
        type: 'raster',
        tiles: ['https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'],
        tileSize: 256
    });
    mapInstance.addLayer({
        id: 'google-satellite-layer',
        type: 'raster',
        source: 'google-satellite',
        layout: { visibility: 'none' }
    });
    mapInstance.addSource('terrain-source', {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        tileSize: 256,
        encoding: 'terrarium',
        maxzoom: 15
    });
    // MapLibre GL v5 does not support Mapbox-style `type: 'sky'` layers; adding one throws and can break map load.
}

/**
 * Lock MapLibre basemaps to the same geographic frame as the left Deck strip.
 * Right vector layers use MapboxOverlay (camera synced on every map render).
 */
function syncCompareBasemaps() {
    if (!state.networkIntel.comparing || !map || !map.loaded() || !currentViewState) return;
    resizeCompareBasemaps();
    syncCompareDeckLayoutFromDom();

    try {
        if (typeof map.setPadding === 'function') {
            map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
        }
        if (mapRight && typeof mapRight.setPadding === 'function') {
            mapRight.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
        }
    } catch (_) { /* ignore */ }

    const vs = stripTransitionFields(currentViewState);
    const bearing = vs.bearing ?? 0;
    const pitch = vs.pitch ?? 0;
    const jump = { duration: 0 };
    const fitOpts = {
        duration: 0,
        linear: true,
        padding: { top: 0, bottom: 0, left: 0, right: 0 },
        bearing,
        pitch
    };

    const bounds = getCompareLeftGeographicBounds();
    if (bounds) {
        try {
            map.fitBounds(bounds, fitOpts);
        } catch (e) {
            console.warn('syncCompareBasemaps left fitBounds', e);
            try {
                map.jumpTo({
                    ...jump,
                    center: [vs.longitude, vs.latitude],
                    zoom: vs.zoom,
                    bearing,
                    pitch
                });
            } catch (e2) {
                console.warn('syncCompareBasemaps left jumpTo', e2);
            }
        }
        if (mapRight) {
            applyMapRightCameraToBounds(bounds, vs);
        }
    } else {
        try {
            map.jumpTo({
                ...jump,
                center: [vs.longitude, vs.latitude],
                zoom: vs.zoom,
                bearing,
                pitch
            });
        } catch (e) {
            console.warn('syncCompareBasemaps left', e);
        }
        if (mapRight) {
            try {
                mapRight.jumpTo({
                    ...jump,
                    center: [vs.longitude, vs.latitude],
                    zoom: vs.zoom,
                    bearing,
                    pitch
                });
            } catch (e) {
                console.warn('syncCompareBasemaps right', e);
            }
        }
    }
}

function resizeCompareBasemaps() {
    if (!state.networkIntel.comparing) return;
    try {
        if (map) map.resize();
        if (mapRight) mapRight.resize();
    } catch (_) { /* ignore */ }
}

/**
 * After exiting split-compare, MapLibre may still use the camera from repeated fitBounds (strip layout)
 * while Deck still uses currentViewState — vectors look shifted vs tiles. Snap map to Deck and resize both.
 */
function resyncMapToDeckAfterCompare() {
    if (!map || !map.loaded() || !deck || !currentViewState) return;
    const vs = stripTransitionFields(currentViewState);
    const mapCanvas = document.getElementById('map-canvas');
    const run = () => {
        try {
            if (typeof map.setPadding === 'function') {
                map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
            }
        } catch (_) { /* ignore */ }
        if (mapCanvas && mapCanvas.clientWidth > 0 && mapCanvas.clientHeight > 0) {
            try {
                deck.setProps({ width: mapCanvas.clientWidth, height: mapCanvas.clientHeight });
            } catch (_) { /* ignore */ }
        }
        try {
            map.resize();
        } catch (_) { /* ignore */ }
        try {
            map.jumpTo({
                duration: 0,
                center: [vs.longitude, vs.latitude],
                zoom: vs.zoom,
                bearing: vs.bearing ?? 0,
                pitch: vs.pitch ?? 0
            });
        } catch (e) {
            console.warn('resyncMapToDeckAfterCompare jumpTo', e);
        }
        updateLayers();
    };
    requestAnimationFrame(() => requestAnimationFrame(run));
}

function syncAuxiliaryLayersFromMainToRight() {
    if (!map || !mapRight || !map.loaded() || !mapRight.loaded()) return;
    try {
        if (map.getLayer('google-satellite-layer') && mapRight.getLayer('google-satellite-layer')) {
            const v = map.getLayoutProperty('google-satellite-layer', 'visibility');
            mapRight.setLayoutProperty('google-satellite-layer', 'visibility', v);
        }
        if (map.getLayer('sky-layer') && mapRight.getLayer('sky-layer')) {
            const v = map.getLayoutProperty('sky-layer', 'visibility');
            mapRight.setLayoutProperty('sky-layer', 'visibility', v);
        }
        const terrain = map.getTerrain();
        mapRight.setTerrain(terrain || null);
    } catch (_) { /* ignore */ }
}

function ensureMapRightDeckOverlay() {
    if (!mapRight || mapRightDeckOverlay || !state.networkIntel.comparing) return;
    if (!mapRight.loaded()) return;
    const cr = document.getElementById('map-canvas-right');
    if (cr) {
        cr.style.display = 'none';
        cr.style.pointerEvents = 'none';
    }
    try {
        mapRightDeckOverlay = new MapboxOverlay({
            interleaved: false,
            useDevicePixels: false,
            controller: false,
            layers: [],
            getTooltip: getDeckTooltipForMapOverlay || (() => null),
            onClick: (info) => {
                if (handleMapClickForMapOverlay) handleMapClickForMapOverlay(info);
            }
        });
        mapRight.addControl(mapRightDeckOverlay);
    } catch (e) {
        console.warn('ensureMapRightDeckOverlay failed', e);
        mapRightDeckOverlay = null;
    }
}

function ensureMapRight() {
    if (mapRight || !state.networkIntel.comparing) return;
    const el = document.getElementById('map-right');
    if (!el || !map) return;
    const center = map.getCenter();
    const zoom = map.getZoom();
    mapRight = new maplibregl.Map({
        container: 'map-right',
        style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
        interactive: false,
        attributionControl: false,
        center: [center.lng, center.lat],
        zoom
    });
    const runMapRightReady = () => {
        if (!mapRight) return;
        try {
            attachAuxiliaryBasemapLayers(mapRight);
            syncAuxiliaryLayersFromMainToRight();
            syncCompareBasemaps();
            ensureMapRightDeckOverlay();
            updateLayers();
        } catch (e) {
            console.warn('runMapRightReady', e);
        }
    };
    // If style loads before 'load' is attached (cached tiles), callback never runs — right pane stays empty.
    if (typeof mapRight.loaded === 'function' && mapRight.loaded()) {
        queueMicrotask(runMapRightReady);
    } else {
        mapRight.once('load', runMapRightReady);
    }
}

function destroyMapRight() {
    if (mapRightDeckOverlay) {
        try {
            mapRightDeckOverlay.finalize();
        } catch (_) { /* ignore */ }
        mapRightDeckOverlay = null;
    }
    const cr = document.getElementById('map-canvas-right');
    if (cr) {
        cr.style.display = '';
        cr.style.pointerEvents = '';
    }
    if (!mapRight) return;
    try {
        mapRight.remove();
    } catch (_) { /* ignore */ }
    mapRight = null;
    const el = document.getElementById('map-right');
    if (el) el.style.display = 'none';
    try {
        if (map && map.loaded()) map.resize();
    } catch (_) { /* ignore */ }
}

/** Floating map overlay removed in compare mode — polygon KPIs stay in the bottom dock + comparison bar. */
function refreshPolygonAreaSummary() {
    const el = document.getElementById('polygon-area-summary');
    if (!el) return;
    clearPolygonAreaSummary(el);
}

/** After the right canvas becomes visible, Deck may need an extra frame to read clientWidth/height. */
function scheduleMirrorDeckResync() {
    requestAnimationFrame(() => {
        resizeCompareBasemaps();
        syncCompareDeckLayoutFromDom();
        syncCompareBasemaps();
        requestAnimationFrame(() => {
            resizeCompareBasemaps();
            syncCompareDeckLayoutFromDom();
            syncCompareBasemaps();
            updateLayers();
        });
    });
}

function rerenderFilterPanel() {
    const fc = document.getElementById('filter-panel');
    if (!fc || !state.filterOptions) return;
    state.filterOptions.layersState = state.filters.layers;
    state.filterOptions.satelliteState = state.filters.satellite;
    state.filterOptions.accessState = getCurrentAccessState();
    state.filters = renderFilters(fc, state.filterOptions);
}

async function init() {
    const dashboardContainer = document.getElementById('dashboard-panel');
    const filterContainer = document.getElementById('filter-panel');
    if (!dashboardContainer || !filterContainer) return;

    const authRes = await initAuthGate();
    if (authRes?.blocked) return;

    state.settings = loadSettings();

    await loadInitialData();
    await loadPopulationGrid(); // MUST LOAD POPULATION BEFORE SCORING RUNS

    const pitchContainer = document.getElementById('pitch-panel') || document.createElement('div');
    if (!pitchContainer.id) {
        pitchContainer.id = 'pitch-panel';
        pitchContainer.className = 'pitch-panel';
        document.body.appendChild(pitchContainer);
    }

    // Toast container initialization
    if (!document.querySelector('.toast-container')) {
        const toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container';
        document.body.appendChild(toastContainer);
    }

    const getCat = (name) => localStorage.getItem(`category-${name}`) || 'towers';
    const towerDataForFilter = state.towers.filter(t => getCat(t.dataset_name) === 'towers' && t.sourceType !== 'STRATEGIC_Discovery');
    const mnoDataForFilter = state.mnoSites.filter(s => s.mno && getCat(s.dataset_name) === 'mno' && s.sourceType !== 'STRATEGIC_Discovery');
    const towerColsAndVals = getColumnsAndValues(towerDataForFilter);
    const mnoColsAndVals = getColumnsAndValues(mnoDataForFilter);

    const filterOptions = {
        activeDatasets: state.activeDatasets,
        datasets: state.datasets,
        rasterLayers: state.rasters,
        towerFilterColumn: state.filters.towerFilterColumn,
        towerFilterValue: state.filters.towerFilterValue,
        towerColumns: towerColsAndVals.columns,
        towerValuesByColumn: towerColsAndVals.valuesByColumn,
        mnoFilterColumn: state.filters.mnoFilterColumn,
        mnoFilterValue: state.filters.mnoFilterValue,
        mnoColumns: mnoColsAndVals.columns,
        mnoValuesByColumn: mnoColsAndVals.valuesByColumn,
        landbankMinPopulation: state.filters.landbankMinPopulation,
        landbankUrbanOnly: state.filters.landbankUrbanOnly,
        settings: state.settings,
        satelliteState: state.filters.satellite,
        accessState: getCurrentAccessState(),
        onSettingsChange: (next) => {
            state.settings = next;
            saveSettings(next);
            recomputeTerrainForAllSites();
            const getCatForScoring = (name) => localStorage.getItem(`category-${name}`) || 'towers';
            const scoringMNOs = state.mnoSites.filter(s => {
                const isExplicitMNO = s.dataset_name && (
                    s.dataset_name.toLowerCase().includes('viettel') ||
                    s.dataset_name.toLowerCase().includes('vinaphone') ||
                    s.dataset_name.toLowerCase().includes('mobifone') ||
                    s.dataset_name.toLowerCase().includes('vietnamobile') ||
                    s.dataset_name.toLowerCase().includes('mno')
                );
                const cat = getCatForScoring(s.dataset_name);
                if (cat !== 'mno' && !isExplicitMNO) return false;
                if (s.sourceType && s.sourceType.startsWith('STRATEGIC_')) return false;
                return true;
            });
            const scoreResults = calculateScores(state.towers, scoringMNOs, null, state.towers.filter(t => t.sourceType === 'MY_ASSETS'), state.settings);
            state.scores = new Map(scoreResults.map(s => [s.towerId, s]));
            state.filterOptions.settings = state.settings;
            rerenderFilterPanel();
            updateLayers();
            updateDashboard();
        },
        onSettingsCancel: () => {
            if (state.filterOptions) {
                state.filterOptions.settings = state.settings;
                rerenderFilterPanel();
            }
        },
        onFilterChange: (newFilters) => {
            state.filters = newFilters;
            if (map && map.getLayer('google-satellite-layer')) {
                const vis = newFilters.satellite ? 'visible' : 'none';
                map.setLayoutProperty('google-satellite-layer', 'visibility', vis);
                if (mapRight && mapRight.getLayer('google-satellite-layer')) {
                    mapRight.setLayoutProperty('google-satellite-layer', 'visibility', vis);
                }
            }
            const mapSatBtn = document.getElementById('map-satellite-btn');
            if (mapSatBtn) mapSatBtn.classList.toggle('active', !!newFilters.satellite);
            // Sync raster visibility (rasters live under Signal Heatmap; per-key visibility)
            if (newFilters.rasterVisibility && typeof newFilters.rasterVisibility === 'object') {
                Object.entries(newFilters.rasterVisibility).forEach(([key, visible]) => {
                    if (state.rasters[key]) {
                        const wasHidden = !state.rasters[key].visible;
                        state.rasters[key].visible = !!visible;
                        if (state.rasters[key].visible && wasHidden) loadRasterData(key);
                    }
                });
            }
            // Show/hide Network Intel panel (panel stays hidden while split-compare is active — controls are in the top bar)
            const niPanel = document.getElementById('network-intel-panel');
            if (niPanel) {
                if (newFilters.layers.networkIntel) {
                    if (!state.networkIntel.comparing) {
                        niPanel.style.display = '';
                        niPanel.classList.add('open');
                        refreshIntelPanel();
                    }
                } else {
                    niPanel.classList.remove('open');
                    niPanel.style.display = '';
                    state.networkIntel.comparing = false;
                    hideComparisonSlider();
                    clearPolygonCompareArea();
                }
            }
            updateLayers();
            updateDashboard();
        },
        onDatasetToggle: async (name, active) => {
            if (active) state.activeDatasets.add(name);
            else state.activeDatasets.delete(name);
            await loadVisibleDatasets();
            await processData();
            updateLayers();
            updateDashboard();
        },
        onParentDatasetToggle: async (active, datasetNames = []) => {
            if (!Array.isArray(datasetNames) || datasetNames.length === 0) return;
            if (active) datasetNames.forEach((name) => state.activeDatasets.add(name));
            else datasetNames.forEach((name) => state.activeDatasets.delete(name));
            await loadVisibleDatasets();
            await processData();
            updateLayers();
            updateDashboard();
        },
        onDatasetDelete: async (name) => {
            if (!name) return;
            console.log(`🗑️ Deleting dataset: ${name}`);
            await deleteFromDB('layers', name);
            state.datasets = state.datasets.filter(d => d !== name);
            state.activeDatasets.delete(name);
            await saveToDB('datasets', state.datasets);
            localStorage.removeItem(`color-${name}`);
            localStorage.removeItem(`shape-${name}`);
            localStorage.removeItem(`size-${name}`);
            localStorage.removeItem(`category-${name}`);
            await loadVisibleDatasets();
            await processData();
            rerenderFilterPanel();
            updateDashboard();
            updateLayers();
        },
        onMeasureToggle: (active) => {
            state.isMeasureMode = active;
            if (!active) {
                state.measurePoints = [];
                state.lastMeasureSegment = null;
                state._lastMeasureSegmentAt = 0;
            }
            updateLayers();
        },
        onSearch: (term) => {
            const trimmed = String(term ?? '').trim();
            if (trimmed.length < 2) {
                if (state.searchPin) {
                    state.searchPin = null;
                    state.searchPinExpiresAt = 0;
                    updateLayers();
                }
                return;
            }

            const inRangeLat = (v) => Number.isFinite(v) && v >= -90 && v <= 90;
            const inRangeLng = (v) => Number.isFinite(v) && v >= -180 && v <= 180;
            const normalizeCoordPair = (a, b) => {
                if (inRangeLat(a) && inRangeLng(b)) return { lat: a, lng: b };
                if (inRangeLat(b) && inRangeLng(a)) return { lat: b, lng: a, swapped: true };
                return null;
            };

            // 1) Try parsing as coordinates: LAT/LONG, lat/long, LNG, lng, latitude/longitude, "16.35581 121.38789", "16.35581, 121.38789"
            const normalized = trimmed
                .replace(/\b(?:lat|lng|lon|long|latitude|longitude)\s*:?\s*/gi, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            const coordMatch = normalized.match(/(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)|(-?\d+\.?\d*)\s+(-?\d+\.?\d*)/);
            if (coordMatch) {
                const a = parseFloat(coordMatch[1] ?? coordMatch[3]);
                const b = parseFloat(coordMatch[2] ?? coordMatch[4]);
                const pair = normalizeCoordPair(a, b);
                if (pair) {
                    const lat = pair.lat;
                    const lng = pair.lng;
                    // Coordinate search should not tilt the map
                    currentViewState = {
                        ...currentViewState,
                        longitude: lng,
                        latitude: lat,
                        zoom: 15,
                        pitch: 0,
                        bearing: 0,
                        transitionDuration: 1000
                    };
                    deck.setProps({ initialViewState: currentViewState });
                    syncMirroredDeckViewState(currentViewState);
                    state.searchPin = { lat, lng, createdAt: Date.now() };
                    state.searchPinExpiresAt = Date.now() + 15000; // 15s temporary pin
                    updateLayers();
                    return;
                }

                // If it looked like coordinates but is invalid, don't mutate view state.
                if (typeof showToast === 'function') {
                    showToast('Invalid coordinates. Use "lat lng" (e.g. 13.705557 123.192514).', 'warning');
                }
                return;
            }
            // 2) Search by ID or name
            const termLower = trimmed.toLowerCase();
            const found = [...state.towers, ...state.mnoSites].find(s =>
                s.id.toLowerCase().includes(termLower) ||
                (s.name && s.name.toLowerCase().includes(termLower))
            );
            if (found) {
                // Site search should not tilt the map
                currentViewState = {
                    ...currentViewState,
                    longitude: found.lng,
                    latitude: found.lat,
                    zoom: 15,
                    pitch: 0,
                    bearing: 0,
                    transitionDuration: 1000
                };
                deck.setProps({ initialViewState: currentViewState });
                syncMirroredDeckViewState(currentViewState);
                state.selectedTower = found;
                state.highlightId = found.id;
                showPitchDeck(found);
                updateLayers();
            }
        },
        onFileUpload: async (file, source) => {
            if (!canUpload()) {
                showToast('Upload requires upload approval from the app owner.', 'warning');
                return;
            }
            try {
                const { headers, data } = await readHeadersAndData(file);
                const fileName = file.name || "Unknown Set";

                showColumnMapperModal({ headers, data, filename: fileName, fileSource: source }, async (processedSites) => {
                    const newSites = processedSites.map(s => ({ ...s, dataset_name: fileName, sourceType: source }));

                    if (newSites.length === 0) {
                        alert("No valid rows were imported. Please check your Lat/Long columns.");
                        return;
                    }

                    await saveToDB('layers', newSites, fileName);
                    if (!state.datasets.includes(fileName)) {
                        state.datasets.push(fileName);
                        await saveToDB('datasets', state.datasets);
                    }
                    // Store dataset category for the unified panel
                    localStorage.setItem(`category-${fileName}`, categoryFromSourceType(source));
                    state.activeDatasets.add(fileName);
                    await loadVisibleDatasets();
                    await processData();
                    updateLayers();
                    updateDashboard();
                    rerenderFilterPanel();
                    updateLayers();
                });
            } catch (err) {
                console.error("File upload failed:", err);
                alert("Could not parse file: " + err.message);
            }
        },
        onSyncOSM: () => {
            if (!canUpload()) {
                showToast('Sync requires upload approval from the app owner.', 'warning');
                return;
            }
            syncIntelligence('Road');
        },
        onSyncMNO: (sources) => {
            if (!canUpload()) {
                showToast('Sync requires upload approval from the app owner.', 'warning');
                return;
            }
            syncIntelligence('MNO', sources);
        },
        onExport: async (layerName = null) => {
            if (!canDownloadCsv()) {
                showToast('CSV export requires download approval from the app owner.', 'warning');
                return;
            }
            let data = [];
            let fileName = "TowerIntel_Export.csv";

            // Special case: export landbank candidates as CSV (ID, Region, Province, Pop, Best_Target, MNO distances/scores)
            if (layerName === '__LANDBANK__') {
                const minPop = typeof state.filters.landbankMinPopulation === 'number'
                    ? state.filters.landbankMinPopulation
                    : 2000;
                const urbanOnly = !!state.filters.landbankUrbanOnly;
                const candidates = (state.potentialLandbankAreas || []).filter(p => {
                    if (landbankPopulationForMinFilter(p) < minPop) return false;
                    return passesLandbankUrbanOnly(p, urbanOnly);
                });

                if (!candidates.length) {
                    showToast("No landbank candidates to export with current filters.", "warning");
                    return;
                }

                const scoringMNOs = state.mnoSites || [];
                const fakeTowers = candidates.map((p, idx) => {
                    const id = `Landbank${idx + 1}`;
                    const pop500 = p.population_500m ?? 0;
                    const pop1k = p.population_1km ?? p.population ?? 0;
                    const pop1_5k = p.population_1_5km ?? 0;
                    const tt = landbankTerrainFromCandidate(p);
                    return {
                        id,
                        name: `Landbank Candidate ${idx + 1}`,
                        lat: p.lat,
                        lng: p.lng,
                        population: { radius_500m: pop500, radius_1km: pop1k, radius_1_5km: pop1_5k, terrain_type: tt },
                        terrain_type: tt
                    };
                });
                const scoreResults = calculateScores(fakeTowers, scoringMNOs, null, [], state.settings);
                const scoreMap = new Map();
                for (let i = 0; i < scoreResults.length; i++) {
                    const r = scoreResults[i];
                    const c = candidates[i];

                    const missingThresholdM = ((typeof c?.searchRadiusKm === 'number' ? c.searchRadiusKm : 1) * 1000);

                    const missing = [];
                    for (const mno of MNOS) {
                        const entry = r.scores[mno];
                        const distM = entry?.factors?.nearestDistM ?? 0;
                        if (distM > missingThresholdM) missing.push(mno);
                    }
                    r.bestTarget = missing.length ? missing.join(' & ') : 'None';
                    scoreMap.set(r.towerId, r);
                }

                data = candidates.map((p, idx) => {
                    const id = `Landbank${idx + 1}`;
                    const { regionName, provinceCity } = getNearestMunicipality(p.lat, p.lng);
                    const { distKm } = getNearestAirport(p.lat, p.lng);
                    const pop500 = p.population_500m ?? 0;
                    const pop1k = p.population_1km ?? p.population ?? 0;
                    const pop1_5k = p.population_1_5km ?? 0;
                    return {
                        id,
                        name: `Landbank Candidate ${idx + 1}`,
                        lat: p.lat,
                        lng: p.lng,
                        region: regionName,
                        city: provinceCity,
                        population: { radius_500m: pop500, radius_1km: pop1k, radius_1_5km: pop1_5k },
                        terrain_type: landbankTerrainFromCandidate(p),
                        caap_dist_km: distKm
                    };
                });

                fileName = "TowerIntel_Landbank_Export.csv";
                exportToCSV(data, fileName, scoreMap);
                return;
            }

            if (layerName) {
                data = [...state.towers, ...state.mnoSites].filter(s => s.dataset_name === layerName);
                fileName = `${layerName.replace(/\s+/g, '_')}_Export.csv`;
            } else {
                data = [...state.towers, ...state.mnoSites];
            }

            if (data.length > 0) {
                showToast(`Exporting ${data.length} sites...`, "success");

                // 1. ENSURE POPULATION IS LOADED FOR EXPORT (don't export 0s if we can help it)
                const missingPop = data.filter(s => !s.population || s.population.radius_1km === 0);
                if (missingPop.length > 0) {
                    console.log(`📡 Enriching ${missingPop.length} sites with population for export...`);
                    const popResults = await Promise.all(missingPop.map(s => getPopulationAtRadii(s.lat, s.lng)));
                    missingPop.forEach((s, idx) => {
                        s.population = popResults[idx];
                        s.terrain_type = popResults[idx].terrain_type;
                    });
                }

                // 2. Recalculate scores with the fresh population data
                const scoringMNOs = state.mnoSites.filter(s => {
                    const cat = localStorage.getItem(`category-${s.dataset_name}`) || 'towers';
                    return cat === 'mno' && !s.sourceType?.startsWith('STRATEGIC_');
                });

                const freshScores = calculateScores(data, scoringMNOs, null, state.towers.filter(t => t.sourceType === 'MY_ASSETS'), state.settings);
                const freshScoreMap = new Map(freshScores.map(s => [s.towerId, s]));
                
                // 3. Sync state.scores so UI updates if export was first success
                freshScores.forEach(s => state.scores.set(s.towerId, s));
                updateDashboard();

                exportToCSV(data, fileName, freshScoreMap, state.filters.targetMNO);
            } else {
                showToast("No data to export.", "warning");
            }
        },
        onDeleteRaster: (key) => {
            if (state.rasters[key]) {
                delete state.rasters[key];
                showToast(`Raster layer removed.`, 'info');
                updateLayers();
                rerenderFilterPanel();
            }
        },
        onClearData: async () => {
            if (confirm("Clear all databases?")) { await clearDB(); localStorage.clear(); location.reload(); }
        },
        onKMLUpload: async (file) => {
            if (!canUpload()) {
                showToast('KML import requires upload approval from the app owner.', 'warning');
                return;
            }
            try {
                const text = await file.text();
                const kmlData = parseKML(text);
                state.searchRingsGeoJSON = kmlToGeoJSON(kmlData);
                await saveToDB('layers', state.searchRingsGeoJSON, '__searchRingsGeoJSON__');

                // Also add KML points as a tower layer for scoring/search
                if (kmlData.points.length > 0) {
                    const kmlSites = kmlData.points.map(p => ({
                        id: p.name,
                        name: p.name,
                        lat: p.lat,
                        lng: p.lng,
                        sourceType: 'SEARCH_RING',
                        dataset_name: file.name
                    }));
                    const fileName = file.name || 'Search Rings';
                    await saveToDB('layers', kmlSites, fileName);
                    if (!state.datasets.includes(fileName)) {
                        state.datasets.push(fileName);
                        await saveToDB('datasets', state.datasets);
                    }
                    // Store category as searchRings for unified panel
                    localStorage.setItem(`category-${fileName}`, 'searchRings');
                    state.activeDatasets.add(fileName);
                    await loadVisibleDatasets();
                    processDataSync();
                }

                updateLayers();
                updateDashboard();
                rerenderFilterPanel();
                updateLayers();
                console.log(`KML loaded: ${kmlData.polygons.length} polygons, ${kmlData.lines.length} lines, ${kmlData.points.length} points`);
            } catch (err) {
                console.error('KML upload failed:', err);
                alert('Failed to parse KML file. Please check the file format.');
            }
        }
    };
    state.filterOptions = filterOptions;
    state.filterOptions.layersState = null;
    state.filters = renderFilters(filterContainer, state.filterOptions);

    if (!map) initMap();
    else updateLayers();
    updateDashboard();
}

async function loadInitialData() {
    state.datasets = await loadFromDB('datasets') || [];

    const masterTowers = await loadFromDB('towers');
    const masterMNOs = await loadFromDB('mnoSites');

    if ((masterTowers?.length || masterMNOs?.length) && !state.datasets.includes('Own Assets')) {
        const ownAssets = (masterTowers || []).filter(t => t.sourceType === 'MY_ASSETS');
        if (ownAssets.length > 0) {
            await saveToDB('layers', ownAssets, 'Own Assets');
            state.datasets.push('Own Assets');
            await saveToDB('datasets', state.datasets);
            localStorage.setItem('category-Own Assets', 'towers');
            if (!localStorage.getItem('color-Own Assets')) {
                localStorage.setItem('color-Own Assets', '#00e5ff');
                localStorage.setItem('shape-Own Assets', 'star');
                localStorage.setItem('size-Own Assets', '40');
            }
        }
    }

    // Ensure all existing datasets have a category assigned (retroactive fix)
    for (const d of state.datasets) {
        if (!localStorage.getItem(`category-${d}`)) {
            // Try to infer category from the first record's sourceType
            const data = await loadFromDB('layers', d);
            if (data && data.length > 0) {
                const st = data[0].sourceType || 'MY_ASSETS';
                localStorage.setItem(`category-${d}`, categoryFromSourceType(st));
            } else {
                localStorage.setItem(`category-${d}`, 'towers');
            }
        } else if (d.startsWith('MNO_Sync_') || d.startsWith('MNO Sync') || d.startsWith('Road_Sync_')) {
            // Retroactive fix: move synced datasets to signalHeatmap
            const current = localStorage.getItem(`category-${d}`);
            if (current === 'towers' || current === 'mno' || current === 'strategy') {
                localStorage.setItem(`category-${d}`, 'signalHeatmap');
            }
        }
    }

    state.datasets.forEach(d => state.activeDatasets.add(d));
    await loadVisibleDatasets();

    // Restore KML search rings from DB so they show after refresh
    const savedSearchRings = await loadFromDB('layers', '__searchRingsGeoJSON__');
    if (savedSearchRings && savedSearchRings.features?.length) {
        state.searchRingsGeoJSON = savedSearchRings;
    }

    // FAST PATH: Run score pass WITHOUT population (uses cached terrain or defaults)
    // This allows the map to render immediately
    processDataSync();

    // BACKGROUND: Download population grid in background so it's ready for on-click lookups.
    // Fire-and-forget — does NOT block map rendering.
    preloadPopulationData().then(() => {
        const t = document.getElementById('loading-text');
        if (t) t.textContent = 'Population data ready ✔';
    }).catch(() => { });
}

async function loadVisibleDatasets() {
    let allTowers = [];
    let allMNOs = [];
    for (const name of state.activeDatasets) {
        let data = await loadFromDB('layers', name);
        if (data) {
            data.forEach(s => {
                const site = { ...s, dataset_name: name };

                // Handle MNO_ prefixed sourceTypes (e.g. MNO_Viettel → Viettel)
                if (!site.mno && site.sourceType && site.sourceType.startsWith('MNO_')) {
                    site.mno = site.sourceType.replace('MNO_', '');
                }
                if (!site.mno && site.sourceType === 'Competitor') site.mno = 'Competitor';

                if (site.mno) allMNOs.push(site);
                else allTowers.push(site);
            });
        }
    }
    state.towers = allTowers;
    state.mnoSites = allMNOs;
}

/** In-flight population grid build — concurrent callers await the same promise (avoids empty landbank race). */
let populationGridLoadPromise = null;

/**
 * Lazy-load population grid for map tint: WorldPop 1 km GeoTIFF (subsampled blocks) or synthetic fallback.
 * See `src/data/population.js` — not a 20 m BIL pipeline; radii use full raster via `getPopulationAtRadii`.
 */
async function loadPopulationGrid() {
    if (state.populationGrid.length > 0) return; // Already loaded
    if (populationGridLoadPromise) return populationGridLoadPromise;

    populationGridLoadPromise = (async () => {
    const loadingText = document.getElementById('loading-text');
    try {
        console.log('📡 Building Vietnam population grid…');
        if (loadingText) loadingText.textContent = 'Loading population data for Vietnam...';

        const { preloadPopulationData, getPopulationGridCells, getWorldBankPopulationMeta } = await import('./data/population.js');
        await preloadPopulationData();
        const meta = getWorldBankPopulationMeta();
        const raw = getPopulationGridCells();
        const srcLabel = meta.source === 'worldpop-1km' ? 'WorldPop 1 km' : 'World Bank + synthetic';
        // WorldPop cells are often fractional people per 1 km² pixel — rounding to int before density
        // removed almost every cell (0 pop, 0 density) so the map layer looked empty.
        const isWorldPop = meta.source === 'worldpop-1km';
        // WorldPop: single 1 km pixel = 1 km²; subsampled blocks use c.blockAreaKm2 from population.js
        const defaultWorldPopArea = 1.0;

        state.populationGrid = raw.map((c) => {
            const hash = ghEncode(c.lat, c.lng, 7);
            const popRaw = Math.max(0, Number(c.population) || 0);
            const pop = Math.round(popRaw);
            const areaKm2ForDensity = isWorldPop
                ? (typeof c.blockAreaKm2 === 'number' && c.blockAreaKm2 > 0 ? c.blockAreaKm2 : defaultWorldPopArea)
                : 4.0; // ~2° synthetic step ≈ 4 km²
            const densityPerKm2 = popRaw / areaKm2ForDensity;
            let density = Math.max(0, Math.round(densityPerKm2));
            if (popRaw > 1e-6 && density === 0) density = 1; // ensure visible tint for tiny counts

            return {
                lat: c.lat,
                lng: c.lng,
                population: pop,
                populationRaw: popRaw,
                density,
                hash,
                polygon: c.polygon || ghToPolygon(hash)
            };
        }).filter((c) => c.polygon && (c.populationRaw > 1e-6));

        if (state.populationGrid.length === 0) {
            console.warn(
                '[population] No hex cells to draw. If using WorldPop, ensure public/data/vn_ppp_2020_1km_Aggregated.tif exists and hard-refresh (Ctrl+Shift+R).'
            );
        }

        console.log(`✅ Population grid: ${state.populationGrid.length.toLocaleString()} cells (${srcLabel} · total ≈ ${meta.population?.toLocaleString?.() ?? meta.population}${meta.year ? ` · ${meta.year}` : ''})`);
        if (loadingText) loadingText.textContent = `${srcLabel}: ${meta.population?.toLocaleString?.() ?? '—'} · ${state.populationGrid.length.toLocaleString()} cells`;

        const attr = document.getElementById('population-attribution');
        if (attr) {
            const appHref =
                typeof window !== 'undefined' && window.location?.port === '5180'
                    ? 'http://localhost:5180/'
                    : typeof window !== 'undefined' && window.location?.origin
                      ? `${window.location.origin}/`
                      : 'http://localhost:5180/';
            if (meta.source === 'worldpop-1km') {
                attr.innerHTML = [
                    '<strong style="color:#94a3b8;">Population source</strong><br/>',
                    '<a href="https://www.worldpop.org/" target="_blank" rel="noopener noreferrer" style="color:#00e5ff;text-decoration:underline;">WorldPop</a>',
                    ' 1 km · 2020 (Vietnam). Licence: typically <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener" style="color:#94a3b8;">CC BY 4.0</a> — cite WorldPop in publications.<br/>',
                    `<span style="opacity:.85">This app: <a href="${appHref}" style="color:#64748b;">${appHref.replace(/\/$/, '')}</a></span>`
                ].join('');
            } else {
                attr.innerHTML =
                    '<strong style="color:#94a3b8;">Population source</strong><br/>Synthetic grid scaled to World Bank national total (add WorldPop TIF for gridded data).';
            }
        }

        processDataSync();
    } catch (err) {
        console.error('❌ Failed to build population grid:', err);
        if (loadingText) loadingText.textContent = 'Population data unavailable';
        const attr = document.getElementById('population-attribution');
        if (attr) attr.textContent = '';
    } finally {
        populationGridLoadPromise = null;
    }
    })();

    return populationGridLoadPromise;
}

async function syncIntelligence(type, selectedSources = ['opencellid']) {
    const loadingText = document.getElementById('loading-text');

    // Show sync progress in the UI
    const showProgress = (msg) => {
        if (loadingText) loadingText.textContent = msg;
        console.log(msg);
    };

    showProgress(`📡 Syncing ${type} intelligence...`);

    setTimeout(async () => {
        const view = deck.props.initialViewState;

        // Use wider viewport bounds — roughly the visible map area
        // At zoom ~10 the visible area is about ±0.3° lat/lng
        const latSpread = Math.max(0.05, 0.5 / Math.pow(2, (view.zoom || 10) - 10));
        const lngSpread = latSpread * 1.2; // Slightly wider for longitude
        const bounds = {
            north: view.latitude + latSpread,
            south: view.latitude - latSpread,
            east: view.longitude + lngSpread,
            west: view.longitude - lngSpread
        };

        const isLand = (lat, lng) => isPointInVietnamLand(lat, lng);

        let points = [];
        if (type === 'Road') {
            const center = { lat: view.latitude, lng: view.longitude };
            points = generateCrowdsourcedData(center, 800, {
                radius: 0.15,
                numClusters: 8,
                isLand
            });
        } else {
            // Use the real API keys if available
            const ocidKey = localStorage.getItem('opencellid-api-key') || 'dummy-key';
            const wigleName = localStorage.getItem('wigle-api-name') || '';
            const wigleToken = localStorage.getItem('wigle-api-token') || '';

            points = await syncMultipleSources(bounds, selectedSources, {
                opencellid: ocidKey,
                wigle: { apiName: wigleName, apiToken: wigleToken }
            }, {
                onProgress: showProgress
            }, {
                isLand
            });
        }

        if (points.length === 0) {
            showProgress('⚠️ No data returned from sync');
            return;
        }

        const sourceLabels = selectedSources.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('_');
        const folderName = `${sourceLabels}_Sync_${new Date().toLocaleTimeString().replace(/:/g, '-')}`;
        await saveToDB('layers', points, folderName);

        if (!state.datasets.includes(folderName)) {
            state.datasets.push(folderName);
            state.activeDatasets.add(folderName);
            await saveToDB('datasets', state.datasets);
        }

        // Ensure new syncs are categorized as signalHeatmap
        localStorage.setItem(`category-${folderName}`, 'signalHeatmap');

        await loadVisibleDatasets();
        await processData();
        updateLayers();
        rerenderFilterPanel();
        updateDashboard();
        updateLayers();
        showProgress(`✅ Synced ${points.length} cell towers`);
    }, 500);
}

/**
 * Lightweight data pass: CAAP distance + colocation scoring only.
 * No population lookups. Runs synchronously and finishes instantly.
 */
function processDataSync() {
    try {
        _processDataSyncImpl();
    } catch (err) {
        console.error('Sync error:', err);
        const div = document.createElement('div');
        div.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:red;color:white;padding:20px;font-size:14px;';
        div.textContent = 'Sync error. See console for details.';
        document.body.appendChild(div);
    }
}
function _processDataSyncImpl() {
    // LIGHTWEIGHT PASS: Just set defaults so towers can render immediately
    state.towers.forEach(t => {
        if (!t.terrain_type) t.terrain_type = 'Rural';
        if (!t.population) t.population = { radius_500m: 0, radius_1km: 0, radius_1_5km: 0, terrain_type: 'Rural' };
    });

    state.coverageGrid = [];

    // Render layers NOW with whatever data we have (no scoring yet)
    updateLayers();
    updateDashboard();
    console.log('🗺️ Initial render complete — deferring heavy computation...');

    // STAGE 1: Fast deferred work — CAAP distances + derived grids
    setTimeout(async () => {
        // Landbank needs populationGrid; GeoTIFF load can finish AFTER this timeout — wait for it first.
        try {
            await loadPopulationGrid();
        } catch (e) {
            console.warn('[landbank] loadPopulationGrid:', e?.message || e);
        }

        // 1. CAAP Airport distances for ALL sites (towers + MNO/heatmap) so pitch deck shows for every site
        const assignCaap = (t) => {
            const { name, distKm } = getNearestAirport(t.lat, t.lng);
            t.nearest_airport = name;
            t.caap_dist_km = distKm;
        };
        state.towers.forEach(assignCaap);
        state.mnoSites.forEach(assignCaap);
        console.log('✅ CAAP distances computed');

        // 2. Potential Landbank Areas (high pop, 2–3 MNO missing).
        try {
            await computePotentialLandbankAreas();
            console.log('✅ Potential Landbank Areas computed');
        } catch (err) {
            console.warn('⚠️ Potential Landbank Areas computation failed:', err);
        }

        // 3. Geohash grid (for Network Intel heatmap)
        try {
            rebuildGeohashGrid();
            console.log('✅ Geohash grid built');
        } catch (err) {
            console.warn('⚠️ Geohash grid failed, skipping Network Intel:', err);
        }

        // Render heatmap NOW — don't wait for scoring
        updateLayers();
        updateDashboard();

        // STAGE 2: Heavy colocation scoring
        setTimeout(() => {
            // First run enrichment so population values exist for scoring algorithm
            batchEnrichAllSites();

            const getCatForScoring = (name) => localStorage.getItem(`category-${name}`) || 'towers';
            const scoringMNOs = state.mnoSites.filter(s => {
                const isExplicitMNO = s.dataset_name && (
                    s.dataset_name.toLowerCase().includes('viettel') ||
                    s.dataset_name.toLowerCase().includes('vinaphone') ||
                    s.dataset_name.toLowerCase().includes('mobifone') ||
                    s.dataset_name.toLowerCase().includes('vietnamobile') ||
                    s.dataset_name.toLowerCase().includes('mno')
                );
                const cat = getCatForScoring(s.dataset_name);
                if (cat !== 'mno' && !isExplicitMNO) return false;
                if (s.sourceType && s.sourceType.startsWith('STRATEGIC_')) return false;
                return true;
            });
            console.log(`📊 Colocation: using ${scoringMNOs.length} MNO sites`);

            const scoreResults = calculateScores(state.towers, scoringMNOs, null, state.towers.filter(t => t.sourceType === 'MY_ASSETS'), state.settings);
            state.scores = new Map(scoreResults.map(s => [s.towerId, s]));
            console.log('✅ Colocation scoring complete');

            // Final re-render with full enrichment
            updateLayers();
            updateDashboard();
        }, 300);
    }, 200);
}

/**
 * Perform batch enrichment of ALL sites (towers + MNO sites) with 
 * population density and terrain context from the population grid (WorldPop / synthetic).
 */
function batchEnrichAllSites() {
    if (!state.populationGrid || state.populationGrid.length === 0) return;

    console.log('🌎 Batch enriching GeoContext for all sites (Accurate Haversine)...');

    // 1. Group population cells into Geohash-5 buckets (~4.9km x 4.9km cells)
    // This allows extremely fast spatial querying without having to iterate 668k cells.
    const popBuckets = new Map();
    state.populationGrid.forEach(c => {
        const h5 = c.hash.substring(0, 5); // Hashes from preprocessor are length 7
        if (!popBuckets.has(h5)) popBuckets.set(h5, []);
        popBuckets.get(h5).push(c);
    });

    const allSites = [...state.towers, ...state.mnoSites];
    let enrichedCount = 0;

    allSites.forEach(site => {
        // 2. Find the 9 surrounding Geohash-5 cells to get a ~15km x 15km bounding box
        const centerHash5 = ghEncode(site.lat, site.lng, 5);
        const allHashes5 = [centerHash5, ...ghNeighbors(centerHash5)];

        let pop100m = 0;
        let pop500m = 0;
        let pop1km = 0;
        let pop1_5km = 0;
        let sumDensityArea = 0;
        let densityCellsCount = 0;

        // 3. Perform exact Haversine buffering on the local subset of cells
        allHashes5.forEach(h5 => {
            const cells = popBuckets.get(h5);
            if (!cells) return;

            for (const c of cells) {
                // Calculate precise spherical distance in kilometers
                const distKm = haversineDistance(site.lat, site.lng, c.lat, c.lng);

                if (distKm <= 1.5) {
                    pop1_5km += (c.population || 0);
                    // For density, average over the 1.5km catchment
                    sumDensityArea += (c.density || 0);
                    densityCellsCount++;

                    if (distKm <= 1.0) {
                        pop1km += (c.population || 0);
                        if (distKm <= 0.5) {
                            pop500m += (c.population || 0);
                            if (distKm <= 0.1) {
                                pop100m += (c.population || 0);
                            }
                        }
                    }
                }
            }
        });

        const avgDensity = densityCellsCount > 0 ? (sumDensityArea / densityCellsCount) : 0;
        site.population_density = Math.round(avgDensity);

        site.population = {
            radius_100m: Math.round(pop100m),
            radius_500m: Math.round(pop500m),
            radius_1km: Math.round(pop1km),
            radius_1_5km: Math.round(pop1_5km),
            terrain_type: getTerrainFromPopulation(pop1km)
        };
        site.terrain_type = site.population.terrain_type;
        enrichedCount++;
    });

    console.log(`✅ Enrichment complete: ${enrichedCount} sites via population grid.`);

    // SECOND PASS: Use getPopulationAtRadii (full WorldPop raster or synthetic) when the
    // subsampled map grid missed population (e.g. sparse blocks or between cell centers).
    const zeroSites = allSites.filter(s => !s.population || s.population.radius_1km === 0);
    if (zeroSites.length > 0) {
        console.log(`🔄 Fallback: enriching ${zeroSites.length} zero-pop sites via getPopulationAtRadii (full raster)...`);

        // Process in async batches to avoid blocking the UI
        (async () => {
            const BATCH_SIZE = 100;
            for (let i = 0; i < zeroSites.length; i += BATCH_SIZE) {
                const batch = zeroSites.slice(i, i + BATCH_SIZE);
                const results = await Promise.all(
                    batch.map(s => getPopulationAtRadii(s.lat, s.lng))
                );
                batch.forEach((s, idx) => {
                    const pop = results[idx];
                    if (pop && pop.radius_1km > 0) {
                        s.population = pop;
                        s.terrain_type = pop.terrain_type;
                        
                        // Also update state.scores if it exists
                        if (state.scores.has(s.id)) {
                            state.scores.get(s.id).population = pop;
                        }
                    }
                });
                // Partial update for the UI as batches finish
                updateDashboard();
            }
            console.log(`✅ Fallback enrichment complete.`);
            const scoringMNOs = state.mnoSites.filter(s => {
                const isExplicitMNO = s.dataset_name && (
                    s.dataset_name.toLowerCase().includes('viettel') ||
                    s.dataset_name.toLowerCase().includes('vinaphone') ||
                    s.dataset_name.toLowerCase().includes('mobifone') ||
                    s.dataset_name.toLowerCase().includes('vietnamobile') ||
                    s.dataset_name.toLowerCase().includes('mno')
                );
                const cat = localStorage.getItem(`category-${s.dataset_name}`) || 'towers';
                return (cat === 'mno' || isExplicitMNO) && !(s.sourceType && s.sourceType.startsWith('STRATEGIC_'));
            });
            const scoreResults = calculateScores(state.towers, scoringMNOs, null, state.towers.filter(t => t.sourceType === 'MY_ASSETS'), state.settings);
            state.scores = new Map(scoreResults.map(s => [s.towerId, s]));
            updateDashboard();
            updateLayers();
        })();
    }
}

function getTerrainFromPopulation(pop1km) {
    return terrainFromPopulation(pop1km, state.settings);
}


// Legacy alias — still used by onDatasetToggle and file upload
async function processData() {
    processDataSync();
}

/** ~4.4 km grid cells; landbank search radius ≤1.5 km — neighbor buckets avoid O(samples × all MNO sites). */
const LANDBANK_BUCKET_DEG = 0.04;

function buildMnoSiteGridBuckets(sites) {
    const m = new Map();
    for (const s of sites) {
        if (typeof s.lat !== 'number' || typeof s.lng !== 'number' || !Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
        const k = `${Math.floor(s.lat / LANDBANK_BUCKET_DEG)}_${Math.floor(s.lng / LANDBANK_BUCKET_DEG)}`;
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(s);
    }
    return m;
}

function sitesInNeighborBuckets(lat, lng, buckets, ring = 2) {
    const bi = Math.floor(lat / LANDBANK_BUCKET_DEG);
    const bj = Math.floor(lng / LANDBANK_BUCKET_DEG);
    const out = [];
    for (let di = -ring; di <= ring; di++) {
        for (let dj = -ring; dj <= ring; dj++) {
            const arr = buckets.get(`${bi + di}_${bj + dj}`);
            if (arr) out.push(...arr);
        }
    }
    return out;
}

/**
 * MNO sites used for landbank "coverage" — align with Network Intel breadth
 * (mno uploads + towers categorized as mno / strategy / signalHeatmap).
 */
function collectMnoSitesForLandbankCoverage() {
    const getCat = (name) => localStorage.getItem(`category-${name}`) || 'towers';
    const mnoTowers = state.towers.filter((t) => {
        const cat = getCat(t.dataset_name);
        return cat === 'mno' || cat === 'strategy' || cat === 'signalHeatmap';
    });
    mnoTowers.forEach((t) => {
        if (!t.mno && t.sourceType && t.sourceType.startsWith('MNO_')) t.mno = t.sourceType.replace('MNO_', '');
        if (!t.mno && [...MNOS, 'Competitor'].includes(t.sourceType)) t.mno = t.sourceType;
        if (!t.mno && t.sourceType === 'STRATEGIC_Discovery' && !t.mno) t.mno = 'Viettel';
        if (!t.mno) t.mno = 'Unknown';
    });
    const merged = [...state.mnoSites, ...mnoTowers];
    return merged.filter((s) => MNOS.includes(normalizeMNO(s.mno || s.anchor || '')));
}

function defaultLandbankDistanceByTerrain(terrain) {
    if (terrain === 'Dense Urban') return 0.35;
    if (terrain === 'Urban') return 0.55;
    if (terrain === 'Suburban') return 0.75;
    if (terrain === 'Rural') return 1.50;
    return 1.0;
}

/** Read per-MNO distance threshold from settings; fallback to shared defaults. */
function getMnoDistanceThresholdKm(mno, terrain) {
    const fallback = defaultLandbankDistanceByTerrain(terrain);
    const row = state.settings?.scoring?.distanceThresholds?.[mno]?.[terrain];
    if (!row || typeof row !== 'object') return fallback;
    const raw = row.minKm ?? row.highKm ?? row.lowKm;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Minimum spacing between two suggested landbank pins (km), by terrain/settings. */
function landbankMinSeparationKm(terrain) {
    const vals = (MNOS || []).map((m) => getMnoDistanceThresholdKm(m, terrain)).filter((v) => Number.isFinite(v) && v > 0);
    return vals.length ? Math.max(...vals) : defaultLandbankDistanceByTerrain(terrain);
}

/** Keep strongest candidate and drop nearby duplicates from neighboring sampled cells. */
function dedupeLandbankCandidatesBySpacing(candidates) {
    if (!candidates?.length) return [];
    const sorted = [...candidates].sort((a, b) => (b.population || 0) - (a.population || 0));
    const kept = [];
    for (const c of sorted) {
        const sepC = landbankMinSeparationKm(c.terrain);
        const clash = kept.some((k) => {
            const need = Math.max(sepC, landbankMinSeparationKm(k.terrain));
            return haversineDistance(c.lat, c.lng, k.lat, k.lng) < need;
        });
        if (!clash) kept.push(c);
    }
    return kept;
}

/**
 * Compute Potential Landbank Areas (Strategic Targets):
 * - Determine geo-context terrain from 1km population thresholds.
 * - Use a terrain-specific MNO "coverage search radius" to decide which MNOs are missing.
 * - Store population metrics keyed by their respective radii so UI filtering uses "population per distance".
 *
 * Radius mapping default:
 * Dense Urban => 350m
 * Urban        => 550m
 * Suburban     => 750m
 * Rural        => 1500m
 * If MNO-specific thresholds are configured in settings, those are used per MNO.
 */
async function computePotentialLandbankAreas() {
    if (!state.populationGrid?.length || state.populationGrid.length === 0) {
        state.potentialLandbankAreas = [];
        return;
    }

    // National sample cap; MNO proximity uses spatial buckets (not a full scan of every site per sample).
    const MAX_POINTS = 18000;
    const results = [];
    const sampledCells = state.populationGrid;
    const step = Math.max(1, Math.floor(sampledCells.length / (MAX_POINTS / 2)));
    const strideOffsets = step >= 2 ? [0, Math.floor(step / 2)] : [0];

    const allMnoSites = collectMnoSitesForLandbankCoverage();
    const siteBuckets = buildMnoSiteGridBuckets(allMnoSites);
    await new Promise((r) => setTimeout(r, 0));

    let landbankIter = 0;

    // Closest available population buckets to the MNO search radius.
    const getPopulationForFilterByTerrain = (terrain, popInfo) => {
        if (terrain === 'Dense Urban') return popInfo.radius_500m || 0; // ~350m
        if (terrain === 'Urban') return popInfo.radius_500m || 0;        // 500m
        if (terrain === 'Suburban') return popInfo.radius_1km || 0;      // ~900m
        if (terrain === 'Rural') return popInfo.radius_1_5km || 0;      // 1.5km
        return popInfo.radius_1km || 0;
    };

    for (const offset of strideOffsets) {
        for (let i = offset; i < sampledCells.length; i += step) {
            landbankIter++;
            if (landbankIter % 120 === 0) await new Promise((r) => setTimeout(r, 0));

            const cell = sampledCells[i];
            const lat = cell.lat, lng = cell.lng;
            if (!isPointInVietnamLand(lat, lng)) continue;

            const popInfo = await getPopulationAtRadii(lat, lng);
            const pop1km = popInfo.radius_1km || 0;

            // Use 1km geo-context thresholds (Dense>=9000, Urban>=5000, Suburban>=3000).
            const terrain = terrainFromPopulation(pop1km, state.settings);
            const searchRadiusKmByMno = Object.fromEntries(
                (MNOS || []).map((m) => [m, getMnoDistanceThresholdKm(m, terrain)])
            );

            const hasMno = Object.fromEntries(MNOS.map((m) => [m, false]));
            for (const site of sitesInNeighborBuckets(lat, lng, siteBuckets, 2)) {
                const d = haversineDistance(lat, lng, site.lat, site.lng);
                const nm = normalizeMNO(site.mno || site.anchor || '');
                if (hasMno[nm] !== undefined) {
                    const th = searchRadiusKmByMno[nm] ?? defaultLandbankDistanceByTerrain(terrain);
                    if (d <= th) hasMno[nm] = true;
                }
            }

            const count = MNOS.filter((m) => hasMno[m]).length;
            const mnMissing = MNOS.length - count;

            if (mnMissing >= 2) {
                results.push({
                    lat,
                    lng,
                    mnMissing,
                    terrain,
                    searchRadiusKm: Math.max(...Object.values(searchRadiusKmByMno)),
                    searchRadiusM: Math.round(Math.max(...Object.values(searchRadiusKmByMno)) * 1000),
                    searchRadiusKmByMno,

                    // This is what the UI minPop filter uses: population "at the right distance"
                    population: getPopulationForFilterByTerrain(terrain, popInfo),

                    population_500m: popInfo.radius_500m || 0,
                    population_1km: pop1km,
                    population_1_5km: popInfo.radius_1_5km || 0
                });
            }
        }
    }

    const deduped = dedupeLandbankCandidatesBySpacing(results);
    state.potentialLandbankAreas = deduped;
    console.log(`✅ Potential Landbank Areas computed (terrain/settings): ${deduped.length}`);
}

// ── Network Intel helpers ─────────────────────────────────────────────
function rebuildGeohashGrid() {
    const ni = state.networkIntel;
    const getCat = (name) => localStorage.getItem(`category-${name}`) || 'towers';

    // Collect ALL MNO-related sites: both mnoSites AND towers categorised as 'mno', 'strategy', or 'signalHeatmap'
    const mnoTowers = state.towers.filter(t => {
        const cat = getCat(t.dataset_name);
        return cat === 'mno' || cat === 'strategy' || cat === 'signalHeatmap';
    });
    // Derive mno field for towers that have MNO_* sourceType but no mno field
    mnoTowers.forEach(t => {
        if (!t.mno && t.sourceType && t.sourceType.startsWith('MNO_')) t.mno = t.sourceType.replace('MNO_', '');
        if (!t.mno && [...MNOS, 'Competitor'].includes(t.sourceType)) t.mno = t.sourceType;
        if (!t.mno && t.sourceType === 'STRATEGIC_Discovery' && !t.mno) t.mno = 'Viettel';
        if (!t.mno) t.mno = 'Unknown';
    });
    const allMNOData = [...state.mnoSites, ...mnoTowers];

    state.geohashGrid = buildGeohashGrid(allMNOData, state.towers, {
        precision: ni.precision,
        filterMNO: ni.comparing ? ni.left.mno : 'All',
        quarter: ni.comparing ? ni.left.quarter : 'All'
    });
    if (ni.comparing) {
        state.geohashGridRight = buildGeohashGrid(allMNOData, state.towers, {
            precision: ni.precision,
            filterMNO: ni.right.mno,
            quarter: ni.right.quarter
        });
    } else {
        state.geohashGridRight = [];
    }

    // ── Enrich cells with population density ─────────────────────────
    if (state.populationGrid.length > 0) {
        enrichWithPopulation(state.geohashGrid, ni.precision, ni.metric === 'population');
        if (ni.comparing && state.geohashGridRight.length > 0) {
            enrichWithPopulation(state.geohashGridRight, ni.precision, ni.metric === 'population');
        }
    }

    const polyRing = state.polygonCompare?.ring;
    if (polyRing && polyRing.length >= 4) {
        state.geohashGrid = filterGeohashCellsByPolygon(state.geohashGrid, polyRing);
        if (state.geohashGridRight.length > 0) {
            state.geohashGridRight = filterGeohashCellsByPolygon(state.geohashGridRight, polyRing);
        }
    }

    refreshIntelPanel();
}

/**
 * Enrich geohash grid cells with population density from the WorldPop / synthetic population grid.
 * When addPopOnlyCells is true, also adds cells for populated areas with no MNO coverage.
 */
function enrichWithPopulation(grid, gridPrecision, addPopOnlyCells = false) {
    if (!state.populationGrid || state.populationGrid.length === 0) return;

    // Build population lookup: geohash → { totalDensity, count }
    const popLookup = new Map();
    for (const c of state.populationGrid) {
        const hash = ghEncode(c.lat, c.lng, gridPrecision);
        if (!popLookup.has(hash)) popLookup.set(hash, { sumDensity: 0, count: 0, sumPop: 0 });
        const b = popLookup.get(hash);
        b.sumDensity += (c.density || 0);
        b.sumPop += (c.population || 0);
        b.count++;
    }

    // Enrich existing cells
    const existingHashes = new Set();
    for (const cell of grid) {
        existingHashes.add(cell.hash);
        const pop = popLookup.get(cell.hash);
        if (pop) {
            cell.populationDensity = Math.round(pop.sumDensity / pop.count);
            cell.populationCount = pop.sumPop;
        } else {
            cell.populationDensity = 0;
            cell.populationCount = 0;
        }
    }

    // Add population-only cells (underserved areas) when population metric is active
    if (addPopOnlyCells) {
        let added = 0;
        for (const [hash, pop] of popLookup) {
            if (existingHashes.has(hash)) continue;
            const avgDensity = Math.round(pop.sumDensity / pop.count);
            if (avgDensity < 50) continue; // Skip very sparse areas

            const center = ghDecode(hash);
            const polygon = ghToPolygon(hash);
            grid.push({
                hash,
                polygon,
                center,
                siteCount: 0,
                ownSupply: 0,
                avgRSRP: -130,
                avgRSRQ: -20,
                avgCongestion: 0,
                supply: 0,
                demand: 0,
                dominantMNO: 'None',
                dominantShare: 0,
                marketShare: {},
                mnoBreakdown: {},
                populationDensity: avgDensity,
                populationCount: pop.sumPop
            });
            added++;
        }
        if (added > 0) console.log(`👥 Added ${added.toLocaleString()} population-only cells (underserved areas)`);
    }
}

function applyNetworkIntelMetricChange(m) {
    const ni = state.networkIntel;
    const wasPopulation = ni.metric === 'population';
    ni.metric = m;
    if (m === 'population' || wasPopulation) {
        if (m === 'population' && state.populationGrid.length === 0) {
            loadPopulationGrid().then(() => {
                rebuildGeohashGrid();
                updateLayers();
                refreshIntelPanel();
            });
            return;
        }
        rebuildGeohashGrid();
    }
    updateLayers();
    refreshIntelPanel();
}

function refreshIntelPanel() {
    const panel = document.getElementById('network-intel-panel');
    if (!panel) return;
    const ni = state.networkIntel;
    if (ni.comparing) {
        panel.classList.remove('open');
        panel.innerHTML = '';
        panel.style.display = 'none';
        if (comparisonSlider?.syncIntelFromState) comparisonSlider.syncIntelFromState(ni);
        return;
    }
    panel.style.display = '';
    const summary = computeSummary(state.geohashGrid);
    renderNetworkIntelPanel(panel, {
        metric: ni.metric,
        precision: ni.precision,
        summary,
        comparing: ni.comparing,
        onMetricChange: (m) => {
            applyNetworkIntelMetricChange(m);
        },
        onPrecisionChange: (p) => {
            ni.precision = p;
            rebuildGeohashGrid();
            updateLayers();
            refreshIntelPanel();
        },
        onMNOFilterChange: (mnos) => {
            ni.mnoFilter = mnos;
            rebuildGeohashGrid();
            updateLayers();
            refreshIntelPanel();
        },
        onCompareToggle: (active) => {
            ni.comparing = active;
            if (active) {
                showComparisonSlider();
                // Sync ni.left/right with the current slider dropdown values
                if (comparisonSlider) {
                    const sel = comparisonSlider.getSelections();
                    ni.left = sel.left;
                    ni.right = sel.right;
                }
                rebuildGeohashGrid();
                updateLayers();
                refreshIntelPanel();
            } else {
                hideComparisonSlider();
                refreshIntelPanel();
            }
        },
        onClose: () => {
            const niPanel = document.getElementById('network-intel-panel');
            if (niPanel) niPanel.classList.remove('open');
            // Uncheck the filter toggle
            const cb = document.querySelector('#layer-network-intel');
            if (cb) cb.checked = false;
            state.filters.layers.networkIntel = false;
            hideComparisonSlider();
            ni.comparing = false;
            clearPolygonCompareArea();
            updateLayers();
        },
        onClearSelection: () => { state.highlightId = null; refreshIntelPanel(); updateLayers(); },
        selectedCell: state.highlightId ?
            (state.geohashGrid.find(c => c.hash === state.highlightId) ||
                state.geohashGridRight.find(c => c.hash === state.highlightId)) : null
    });
}

function showComparisonSlider() {
    const ni = state.networkIntel;
    const sliderOptions = {
        mnos: [...MNOS],
        quarters: getAvailableQuarters(state.mnoSites),
        metric: ni.metric,
        precision: ni.precision,
        mnoFilter: ni.mnoFilter,
        onPositionChange: (x) => {
            ni.sliderPos = x;
            updateLayers();
            resizeCompareBasemaps();
            syncCompareDeckLayoutFromDom();
            syncCompareBasemaps();
        },
        onLeftChange: (sel) => {
            ni.left = sel;
            const pc = state.polygonCompare;
            if (pc.ring?.length) {
                pc.mnoA = sel.mno;
                if (pc.panelOpen) refreshPolygonComparePanel();
            }
            rebuildGeohashGrid();
            updateLayers();
        },
        onRightChange: (sel) => {
            ni.right = sel;
            const pc = state.polygonCompare;
            if (pc.ring?.length) {
                pc.mnoB = sel.mno;
                if (pc.panelOpen) refreshPolygonComparePanel();
            }
            rebuildGeohashGrid();
            updateLayers();
        },
        onMetricChange: (m) => {
            applyNetworkIntelMetricChange(m);
        },
        onPrecisionChange: (p) => {
            ni.precision = p;
            rebuildGeohashGrid();
            updateLayers();
            refreshIntelPanel();
        },
        onMNOFilterChange: (mnos) => {
            ni.mnoFilter = mnos;
            rebuildGeohashGrid();
            updateLayers();
            refreshIntelPanel();
        },
        onClose: () => {
            destroyMapRight();
            ni.comparing = false;
            clearPolygonAreaSummary(document.getElementById('polygon-area-summary'));
            rebuildGeohashGrid();
            resyncMapToDeckAfterCompare();
            refreshIntelPanel();
        }
    };

    if (comparisonSlider) {
        comparisonSlider.show();
        if (comparisonSlider.syncIntelFromState) comparisonSlider.syncIntelFromState(ni);
        if (comparisonSlider.updateQuarters) comparisonSlider.updateQuarters(getAvailableQuarters(state.mnoSites));
        ensureMapRight();
        syncCompareDeckLayoutFromDom();
        syncCompareBasemaps();
        scheduleMirrorDeckResync();
        refreshPolygonAreaSummary();
        return;
    }
    const container = document.querySelector('.map-container');
    if (!container) return;
    comparisonSlider = createComparisonSlider(container, sliderOptions);
    comparisonSlider.show();
    ensureMapRight();
    syncCompareDeckLayoutFromDom();
    syncCompareBasemaps();
    scheduleMirrorDeckResync();
    refreshPolygonAreaSummary();
}

function hideComparisonSlider() {
    if (comparisonSlider) comparisonSlider.hide();
    destroyMapRight();
    clearPolygonAreaSummary(document.getElementById('polygon-area-summary'));
    resyncMapToDeckAfterCompare();
    if (state.filters.layers.networkIntel) refreshIntelPanel();
}

/** Same MNO-site union as rebuildGeohashGrid (for polygon KPI stats). */
function getAllMnoSitesForPolygonStats() {
    const getCat = (name) => localStorage.getItem(`category-${name}`) || 'towers';
    const mnoTowers = state.towers.filter(t => {
        const cat = getCat(t.dataset_name);
        return cat === 'mno' || cat === 'strategy' || cat === 'signalHeatmap';
    });
    mnoTowers.forEach(t => {
        if (!t.mno && t.sourceType && t.sourceType.startsWith('MNO_')) t.mno = t.sourceType.replace('MNO_', '');
        if (!t.mno && [...MNOS, 'Competitor'].includes(t.sourceType)) t.mno = t.sourceType;
        if (!t.mno && t.sourceType === 'STRATEGIC_Discovery' && !t.mno) t.mno = 'Viettel';
        if (!t.mno) t.mno = 'Unknown';
    });
    return [...state.mnoSites, ...mnoTowers];
}

function lngLatFromDeckPickInfo(info) {
    let lng;
    let lat;
    // Ground click on empty map: Deck provides WGS84 directly (avoids pixel↔mercator bugs).
    if (info && !info.object && info.coordinate && Array.isArray(info.coordinate) && info.coordinate.length >= 2) {
        lng = Number(info.coordinate[0]);
        lat = Number(info.coordinate[1]);
        if (Number.isFinite(lng) && Number.isFinite(lat)) return { lng, lat };
    }
    const px = info.x ?? info.position?.[0];
    const py = info.y ?? info.position?.[1];
    if (typeof px === 'number' && typeof py === 'number' && deck && currentViewState) {
        const viewports = deck.getViewports ? deck.getViewports() : [];
        const vp = viewports[0];
        if (vp && vp.unproject) {
            const unprojected = vp.unproject([px, py]);
            lng = unprojected[0];
            lat = unprojected[1];
        }
        if ((typeof lng !== 'number' || typeof lat !== 'number' || !Number.isFinite(lng) || !Number.isFinite(lat)) && currentViewState) {
            const canvas = document.getElementById('map-canvas');
            // MUST use CSS layout size — canvas.width/height are backing-store pixels (DPR) and break unproject vs Deck.
            const w = canvas?.clientWidth || 800;
            const h = canvas?.clientHeight || 600;
            const viewport = new WebMercatorViewport({
                width: w, height: h,
                longitude: currentViewState.longitude,
                latitude: currentViewState.latitude,
                zoom: currentViewState.zoom,
                pitch: currentViewState.pitch ?? 0,
                bearing: currentViewState.bearing ?? 0
            });
            const [u, v] = viewport.unproject([px, py]);
            lng = u;
            lat = v;
        }
    }
    if ((typeof lng !== 'number' || typeof lat !== 'number' || !Number.isFinite(lng) || !Number.isFinite(lat)) &&
        info?.coordinate && Array.isArray(info.coordinate) && info.coordinate.length >= 2) {
        lng = Number(info.coordinate[0]);
        lat = Number(info.coordinate[1]);
    }
    return { lng, lat };
}

function removePolygonDrawToolbar() {
    document.getElementById('polygon-draw-toolbar')?.remove();
}

function updatePolygonDrawToolbarState() {
    const bar = document.getElementById('polygon-draw-toolbar');
    if (!bar) return;
    const n = state.polygonCompare.vertices.length;
    const cnt = bar.querySelector('#pcc-draw-count');
    if (cnt) cnt.textContent = `${n} point${n === 1 ? '' : 's'}`;
}

function showPolygonDrawToolbar() {
    removePolygonDrawToolbar();
    const container = document.querySelector('.map-container');
    if (!container) return;
    const bar = document.createElement('div');
    bar.id = 'polygon-draw-toolbar';
    bar.style.cssText = 'position:absolute;left:50%;bottom:110px;transform:translateX(-50%);z-index:220;display:flex;flex-direction:column;gap:8px;align-items:center;padding:10px 14px;background:rgba(15,23,42,0.98);border:1px solid rgba(0,229,255,0.35);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.4);pointer-events:auto;';
    bar.innerHTML = `
        <div style="font-size:10px;color:#64748b;text-align:center;max-width:300px;line-height:1.35;">Double-click the <strong style="color:#94a3b8">map</strong> or press <strong style="color:#94a3b8">Enter</strong> to finish (≥3 points). Cyan line shows the closing edge.</div>
        <div style="display:flex;gap:10px;align-items:center;">
        <span id="pcc-draw-count" style="font-size:12px;color:#94a3b8;">0 points</span>
        <button type="button" id="pcc-draw-cancel" style="font-size:12px;padding:6px 12px;border-radius:8px;border:1px solid #64748b;background:transparent;color:#e2e8f0;cursor:pointer;">Cancel</button>
        </div>
    `;
    container.appendChild(bar);
    // Block pointer events from reaching the Deck canvas (prevents accidental vertices when using Cancel / toolbar)
    bar.addEventListener('mousedown', (e) => e.stopPropagation());
    bar.addEventListener('click', (e) => e.stopPropagation());
    bar.querySelector('#pcc-draw-cancel')?.addEventListener('click', (e) => {
        e.preventDefault();
        cancelPolygonCompareDraw();
    });
    updatePolygonDrawToolbarState();
}

function cancelPolygonCompareDraw() {
    state.polygonCompare.drawMode = false;
    state.polygonCompare.vertices = [];
    removePolygonDrawToolbar();
    document.getElementById('map-compare-area-btn')?.classList.toggle('active', !!state.polygonCompare.ring);
    const canvas = document.getElementById('map-canvas');
    if (canvas && !state.isMeasureMode) canvas.style.cursor = 'grab';
    updateLayers();
}

function clearPolygonCompareArea() {
    const pc = state.polygonCompare;
    pc.ring = null;
    pc.vertices = [];
    pc.drawMode = false;
    pc.panelOpen = false;
    pc.ratFilter = 'all';
    removePolygonDrawToolbar();
    removePolygonComparePanel(document.getElementById('polygon-compare-root'));
    document.getElementById('map-compare-area-btn')?.classList.remove('active');
    clearPolygonAreaSummary(document.getElementById('polygon-area-summary'));
    rebuildGeohashGrid();
    updateLayers();
}

function refreshPolygonComparePanel() {
    const root = document.getElementById('polygon-compare-root');
    if (!root) return;
    const pc = state.polygonCompare;
    if (!pc.ring?.length || !pc.panelOpen) {
        if (!pc.panelOpen) removePolygonComparePanel(root);
        return;
    }
    const sites = collectSitesInPolygon(getAllMnoSitesForPolygonStats(), pc.ring);
    const ratOpt = { ratFilter: pc.ratFilter || 'all' };
    const statsA = aggregateMnoKpisInPolygon(sites, pc.mnoA, ratOpt);
    const statsB = aggregateMnoKpisInPolygon(sites, pc.mnoB, ratOpt);
    renderPolygonComparePanel(root, {
        mnoA: pc.mnoA,
        mnoB: pc.mnoB,
        statsA,
        statsB,
        ratFilter: pc.ratFilter || 'all',
        onRatFilterChange: (v) => {
            pc.ratFilter = v;
            refreshPolygonComparePanel();
        },
        onMnoAChange: (m) => {
            pc.mnoA = m;
            state.networkIntel.left.mno = m;
            if (comparisonSlider?.setMNOSelections) comparisonSlider.setMNOSelections(pc.mnoA, pc.mnoB);
            else rebuildGeohashGrid();
            refreshPolygonComparePanel();
        },
        onMnoBChange: (m) => {
            pc.mnoB = m;
            state.networkIntel.right.mno = m;
            if (comparisonSlider?.setMNOSelections) comparisonSlider.setMNOSelections(pc.mnoA, pc.mnoB);
            else rebuildGeohashGrid();
            refreshPolygonComparePanel();
        },
        onClearPolygon: () => clearPolygonCompareArea(),
        onClose: () => {
            pc.panelOpen = false;
            removePolygonComparePanel(root);
        }
    });
    refreshPolygonAreaSummary();
}

function finishPolygonCompareDraw() {
    const pc = state.polygonCompare;
    if (!pc.vertices || pc.vertices.length < 3) {
        showToast('Need at least 3 points for a polygon.', 'warning');
        return;
    }
    const cleaned = dedupePolygonVertices(pc.vertices);
    if (cleaned.length < 3) {
        showToast('Need at least 3 distinct corners — avoid double-clicks on the same spot.', 'warning');
        return;
    }
    const ring = closeCompareRing(cleaned);
    if (!ring) {
        showToast('Could not close polygon.', 'warning');
        return;
    }
    pc.ring = ring;
    pc.drawMode = false;
    pc.vertices = [];
    removePolygonDrawToolbar();

    const ni = state.networkIntel;
    ni.left = { ...ni.left, mno: pc.mnoA };
    ni.right = { ...ni.right, mno: pc.mnoB };
    ni.comparing = true;
    state.filters.layers.networkIntel = true;
    const niCb = document.querySelector('#layer-network-intel');
    if (niCb) niCb.checked = true;

    showComparisonSlider();
    if (comparisonSlider?.setMNOSelections) comparisonSlider.setMNOSelections(pc.mnoA, pc.mnoB);
    else rebuildGeohashGrid();

    updateLayers();
    refreshIntelPanel();
    scheduleMirrorDeckResync();

    pc.panelOpen = true;
    refreshPolygonComparePanel();
    document.getElementById('map-compare-area-btn')?.classList.add('active');
    const canvas = document.getElementById('map-canvas');
    if (canvas && !state.isMeasureMode) canvas.style.cursor = 'grab';
    showToast('Compare area set — split map + KPI dock. Drag the handle to swipe.', 'success');
}

function startPolygonCompareDraw() {
    if (state.isMeasureMode) {
        state.isMeasureMode = false;
        state.measurePoints = [];
        state.lastMeasureSegment = null;
        state._lastMeasureSegmentAt = 0;
        const mapMeasureBtn = document.getElementById('map-measure-btn');
        if (mapMeasureBtn) {
            mapMeasureBtn.classList.remove('active');
            mapMeasureBtn.textContent = '📐 Measure';
        }
    }
    if (state.isPegmanMode) {
        state.isPegmanMode = false;
        setPegmanStreetHighlight(false);
        const streetViewBtn = document.getElementById('street-view-btn');
        if (streetViewBtn) {
            streetViewBtn.classList.remove('active');
            streetViewBtn.textContent = '🚶 Pegman';
        }
        document.getElementById('map-canvas').style.cursor = 'crosshair';
    }
    const pc = state.polygonCompare;
    const hadRing = !!pc.ring;
    pc.drawMode = true;
    pc.vertices = [];
    pc.ring = null;
    pc.panelOpen = false;
    removePolygonComparePanel(document.getElementById('polygon-compare-root'));
    if (hadRing) rebuildGeohashGrid();
    showPolygonDrawToolbar();
    showToast('Click corners on the map — cyan line shows the close. Double-click map or Enter to finish.', 'info');
    document.getElementById('map-compare-area-btn')?.classList.add('active');
    const canvas = document.getElementById('map-canvas');
    if (canvas) canvas.style.cursor = 'crosshair';
    updateLayers();
}

/** Right-click editor: only real persisted tower/MNO markers, not landbank / geohash / etc. */
function isPersistedSitePickForEditor(obj, layer) {
    if (!obj || typeof obj.lat !== 'number' || typeof obj.lng !== 'number') return false;
    if (obj.id == null || obj.id === '') return false;
    const lid = layer?.id || '';
    if (lid.startsWith('potential-landbank')) return false;
    if (lid.startsWith('geohash')) return false;
    if (obj.sourceType === 'STRATEGIC_Landbank') return false;
    if (String(obj.id).startsWith('LB-') && (obj.dataset_name === 'Landbank' || obj.name === 'Landbank Candidate')) return false;
    return true;
}

function resolveLngLatFromMapEvent(e, deckInstance, vs) {
    const canvas = document.getElementById('map-canvas');
    if (!canvas || !deckInstance || !vs) return null;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const viewports = deckInstance.getViewports ? deckInstance.getViewports() : [];
    const vp = viewports[0];
    let lng;
    let lat;
    if (vp && vp.unproject) {
        const u = vp.unproject([px, py]);
        lng = u[0];
        lat = u[1];
    }
    if (typeof lng !== 'number' || typeof lat !== 'number') {
        const w = canvas.clientWidth || 800;
        const h = canvas.clientHeight || 600;
        const viewport = new WebMercatorViewport({
            width: w,
            height: h,
            longitude: vs.longitude,
            latitude: vs.latitude,
            zoom: vs.zoom,
            pitch: vs.pitch ?? 0,
            bearing: vs.bearing ?? 0
        });
        const [u, v] = viewport.unproject([px, py]);
        lng = u;
        lat = v;
    }
    if (typeof lng === 'number' && typeof lat === 'number' && Number.isFinite(lng) && Number.isFinite(lat)) {
        return { lng, lat };
    }
    return null;
}

async function appendSiteToLayer(folderName, site, category, mnoForStyle = null) {
    let data = await loadFromDB('layers', folderName);
    if (!Array.isArray(data)) data = [];
    data.push(site);
    await saveToDB('layers', data, folderName);
    if (!state.datasets.includes(folderName)) {
        state.datasets.push(folderName);
        await saveToDB('datasets', state.datasets);
    }
    localStorage.setItem(`category-${folderName}`, category);
    if (category === 'mno' && mnoForStyle && !localStorage.getItem(`color-${folderName}`)) {
        const hex = { Viettel: '#00e5ff', Vinaphone: '#00c853', Mobifone: '#ff9100', Vietnamobile: '#ab47bc' }[mnoForStyle] || '#00e5ff';
        localStorage.setItem(`color-${folderName}`, hex);
        localStorage.setItem(`shape-${folderName}`, 'circle');
        localStorage.setItem(`size-${folderName}`, '22');
    }
    if (category === 'towers' && folderName === 'Own Assets' && !localStorage.getItem(`color-${folderName}`)) {
        localStorage.setItem(`color-${folderName}`, '#00e5ff');
        localStorage.setItem(`shape-${folderName}`, 'star');
        localStorage.setItem(`size-${folderName}`, '40');
    }
    state.activeDatasets.add(folderName);
    await loadVisibleDatasets();
    await processData();
    updateLayers();
    updateDashboard();
    rerenderFilterPanel();
}

async function persistUserPinnedSite(lat, lng, name, target) {
    const baseId = `PIN-${Date.now()}`;
    const siteName = (name && name.trim()) || (target === 'MY_ASSETS' ? `Site ${baseId}` : `${target} ${baseId}`);
    try {
        if (target === 'MY_ASSETS') {
            const site = {
                id: baseId,
                name: siteName,
                lat,
                lng,
                sourceType: 'MY_ASSETS',
                dataset_name: 'Own Assets',
                height_m: 30,
                structural_status: 'Planned'
            };
            await appendSiteToLayer('Own Assets', site, 'towers');
        } else {
            const mno = target;
            const folder = `Pinned — ${mno}`;
            const site = {
                id: baseId,
                name: siteName,
                lat,
                lng,
                mno,
                sourceType: `MNO_${mno}`,
                dataset_name: folder,
                height_m: 30,
                structural_status: 'Active'
            };
            await appendSiteToLayer(folder, site, 'mno', mno);
        }
        state.searchPin = null;
        state.searchPinExpiresAt = 0;
        showToast(`Saved: ${siteName}`, 'success');
    } catch (err) {
        console.error('persistUserPinnedSite', err);
        showToast('Could not save location', 'warning');
    }
}

function initMap() {
    const INITIAL_VIEW_STATE = { ...INITIAL_MAP_VIEW };
    map = new maplibregl.Map({
        container: 'map',
        style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
        interactive: true,
        center: [INITIAL_VIEW_STATE.longitude, INITIAL_VIEW_STATE.latitude],
        zoom: INITIAL_VIEW_STATE.zoom
    });

    // Add Navigation Control (Compass / North)
    map.addControl(new maplibregl.NavigationControl(), 'top-right');


    map.on('load', () => {
        attachAuxiliaryBasemapLayers(map);
    });

    // --- 3D MODE TOGGLE ---
    let is3DMode = false;
    const toggle3DBtn = document.getElementById('toggle-3d');
    const terrainControls = document.getElementById('terrain-controls');
    const terrainExagSlider = document.getElementById('terrain-exag');
    const exagValLabel = document.getElementById('exag-val');
    const streetViewBtn = document.getElementById('street-view-btn');

    if (toggle3DBtn) {
        toggle3DBtn.addEventListener('click', () => {
            is3DMode = !is3DMode;
            toggle3DBtn.classList.toggle('active', is3DMode);
            toggle3DBtn.textContent = is3DMode ? '🗺️ 2D' : '🌍 3D';

            // Show/hide terrain controls
            if (terrainControls) terrainControls.style.display = is3DMode ? 'flex' : 'none';

            if (is3DMode) {
                const exag = terrainExagSlider ? parseFloat(terrainExagSlider.value) : 1.5;
                map.setTerrain({ source: 'terrain-source', exaggeration: exag });
                if (map.getLayer('google-satellite-layer')) {
                    map.setLayoutProperty('google-satellite-layer', 'visibility', 'visible');
                }
                if (map.getLayer('sky-layer')) {
                    map.setLayoutProperty('sky-layer', 'visibility', 'visible');
                }
                // Do not force tilt/bearing; user can tilt manually (Shift + arrows / drag)
            } else {
                map.setTerrain(null);
                if (map.getLayer('google-satellite-layer')) {
                    map.setLayoutProperty('google-satellite-layer', 'visibility', 'none');
                }
                if (map.getLayer('sky-layer')) {
                    map.setLayoutProperty('sky-layer', 'visibility', 'none');
                }
                // Keep whatever view the user is in; don't force reset
            }
            if (state.networkIntel.comparing) {
                syncAuxiliaryLayersFromMainToRight();
                syncCompareBasemaps();
            }
        });
    }

    // Terrain Exaggeration Slider
    if (terrainExagSlider) {
        terrainExagSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            if (exagValLabel) exagValLabel.textContent = `${val}x`;
            if (is3DMode) {
                map.setTerrain({ source: 'terrain-source', exaggeration: val });
                if (state.networkIntel.comparing && mapRight && mapRight.loaded()) {
                    mapRight.setTerrain({ source: 'terrain-source', exaggeration: val });
                }
            }
        });
    }

    // Street View (Pegman) Button
    if (streetViewBtn) {
        streetViewBtn.addEventListener('click', () => {
            state.isPegmanMode = !state.isPegmanMode;
            if (state.isPegmanMode) {
                setPegmanStreetHighlight(true);
                streetViewBtn.classList.add('active');
                streetViewBtn.textContent = '📍 Click on map...';
                document.getElementById('map-canvas').style.cursor = 'crosshair';
            } else {
                setPegmanStreetHighlight(false);
                streetViewBtn.classList.remove('active');
                streetViewBtn.textContent = '🚶 Pegman';
                document.getElementById('map-canvas').style.cursor = 'grab';
            }
        });
    }

    // Street View Container Close Button
    const svContainer = document.getElementById('sv-container');
    const closeSvBtn = document.getElementById('close-sv');
    const svIframe = document.getElementById('sv-iframe');
    if (closeSvBtn) {
        closeSvBtn.addEventListener('click', () => {
            svContainer.style.display = 'none';
            svIframe.src = ''; // Stop loading
        });
    }

    // Map Measure button (between zoom and pegman): toggle measure mode, sync with state
    const mapMeasureBtn = document.getElementById('map-measure-btn');
    if (mapMeasureBtn) {
        mapMeasureBtn.addEventListener('click', () => {
            if (state.polygonCompare.drawMode) cancelPolygonCompareDraw();
            state.isMeasureMode = !state.isMeasureMode;
            if (!state.isMeasureMode) {
                state.measurePoints = [];
                state.lastMeasureSegment = null;
                state._lastMeasureSegmentAt = 0;
            }
            mapMeasureBtn.classList.toggle('active', state.isMeasureMode);
            mapMeasureBtn.textContent = state.isMeasureMode ? '📐 Measure ON' : '📐 Measure';
            document.getElementById('map-canvas').style.cursor = state.isMeasureMode ? 'crosshair' : 'grab';
            updateLayers();
        });
    }

    const mapCompareAreaBtn = document.getElementById('map-compare-area-btn');
    if (mapCompareAreaBtn) {
        mapCompareAreaBtn.addEventListener('click', () => {
            if (state.polygonCompare.drawMode) {
                cancelPolygonCompareDraw();
                return;
            }
            startPolygonCompareDraw();
        });
    }

    // Map Satellite button (next to 3D): toggle satellite layer, sync with filters
    const mapSatelliteBtn = document.getElementById('map-satellite-btn');
    if (mapSatelliteBtn) {
        mapSatelliteBtn.addEventListener('click', () => {
            state.filters.satellite = !state.filters.satellite;
            if (map && map.getLayer('google-satellite-layer')) {
                const vis = state.filters.satellite ? 'visible' : 'none';
                map.setLayoutProperty('google-satellite-layer', 'visibility', vis);
                if (mapRight && mapRight.getLayer('google-satellite-layer')) {
                    mapRight.setLayoutProperty('google-satellite-layer', 'visibility', vis);
                }
            }
            mapSatelliteBtn.classList.toggle('active', state.filters.satellite);
            const sidebarSat = document.getElementById('toggle-satellite');
            if (sidebarSat) {
                sidebarSat.checked = state.filters.satellite;
            }
        });
    }
    
    currentViewState = INITIAL_VIEW_STATE;

    // Custom DeckGL Zoom Controls
    const zoomInBtn = document.getElementById('deck-zoom-in');
    const zoomOutBtn = document.getElementById('deck-zoom-out');

    if (zoomInBtn && zoomOutBtn) {
        zoomInBtn.addEventListener('click', () => {
            currentViewState = { ...currentViewState, zoom: currentViewState.zoom + 1, transitionDuration: 300 };
            deck.setProps({ initialViewState: currentViewState });
            syncMirroredDeckViewState(currentViewState);
        });

        zoomOutBtn.addEventListener('click', () => {
            currentViewState = { ...currentViewState, zoom: currentViewState.zoom - 1, transitionDuration: 300 };
            deck.setProps({ initialViewState: currentViewState });
            syncMirroredDeckViewState(currentViewState);
        });
    }

    function getDeckTooltip({ object, layer }) {
        if (!object || !layer) return null;
        if (layer.id && layer.id.startsWith('geohash') && object.hash) {
            return { html: buildGeohashTooltip(object), style: { background: 'none', border: 'none', padding: '0', 'max-width': '400px' } };
        }
        if (layer.id === 'arc-layer') {
            return {
                html: `<div style="padding: 10px; background: rgba(13, 17, 23, 0.95); color: white; border-radius: 8px; font-family: 'Inter', sans-serif; border: 1px solid rgba(255, 255, 255, 0.2); box-shadow: 0 4px 15px rgba(0,0,0,0.5);">
                         <div style="font-weight: 700; color: #fff; margin-bottom: 4px; font-size: 12px; display: flex; align-items: center; gap: 6px;">
                            <span>🔗</span> Strategic Target Line
                         </div>
                         <div style="font-size: 11px; color: #94a3b8; line-height: 1.4;">
                            Connects the selected site to the nearest<br>
                            <strong style="color: #00e5ff;">${object.mno}</strong> asset. Distance: <strong>${Math.round(object.distKm * 1000)}m</strong>.
                         </div>
                       </div>`,
                style: { background: 'none', border: 'none', padding: '0', 'max-width': '300px' }
            };
        }
        if (layer.id && layer.id.includes('raster-raw') && object.rsrp !== undefined) {
            return {
                html: `<div style="padding: 12px; background: rgba(13, 17, 23, 0.98); color: white; border-radius: 8px; font-family: 'Inter', sans-serif; border: 1px solid rgba(0, 229, 255, 0.4); box-shadow: 0 8px 32px rgba(0,0,0,0.6);">
                         <div style="font-weight: 700; color: #00e5ff; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 6px; display: flex; justify-content: space-between; align-items: center; gap: 20px;">
                            <span>📡 Signal Intel</span>
                            <span style="font-size: 9px; background: rgba(0,229,255,0.2); padding: 2px 6px; border-radius: 4px; color: #00e5ff; border: 1px solid rgba(0,229,255,0.3);">GLOBE</span>
                         </div>
                         <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                            <div>
                                <div style="font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">RSRP</div>
                                <div style="font-size: 16px; font-weight: 600;">${object.rsrp} <span style="font-size: 10px; opacity: 0.7;">dBm</span></div>
                            </div>
                            <div>
                                <div style="font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">RSRQ (est)</div>
                                <div style="font-size: 16px; font-weight: 600;">-12.4 <span style="font-size: 10px; opacity: 0.7;">dB</span></div>
                            </div>
                            <div style="grid-column: span 2;">
                                <div style="font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Marketshare / Samples</div>
                                <div style="font-size: 13px; font-weight: 500; color: #94a3b8; display: flex; align-items: center; gap: 6px;">
                                    <div style="width: 8px; height: 8px; border-radius: 50%; background: #00e5ff;"></div>
                                    482 Samples in cluster
                                </div>
                            </div>
                         </div>
                         <div style="font-size: 9px; color: #475569; margin-top: 10px; font-style: italic; border-top: 1px solid rgba(255,255,255,0.05); pt: 4px;">Raster Source: MapInfo TAB (High-Res)</div>
                       </div>`,
                style: { background: 'none', border: 'none', padding: '0', zIndex: '999999' }
            };
        }
        return null;
    }

    deck = new Deck({
        canvas: 'map-canvas', parent: document.querySelector('.map-container'),
        // Align WebGL buffer 1:1 with CSS pixels so MapLibre (underlay) and Deck overlays stay locked on zoom/split.
        useDevicePixels: false, initialViewState: currentViewState, controller: true,
        onHover: (info) => {
            const el = document.getElementById('cursor-coords');
            if (el) {
                if (info && info.coordinate) {
                    const [lng, lat] = info.coordinate;
                    el.innerText = cursorCoordDisplay(lat, lng);
                } else {
                    // Only reset if we actually have no coordinate
                    if (info.devicePixel) {
                        el.innerText = `Lat: --.----, Lng: --.----`;
                    }
                }
            }
        },
        getTooltip: getDeckTooltip,
        onViewStateChange: ({ viewState }) => {
            const oldViewState = currentViewState;
            currentViewState = viewState;

            const delta = !oldViewState ||
                Math.abs(oldViewState.longitude - viewState.longitude) > 0.00001 ||
                Math.abs(oldViewState.latitude - viewState.latitude) > 0.00001 ||
                Math.abs(oldViewState.zoom - viewState.zoom) > 0.01 ||
                oldViewState.bearing !== viewState.bearing ||
                oldViewState.pitch !== viewState.pitch;

            if (state.networkIntel.comparing) {
                syncCompareDeckLayoutFromDom();
                // Always sync compare panes on every viewState tick — threshold skips can leave mapRight frozen vs left strip.
                syncCompareBasemaps();
            } else {
                syncMirroredDeckViewState(viewState);
                if (delta) {
                    map.jumpTo({
                        duration: 0,
                        center: [viewState.longitude, viewState.latitude],
                        zoom: viewState.zoom,
                        bearing: viewState.bearing ?? 0,
                        pitch: viewState.pitch ?? 0
                    });
                }
            }

            syncCompassFromViewState(viewState);
            updateDashboard(); // Dynamic dashboard slicing (debounced)
        },
        onClick: (info) => handleMapClick(info)
    });

    syncCompassFromViewState(currentViewState);
    const compassEl = document.getElementById('compass');
    if (compassEl) {
        compassEl.addEventListener('click', () => {
            if (!deck || !currentViewState) return;
            const vs = { ...currentViewState, bearing: 0, transitionDuration: 350 };
            deck.setProps({ initialViewState: vs });
            currentViewState = vs;
            syncMirroredDeckViewState(currentViewState);
            if (!state.networkIntel.comparing) {
                map.jumpTo({
                    duration: 0,
                    center: [vs.longitude, vs.latitude],
                    zoom: vs.zoom,
                    bearing: 0,
                    pitch: vs.pitch
                });
            }
            syncCompassFromViewState(vs);
        });
    }

    // Double-click on free map area (not on a site) closes the info panel; capture phase so we run before map zoom
    const mapContainer = document.querySelector('.map-container');
    const mapCanvas = document.getElementById('map-canvas');
    if (mapContainer && mapCanvas) {
        mapContainer.addEventListener('dblclick', (e) => {
            if (state.polygonCompare?.drawMode && state.polygonCompare.vertices.length >= 3) {
                e.preventDefault();
                e.stopPropagation();
                finishPolygonCompareDraw();
                return;
            }
            if (!state.selectedTower) return;
            if (e.target.closest('.pitch-panel')) return;
            const rect = mapCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const pick = deck.pickObject({ x, y, radius: 2 });
            const isSite = pick && pick.object && typeof pick.object.lat === 'number' && typeof pick.object.lng === 'number' &&
                (pick.object.id != null || pick.object.name != null || (pick.layer && pick.layer.id && String(pick.layer.id).startsWith('potential-landbank')));
            if (!isSite) {
                e.preventDefault();
                e.stopPropagation();
                const pitchPanel = document.getElementById('pitch-panel');
                if (pitchPanel) pitchPanel.classList.remove('open');
                state.selectedTower = null;
                state.highlightId = null;
                updateLayers();
            }
        }, true);
    }

    window.addEventListener('keydown', (e) => {
        if (!state.polygonCompare?.drawMode) return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
        if (e.key === 'Enter') {
            e.preventDefault();
            if (state.polygonCompare.vertices.length >= 3) finishPolygonCompareDraw();
        }
    }, true);

    function handleMapClick(info) {
        if (state.polygonCompare?.drawMode) {
            const { lng, lat } = lngLatFromDeckPickInfo(info);
            if (typeof lng === 'number' && typeof lat === 'number' && Number.isFinite(lng) && Number.isFinite(lat)) {
                const pc = state.polygonCompare;
                const now = Date.now();
                const prev = pc.vertices[pc.vertices.length - 1];
                if (prev) {
                    const dKm = haversineDistance(prev[1], prev[0], lat, lng);
                    if (dKm < 0.004) return;
                    if (now - pc._lastVertexAt < 400 && dKm < 0.08) return;
                }
                pc._lastVertexAt = now;
                pc.vertices.push([lng, lat]);
                updatePolygonDrawToolbarState();
                updateLayers();
            }
            return;
        }
        // Any map click clears the temporary coordinate-search pin (it is not permanent unless later saved as a dataset)
        if (state.searchPin) {
            state.searchPin = null;
            state.searchPinExpiresAt = 0;
        }
        if (state.isPegmanMode) {
            if (info.coordinate) {
                const [lng, lat] = info.coordinate;
                const svIframe = document.getElementById('sv-iframe');
                const svContainer = document.getElementById('sv-container');
                svIframe.src = `https://www.google.com/maps?q&layer=c&cbll=${lat},${lng}&cbp=11,0,0,0,0&output=svembed`;
                svContainer.style.display = 'block';
            }
            state.isPegmanMode = false;
            setPegmanStreetHighlight(false);
            const streetViewBtn = document.getElementById('street-view-btn');
            if (streetViewBtn) {
                streetViewBtn.classList.remove('active');
                streetViewBtn.textContent = '🚶 Pegman';
            }
            document.getElementById('map-canvas').style.cursor = 'grab';
            return;
        }

        if (state.isMeasureMode) {
            // Get map position under cursor: prefer deck's viewport unproject (matches canvas), else info.coordinate
            let lng, lat;
            const px = info.x ?? info.position?.[0];
            const py = info.y ?? info.position?.[1];
            if (typeof px === 'number' && typeof py === 'number' && deck && currentViewState) {
                const viewports = deck.getViewports ? deck.getViewports() : [];
                const vp = viewports[0];
                if (vp && vp.unproject) {
                    const unprojected = vp.unproject([px, py]);
                    lng = unprojected[0];
                    lat = unprojected[1];
                }
                if ((typeof lng !== 'number' || typeof lat !== 'number' || !Number.isFinite(lng) || !Number.isFinite(lat)) && currentViewState) {
                    const canvas = document.getElementById('map-canvas');
                    const w = canvas?.clientWidth || 800;
                    const h = canvas?.clientHeight || 600;
                    const viewport = new WebMercatorViewport({
                        width: w, height: h,
                        longitude: currentViewState.longitude,
                        latitude: currentViewState.latitude,
                        zoom: currentViewState.zoom,
                        pitch: currentViewState.pitch ?? 0,
                        bearing: currentViewState.bearing ?? 0
                    });
                    const [u, v] = viewport.unproject([px, py]);
                    lng = u;
                    lat = v;
                }
            }
            if ((typeof lng !== 'number' || typeof lat !== 'number' || !Number.isFinite(lng) || !Number.isFinite(lat)) &&
                info.coordinate && Array.isArray(info.coordinate) && info.coordinate.length >= 2) {
                lng = Number(info.coordinate[0]);
                lat = Number(info.coordinate[1]);
            }
            if (typeof lng === 'number' && typeof lat === 'number') {
                const coord = [lng, lat];
                if (state.measurePoints.length >= 2) state.measurePoints = [];
                // Only clear previous segment when starting a new measure; avoid clearing if we just set it (double-fire on same click)
                if (state.measurePoints.length === 0 && (Date.now() - (state._lastMeasureSegmentAt || 0)) > 80) {
                    state.lastMeasureSegment = null;
                }
                if (state.measurePoints.length === 1) {
                    const [lng0, lat0] = state.measurePoints[0];
                    const distKm = haversineDistance(lat0, lng0, lat, lng);
                    if (distKm < 0.001) {
                        showToast('Click a different point for the second measure point.', 'warning');
                        return;
                    }
                }
                state.measurePoints.push(coord);
                // Leaflet-style: after 2 points, keep line visible and reset so next click = first of new measure
                if (state.measurePoints.length === 2) {
                    const [a, b] = state.measurePoints;
                    state.lastMeasureSegment = {
                        start: a.slice(),
                        end: b.slice(),
                        distKm: haversineDistance(a[1], a[0], b[1], b[0])
                    };
                    state._lastMeasureSegmentAt = Date.now();
                    state.measurePoints = [];
                }
                updateLayers();
            }
            return;
        }

        // Fallback picking: sometimes onClick may not carry a picked object even when clicking a marker.
        // Use a manual pick at the cursor to ensure selection/pitch-deck works.
        if (!info.object && deck && typeof info.x === 'number' && typeof info.y === 'number') {
            const picked = deck.pickObject({ x: info.x, y: info.y, radius: 6 });
            if (picked && picked.object) {
                info = { ...info, object: picked.object, layer: picked.layer || info.layer };
            }
        }

        if (info.object) {
            // 1) Geohash cell (Network Intel) — has hash but no site id
            if (info.object.hash && !info.object.id) {
                state.highlightId = info.object.hash;
                updateLayers();
                return;
            }

            // 2) Landbank candidate (Potential Landbank Areas layer)
            if (info.layer && info.layer.id && info.layer.id.startsWith('potential-landbank-areas')) {
                const p = info.object;
                const fakeId = `LB-${p.lat.toFixed(4)}-${p.lng.toFixed(4)}`;
                const pop1km = p.population_1km ?? p.population ?? 0;
                const fakeSite = {
                    id: fakeId,
                    name: 'Landbank Candidate',
                    lat: p.lat,
                    lng: p.lng,
                    sourceType: 'STRATEGIC_Landbank',
                    dataset_name: 'Landbank',
                    population: {
                        radius_500m: p.population_500m ?? 0,
                        radius_1km: pop1km,
                        radius_1_5km: p.population_1_5km ?? 0,
                        terrain_type: landbankTerrainFromCandidate(p)
                    },
                    terrain_type: landbankTerrainFromCandidate(p)
                };
                state.selectedTower = fakeSite;
                state.highlightId = fakeId;
                showPitchDeck(fakeSite);
                updateLayers();
                return;
            }

            // 3) Regular tower or MNO site
            state.selectedTower = info.object;
            state.highlightId = info.object.id;
            showPitchDeck(info.object);
            updateLayers();
        } else {
            // Clicked empty space — clear selection and hide info panel only if it was open
            state.highlightId = null;
            state.selectedTower = null;
            const pitchPanel = document.getElementById('pitch-panel');
            if (pitchPanel && pitchPanel.classList.contains('open')) {
                pitchPanel.classList.remove('open');
            }
            updateLayers();
        }
    }

    getDeckTooltipForMapOverlay = getDeckTooltip;
    handleMapClickForMapOverlay = handleMapClick;

    // Removed all MapLibre native controls; using exclusively custom DeckGL zoom & 3D buttons now.


    window.addEventListener('trigger-rf-sim', (e) => {
        const { tower, isAreaMode } = e.detail;

        // MEMORY CLEANUP: Free previous simulation data before starting new one
        state.rfSimulationGrid = null;
        state.groundTruthGrid = null;

        // CONSOLIDATED PROMPTS
        alert(isAreaMode ? "Configuring AREA Simulation..." : `Configuring RF for ${tower.name}...`);

        const band = prompt("Frequency Band (MHz):", "1800") || 1800;
        const acl = prompt("Antenna Height (ACL) in meters:", tower.height_m || "30") || 30;
        const tilt = prompt("Antenna Mechanical Tilt (deg):", "2") || 2;
        const numSectors = prompt("Number of Sectors (e.g. 1, 3, 4):", "3") || 3;
        const modelIndex = prompt("Propagation Model:\n1: Hata Urban\n2: Hata Dense Urban (High-Rise)\n3: Hata Suburban\n4: Hata Rural", "1") || "1";

        const models = [PATH_LOSS_MODELS.HATA_URBAN, PATH_LOSS_MODELS.HATA_DENSE_URBAN, PATH_LOSS_MODELS.HATA_SUBURBAN, PATH_LOSS_MODELS.HATA_RURAL];
        const selectedModel = models[parseInt(modelIndex) - 1] || PATH_LOSS_MODELS.HATA_URBAN;

        const simOptions = {
            numSectors: parseInt(numSectors),
            mechanicalTilt: parseFloat(tilt),
            antennaHeight: parseFloat(acl),
            // Area mode uses much coarser resolution to prevent crashes
            resolution: isAreaMode ? 0.004 : 0.001,
            rangeKm: isAreaMode ? 1.5 : 3
        };

        try {
            if (isAreaMode) {
                const combinedGrid = [];
                // BUDGET: Limit area sim to nearest 10 towers max
                const towersToSim = state.towers.slice(0, 10);
                for (const t of towersToSim) {
                    const sectorGrid = generateRFHeatmap(t, parseFloat(band), selectedModel, simOptions);
                    // SAFE PUSH: Use loop instead of spread to avoid stack overflow
                    for (let i = 0; i < sectorGrid.length; i++) {
                        combinedGrid.push(sectorGrid[i]);
                    }
                }
                state.rfSimulationGrid = combinedGrid;
            } else {
                state.rfSimulationGrid = generateRFHeatmap(tower, parseFloat(band), selectedModel, simOptions);
            }
        } catch (err) {
            console.error('RF Simulation failed:', err);
            alert('Simulation too large. Try reducing sectors or range.');
            return;
        }

        updateRFLegend(true);
        updateLayers();
    });


    function updateRFLegend(visible) {
        const legend = document.getElementById('rf-legend');
        if (!legend) return;
        legend.style.display = visible ? 'block' : 'none';
    }

    const canvas = document.getElementById('map-canvas');
    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const info = deck.pickObject({ x, y, radius: 10 });

        if (info && info.object && isPersistedSitePickForEditor(info.object, info.layer)) {
            const obj = info.object;
            showSiteEditorModal(obj, async (updates) => {
                Object.assign(obj, updates);
                const folder = obj.dataset_name || 'Own Assets';
                const data = await loadFromDB('layers', folder);
                if (data) {
                    const updated = data.map(s => s.id === obj.id ? { ...s, ...updates } : s);
                    await saveToDB('layers', updated, folder);
                }
                await loadVisibleDatasets();
                await processData();
                updateLayers();
                updateDashboard();
            });
            return;
        }

        let lngLat = null;
        if (info?.layer?.id?.startsWith('potential-landbank') && info.object && typeof info.object.lat === 'number') {
            lngLat = { lng: info.object.lng, lat: info.object.lat };
        } else {
            lngLat = resolveLngLatFromMapEvent(e, deck, currentViewState);
        }
        if (!lngLat) return;
        showSaveLocationModal(lngLat, async ({ target, name, lat, lng }) => {
            await persistUserPinnedSite(lat, lng, name, target);
        });
    });

    updateLayers();
}



/** Match site status to filter (On-air ↔ Active, CME Completed ↔ Ready, case-insensitive). */
function matchesStatusFilter(siteStatus, filterValue) {
    if (!filterValue || filterValue === 'All') return true;
    const s = (siteStatus || '').toString().trim().toLowerCase();
    const f = filterValue.trim().toLowerCase();
    if (s === f) return true;
    if (f === 'on-air' && (s === 'active' || s === 'onair' || s === 'on-air')) return true;
    if (f === 'cme completed' && (s === 'ready' || s === 'cme completed' || s === 'cmecompleted')) return true;
    return false;
}

/** Get value from a site by column name (top-level or properties). */
function getValueFromSite(site, column) {
    if (!site || !column) return '';
    const v = site[column] ?? site.properties?.[column];
    return (v == null ? '' : String(v)).trim();
}

/** Collect all column names and unique values per column from an array of sites. */
function getColumnsAndValues(sites) {
    const columnsSet = new Set();
    const valuesByColumn = Object.create(null);
    for (const site of sites || []) {
        const keys = new Set([...Object.keys(site), ...(site.properties ? Object.keys(site.properties) : [])]);
        keys.forEach(k => columnsSet.add(k));
        keys.forEach(col => {
            const val = getValueFromSite(site, col);
            if (val === '') return;
            if (!valuesByColumn[col]) valuesByColumn[col] = new Set();
            valuesByColumn[col].add(val);
        });
    }
    const columns = [...columnsSet].sort();
    const valuesByColumnArr = Object.create(null);
    columns.forEach(c => {
        valuesByColumnArr[c] = valuesByColumn[c] ? [...valuesByColumn[c]].sort() : [];
    });
    return { columns, valuesByColumn: valuesByColumnArr };
}

/**
 * Align state.filters layer flags with sidebar checkboxes before building deck layers.
 * Some paths (e.g. onDatasetToggle → processData → updateLayers) skip onFilterChange,
 * so flags like layers.mno could stay stale while #layer-mno is unchecked.
 */
function syncLayerTogglesFromDom() {
    if (!state.filters?.layers) return;
    const g = (id) => document.getElementById(id);
    const t = g('layer-towers');
    if (t) state.filters.layers.towers = t.checked;
    const m = g('layer-mno');
    if (m) state.filters.layers.mno = m.checked;
    const h = g('layer-heatmap');
    if (h) state.filters.layers.heatmap = h.checked;
    const p = g('layer-population');
    if (p) state.filters.layers.population = p.checked;
    const st = g('layer-strategy');
    const lb = g('layer-potential-landbank');
    if (st) {
        state.filters.layers.strategy = st.checked;
        state.filters.layers.potentialLandbankAreas = !!(st.checked && lb && lb.checked);
    }
    const sr = g('layer-search-rings');
    if (sr) state.filters.layers.searchRings = sr.checked;
    const ni = g('layer-network-intel');
    if (ni) state.filters.layers.networkIntel = ni.checked;
    const sat = g('toggle-satellite');
    if (sat) state.filters.satellite = sat.checked;
}

function updateLayers() {
    try {
        _updateLayersImpl();
    } catch (err) {
        console.error('Layer error:', err);
        const div = document.createElement('div');
        div.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:red;color:white;padding:20px;font-size:14px;';
        div.textContent = 'Layer error. See console for details.';
        document.body.appendChild(div);
    }
}
function _updateLayersImpl() {
    if (!deck) return;
    syncLayerTogglesFromDom();
    const layers = [];
    const layersRight = [];
    const ni = state.networkIntel;
    const getCat = (name) => localStorage.getItem(`category-${name}`) || 'towers';

    // ═══════════════════════════════════════════════════════════════════
    // LAYER ORDER (bottom to top):
    //   1. Population Density (base layer, just above map)
    //   2. Geohash / Network Intel grid (coverage analysis)
    //   3. RF Simulation overlay
    //   4. Search Ring KML polygons
    //   5. Signal Heatmap sites
    //   6. MNO Sites
    //   7. Our Towers
    //   8. Strategic Targets
    //   9. Measure tool / arcs / rings (always on top)
    // ═══════════════════════════════════════════════════════════════════

    // ── 1. POPULATION DENSITY (bottom) ────────────────────────────────
    if (state.filters.layers.population) {
        if (state.populationGrid.length > 0) {
            // Population is geographic — same data on both sides
            const popLeft = createPopulationHexagons(state.populationGrid, { idSuffix: '-left' });
            if (popLeft) {
                if (Array.isArray(popLeft)) layers.push(...popLeft);
                else layers.push(popLeft);
            }
            if (ni.comparing) {
                // Must create a SEPARATE layer instance for the right deck
                const popRight = createPopulationHexagons(state.populationGrid, { idSuffix: '-right' });
                if (popRight) {
                    if (Array.isArray(popRight)) layersRight.push(...popRight);
                    else layersRight.push(popRight);
                }
            }
        } else {
            loadPopulationGrid();
        }
    }

    // ── 2. RASTER / SIGNAL HEATMAP LAYERS (under Signal Heatmap; per-key) ─────────────────────────
    Object.entries(state.rasters).forEach(([rasterKey, raster]) => {
        if (!raster.visible || !raster.data?.length) return;
        const rasterLayers = createRawRasterLayer(raster.data, { idSuffix: rasterKey });
        if (rasterLayers) {
            layers.push(...rasterLayers);
            if (ni.comparing) {
                const rightRaster = createRawRasterLayer(raster.data, { idSuffix: `${rasterKey}-right` });
                layersRight.push(...rightRaster);
            }
        }
    });

    // ── 3. GEOHASH / NETWORK INTEL GRID ──────────────────────────────
    if (state.filters.layers.networkIntel && state.geohashGrid.length > 0) {
        if (ni.comparing) {
            // Comparison mode: use right grid, or fallback to left grid
            const rightGrid = state.geohashGridRight.length > 0 ? state.geohashGridRight : state.geohashGrid;
            const leftLayer = createGeohashLayer(state.geohashGrid, {
                metric: ni.metric,
                layerId: 'geohash-left',
                highlightId: state.highlightId
            });
            const rightLayer = createGeohashLayer(rightGrid, {
                metric: ni.metric,
                layerId: 'geohash-right',
                highlightId: state.highlightId
            });
            if (leftLayer) layers.push(leftLayer);
            if (rightLayer) layersRight.push(rightLayer);
        } else {
            const ghLayer = createGeohashLayer(state.geohashGrid, {
                metric: ni.metric,
                layerId: 'geohash-grid',
                highlightId: state.highlightId
            });
            if (ghLayer) layers.push(ghLayer);
        }
    }

    // ── 3. RF SIMULATION OVERLAY ─────────────────────────────────────
    if (state.rfSimulationGrid && state.rfSimulationGrid.length > 0) {
        const rfLayers = createCoverageHeatmap(state.rfSimulationGrid, state.groundTruthGrid);
        if (Array.isArray(rfLayers)) {
            layers.push(...rfLayers);
            if (ni.comparing) layersRight.push(...rfLayers);
        } else {
            layers.push(rfLayers);
            if (ni.comparing) layersRight.push(rfLayers);
        }
    }

    // ── 4. SEARCH RING KML POLYGONS ──────────────────────────────────
    if (state.filters.layers.searchRings && state.searchRingsGeoJSON) {
        const srLayer = createSearchRingLayer(state.searchRingsGeoJSON);
        if (srLayer) {
            if (Array.isArray(srLayer)) {
                layers.push(...srLayer);
                if (ni.comparing) layersRight.push(...srLayer);
            } else {
                layers.push(srLayer);
                if (ni.comparing) layersRight.push(srLayer);
            }
        }
    }


    // ── 5. SIGNAL HEATMAP SITES ──────────────────────────────────────
    if (state.filters.layers.heatmap) {
        if (state.filters.layers.mno) {
            const heatmapMNOs = state.mnoSites.filter(s => getCat(s.dataset_name) === 'signalHeatmap');
            if (heatmapMNOs.length > 0) {
                let leftHeatmapMNOs = heatmapMNOs;
                if (ni.comparing && ni.left.mno !== 'All') leftHeatmapMNOs = heatmapMNOs.filter(s => s.mno && s.mno.toLowerCase() === ni.left.mno.toLowerCase());
                if (leftHeatmapMNOs.length > 0) layers.push(...createMNOLayer(leftHeatmapMNOs, { visibleMNOs: [...MNOS, 'Competitor', 'Unknown'], idSuffix: '-heatmap-left' }));

                if (ni.comparing) {
                    let rightHeatmapMNOs = heatmapMNOs;
                    if (ni.right.mno !== 'All') rightHeatmapMNOs = heatmapMNOs.filter(s => s.mno && s.mno.toLowerCase() === ni.right.mno.toLowerCase());
                    if (rightHeatmapMNOs.length > 0) layersRight.push(...createMNOLayer(rightHeatmapMNOs, { visibleMNOs: [...MNOS, 'Competitor', 'Unknown'], idSuffix: '-heatmap-right' }));
                }
            }
        }

        const heatmapTowers = state.towers.filter(t => getCat(t.dataset_name) === 'signalHeatmap');
        if (heatmapTowers.length > 0) {
            const htl = createTowerLayer(heatmapTowers, state.scores, { highlightId: state.highlightId, filters: state.filters, layerId: 'heatmap-towers' });
            if (htl && Array.isArray(htl)) {
                layers.push(...htl);
                if (ni.comparing) layersRight.push(...createTowerLayer(heatmapTowers, state.scores, { highlightId: state.highlightId, filters: state.filters, layerId: 'heatmap-towers-right' }));
            }
        }
    }

    // ── 6. SEARCH RING TOWER SITES ───────────────────────────────────
    if (state.filters.layers.searchRings) {
        const srTowers = state.towers.filter(t => getCat(t.dataset_name) === 'searchRings');
        if (srTowers.length > 0) {
            const sl = createTowerLayer(srTowers, state.scores, { highlightId: state.highlightId, filters: state.filters, layerId: 'search-ring-towers' });
            if (sl && Array.isArray(sl)) {
                layers.push(...sl);
                if (ni.comparing) layersRight.push(...createTowerLayer(srTowers, state.scores, { highlightId: state.highlightId, filters: state.filters, layerId: 'search-ring-towers-right' }));
            }
        }
    }

    // ── 7. MNO SITES ─────────────────────────────────────────────────
    if (state.filters.layers.mno) {
        let baseMNOData = state.mnoSites.filter(s => s.mno && getCat(s.dataset_name) === 'mno' && s.sourceType !== 'STRATEGIC_Discovery');
        if (state.filters.mnoFilterColumn && state.filters.mnoFilterValue && state.filters.mnoFilterValue !== 'All') {
            baseMNOData = baseMNOData.filter(s => getValueFromSite(s, state.filters.mnoFilterColumn) === state.filters.mnoFilterValue);
        }

        let leftMNOData = baseMNOData;
        if (ni.comparing && ni.left.mno !== 'All') leftMNOData = baseMNOData.filter(s => s.mno.toLowerCase() === ni.left.mno.toLowerCase());
        if (leftMNOData.length > 0) layers.push(...createMNOLayer(leftMNOData, { visibleMNOs: [...MNOS, 'Competitor'], idSuffix: '-left' }));

        if (ni.comparing) {
            let rightMNOData = baseMNOData;
            if (ni.right.mno !== 'All') rightMNOData = baseMNOData.filter(s => s.mno.toLowerCase() === ni.right.mno.toLowerCase());
            if (rightMNOData.length > 0) layersRight.push(...createMNOLayer(rightMNOData, { visibleMNOs: [...MNOS, 'Competitor'], idSuffix: '-right' }));
        }

        let mnoTowers = state.towers.filter(t => getCat(t.dataset_name) === 'mno' && t.sourceType !== 'STRATEGIC_Discovery');
        if (state.filters.mnoFilterColumn && state.filters.mnoFilterValue && state.filters.mnoFilterValue !== 'All') {
            mnoTowers = mnoTowers.filter(t => getValueFromSite(t, state.filters.mnoFilterColumn) === state.filters.mnoFilterValue);
        }
        if (mnoTowers.length > 0) {
            const mlLeft = createTowerLayer(mnoTowers, state.scores, { highlightId: state.highlightId, filters: state.filters, layerId: 'mno-towers' });
            if (mlLeft && Array.isArray(mlLeft)) layers.push(...mlLeft);
            if (ni.comparing) {
                const mlRight = createTowerLayer(mnoTowers, state.scores, { highlightId: state.highlightId, filters: state.filters, layerId: 'mno-towers-right' });
                if (mlRight && Array.isArray(mlRight)) layersRight.push(...mlRight);
            }
        }
    }

    // ── 8. OUR TOWERS ────────────────────────────────────────────────
    if (state.filters.layers.towers) {
        let towerData = state.towers.filter(t => getCat(t.dataset_name) === 'towers' && t.sourceType !== 'STRATEGIC_Discovery');
        if (state.filters.towerFilterColumn && state.filters.towerFilterValue && state.filters.towerFilterValue !== 'All') {
            towerData = towerData.filter(t => getValueFromSite(t, state.filters.towerFilterColumn) === state.filters.towerFilterValue);
        }
        if (towerData.length > 0) {
            const tl = createTowerLayer(towerData, state.scores, { highlightId: state.highlightId, filters: state.filters, layerId: 'our-towers' });
            if (tl && Array.isArray(tl)) {
                layers.push(...tl);
                if (ni.comparing) layersRight.push(...createTowerLayer(towerData, state.scores, { highlightId: state.highlightId, filters: state.filters, layerId: 'our-towers-right' }));
            }
        }
    }

    // ── 9. STRATEGIC TARGETS (sync discovery + Potential Landbank Areas) ─────────────────────────────────────────
    if (state.filters.layers.strategy) {
        const discoveryPoints = state.mnoSites.filter(s => s.sourceType === 'STRATEGIC_Discovery');
        if (discoveryPoints.length > 0) {
            const strategyLayers = createTowerLayer(discoveryPoints, state.scores, { isOpportunityLayer: true, layerId: 'discovery', filters: state.filters });
            if (strategyLayers && Array.isArray(strategyLayers)) {
                layers.push(...strategyLayers);
                if (ni.comparing) layersRight.push(...createTowerLayer(discoveryPoints, state.scores, { isOpportunityLayer: true, layerId: 'discovery-right', filters: state.filters }));
            }
        }
    }
    if (state.filters.layers.potentialLandbankAreas && state.potentialLandbankAreas.length > 0) {
        const minPop = typeof state.filters.landbankMinPopulation === 'number'
            ? state.filters.landbankMinPopulation
            : 2000;
        const urbanOnly = !!state.filters.landbankUrbanOnly;
        const filteredLandbank = state.potentialLandbankAreas.filter(p => {
            if (landbankPopulationForMinFilter(p) < minPop) return false;
            return passesLandbankUrbanOnly(p, urbanOnly);
        });
        console.log('🔍 Landbank filter:', {
            totalCandidates: state.potentialLandbankAreas.length,
            minPop,
            urbanOnly,
            afterFilter: filteredLandbank.length
        });
        const landbankLayer = createPotentialLandbankLayer(filteredLandbank);
        if (landbankLayer) {
            layers.push(landbankLayer);
            if (ni.comparing) {
                const rightLayer = createPotentialLandbankLayer(filteredLandbank, { idSuffix: '-right' });
                if (rightLayer) layersRight.push(rightLayer);
            }
        }
    }

    // ── 10. INTERACTIVE OVERLAYS (always on top) ─────────────────────
    if (state.isMeasureMode && (state.measurePoints.length > 0 || state.lastMeasureSegment)) {
        const ml = createMeasureLayer(state.measurePoints, state.lastMeasureSegment);
        layers.push(...ml);
        if (ni.comparing) layersRight.push(...ml);
    }

    if (state.selectedTower && state.filters.layers.mno) {
        const getCatForArc = (name) => localStorage.getItem(`category-${name}`) || 'towers';
        const scoringMNOs = state.mnoSites.filter(s => {
            const cat = getCatForArc(s.dataset_name);
            return cat === 'mno' && !s.sourceType?.startsWith('STRATEGIC_');
        });

        const arcLayers = createArcLayer(state.selectedTower, scoringMNOs, state.filters.targetMNO);
        if (arcLayers && arcLayers.length > 0) {
            layers.push(...arcLayers);
            if (ni.comparing) layersRight.push(...arcLayers);
        }
    }
    if (state.selectedTower) {
        const rings = createPopulationRings(state.selectedTower);
        if (rings) {
            layers.push(rings);
            if (ni.comparing) layersRight.push(rings);
        }
    }

    // ── 11. POLYGON COMPARE (draft + static close chord / filled ring) ─
    const pcComp = state.polygonCompare;
    const polyDraftVisible = pcComp?.drawMode && pcComp.vertices.length > 0;
    /** Right pane mirror only when split-compare is active (not gated on NI checkbox — avoids missing draft polygon). */
    const mirrorRightPoly = state.networkIntel.comparing && (polyDraftVisible || (pcComp?.ring && pcComp.ring.length >= 4));
    if (pcComp && (polyDraftVisible || (pcComp.ring && pcComp.ring.length >= 4))) {
        const plLeft = polyDraftVisible
            ? createPolygonCompareDrawLayers({ vertices: pcComp.vertices })
            : createPolygonCompareDrawLayers({ closedRing: pcComp.ring });
        const plRight = polyDraftVisible
            ? createPolygonCompareDrawLayers({ vertices: pcComp.vertices, idSuffix: '-right' })
            : createPolygonCompareDrawLayers({ closedRing: pcComp.ring, idSuffix: '-right' });
        if (plLeft?.length) layers.push(...plLeft);
        if (mirrorRightPoly && plRight?.length) layersRight.push(...plRight);
    }

    // ── 12. SEARCH PIN (top-most, temporary) ─────────────────────
    if (state.searchPin && state.searchPinExpiresAt && Date.now() > state.searchPinExpiresAt) {
        state.searchPin = null;
        state.searchPinExpiresAt = 0;
    }

    if (state.searchPin && typeof state.searchPin.lat === 'number' && typeof state.searchPin.lng === 'number') {
        layers.push(new ScatterplotLayer({
            id: 'search-pin',
            data: [state.searchPin],
            pickable: false,
            getPosition: d => [d.lng, d.lat],
            getFillColor: [255, 214, 0],
            getLineColor: [0, 0, 0],
            lineWidthMinPixels: 2,
            stroked: true,
            filled: true,
            radiusMinPixels: 7,
            radiusMaxPixels: 14,
            getRadius: 60
        }));
        if (ni.comparing) layersRight.push(...layers.slice(-1));
    }

    const polyDrawMode = !!state.polygonCompare?.drawMode;
    const mapCanvas = document.getElementById('map-canvas');
    // During area-compare draw, double-click must not zoom the map (would shift view and make the finished polygon look "wrong" vs draft).
    const deckProps = {
        layers,
        controller: polyDrawMode ? { type: MapController, doubleClickZoom: false } : true
    };
    // Always push #map-canvas CSS size into Deck (strip mode + full width). Stale dimensions after compare exit = sites vs tiles drift.
    if (mapCanvas && mapCanvas.clientWidth > 0 && mapCanvas.clientHeight > 0) {
        deckProps.width = mapCanvas.clientWidth;
        deckProps.height = mapCanvas.clientHeight;
    }
    deck.setProps(deckProps);
    if (mapRightDeckOverlay) {
        mapRightDeckOverlay.setProps({ layers: layersRight });
    } else if (state.networkIntel.comparing && mapRight && typeof mapRight.loaded === 'function' && mapRight.loaded()) {
        ensureMapRightDeckOverlay();
        if (mapRightDeckOverlay) mapRightDeckOverlay.setProps({ layers: layersRight });
    }

    // Keep map measure button in sync when toggled from sidebar
    const mapMeasureBtn = document.getElementById('map-measure-btn');
    if (mapMeasureBtn) {
        mapMeasureBtn.classList.toggle('active', state.isMeasureMode);
        mapMeasureBtn.textContent = state.isMeasureMode ? '📐 Measure ON' : '📐 Measure';
    }
    const mapCompareBtn = document.getElementById('map-compare-area-btn');
    if (mapCompareBtn) {
        mapCompareBtn.classList.toggle('active', state.polygonCompare.drawMode || !!state.polygonCompare.ring);
    }
    if (mapCanvas) {
        if (state.polygonCompare.drawMode) mapCanvas.style.cursor = 'crosshair';
        else if (!state.isMeasureMode) mapCanvas.style.cursor = 'grab';
    }
}
let _dashboardDebounce = null;

function updateDashboard() {
    clearTimeout(_dashboardDebounce);
    _dashboardDebounce = setTimeout(() => {
        let visibleTowers = state.towers;

        // Filter to viewport if map is active and fully initialized
        if (map && currentViewState && currentViewState.longitude !== undefined) {
            const canvas = document.getElementById('map-canvas');
            // Only run viewport math if canvas has actual layout width
            if (canvas && canvas.clientWidth > 0) {
                try {
                    const viewport = new WebMercatorViewport({
                        width: canvas.clientWidth,
                        height: canvas.clientHeight,
                        longitude: currentViewState.longitude,
                        latitude: currentViewState.latitude,
                        zoom: currentViewState.zoom,
                        pitch: currentViewState.pitch,
                        bearing: currentViewState.bearing
                    });

                    // Get viewport bounding box [minX, minY, maxX, maxY]
                    const bounds = viewport.getBounds();
                    
                    if (bounds && bounds.length === 4) {
                        const [minLng, minLat, maxLng, maxLat] = bounds;
                        // Pad bounds slightly to avoid popping elements on edges
                        const padLng = (maxLng - minLng) * 0.1;
                        const padLat = (maxLat - minLat) * 0.1;
                        
                        visibleTowers = state.towers.filter(t => 
                            t.lng >= (minLng - padLng) && t.lng <= (maxLng + padLng) && 
                            t.lat >= (minLat - padLat) && t.lat <= (maxLat + padLat)
                        );
                    }
                } catch (e) {
                    console.warn('Viewport bounds calc failed, showing all assets', e);
                }
            }
        }

        // MNO site counts for visible viewport (for dashboard left bar)
        let visibleMno = state.mnoSites;
        if (map && currentViewState && currentViewState.longitude !== undefined) {
            const canvas = document.getElementById('map-canvas');
            if (canvas && canvas.clientWidth > 0) {
                try {
                    const viewport = new WebMercatorViewport({
                        width: canvas.clientWidth, height: canvas.clientHeight,
                        longitude: currentViewState.longitude, latitude: currentViewState.latitude,
                        zoom: currentViewState.zoom, pitch: currentViewState.pitch, bearing: currentViewState.bearing
                    });
                    const bounds = viewport.getBounds();
                    if (bounds && bounds.length === 4) {
                        const [minLng, minLat, maxLng, maxLat] = bounds;
                        const padLng = (maxLng - minLng) * 0.1, padLat = (maxLat - minLat) * 0.1;
                        visibleMno = state.mnoSites.filter(s =>
                            s.lng >= minLng - padLng && s.lng <= maxLng + padLng &&
                            s.lat >= minLat - padLat && s.lat <= maxLat + padLat
                        );
                    }
                } catch (e) { /* use all */ }
            }
        }
        const byMno = Object.fromEntries(
            MNOS.map((m) => [m, visibleMno.filter((s) => normalizeMNO(s.mno) === m).length])
        );
        const mnoCounts = {
            totalAssets: visibleTowers.length,
            byMno,
            other: visibleMno.filter((s) => !MNOS.includes(normalizeMNO(s.mno))).length
        };
        renderDashboard(visibleTowers, mnoCounts, document.getElementById('dashboard-panel'), {});
    }, 150); // 150ms debounce
}

/**
 * Show a floating toast notification
 */
function showToast(message, type = 'info') {
    const container = document.querySelector('.toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const span = document.createElement('span');
    span.textContent = message;
    toast.appendChild(span);

    container.appendChild(toast);

    // Auto-remove after 4 seconds
    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}


// Async race guard: tracks which tower was last clicked
let _pitchDeckTowerId = null;

async function showPitchDeck(tower) {
    let pitchPanel = document.getElementById('pitch-panel');
    if (!pitchPanel) {
        pitchPanel = document.createElement('div');
        pitchPanel.id = 'pitch-panel';
        pitchPanel.className = 'pitch-panel';
        document.body.appendChild(pitchPanel);
    }
    const onClose = () => { state.selectedTower = null; state.highlightId = null; updateLayers(); };
    const myTowerId = tower.id;
    _pitchDeckTowerId = myTowerId;

    // ALWAYS calculate score on the fly to guarantee consistency with map arcs!
    // This solves issues where clicked item is an MNO site not naturally present in state.towers,
    // or if the async scoring pass hasn't finished yet.
    const getCat = (name) => localStorage.getItem(`category-${name}`) || 'towers';
    const scoringMNOs = state.mnoSites.filter(s => {
        const cat = getCat(s.dataset_name);
        return cat === 'mno' && !s.sourceType?.startsWith('STRATEGIC_');
    });
    
    // We already have `calculateScores` imported at the top of main.js
    const freshScores = calculateScores([tower], scoringMNOs, null, [], state.settings);
    let scoreResult = freshScores[0];
    
    // Preserve population if it already exists in tower object (so it's not reset by default fallback)
    if (tower.population && tower.population.radius_1km !== undefined) {
        scoreResult.population = tower.population;
    }
    
    state.scores.set(tower.id, scoreResult);

    // Ensure CAAP/airport distance is set for this site (covers MNO/heatmap sites or early click before STAGE 1)
    if ((tower.nearest_airport == null || tower.caap_dist_km == null) && typeof tower.lat === 'number' && typeof tower.lng === 'number') {
        const a = getNearestAirport(tower.lat, tower.lng);
        tower.nearest_airport = a.name;
        tower.caap_dist_km = a.distKm;
    }

    const pitchOpts = { onClose, coordFormat: state.settings?.coordFormat || 'DD' };
    // Render immediately with cached/live data (no delay for user)
    renderPitchDeck(tower, scoreResult, pitchPanel, pitchOpts);
    pitchPanel.classList.add('open');

    // If population not yet computed for this tower, fetch it now in background
    if (!tower.population || tower.population.radius_1km === 0) {
        const pop = await getPopulationAtRadii(tower.lat, tower.lng);

        // RACE GUARD: If user clicked a different tower while awaiting, abort this update
        if (_pitchDeckTowerId !== myTowerId) return;

        tower.population = pop;
        tower.terrain_type = terrainFromPopulation(pop.radius_1km, state.settings);
        tower.population = { ...pop, terrain_type: tower.terrain_type };

        // Update the score object in state with fresh population
        if (state.scores.has(tower.id)) {
            state.scores.get(tower.id).population = tower.population;
        }

        // Re-render with real population numbers
        renderPitchDeck(tower, state.scores.get(tower.id) || scoreResult, pitchPanel, pitchOpts);
        // Force re-render of map layers to draw population rings with fresh data
        updateLayers();
    }
}

/** Exit split MNO compare without hunting the small ✕ (Escape when not typing in an input). */
window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!state.networkIntel.comparing) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    e.preventDefault();
    state.networkIntel.comparing = false;
    hideComparisonSlider();
    refreshIntelPanel();
});

init();

async function loadRasterData(rasterKey) {
    const raster = state.rasters[rasterKey];
    if (!raster || raster.data?.length > 0 || raster.isLoading) return;

    raster.isLoading = true;
    showToast(`Loading high-res data grid... (26k points)`, 'info');
    try {
        const res = await fetch(raster.url);
        const data = await res.json();
        raster.data = data;
        showToast(`Loaded RSRP raster data.`, 'success');
        updateLayers();
    } catch (err) {
        console.error('Raster data load failed:', err);
        showToast('Failed to load raw signal data.', 'warning');
    } finally {
        raster.isLoading = false;
    }
}

