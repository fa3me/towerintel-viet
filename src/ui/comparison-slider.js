import { MNOS } from '../config/app-config.js';

/**
 * TowerIntel Vietnam — Comparison Slider
 * Draggable vertical split slider for MNO vs MNO or quarterly timeline comparison.
 * Side-by-side canvases: left strip is interactive; right shows the same geography (view fitted in main).
 */

/**
 * Initialise the comparison slider UI inside the map container.
 *
 * @param {HTMLElement} container        The map-container element
 * @param {Object} options
 * @param {Function} options.onPositionChange   (normalizedX: 0–1) => void
 * @param {Function} options.onLeftChange       ({ mno, quarter }) => void
 * @param {Function} options.onRightChange      ({ mno, quarter }) => void
 * @param {Function} options.onClose            () => void
 * @param {Array<string>} options.mnos          Available MNO names
 * @param {Array<string>} options.quarters      Available quarter labels
 * @returns {{ el: HTMLElement, setPosition: Function, destroy: Function }}
 */
export function createComparisonSlider(container, options = {}) {
    const {
        onPositionChange = () => { },
        onLeftChange = () => { },
        onRightChange = () => { },
        onClose = () => { },
        mnos = [...MNOS],
        quarters = ['Current']
    } = options;

    let position = 0.5; // normalised 0–1

    // ── Root element ─────────────────────────────────────────────────
    const root = document.createElement('div');
    root.id = 'comparison-slider';
    root.className = 'comparison-slider';
    root.innerHTML = `
        <div class="cs-header">
            <div class="cs-side cs-left-side">
                <select class="cs-select cs-mno-left" title="Left MNO">
                    <option value="All">All MNOs</option>
                    ${mnos.map(m => `<option value="${m}">${m}</option>`).join('')}
                </select>
                <select class="cs-select cs-quarter-left" title="Left Quarter">
                    ${quarters.map(q => `<option value="${q}">${q}</option>`).join('')}
                </select>
            </div>

            <button class="cs-close-btn" title="Close comparison">✕</button>

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

    // ── Drag logic ───────────────────────────────────────────────────
    let isDragging = false;
    // Overlay to protect against map interactions during drag
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
        // Right vector layers render via @deck.gl/mapbox MapboxOverlay inside #map-right (same camera as tiles).
        // Legacy #map-canvas-right is unused — keep hidden so it cannot sit above the map.
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

    function destroy() {
        window.removeEventListener('mousemove', onPointerMove);
        window.removeEventListener('touchmove', onPointerMove);
        window.removeEventListener('mouseup', onPointerUp);
        window.removeEventListener('touchend', onPointerUp);
        if (dragOverlay && dragOverlay.parentNode) dragOverlay.parentNode.removeChild(dragOverlay);
        root.remove();
    }

    return { el: root, show, hide, setPosition, getPosition, getSelections, setMNOSelections, updateQuarters, destroy };
}
