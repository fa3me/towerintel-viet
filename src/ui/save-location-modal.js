/**
 * Save map coordinates to Own Assets or an MNO pin layer (right-click flow).
 */
import { MNOS, MNO_HEX } from '../config/app-config.js';

const MNO_META = Object.fromEntries(
  MNOS.map((m) => [m, { label: `${m} (MNO)`, color: MNO_HEX[m] || '#94a3b8' }])
);

/**
 * @param {{ lat: number, lng: number }} coords
 * @param {(choice: { target: 'MY_ASSETS' | string, name: string }) => void} onSave - sync or async
 */
export function showSaveLocationModal(coords, onSave) {
  const existing = document.getElementById('save-loc-overlay');
  if (existing) existing.remove();

  const lat = Number(coords.lat);
  const lng = Number(coords.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  const overlay = document.createElement('div');
  overlay.id = 'save-loc-overlay';
  overlay.innerHTML = `
    <div class="sl-backdrop"></div>
    <div class="sl-modal">
      <div class="sl-header">
        <div>
          <h3 class="sl-title">Save this location</h3>
          <span class="sl-subtitle">Adds to your database with the same layer color &amp; symbol</span>
        </div>
        <button type="button" class="sl-close" id="sl-close">&times;</button>
      </div>
      <div class="sl-body">
        <div class="sl-field">
          <label class="sl-label">Site name</label>
          <input type="text" id="sl-name" class="sl-input" placeholder="e.g. Candidate rooftop" />
        </div>
        <div class="sl-coords">
          <div class="sl-field sl-half">
            <label class="sl-label">Latitude</label>
            <input type="number" step="0.00001" id="sl-lat" class="sl-input" value="${lat}" />
          </div>
          <div class="sl-field sl-half">
            <label class="sl-label">Longitude</label>
            <input type="number" step="0.00001" id="sl-lng" class="sl-input" value="${lng}" />
          </div>
        </div>
        <p class="sl-hint">Save as:</p>
        <div class="sl-actions">
          <button type="button" class="sl-btn sl-btn-own" data-target="MY_ASSETS">Our tower<br><span class="sl-small">Own Assets</span></button>
          ${MNOS.map((m) => `
            <button type="button" class="sl-btn sl-btn-mno" data-target="${m}" style="--mno:${MNO_META[m].color}">
              ${MNO_META[m].label.replace(' (MNO)', '')}<br><span class="sl-small">MNO site</span>
            </button>
          `).join('')}
        </div>
      </div>
      <div class="sl-footer">
        <button type="button" class="sl-btn-cancel" id="sl-cancel">Cancel</button>
      </div>
    </div>
  `;

  if (!document.getElementById('save-loc-styles')) {
    const style = document.createElement('style');
    style.id = 'save-loc-styles';
    style.textContent = `
      #save-loc-overlay { position: fixed; inset: 0; z-index: 100000; font-family: Inter, system-ui, sans-serif; }
      .sl-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.55); backdrop-filter: blur(4px); }
      .sl-modal {
        position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
        width: min(420px, 94vw); max-height: 90vh; overflow: auto;
        background: #0f172a; border: 1px solid rgba(0,229,255,0.25); border-radius: 16px;
        box-shadow: 0 25px 50px rgba(0,0,0,0.5);
      }
      .sl-header { display: flex; justify-content: space-between; align-items: flex-start; padding: 16px 18px; border-bottom: 1px solid rgba(255,255,255,0.08); }
      .sl-title { margin: 0; font-size: 17px; font-weight: 700; color: #fff; }
      .sl-subtitle { font-size: 10px; color: #94a3b8; display: block; margin-top: 4px; max-width: 300px; line-height: 1.35; }
      .sl-close { background: none; border: none; color: #94a3b8; font-size: 22px; cursor: pointer; line-height: 1; padding: 4px; }
      .sl-close:hover { color: #fff; }
      .sl-body { padding: 14px 18px; }
      .sl-field { margin-bottom: 10px; }
      .sl-label { display: block; font-size: 10px; color: #94a3b8; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
      .sl-input {
        width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 8px;
        border: 1px solid #334155; background: #0b1121; color: #e2e8f0; font-size: 13px;
      }
      .sl-coords { display: flex; gap: 10px; }
      .sl-half { flex: 1; }
      .sl-hint { font-size: 11px; color: #64748b; margin: 12px 0 8px; }
      .sl-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .sl-btn {
        padding: 10px 8px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12);
        background: rgba(255,255,255,0.05); color: #e2e8f0; font-size: 12px; font-weight: 600; cursor: pointer; text-align: center; line-height: 1.25;
      }
      .sl-btn:hover { filter: brightness(1.12); border-color: rgba(0,229,255,0.35); }
      .sl-btn-own { border-color: rgba(0,229,255,0.35); background: rgba(0,229,255,0.08); }
      .sl-btn-mno { border-color: var(--mno); background: rgba(255,255,255,0.06); }
      .sl-small { font-size: 9px; font-weight: 500; opacity: 0.85; }
      .sl-footer { padding: 10px 18px 16px; }
      .sl-btn-cancel {
        width: 100%; padding: 8px; border-radius: 8px; border: 1px solid #334155;
        background: transparent; color: #94a3b8; font-size: 12px; cursor: pointer;
      }
      .sl-btn-cancel:hover { color: #e2e8f0; border-color: #475569; }
    `;
    document.head.appendChild(style);
  }

  const close = () => overlay.remove();

  overlay.querySelector('#sl-close')?.addEventListener('click', close);
  overlay.querySelector('#sl-cancel')?.addEventListener('click', close);
  overlay.querySelector('.sl-backdrop')?.addEventListener('click', close);

  overlay.querySelectorAll('.sl-btn[data-target]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const target = btn.getAttribute('data-target');
      const nameEl = overlay.querySelector('#sl-name');
      const latEl = overlay.querySelector('#sl-lat');
      const lngEl = overlay.querySelector('#sl-lng');
      const name = (nameEl?.value || '').trim();
      const la = parseFloat(latEl?.value);
      const ln = parseFloat(lngEl?.value);
      if (!Number.isFinite(la) || !Number.isFinite(ln)) return;
      close();
      if (typeof onSave === 'function') {
        await onSave({ target, name, lat: la, lng: ln });
      }
    });
  });

  document.body.appendChild(overlay);
  overlay.querySelector('#sl-name')?.focus();
}
