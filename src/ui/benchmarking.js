import { Deck } from '@deck.gl/core';
import maplibregl from 'maplibre-gl';
import { ScatterplotLayer } from '@deck.gl/layers';
import { MNO_COLORS } from '../layers/map-layers.js';
import { MNOS } from '../config/app-config.js';

/**
 * TowerIntel Vietnam — Benchmarking Module
 * Creates a split-screen map interface for side-by-side MNO comparison
 */
export function initBenchmarking(container, { mnoSites, initialViewState, onClose }) {
    container.innerHTML = `
        <div class="benchmark-header">
            <div style="display: flex; align-items: center; gap: 15px;">
                <h3 style="margin: 0; color: #00e5ff;">MNO Benchmarking</h3>
                <div class="kpi-selector">
                    <button class="kpi-btn active" data-kpi="rsrp">RSRP</button>
                    <button class="kpi-btn" data-kpi="rsrq">RSRQ</button>
                    <button class="kpi-btn" data-kpi="congestion">Congestion</button>
                </div>
            </div>
            <button id="close-benchmark" class="pitch-close">&times;</button>
        </div>
        <div class="benchmark-grid">
            <div class="benchmark-panel" id="panel-left">
                <div class="panel-controls">
                    <select class="mno-select" id="mno-left">
                        ${MNOS.map((m, i) => `<option value="${m}" ${i === 1 ? 'selected' : ''}>${m}</option>`).join('')}
                    </select>
                </div>
                <div id="map-left" class="benchmark-map"></div>
                <canvas id="canvas-left" class="benchmark-canvas"></canvas>
            </div>
            <div class="benchmark-panel" id="panel-right">
                <div class="panel-controls">
                    <select class="mno-select" id="mno-right">
                        ${MNOS.map((m, i) => `<option value="${m}" ${i === 0 ? 'selected' : ''}>${m}</option>`).join('')}
                    </select>
                </div>
                <div id="map-right" class="benchmark-map"></div>
                <canvas id="canvas-right" class="benchmark-canvas"></canvas>
            </div>
        </div>
        <div class="benchmark-legend">
            <div id="legend-label" style="font-size: 10px; color: #94a3b8; margin-bottom: 5px;">RSRP (dBm)</div>
            <div class="legend-bar"></div>
            <div class="legend-scale">
                <span>-110 (Poor)</span>
                <span>-95</span>
                <span>-80</span>
                <span>-65 (Exc)</span>
            </div>
        </div>
    `;

    let activeKPI = 'rsrp';
    let leftMNO = MNOS[1] || MNOS[0];
    let rightMNO = MNOS[0] || MNOS[0];
    
    let isSyncing = false;

    // KPI Color Mapping
    const getKPIColor = (val, kpi) => {
        if (kpi === 'rsrp') {
            if (val >= -80) return [0, 230, 118]; // Green
            if (val >= -95) return [255, 214, 0]; // Yellow
            return [255, 23, 68]; // Red
        }
        if (kpi === 'rsrq') {
            if (val >= -10) return [0, 230, 118];
            if (val >= -15) return [255, 214, 0];
            return [255, 23, 68];
        }
        if (kpi === 'congestion') {
            if (val < 0.3) return [0, 230, 118];
            if (val < 0.7) return [255, 214, 0];
            return [255, 23, 68];
        }
        return [150, 150, 150];
    };

    const createLayer = (mno, kpi) => {
        const data = mnoSites.filter(s => s.mno === mno);
        return new ScatterplotLayer({
            id: `benchmark-${mno}-${kpi}`,
            data,
            getPosition: d => [d.lng, d.lat],
            getRadius: 200,
            getFillColor: d => [...getKPIColor(d[kpi] || (kpi === 'rsrp' ? -105 : -15), kpi), 200],
            pickable: true,
            radiusMinPixels: 5,
            radiusMaxPixels: 15
        });
    };

    const initMap = (id, canvasId, mno) => {
        const map = new maplibregl.Map({
            container: id,
            style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
            interactive: true,
            center: [initialViewState.longitude, initialViewState.latitude],
            zoom: initialViewState.zoom
        });

        const deck = new Deck({
            canvas: canvasId,
            parent: document.getElementById(id).parentElement,
            initialViewState,
            controller: true,
            onViewStateChange: ({ viewState }) => {
                if (isSyncing) return;
                isSyncing = true;
                map.jumpTo({ center: [viewState.longitude, viewState.latitude], zoom: viewState.zoom, bearing: viewState.bearing, pitch: viewState.pitch });
                
                // Sync the other map
                const otherDeck = id === 'map-left' ? deckRight : deckLeft;
                const otherMap = id === 'map-left' ? mapRight : mapLeft;
                
                otherDeck.setProps({ viewState });
                otherMap.jumpTo({ center: [viewState.longitude, viewState.latitude], zoom: viewState.zoom, bearing: viewState.bearing, pitch: viewState.pitch });
                
                isSyncing = false;
            },
            layers: [createLayer(mno, activeKPI)]
        });

        return { map, deck };
    };

    const { map: mapLeft, deck: deckLeft } = initMap('map-left', 'canvas-left', leftMNO);
    const { map: mapRight, deck: deckRight } = initMap('map-right', 'canvas-right', rightMNO);

    // Event Listeners
    document.getElementById('close-benchmark').addEventListener('click', () => {
        container.style.display = 'none';
        onClose && onClose();
    });

    container.querySelectorAll('.kpi-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            container.querySelectorAll('.kpi-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeKPI = btn.dataset.kpi;
            
            // Update Legend
            const labels = {
                rsrp: { title: 'RSRP (dBm)', scale: ['-110 (Poor)', '-95', '-80', '-65 (Exc)'] },
                rsrq: { title: 'RSRQ (dB)', scale: ['-20 (Poor)', '-15', '-10', '-5 (Exc)'] },
                congestion: { title: 'Congestion (%)', scale: ['0 (Free)', '30', '70', '100 (Full)'] }
            };
            const l = labels[activeKPI];
            document.getElementById('legend-label').textContent = l.title;
            const scaleSpans = document.querySelectorAll('.legend-scale span');
            l.scale.forEach((text, i) => scaleSpans[i].textContent = text);

            deckLeft.setProps({ layers: [createLayer(leftMNO, activeKPI)] });
            deckRight.setProps({ layers: [createLayer(rightMNO, activeKPI)] });
        });
    });

    document.getElementById('mno-left').addEventListener('change', (e) => {
        leftMNO = e.target.value;
        deckLeft.setProps({ layers: [createLayer(leftMNO, activeKPI)] });
    });

    document.getElementById('mno-right').addEventListener('change', (e) => {
        rightMNO = e.target.value;
        deckRight.setProps({ layers: [createLayer(rightMNO, activeKPI)] });
    });

    container.style.display = 'block';
}
