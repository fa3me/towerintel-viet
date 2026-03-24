/**
 * TowerIntel PH — RF Propagation Map Layer v3
 * Renders viewshed as polygon wedge cells (Google Earth style)
 * and simple coverage rings for quick preview mode
 */
import { ScatterplotLayer } from '@deck.gl/layers';
import { PolygonLayer } from '@deck.gl/layers';
import { generateCoverageRings } from '../engine/propagation.js';

/**
 * Simple coverage rings (non-viewshed mode)
 */
export function createPropagationLayers(towers, params) {
    if (!towers || towers.length === 0) return [];

    const allRings = [];
    towers.forEach((tower, tIdx) => {
        const towerParams = {
            ...params,
            height_m: tower.height_m || params.height_m || 30,
            terrain_type: tower.terrain_type || params.terrain_type || 'Suburban'
        };
        const rings = generateCoverageRings(tower, towerParams);
        rings.forEach((ring, rIdx) => {
            allRings.push({ ...ring, towerId: tower.id, index: tIdx * 10 + rIdx });
        });
    });

    return [
        new ScatterplotLayer({
            id: 'propagation-coverage',
            data: allRings.sort((a, b) => b.radiusM - a.radiusM),
            getPosition: d => d.center,
            getRadius: d => d.radiusM,
            getFillColor: d => d.color,
            getLineColor: d => [...d.color.slice(0, 3), 150],
            filled: true,
            stroked: true,
            lineWidthMinPixels: 1,
            radiusUnits: 'meters',
            pickable: true,
            opacity: 0.6,
        })
    ];
}

/**
 * Viewshed polygon layer — renders wedge-shaped cells colored
 * green (visible/LOS clear) or red (blocked by terrain)
 * Like Google Earth's Show Viewshed
 */
export function createViewshedLayer(viewshedResult) {
    if (!viewshedResult || !viewshedResult.points || viewshedResult.points.length === 0) return [];

    const points = viewshedResult.points;

    return [
        new PolygonLayer({
            id: 'viewshed-polygons',
            data: points,
            getPolygon: d => d.polygon,
            getFillColor: d => d.color,
            getLineColor: [255, 255, 255, 20],
            filled: true,
            stroked: true,
            lineWidthMinPixels: 0.5,
            pickable: true,
            opacity: 0.75,
            updateTriggers: {
                getFillColor: [points.length],
                getPolygon: [points.length]
            }
        })
    ];
}
