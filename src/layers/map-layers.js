import { ScatterplotLayer, ArcLayer, TextLayer, LineLayer, PathLayer, IconLayer, GeoJsonLayer, PolygonLayer, BitmapLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import { haversineDistance } from '../data/vn-geo.js';
import { normalizeMNO } from '../engine/colocation-engine.js';
import { MNO_RGB, MNO_HEX, MNOS } from '../config/app-config.js';

export const MNO_COLORS = {
    ...MNO_RGB,
    Competitor: [156, 39, 176]
};

const SHAPE_ICONS = {
    circle: 'M18,34C9.2,34,2,26.8,2,18S9.2,2,18,2s16,7.2,16,16S26.8,34,18,34z',
    square: 'M2,2h32v32H2V2z',
    hexagon: 'M18,2l14.7,8.5v17L18,36L3.3,27.5v-17L18,2z',
    star: 'M18,2l4.6,9.3l10.3,1.5l-7.4,7.2l1.8,10.2L18,25.4l-9.3,4.9l1.8-10.2l-7.4-7.2l10.3-1.5L18,2z'
};

const iconCache = new Map();
function getCachedIcon(shape, color) {
    const key = `${shape}-${color}`;
    if (iconCache.has(key)) return iconCache.get(key);
    const path = SHAPE_ICONS[shape] || SHAPE_ICONS.circle;
    // Use 48×48 SVG with 6px padding around 36×36 path to prevent edge clipping
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="-6 -6 48 48"><path fill="${color}" stroke="rgba(0,0,0,0.3)" stroke-width="1" d="${path}"/></svg>`;
    const url = `data:image/svg+xml;base64,${btoa(svg)}`;

    const iconDef = { url, width: 48, height: 48, anchorY: 24, anchorX: 24, mask: false };
    iconCache.set(key, iconDef);
    return iconDef;
}

export function createTowerLayer(towers, scoreMap, { filters, highlightId, isOpportunityLayer = false, layerId }) {
    if (!towers || towers.length === 0) return [];

    const groups = {};
    towers.forEach(t => {
        const ds = t.dataset_name || 'default';
        if (!groups[ds]) groups[ds] = [];
        groups[ds].push(t);
    });

    const result = [];
    Object.entries(groups).forEach(([ds, data]) => {
        const shape = localStorage.getItem(`shape-${ds}`) || 'circle';
        const color = localStorage.getItem(`color-${ds}`) || (isOpportunityLayer ? '#ffd600' : '#00e5ff');
        const size = parseInt(localStorage.getItem(`size-${ds}`) || '20');

        result.push(new IconLayer({
            // STABLE ID: No Math.random()
            id: `tower-${layerId || 'towers'}-${ds}-${isOpportunityLayer ? 'opt' : 'std'}`,
            data,
            pickable: true,
            getPosition: d => [d.lng, d.lat],
            getIcon: d => {
                let opacityColor = color;
                if (filters?.priorityHighlight) {
                    const score = scoreMap.find(s => s.towerId === d.id)?.composite || 0;
                    const isHigh = score >= 70;
                    const isMid = score >= 45 && score < 70;
                    const isMatch = (filters.priorityHighlight === 'HIGH' && isHigh) || 
                                    (filters.priorityHighlight === 'MID' && isMid);
                    
                    if (!isMatch) {
                        // Dim unmatched sites by modifying the SVG color to a dark gray with low opacity
                        opacityColor = 'rgba(100, 116, 139, 0.3)';
                    }
                }
                return getCachedIcon(shape, opacityColor);
            },
            getSize: d => {
                let baseSize = size;
                if (filters?.priorityHighlight) {
                    const score = scoreMap.find(s => s.towerId === d.id)?.composite || 0;
                    const isHigh = score >= 70;
                    const isMid = score >= 45 && score < 70;
                    const isMatch = (filters.priorityHighlight === 'HIGH' && isHigh) || 
                                    (filters.priorityHighlight === 'MID' && isMid);
                    
                    if (!isMatch) baseSize = size * 0.4; // Shrink unmatched sites
                    else baseSize = size * 1.5; // Slightly enlarge matched sites
                }
                return (d.id === highlightId) ? size * 2 : baseSize;
            },
            sizeUnits: 'pixels',
            updateTriggers: {
                getIcon: [shape, color, filters?.priorityHighlight, scoreMap],
                getSize: [highlightId, size, filters?.priorityHighlight, scoreMap]
            }
        }));
    });
    return result;
}

export function createMNOLayer(mnoSites, { visibleMNOs, idSuffix = '' }) {
    if (!mnoSites || mnoSites.length === 0) return [];
    const filtered = mnoSites.filter(s => visibleMNOs.includes(s.mno) || visibleMNOs.includes(s.sourceType));
    if (filtered.length === 0) return [];

    // Group by dataset for per-dataset styling
    const groups = {};
    filtered.forEach(s => {
        const ds = s.dataset_name || 'mno-default';
        if (!groups[ds]) groups[ds] = [];
        groups[ds].push(s);
    });

    // Default color by MNO as hex
    const HEX = { ...MNO_HEX, Competitor: '#9c27b0' };

    const result = [];
    Object.entries(groups).forEach(([ds, data]) => {
        const shape = localStorage.getItem(`shape-${ds}`) || 'circle';
        // Use stored color, or fall back to MNO-based color
        const storedColor = localStorage.getItem(`color-${ds}`);
        const defaultColor = data[0] ? (HEX[data[0].mno] || '#9e9e9e') : '#9e9e9e';
        const color = storedColor || defaultColor;
        const size = parseInt(localStorage.getItem(`size-${ds}`) || '10');

        result.push(new IconLayer({
            id: `mno-${ds}${idSuffix}`,
            data,
            pickable: true,
            getPosition: d => [d.lng, d.lat],
            getIcon: () => getCachedIcon(shape, color),
            getSize: size,
            sizeUnits: 'pixels',
            updateTriggers: {
                getIcon: [shape, color],
                getSize: [size]
            }
        }));
    });
    return result;
}

export function createCoverageHeatmap(coverageGrid, groundTruthGrid = null) {
    const layers = [];

    if (coverageGrid && coverageGrid.length > 0) {
        layers.push(new HeatmapLayer({
            id: 'heatmap-layer',
            data: coverageGrid,
            getPosition: d => [d.lng, d.lat],
            getWeight: d => {
                if (d.rsrp >= -65) return 1.0;
                if (d.rsrp >= -75) return 0.8;
                if (d.rsrp >= -85) return 0.6;
                if (d.rsrp >= -95) return 0.4;
                if (d.rsrp >= -105) return 0.2;
                return 0.05;
            },
            colorRange: [
                [0, 102, 204],   // Poor (Dark Blue)
                [0, 204, 102],   // Fair (Green)
                [255, 255, 0],   // Good (Yellow)
                [255, 153, 51],  // Very Good (Orange)
                [204, 0, 0]      // Excellent (Deep Red)
            ],
            radiusPixels: 35,
            intensity: 2,
            threshold: 0.1,
            debounceTimeout: 200,       // Prevent freeze during pan/zoom
            weightsTextureSize: 512,    // Smaller texture = faster rendering
        }));
    }

    if (groundTruthGrid && groundTruthGrid.length > 0) {
        // Overlay Ground Truth as dots to see "Reality" vs "Sim"
        layers.push(new ScatterplotLayer({
            id: 'ground-truth-layer',
            data: groundTruthGrid,
            getPosition: d => [d.lng, d.lat],
            getRadius: 40,
            getFillColor: d => {
                // Different color palette for Ground Truth to distinguish
                if (d.rsrp >= -85) return [255, 255, 255, 150]; // White/Strong
                return [100, 100, 100, 100]; // Grey/Weak
            },
            pickable: false
        }));
    }

    return layers;
}

export function createPopulationHexagons(populationGrid, { idSuffix = '' } = {}) {
    if (!populationGrid || populationGrid.length === 0) return [];

    // Flat PolygonLayer with geohash cell shapes — seamless tiled coverage
    return new PolygonLayer({
        id: 'pop-density-layer' + idSuffix,
        data: populationGrid,
        getPolygon: d => d.polygon,
        getFillColor: d => popDensityColor(d.density),
        getLineColor: [0, 0, 0, 0],
        getLineWidth: 0,
        filled: true,
        stroked: false,
        opacity: 0.55,
        pickable: false,
        extruded: false,
        parameters: { depthWrite: false }
    });
}

function popDensityColor(density) {
    if (density <= 0) return [30, 30, 50, 0];
    if (density <= 100) return [33, 150, 243, 130];      // Sparse — faint blue (slightly more visible)
    if (density <= 500) return [66, 165, 245, 120];     // Rural — light blue
    if (density <= 1000) return [0, 200, 83, 135];       // Suburban low — green
    if (density <= 2000) return [76, 175, 80, 150];      // Suburban — dark green
    if (density <= 5000) return [255, 235, 59, 155];     // Urban — yellow
    if (density <= 10000) return [255, 152, 0, 170];      // Dense urban — orange
    return [244, 67, 54, 190];                            // Metro core — red
}

export function getRSRPColor(rsrp) {
    if (rsrp >= -75) return [0, 230, 118];    // Excellent - Green
    if (rsrp >= -85) return [139, 195, 74];   // Good - Light Green
    if (rsrp >= -95) return [255, 235, 59];   // Fair - Yellow
    if (rsrp >= -105) return [255, 152, 0];   // Poor - Orange
    if (rsrp >= -115) return [244, 67, 54];   // Very Poor - Dark Red
    return [183, 28, 28];                     // Dead Zone - Red
}


export function createArcLayer(tower, mnoSites, targetMNO) {
    if (!tower || !mnoSites || mnoSites.length === 0) return [];
    
    // "Comp." usually means all competitors.
    const targets = (targetMNO === 'All' || targetMNO === 'Comp.')
        ? [...MNOS]
        : [targetMNO];
    const relevantSites = [];
    targets.forEach(mno => {
        const towerMNO = normalizeMNO(tower.mno || tower.anchor || '');
        if (towerMNO === mno) return;
        
        const closest = mnoSites
            .filter(s => normalizeMNO(s.mno || s.anchor || '') === mno)
            .map(s => ({ ...s, distKm: haversineDistance(tower.lat, tower.lng, s.lat, s.lng) }))
            // CRITICAL: Filter out redundant sites (<100m) just like colocation-engine.js does!
            .filter(s => s.distKm > 0.1)
            .sort((a, b) => a.distKm - b.distKm)[0];
        if (closest) relevantSites.push(closest);
    });
    if (relevantSites.length === 0) return [];

    const arcLayer = new ArcLayer({
        id: `arc-layer-${tower.id || 'sel'}`,
        data: relevantSites,
        getSourcePosition: () => [tower.lng, tower.lat],
        getTargetPosition: d => [d.lng, d.lat],
        getSourceColor: [255, 255, 255, 200],
        getTargetColor: d => [...(MNO_COLORS[d.mno] || [158, 158, 158]), 255],
        getWidth: 3,
        greatCircle: false,
        parameters: {
            depthWrite: false,
            depthTest: false
        }
    });

    // Distance labels at arc midpoints
    const labelData = relevantSites.map(s => {
        const midLng = (tower.lng + s.lng) / 2;
        const midLat = (tower.lat + s.lat) / 2;
        const distM = Math.round(s.distKm * 1000);
        const label = distM >= 1000 ? `${(distM / 1000).toFixed(1)}km` : `${distM}m`;
        return { position: [midLng, midLat], text: label, mno: s.mno };
    });

    const textLayer = new TextLayer({
        id: `arc-dist-labels-${tower.id || 'sel'}`,
        data: labelData,
        getPosition: d => d.position,
        getText: d => d.text,
        getSize: 14,
        getColor: [255, 255, 255, 255],
        getBackgroundColor: [0, 0, 0, 180],
        background: true,
        backgroundPadding: [4, 2, 4, 2],
        fontWeight: 700,
        fontFamily: 'monospace',
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        billboard: true,
        sizeUnits: 'pixels',
        updateTriggers: {
            getPosition: [tower.lng, tower.lat],
            getText: [relevantSites.length]
        }
    });

    return [arcLayer, textLayer];
}

export function createPopulationRings(tower) {
    if (!tower) return null;
    const rings = [
        { radius: 1500, color: [0, 150, 255, 40] },
        { radius: 1000, color: [0, 150, 255, 70] },
        { radius: 500, color: [0, 150, 255, 100] }
    ];
    return new ScatterplotLayer({
        id: `ring-layer-${tower.id || 'sel'}`,
        data: rings,
        getPosition: d => [tower.lng, tower.lat],
        getRadius: d => d.radius,
        getFillColor: d => d.color,
        getLineColor: [0, 150, 255, 200],
        stroked: true,
        filled: true,
        radiusScale: 1,
        radiusUnits: 'meters',
        radiusMinPixels: 3,
        pickable: false,
        lineWidthUnits: 'pixels',
        getLineWidth: 2,
        parameters: {
            depthWrite: false, 
            depthTest: false
        },
        updateTriggers: {
            getPosition: [tower.lng, tower.lat]
        }
    });
}

/**
 * Potential Landbank Areas: high-pop (>2000/1km) where 2 or 3 MNO are missing.
 * @param {Array} data - [{ lat, lng, mnMissing (2|3), population }]
 * @param {Object} opts - { idSuffix: '' } for comparison view
 * @returns {ScatterplotLayer}
 */
export function createPotentialLandbankLayer(data, opts = {}) {
    if (!data || data.length === 0) return null;
    const idSuffix = opts.idSuffix || '';
    return new ScatterplotLayer({
        id: `potential-landbank-areas${idSuffix}`,
        data,
        getPosition: d => [d.lng, d.lat],
        getRadius: d => d.mnMissing === 3 ? 120 : 90,
        radiusUnits: 'meters',
        getFillColor: d => d.mnMissing === 3 ? [128, 128, 128, 200] : [255, 255, 255, 220],
        getLineColor: d => d.mnMissing === 3 ? [80, 80, 80, 255] : [200, 200, 200, 255],
        stroked: true,
        filled: true,
        lineWidthMinPixels: 1,
        radiusMinPixels: 6,
        radiusMaxPixels: 24,
        pickable: true,
        parameters: { depthWrite: false }
    });
}

/**
 * Draw polygon for MNO area compare (open path while drawing, closed ring when done).
 * Draft uses only clicked vertices — no cursor rubber-band (avoids jitter vs map picks).
 * @param {{ vertices?: number[][], closedRing?: number[][], idSuffix?: string }} opts
 */
export function createPolygonCompareDrawLayers(opts = {}) {
    const { vertices = [], closedRing = null, idSuffix = '' } = opts;
    const suf = idSuffix || '';
    const layers = [];

    if (closedRing && closedRing.length >= 4) {
        const path = closedRing;
        layers.push(new PathLayer({
            id: `polygon-compare-outline${suf}`,
            data: [{ path }],
            getPath: d => d.path,
            getColor: [0, 229, 255, 255],
            // Meters: outline scales with zoom like the filled ring (geographic anchoring).
            getWidth: 90,
            widthUnits: 'meters',
            pickable: false
        }));
        // Do not run deck's polygon "normalize" on WGS84 rings — it rewinds in degree space and
        // breaks triangulation for large areas (islands), causing spikes / self-crossing fills.
        layers.push(new PolygonLayer({
            id: `polygon-compare-fill${suf}`,
            data: [{ polygon: closedRing }],
            getPolygon: d => d.polygon,
            _normalize: false,
            getFillColor: [0, 229, 255, 45],
            stroked: false,
            filled: true,
            pickable: false
        }));
        return layers;
    }

    if (vertices.length >= 2) {
        layers.push(new PathLayer({
            id: `polygon-compare-draft${suf}`,
            data: [{ path: vertices }],
            getPath: d => d.path,
            getColor: [255, 214, 0, 230],
            getWidth: 75,
            widthUnits: 'meters',
            pickable: false
        }));
    } else if (vertices.length === 1) {
        layers.push(new ScatterplotLayer({
            id: `polygon-compare-vertex${suf}`,
            data: [{ position: vertices[0] }],
            getPosition: d => d.position,
            getFillColor: [255, 214, 0, 220],
            getRadius: 8,
            radiusUnits: 'pixels',
            pickable: false
        }));
    }

    // Static closing chord: last corner → first (exact segment used when you Finish / double-click)
    if (vertices.length >= 3) {
        const last = vertices[vertices.length - 1];
        const first = vertices[0];
        layers.push(new PathLayer({
            id: `polygon-compare-close-chord${suf}`,
            data: [{ path: [last, first] }],
            getPath: d => d.path,
            getColor: [0, 229, 255, 140],
            getWidth: 55,
            widthUnits: 'meters',
            pickable: false
        }));
    }
    return layers;
}

/**
 * @param {number[][]} points - Current 0, 1, or 2 points [lng, lat]
 * @param {{ start: number[], end: number[], distKm: number } | null} lastSegment - Leaflet-style: completed measurement to keep visible
 */
export function createMeasureLayer(points, lastSegment = null) {
    const layers = [];
    // Completed segment (line + label) stays on map until next measurement
    if (lastSegment) {
        const { start, end, distKm } = lastSegment;
        layers.push(new LineLayer({ id: 'measure-line-last', data: [{ start, end }], getSourcePosition: d => d.start, getTargetPosition: d => d.end, getColor: [255, 214, 0], getWidth: 3, pickable: false }));
        const mid = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
        const text = distKm < 1 ? `${Math.round(distKm * 1000)}m` : `${distKm.toFixed(2)}km`;
        layers.push(new TextLayer({ id: 'measure-text-last', data: [{ position: mid, text }], getPosition: d => d.position, getText: d => d.text, getSize: 16, getColor: [255, 255, 255], getBackgroundColor: [0, 0, 0, 150], getAlignmentBaseline: 'bottom', pixelOffset: [0, -10], pickable: false }));
    }
    if (points && points.length > 0) {
        layers.push(new ScatterplotLayer({ id: 'measure-dots', data: points, getPosition: d => d, getFillColor: [255, 214, 0], getRadius: 20, radiusMinPixels: 4, radiusMaxPixels: 10, pickable: false }));
        if (points.length === 2) {
            const dist = haversineDistance(points[0][1], points[0][0], points[1][1], points[1][0]);
            layers.push(new LineLayer({ id: 'measure-line', data: [{ start: points[0], end: points[1] }], getSourcePosition: d => d.start, getTargetPosition: d => d.end, getColor: [255, 214, 0], getWidth: 3, pickable: false }));
            layers.push(new TextLayer({ id: 'measure-text', data: [{ position: [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2], text: dist < 1 ? `${Math.round(dist * 1000)}m` : `${dist.toFixed(2)}km` }], getPosition: d => d.position, getText: d => d.text, getSize: 16, getColor: [255, 255, 255], getBackgroundColor: [0, 0, 0, 150], getAlignmentBaseline: 'bottom', pixelOffset: [0, -10], pickable: false }));
        }
    }
    return layers;
}

/**
 * Render KML-imported search ring polygons and antenna arrows.
 * @param {Object} geojson - GeoJSON FeatureCollection from kmlToGeoJSON()
 */
export function createSearchRingLayer(geojson) {
    if (!geojson || !geojson.features || geojson.features.length === 0) return [];

    return new GeoJsonLayer({
        id: 'search-rings-layer',
        data: geojson,
        pickable: true,
        stroked: true,
        filled: true,
        lineWidthMinPixels: 1,
        updateTriggers: {
            getFillColor: [geojson],
            getLineColor: [geojson],
            getLineWidth: [geojson]
        },
        getLineColor: f => {
            const p = f.properties;
            if (p.lineColor) return p.lineColor;
            if (p.lineType === 'arrow' || p.lineType === 'arrowhead') return [0, 255, 255, 220];
            return [255, 255, 255, 200];
        },
        getFillColor: f => {
            const p = f.properties;
            if (p.fillColor) return p.fillColor;
            if (p.polyType === 'inner') return [255, 255, 255, 30];
            if (p.polyType === 'extended') return [255, 0, 0, 40];
            return [255, 255, 255, 20];
        },
        getLineWidth: f => {
            const p = f.properties;
            if (p.lineWidth) return p.lineWidth;
            if (p.lineType === 'arrowhead') return 3;
            return 2;
        },
        lineWidthUnits: 'pixels',
        autoHighlight: true,
        highlightColor: [0, 229, 255, 80],
        getTooltip: f => f.properties.name
    });
}
/**
 * Render a georeferenced raster image overlay.
 */
export function createRasterLayer(id, url, bounds, { opacity = 0.7 } = {}) {
    if (!url || !bounds) return [];

    return new BitmapLayer({
        id: `raster-${id}`,
        bounds: [
            [bounds.west, bounds.south],
            [bounds.west, bounds.north],
            [bounds.east, bounds.north],
            [bounds.east, bounds.south]
        ],
        image: url,
        opacity,
        pickable: false,
        parameters: { depthWrite: false }
    });
}
/**
 * Render an interactive raw data grid from a raster.
 */
export function createRawRasterLayer(data, { idSuffix = '', opacity = 0.8 } = {}) {
    if (!data || data.length === 0) return [];

    return [
        new ScatterplotLayer({
            id: `raster-raw-${idSuffix}`,
            data,
            pickable: true,
            getPosition: d => [d.lng, d.lat],
            getFillColor: d => getRSRPColor(d.rsrp),
            getRadius: 8, // Reduced from 12 to ensure total site visibility
            radiusUnits: 'meters',
            radiusMinPixels: 1,
            radiusMaxPixels: 6,
            opacity,
            updateTriggers: {
                getFillColor: [data.length]
            },
            parameters: { depthWrite: false }
        })
    ];
}
