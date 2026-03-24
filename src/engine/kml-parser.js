/**
 * KML Parser — Converts KML file content to GeoJSON features for deck.gl rendering.
 * 
 * Extracts:
 * - Point placemarks (site markers)
 * - Polygon placemarks (search rings, extended polygons)
 * - LineString placemarks (antenna orientation arrows)
 */

/**
 * Parse KML XML string and return structured geospatial data.
 * @param {string} kmlText - Raw KML file content
 * @returns {{ points: Array, polygons: Array, lines: Array, folders: Array }}
 */
export function parseKML(kmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(kmlText, 'application/xml');

    const points = [];
    const polygons = [];
    const lines = [];
    const folders = [];

    // Process each folder (= one site)
    const kmlFolders = doc.querySelectorAll('Folder');

    for (const folder of kmlFolders) {
        const folderName = folder.querySelector(':scope > name')?.textContent || 'Unnamed';
        folders.push(folderName);

        const placemarks = folder.querySelectorAll('Placemark');
        for (const pm of placemarks) {
            const name = pm.querySelector('name')?.textContent || '';
            const desc = pm.querySelector('description')?.textContent || '';

            // Check for Point
            const point = pm.querySelector('Point coordinates');
            if (point) {
                const coords = parseCoordString(point.textContent);
                if (coords.length > 0) {
                    points.push({
                        name, description: desc, folder: folderName,
                        lng: coords[0][0], lat: coords[0][1],
                        type: 'search_ring_point'
                    });
                }
                continue;
            }

            // Check for Polygon
            const polygon = pm.querySelector('Polygon outerBoundaryIs coordinates');
            if (polygon) {
                const coords = parseCoordString(polygon.textContent);
                if (coords.length >= 3) {
                    const style = extractStyle(pm);
                    polygons.push({
                        name, description: desc, folder: folderName,
                        coordinates: coords,
                        style,
                        type: name.includes('Inner') ? 'inner' :
                            name.includes('Extended') ? 'extended' :
                                name.includes('estimated') ? 'estimated' : 'polygon'
                    });
                }
                continue;
            }

            // Check for LineString (arrows)
            const lineString = pm.querySelector('LineString coordinates');
            if (lineString) {
                const coords = parseCoordString(lineString.textContent);
                if (coords.length >= 2) {
                    lines.push({
                        name, description: desc, folder: folderName,
                        coordinates: coords,
                        type: name.includes('head') ? 'arrowhead' : 'arrow'
                    });
                }
            }
        }
    }

    return { points, polygons, lines, folders };
}

/**
 * Parse a KML coordinate string into an array of [lng, lat, alt] arrays.
 */
function parseCoordString(text) {
    if (!text) return [];
    return text.trim().split(/\s+/)
        .map(s => s.split(',').map(Number))
        .filter(c => c.length >= 2 && !isNaN(c[0]) && !isNaN(c[1]));
}

/**
 * Extract basic style info from a Placemark.
 */
function extractStyle(pm) {
    const lineColor = pm.querySelector('LineStyle color')?.textContent;
    const lineWidth = pm.querySelector('LineStyle width')?.textContent;
    const polyColor = pm.querySelector('PolyStyle color')?.textContent;

    return {
        lineColor: kmlColorToRGBA(lineColor),
        lineWidth: lineWidth ? parseFloat(lineWidth) : 2,
        fillColor: kmlColorToRGBA(polyColor)
    };
}

/**
 * Convert KML color (aabbggrr) to [r, g, b, a] array (0-255).
 */
function kmlColorToRGBA(kmlColor) {
    if (!kmlColor || kmlColor.length !== 8) return [255, 255, 255, 100];
    const a = parseInt(kmlColor.substr(0, 2), 16);
    const b = parseInt(kmlColor.substr(2, 2), 16);
    const g = parseInt(kmlColor.substr(4, 2), 16);
    const r = parseInt(kmlColor.substr(6, 2), 16);
    return [r, g, b, a];
}

/**
 * Convert parsed KML data to GeoJSON FeatureCollection for deck.gl GeoJsonLayer.
 */
export function kmlToGeoJSON(kmlData) {
    const features = [];

    // Polygons → GeoJSON Polygon features
    for (const poly of kmlData.polygons) {
        const ring = poly.coordinates.map(c => [c[0], c[1]]);
        // Ensure ring is closed
        if (ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
            ring.push([...ring[0]]);
        }
        features.push({
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [ring] },
            properties: {
                name: poly.name,
                folder: poly.folder,
                description: poly.description,
                polyType: poly.type,
                fillColor: poly.style.fillColor,
                lineColor: poly.style.lineColor,
                lineWidth: poly.style.lineWidth
            }
        });
    }

    // Lines → GeoJSON LineString features
    for (const line of kmlData.lines) {
        features.push({
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: line.coordinates.map(c => [c[0], c[1]])
            },
            properties: {
                name: line.name,
                folder: line.folder,
                lineType: line.type
            }
        });
    }

    return { type: 'FeatureCollection', features };
}
