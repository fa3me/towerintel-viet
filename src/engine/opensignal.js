/**
 * TowerIntel PH — OpenSignal API integration (stub)
 *
 * Signal heatmap is intended to use OpenSignal coverage/signal data.
 * OpenSignal (Ookla) does not expose a public cell-tower API; enterprise data
 * is available via ONX/Opensignal Network Experience. This module provides a
 * placeholder for when an API key or backend proxy is available.
 *
 * Current heatmap data sources in the app:
 * - OpenCelliD (real API when key is set)
 * - WiGle.net (real API when credentials are set)
 * - OpenSignal: simulated data via "Sync Multiple Sources" with OpenSignal selected
 *
 * To wire real OpenSignal data: implement fetchOpenSignalCells to call your
 * OpenSignal/ONX API or backend proxy and return the same site shape as other
 * sync sources (id, lat, lng, mno, rsrp, etc.).
 */

/**
 * Fetch signal/coverage points from OpenSignal for a bounding box.
 * @param {Object} bounds - { north, south, east, west }
 * @param {string} apiKey - OpenSignal/ONX API key (if available)
 * @returns {Promise<Array>} Array of site points; empty if no API or no key
 */
export async function fetchOpenSignalCells(bounds, apiKey) {
    if (!apiKey || apiKey.trim() === '') {
        console.warn('OpenSignal: No API key configured. Signal heatmap uses OpenCelliD, WiGle, or simulated data. OpenSignal enterprise API (ONX) requires separate access.');
        return [];
    }
    // TODO: When OpenSignal/ONX API is available, call it here and map response to
    // the same format as OpenCelliD/WiGle: { id, lat, lng, mno, rsrp, sourceType, ... }
    console.warn('OpenSignal API integration not yet implemented. Using simulated data when "OpenSignal" is selected in Sync.');
    return [];
}
