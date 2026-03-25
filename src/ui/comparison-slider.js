import { MNOS, MNO_HEX } from '../config/app-config.js';
import { getLegendEntries } from '../engine/network-analysis.js';

/**
 * TowerIntel Vietnam — Comparison Slider
 * Draggable vertical split slider for MNO vs MNO or quarterly timeline comparison.
 * Side-by-side canvases: left strip is interactive; right shows the same geography (view fitted in main).
 */

function precisionLabel(p) {
    const n = Number(p);
    if (n <= 5) return 'City (~4.9 km)';
    if (n <= 6) return 'Neighborhood (~1.2 km)';
    if (n <= 7) return 'Street (~153 m)';
    return 'Building (~38 m)';
}

/**
 * Initialise the comparison slider UI inside the map container.
 *
 * @param {HTMLElement} container        The map-container element
 * @param {Object} options
 * @param {Function} options.onPositionChange   (normalizedX: 0–1) => void
 * @param {Function} options.onLeftChange       ({ mno, quarter }) => void
 * @param {Function} options.onRightChange      ({ mno, quarter }) => void
 * @param {Function} options.onClose            () => void
 * @param {Function} [options.onMetricChange]   (metric: string) => void
 * @param {Function} [options.onPrecisionChange] (precision: number) => void
 * @param {Function} [options.onMNOFilterChange] (mnos: string[]) => void
 * @param {string} [options.metric]           Initial analysis metric
 * @param {number} [options.precision]          Initial geohash precision
 * @param {string[]} [options.mnoFilter]        Which MNOs feed the grid
 * @param {Array<string>} options.mnos          Available MNO names
 * @param {Array<string>} options.quarters      Available quarter labels
 * @returns {{ el: HTMLElement, setPosition: Function, destroy: Function, syncIntelFromState: Function }}
 */
