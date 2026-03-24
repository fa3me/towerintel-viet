/**
 * TowerIntel Vietnam — Dashboard layout (viewport MNO site counts).
 */
import { MNOS, MNO_HEX, APP_TITLE } from '../config/app-config.js';

export function renderDashboard(towers, mnoCounts, container, options = {}) {
  if (!container) return;

  const totalAssets = (mnoCounts && typeof mnoCounts.totalAssets === 'number') ? mnoCounts.totalAssets : towers.length;
  const byMno = (mnoCounts && mnoCounts.byMno) || {};
  const other = (mnoCounts && typeof mnoCounts.other === 'number') ? mnoCounts.other : 0;

  const otherCardHtml = other > 0
    ? `<div class="stat-card accent">
        <span class="stat-value">${other.toLocaleString()}</span>
        <span class="stat-label">Other</span>
       </div>`
    : '';

  const mnoCards = MNOS.map((m) => {
    const n = typeof byMno[m] === 'number' ? byMno[m] : 0;
    const hex = MNO_HEX[m] || '#94a3b8';
    return `
      <div class="stat-card" style="border-left: 3px solid ${hex};">
        <span class="stat-value">${n.toLocaleString()}</span>
        <span class="stat-label">${m}</span>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="dashboard-header">
      <div class="logo-section">
        <h2 class="dash-title">${APP_TITLE}</h2>
      </div>
      <p class="dash-subtitle">Geospatial Intelligence Platform</p>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <span class="stat-value">${totalAssets.toLocaleString()}</span>
        <span class="stat-label">Total Assets</span>
      </div>
      ${mnoCards}
      ${otherCardHtml}
    </div>
  `;
}
