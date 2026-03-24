import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { canDownloadCsv } from '../auth/auth-gate.js';
import { MNO_HEX } from '../config/app-config.js';

function pad2(n) {
  return String(Math.floor(Math.abs(n))).padStart(2, '0');
}

function formatCoordComponent(value, isLat, format) {
  const f = format || 'DD';
  const hemi = isLat ? (value >= 0 ? 'N' : 'S') : (value >= 0 ? 'E' : 'W');
  const v = Math.abs(Number(value) || 0);
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

function formatCoord(lat, lng, format) {
  const f = format || 'DD';
  if (f === 'DD') {
    return { lat: Number(lat).toFixed(5), lng: Number(lng).toFixed(5) };
  }
  return {
    lat: formatCoordComponent(lat, true, f),
    lng: formatCoordComponent(lng, false, f)
  };
}

/**
 * TowerIntel Vietnam — Pitch Deck Panel
 */
export function renderPitchDeck(tower, score, container, { onClose, coordFormat = 'DD' }) {
  if (!tower || !score) return;

  // Population is stored directly on the tower object by batchEnrichAllSites / showPitchDeck
  const pop = tower.population || score.population || { radius_500m: 0, radius_1km: 0, radius_1_5km: 0 };
  const potentials = Object.entries(score.scores || {})
    .filter(([mno, data]) => data.total > 0)
    .sort((a, b) => b[1].total - a[1].total);

  container.innerHTML = `
    <div class="pitch-header">
      <div style="display: flex; flex-direction: column;">
        <h2 class="pitch-tower-name">${tower.name || 'Site Profile'}</h2>
        <div class="pitch-tower-id">${tower.id}</div>
      </div>
      <button id="close-pitch" class="pitch-close">&times;</button>
    </div>

    <div class="pitch-section">
      <h4 class="pitch-section-title">Colocation Potential</h4>
      <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 10px;">
        ${potentials.map(([mno, data]) => `
          <div style="background: rgba(255,255,255,0.03); border-radius: 12px; padding: 12px; border-left: 4px solid ${MNO_HEX[mno] || '#94a3b8'};">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
               <span style="font-weight: 700; color: #fff; font-size: 14px;">${mno}</span>
               <span style="font-size: 12px; font-weight: 800; color: ${data.total >= 75 ? '#00e676' : (data.total >= 50 ? '#ffd600' : '#ff1744')};">${data.total}%</span>
            </div>
            <div style="width: 100%; height: 4px; background: rgba(255,255,255,0.05); border-radius: 2px; overflow: hidden;">
               <div style="width: ${data.total}%; height: 100%; background: ${data.total >= 75 ? '#00e676' : (data.total >= 50 ? '#ffd600' : '#ff1744')};"></div>
            </div>
            <div style="display: flex; justify-content: space-between; margin-top: 8px; font-size: 10px; color: #94a3b8;">
               <span>Priority: ${data.label}</span>
               <span>Nearest: ${data.factors.nearestDistM}m</span>
            </div>
          </div>
        `).join('')}
        ${potentials.length === 0 ? '<div style="font-size: 11px; opacity: 0.6; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px;">No colocation targets identified (MNOs are already on-site or nearby).</div>' : ''}
      </div>
    </div>

    <div class="pitch-section">
      <div class="city-badge">${tower.city || 'Vietnam'}</div>
      <div class="pitch-coordinates" style="margin-top: 10px;">
        ${(() => {
          const c = formatCoord(Number(tower.lat), Number(tower.lng), coordFormat);
          return `<span class="coord">LAT: ${c.lat}</span><span class="coord">LNG: ${c.lng}</span>`;
        })()}
      </div>
    </div>

    <div class="pitch-section" style="background: rgba(255,214,0,0.05); border: 1px solid rgba(255,214,0,0.2);">
      <h4 class="pitch-section-title" style="color: #ffd600;">Strategic Insights</h4>
      <div style="font-size: 12px; line-height: 1.6;">
        ${tower.recommendation ? `<strong>Recommendation:</strong> <span style="color: ${tower.recommendation === 'COLOCATE' ? '#00e676' : '#ffd600'}; font-weight: 800;">${tower.recommendation}</span><br>` : ''}
        <strong>Nearest Airport:</strong> ${tower.nearest_airport ?? 'N/A'}<br>
        <strong>CAAP Distance:</strong> ${(tower.caap_dist_km != null && tower.caap_dist_km !== '') ? tower.caap_dist_km : '--'}km<br>
        <strong>Geo Context:</strong> Site is in a <b>${(pop.terrain_type || tower.terrain_type || '—')}</b> zone.<br><br>
        <a href="https://www.google.com/maps/@${tower.lat},${tower.lng},3a,75y,0h,90t/data=!3m6!1e1!3m4!1s!2e0!7i16384!8i8192" 
           target="_blank" 
           style="color: #00e5ff; text-decoration: none; font-weight: 600; font-size: 11px;">
           🚶 Open Full Street View ↗
        </a>
      </div>
    </div>

    <div class="pitch-section">
      <h4 class="pitch-section-title">Catchment Population</h4>
      <div class="pop-rings" style="display: flex; flex-direction: column; gap: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 8px;">
           <div style="display: flex; align-items: center; gap: 8px;">
              <div style="width: 12px; height: 12px; border-radius: 50%; border: 2px solid #00e5ff;"></div>
              <span style="font-size: 12px; color: #94a3b8;">500m Radius</span>
           </div>
           <span style="font-size: 14px; font-weight: 700; color: #fff;">${(pop.radius_500m || 0).toLocaleString()}</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 8px;">
           <div style="display: flex; align-items: center; gap: 8px;">
              <div style="width: 16px; height: 16px; border-radius: 50%; border: 2px solid #00e5ff; opacity: 0.7;"></div>
              <span style="font-size: 12px; color: #94a3b8;">1.0km Radius</span>
           </div>
           <span style="font-size: 14px; font-weight: 700; color: #fff;">${(pop.radius_1km || 0).toLocaleString()}</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 8px;">
           <div style="display: flex; align-items: center; gap: 8px;">
              <div style="width: 20px; height: 20px; border-radius: 50%; border: 2px solid #00e5ff; opacity: 0.4;"></div>
              <span style="font-size: 12px; color: #94a3b8;">1.5km Radius</span>
           </div>
           <span style="font-size: 14px; font-weight: 700; color: #fff;">${(pop.radius_1_5km || 0).toLocaleString()}</span>
        </div>
      </div>
    </div>

    <div class="pitch-section">
      <h4 class="pitch-section-title">Structural Specs</h4>
      <div class="specs-grid">
        <div class="spec-item">
          <span class="spec-label">Height</span>
          <span class="spec-value">${tower.height_m || '--'}m</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">Status</span>
          <span class="spec-value">${tower.structural_status || 'Ready'}</span>
        </div>
      </div>
    </div>

    ${tower.properties && Object.keys(tower.properties).length > 0 ? `
    <div class="pitch-section">
      <h4 class="pitch-section-title">Additional Properties</h4>
      <div class="specs-grid" style="grid-template-columns: 1fr;">
        ${Object.entries(tower.properties).map(([key, val]) => {
    // Ignore internal or empty values
    if (!val || ['lat', 'lng', 'height', 'height_m'].includes(key.toLowerCase())) return '';
    return `
            <div class="spec-item" style="display: flex; justify-content: space-between;">
              <span class="spec-label" style="text-transform: capitalize;">${key.replace(/_/g, ' ')}</span>
              <span class="spec-value" style="text-align: right; max-width: 65%; word-wrap: break-word;">${val}</span>
            </div>`;
  }).join('')}
      </div>
    </div>
    ` : ''}

    <div style="padding: 20px;">
      <button id="download-pdf" class="mno-btn active" style="width: 100%; padding: 12px; background: #00e5ff; color: #0b1121; font-weight: 800; cursor: pointer; margin-bottom: 10px;">Generate Pitch Deck (PDF)</button>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <button id="simulate-rf" class="mno-btn" style="padding: 12px; background: rgba(0, 230, 118, 0.1); border: 1px solid #00e676; color: #00e676; font-weight: 800; cursor: pointer;">Single Site RF</button>
        <button id="simulate-rf-area" class="mno-btn" style="padding: 12px; background: rgba(255, 214, 0, 0.1); border: 1px solid #ffd600; color: #ffd600; font-weight: 800; cursor: pointer;">Area Coverage</button>
      </div>
    </div>
  `;

  document.getElementById('close-pitch').addEventListener('click', () => {
    container.classList.remove('open');
    onClose && onClose();
  });

  document.getElementById('download-pdf').addEventListener('click', () => {
    if (!canDownloadCsv()) {
      alert('PDF export requires download approval from the app owner.');
      return;
    }
    generatePDF(tower, score);
  });

  document.getElementById('simulate-rf').addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('trigger-rf-sim', {
      detail: { tower, isAreaMode: false }
    }));
  });

  document.getElementById('simulate-rf-area').addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('trigger-rf-sim', {
      detail: { tower, isAreaMode: true }
    }));
  });

  container.classList.add('open');
}