export function createComparisonSlider(container, options = {}) {
    const {
        onPositionChange = () => { },
        onLeftChange = () => { },
        onRightChange = () => { },
        onClose = () => { },
        onMetricChange = () => { },
        onPrecisionChange = () => { },
        onMNOFilterChange = () => { },
        metric: initialMetric = 'rsrp',
        precision: initialPrecision = 6,
        mnoFilter: initialMnoFilter = [...MNOS],
        mnos = [...MNOS],
        quarters = ['Current']
    } = options;

    let position = 0.5; // normalised 0–1
    let syncing = false;

    const metricOptions = [
        ['rsrp', '📡 Coverage (RSRP)'],
        ['rsrq', '📊 Quality (RSRQ)'],
        ['congestion', '🔥 Congestion'],
        ['supply', '🏗️ Supply (Sites)'],
        ['demand', '📈 Demand'],
        ['marketShare', '🏆 Market Share'],
        ['population', '👥 Population Density']
    ];

    const mnoChipsHtml = MNOS.map((m) => {
        const on = initialMnoFilter.includes(m) ? 'checked' : '';
        return `<label class="cs-chip" style="border-color:${MNO_HEX[m] || '#94a3b8'}"><input type="checkbox" value="${m}" ${on}> ${m}</label>`;
    }).join('');

    // ── Root element ─────────────────────────────────────────────────
    const root = document.createElement('div');
    root.id = 'comparison-slider';
    root.className = 'comparison-slider';
    root.innerHTML = `
        <div class="cs-header">
            <div class="cs-row cs-row-mno">
                <div class="cs-side cs-left-side">
                    <select class="cs-select cs-mno-left" title="Left MNO">
                        <option value="All">All MNOs</option>
                        ${mnos.map(m => `<option value="${m}">${m}</option>`).join('')}
                    </select>
                    <select class="cs-select cs-quarter-left" title="Left Quarter">
                        ${quarters.map(q => `<option value="${q}">${q}</option>`).join('')}
                    </select>
                </div>

                <button class="cs-close-btn" type="button" title="Close comparison">✕</button>

                <div class="cs-side cs-right-side">
                    <select class="cs-select cs-mno-right" title="Right MNO">
                        <option value="All">All MNOs</option>
                        ${mnos.map((m, i) => `<option value="${m}" ${i === 1 ? 'selected' : ''}>${m}</option>`).join('')}
                    </select>
                    <select class="cs-select cs-quarter-right" title="Right Quarter">
                        ${quarters.map(q => `<option value="${q}">${q}</option>`).join('')}
                    </select>
                </div>
            </div>

            <div class="cs-row cs-row-tools">
                <label class="cs-mini-lbl">Analysis</label>
                <select class="cs-select cs-metric" title="Heatmap metric">
                    ${metricOptions.map(([v, lab]) => `<option value="${v}" ${v === initialMetric ? 'selected' : ''}>${lab}</option>`).join('')}
                </select>
                <label class="cs-mini-lbl">Grid</label>
                <span class="cs-precision-val">${precisionLabel(initialPrecision)}</span>
                <input type="range" class="cs-precision-range" min="5" max="8" step="1" value="${initialPrecision}" title="Geohash resolution" />
                <div class="cs-mno-chips">${mnoChipsHtml}</div>
            </div>

            <div class="cs-row cs-row-legend">
                <span class="cs-legend-title">Legend</span>
                <div class="cs-legend-items"></div>
            </div>
        </div>

        <div class="cs-track">
            <div class="cs-label cs-label-left">◀</div>
            <div class="cs-handle" title="Drag to compare">
                <div class="cs-handle-line"></div>
                <div class="cs-handle-grip">
                    <span>⇔</span>
                </div>
                <div class="cs-handle-line"></div>
            </div>
            <div class="cs-label cs-label-right">▶</div>
        </div>
    `;

    container.appendChild(root);

    // ── DOM references ───────────────────────────────────────────────
    const handle = root.querySelector('.cs-handle');
    const track = root.querySelector('.cs-track');
    const mnoLeftSel = root.querySelector('.cs-mno-left');
    const mnoRightSel = root.querySelector('.cs-mno-right');
    const quarterLeftSel = root.querySelector('.cs-quarter-left');
    const quarterRightSel = root.querySelector('.cs-quarter-right');
    const closeBtn = root.querySelector('.cs-close-btn');
    const metricSel = root.querySelector('.cs-metric');
    const precisionRange = root.querySelector('.cs-precision-range');
    const precisionValEl = root.querySelector('.cs-precision-val');
    const legendItemsEl = root.querySelector('.cs-legend-items');
    const mnoChipInputs = root.querySelectorAll('.cs-mno-chips input');

    function renderLegend(m) {
        if (!legendItemsEl) return;
        const entries = getLegendEntries(m) || [];
        legendItemsEl.innerHTML = entries.slice(0, 8).map((e) => {
            const lab = String(e.label);
            const short = lab.length > 20 ? `${lab.slice(0, 18)}…` : lab;
            return `
            <span class="cs-legend-pair" title="${lab.replace(/"/g, '&quot;')}">
                <span class="cs-legend-swatch" style="background:${e.color};"></span>
                <span class="cs-legend-txt">${short}</span>
            </span>`;
        }).join('');
    }

    renderLegend(initialMetric);

    // ── Drag logic ───────────────────────────────────────────────────
    let isDragging = false;
    const dragOverlay = document.createElement('div');
    dragOverlay.className = 'cs-drag-overlay';
    dragOverlay.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; z-index:9000; cursor:col-resize; display:none;';
    document.body.appendChild(dragOverlay);

    const canvasLeft = document.getElementById('map-canvas');
    const canvasRight = document.getElementById('map-canvas-right');

    /** Same geographic bounds on both panes: left canvas is the interactive strip; right matches via fitBounds in main. */
    function applySplitLayout(xNorm) {
        let x = Math.max(0.01, Math.min(0.99, xNorm));
        position = x;

        handle.style.left = `${x * 100}%`;

        const leftLabel = root.querySelector('.cs-label-left');
        const rightLabel = root.querySelector('.cs-label-right');
        if (leftLabel) leftLabel.style.left = `${x * 50}%`;
        if (rightLabel) rightLabel.style.left = `${x * 100 + (100 - x * 100) / 2}%`;

        const percLeft = x * 100;
        const percRight = 100 - percLeft;

        if (canvasLeft) {
            canvasLeft.style.clipPath = '';
            canvasLeft.style.position = 'absolute';
            canvasLeft.style.top = '0';
            canvasLeft.style.left = '0';
            canvasLeft.style.height = '100%';
            canvasLeft.style.width = `${percLeft}%`;
        }
        if (canvasRight) {
            canvasRight.style.display = 'none';
            canvasRight.style.pointerEvents = 'none';
        }

        const mapLeftEl = document.getElementById('map');
        const mapRightEl = document.getElementById('map-right');
        if (mapLeftEl) {
            mapLeftEl.style.position = 'absolute';
            mapLeftEl.style.top = '0';
            mapLeftEl.style.bottom = '0';
            mapLeftEl.style.left = '0';
            mapLeftEl.style.width = `${percLeft}%`;
        }
        if (mapRightEl) {
            mapRightEl.style.display = 'block';
            mapRightEl.style.position = 'absolute';
            mapRightEl.style.top = '0';
            mapRightEl.style.bottom = '0';
            mapRightEl.style.left = `${percLeft}%`;
            mapRightEl.style.width = `${percRight}%`;
        }

        onPositionChange(x);
    }

    function updatePosition(clientX) {
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const x = (clientX - rect.left) / rect.width;
        applySplitLayout(x);
    }

    function onPointerDown(e) {
        isDragging = true;
        handle.classList.add('dragging');
        dragOverlay.style.display = 'block';
        document.body.style.cursor = 'col-resize';
        e.preventDefault();
        e.stopPropagation();
    }

    function onPointerMove(e) {
        if (!isDragging) return;
        const clientX = e.clientX || (e.touches && e.touches[0].clientX);
        if (clientX != null) updatePosition(clientX);
    }

    function onPointerUp() {
        if (!isDragging) return;
        isDragging = false;
        handle.classList.remove('dragging');
        dragOverlay.style.display = 'none';
        document.body.style.cursor = '';
    }

    handle.addEventListener('mousedown', onPointerDown);
    handle.addEventListener('touchstart', onPointerDown, { passive: false });

    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('touchmove', onPointerMove, { passive: false });
    window.addEventListener('mouseup', onPointerUp);
    window.addEventListener('touchend', onPointerUp);

    // ── Selectors ────────────────────────────────────────────────────
    function emitLeft() {
        onLeftChange({ mno: mnoLeftSel.value, quarter: quarterLeftSel.value });
    }
    function emitRight() {
        onRightChange({ mno: mnoRightSel.value, quarter: quarterRightSel.value });
    }

    mnoLeftSel.addEventListener('change', emitLeft);
    quarterLeftSel.addEventListener('change', emitLeft);
    mnoRightSel.addEventListener('change', emitRight);
    quarterRightSel.addEventListener('change', emitRight);

    metricSel.addEventListener('change', () => {
        if (syncing) return;
        renderLegend(metricSel.value);
        onMetricChange(metricSel.value);
    });

    precisionRange.addEventListener('input', () => {
        if (syncing) return;
        const val = parseInt(precisionRange.value, 10);
        if (precisionValEl) precisionValEl.textContent = precisionLabel(val);
        onPrecisionChange(val);
    });

    mnoChipInputs.forEach((cb) => {
        cb.addEventListener('change', () => {
            if (syncing) return;
            const selected = [...mnoChipInputs].filter((c) => c.checked).map((c) => c.value);
            if (selected.length === 0) {
                cb.checked = true;
                return;
            }
            onMNOFilterChange(selected);
        });
    });

    function resetSplitBasemapDom() {
        const mapLeftEl = document.getElementById('map');
        const mapRightEl = document.getElementById('map-right');
        if (mapLeftEl) {
            mapLeftEl.style.width = '100%';
            mapLeftEl.style.left = '0';
        }
        if (mapRightEl) mapRightEl.style.display = 'none';
    }

    closeBtn.addEventListener('click', () => {
        root.classList.remove('active');
        if (canvasLeft) {
            canvasLeft.style.clipPath = '';
            canvasLeft.style.left = '0';
            canvasLeft.style.width = '100%';
        }
        if (canvasRight) {
            canvasRight.style.display = 'none';
            canvasRight.style.clipPath = '';
        }
        resetSplitBasemapDom();
        onClose();
    });

    // ── Public API ───────────────────────────────────────────────────
    function show() {
        if (!container) return;
        root.classList.add('active');
        const rect = container.getBoundingClientRect();
        updatePosition(rect.left + rect.width / 2);
    }

    function hide() {
        root.classList.remove('active');
        if (canvasLeft) {
            canvasLeft.style.clipPath = '';
            canvasLeft.style.left = '0';
            canvasLeft.style.width = '100%';
        }
        if (canvasRight) {
            canvasRight.style.display = 'none';
            canvasRight.style.pointerEvents = 'none';
            canvasRight.style.clipPath = '';
        }
        resetSplitBasemapDom();
    }

    function setPosition(x) {
        applySplitLayout(x);
    }

    function getPosition() {
        return position;
    }

    function updateQuarters(newQuarters) {
        [quarterLeftSel, quarterRightSel].forEach(sel => {
            sel.innerHTML = newQuarters.map(q => `<option value="${q}">${q}</option>`).join('');
        });
    }

    function getSelections() {
        return {
            left: { mno: mnoLeftSel.value, quarter: quarterLeftSel.value },
            right: { mno: mnoRightSel.value, quarter: quarterRightSel.value }
        };
    }

    /** Sync dropdowns and rebuild grids (used by polygon MNO compare). */
    function setMNOSelections(leftMno, rightMno) {
        const leftOk = [...mnoLeftSel.options].some(o => o.value === leftMno);
        const rightOk = [...mnoRightSel.options].some(o => o.value === rightMno);
        if (leftOk) mnoLeftSel.value = leftMno;
        if (rightOk) mnoRightSel.value = rightMno;
        emitLeft();
        emitRight();
    }

    /**
     * @param {{ metric?: string, precision?: number, mnoFilter?: string[] }} ni  networkIntel slice
     */
    function syncIntelFromState(ni) {
        if (!ni) return;
        syncing = true;
        try {
            if (ni.metric && metricSel) {
                metricSel.value = ni.metric;
                renderLegend(ni.metric);
            }
            if (ni.precision != null && precisionRange && precisionValEl) {
                precisionRange.value = String(ni.precision);
                precisionValEl.textContent = precisionLabel(ni.precision);
            }
            if (Array.isArray(ni.mnoFilter) && mnoChipInputs.length) {
                mnoChipInputs.forEach((cb) => {
                    cb.checked = ni.mnoFilter.includes(cb.value);
                });
            }
        } finally {
            syncing = false;
        }
    }

    function destroy() {
        window.removeEventListener('mousemove', onPointerMove);
        window.removeEventListener('touchmove', onPointerMove);
        window.removeEventListener('mouseup', onPointerUp);
        window.removeEventListener('touchend', onPointerUp);
        if (dragOverlay && dragOverlay.parentNode) dragOverlay.parentNode.removeChild(dragOverlay);
        root.remove();
    }

    return { el: root, show, hide, setPosition, getPosition, getSelections, setMNOSelections, updateQuarters, syncIntelFromState, destroy };
}
