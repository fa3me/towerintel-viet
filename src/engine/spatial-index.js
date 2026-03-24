/**
 * Simple Spatial Grid for fast proximity lookups
 * Partitions sites into grid cells of ~2km to avoid O(N^2) comparisons
 */
export function createSpatialIndex(sites, cellSize = 0.02) { // ~2km cells
    const grid = new Map();

    for (const site of sites) {
        const gx = Math.floor(site.lat / cellSize);
        const gy = Math.floor(site.lng / cellSize);
        const key = `${gx},${gy}`;

        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(site);
    }

    return {
        grid,
        cellSize,
        getNearby: (lat, lng, radiusKm = 5) => {
            const cellsToCheck = Math.ceil(radiusKm / 111 / cellSize); // Roughly 1deg = 111km
            const gx = Math.floor(lat / cellSize);
            const gy = Math.floor(lng / cellSize);
            const results = [];

            for (let x = gx - cellsToCheck; x <= gx + cellsToCheck; x++) {
                for (let y = gy - cellsToCheck; y <= gy + cellsToCheck; y++) {
                    const cell = grid.get(`${x},${y}`);
                    if (cell) results.push(...cell);
                }
            }
            return results;
        }
    };
}