function generatePDF(tower, scoreResult) {
  if (!canDownloadCsv()) {
    alert('PDF export requires download approval from the app owner.');
    return;
  }
  try {
    const doc = new jsPDF();
    doc.setFillColor(11, 17, 33);
    doc.rect(0, 0, 210, 40, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.text('TowerIntel Vietnam — Site Pitch Deck', 15, 25);

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(16);
    doc.text(tower.name || 'Site Profile', 15, 55);

    const pop = scoreResult.population || {};

    const body = [
      ['Height (m)', (tower.height_m || '--').toString()],
      ['Latitude', tower.lat.toString()],
      ['Longitude', tower.lng.toString()],
      ['Nearest Airport', (tower.nearest_airport || 'N/A').toString()],
      ['CAAP Dist (km)', (tower.caap_dist_km || '--').toString()],
      ['Clutter Type', (tower.terrain_type || '--').toString()],
      ['Population (500m)', (pop.radius_500m || 0).toLocaleString()],
      ['Population (1.0km)', (pop.radius_1km || 0).toLocaleString()],
      ['Population (1.5km)', (pop.radius_1_5km || 0).toLocaleString()]
    ];

    if (doc.autoTable) {
      doc.autoTable({
        startY: 70,
        head: [['Specification', 'Value']],
        body: body
      });
    } else {
      let y = 70;
      body.forEach(row => {
        doc.text(`${row[0]}: ${row[1]}`, 20, y);
        y += 10;
      });
    }

    doc.save(`TowerIntel_Pitch_${tower.id}.pdf`);
  } catch (err) {
    console.error('[PDF] Error:', err);
  }
}
