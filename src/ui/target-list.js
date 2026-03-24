/**
 * TowerIntel PH — Landbanking Target List UI
 * Renders a list of coordinates prioritized for new site acquisition.
 */

export function renderTargetList(targets, container, { onTargetClick }) {
    if (!container) return;

    container.innerHTML = `
        <div class="target-list-inner" style="padding: 16px; color: #f1f5f9;">
            <h3 style="margin: 0 0 16px 0; font-size: 16px; color: #00e5ff; display: flex; justify-content: space-between; align-items: center;">
                Landbanking Targets
                <span style="font-size: 10px; background: rgba(0,229,255,0.1); padding: 2px 8px; border-radius: 10px; border: 1px solid rgba(0,229,255,0.3);">
                    ${targets.length} Sites
                </span>
            </h3>
            
            <div class="list-container" style="max-height: 400px; overflow-y: auto; padding-right: 4px;">
                ${targets.length === 0 ? `
                    <div style="text-align: center; color: #64748b; padding: 20px; font-style: italic; font-size: 12px;">
                        No landbanking targets identified.<br/>Upload OSM Growth or performance data to begin.
                    </div>
                ` : targets.map(t => `
                    <div class="target-item" data-id="${t.id}" style="
                        background: rgba(255, 145, 0, 0.05); 
                        border: 1px solid rgba(255, 145, 0, 0.2); 
                        border-radius: 8px; 
                        padding: 12px; 
                        margin-bottom: 10px; 
                        cursor: pointer;
                        transition: all 0.2s;
                    " onmouseover="this.style.background='rgba(255, 145, 0, 0.1)'; this.style.borderColor='rgba(255, 145, 0, 0.4)'" 
                      onmouseout="this.style.background='rgba(255, 145, 0, 0.05)'; this.style.borderColor='rgba(255, 145, 0, 0.2)'">
                        
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
                            <span style="font-weight: 600; font-size: 13px; color: #ff9100;">${t.name}</span>
                            <div style="text-align: right;">
                                <div style="font-size: 14px; font-weight: 800; color: #fff;">${t.landbankingScore}</div>
                                <div style="font-size: 9px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px;">Score</div>
                            </div>
                        </div>
                        
                        <div style="font-size: 11px; color: #94a3b8; display: flex; gap: 8px; margin-bottom: 8px;">
                            <span>${t.lat.toFixed(4)}, ${t.lng.toFixed(4)}</span>
                            <span>•</span>
                            <span style="color: #00e5ff;">${t.city || 'National'}</span>
                        </div>
                        
                        <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                            ${t.metrics.growth >= 80 ? '<span style="font-size: 9px; background: rgba(255, 145, 0, 0.1); color: #ff9100; padding: 1px 6px; border-radius: 4px; border: 1px solid rgba(255, 145, 0, 0.2);">Growth Vector</span>' : ''}
                            ${t.metrics.serviceGap >= 60 ? '<span style="font-size: 9px; background: rgba(255, 23, 68, 0.1); color: #ff1744; padding: 1px 6px; border-radius: 4px; border: 1px solid rgba(255, 23, 68, 0.2);">Coverage Void</span>' : ''}
                            ${t.metrics.population >= 70 ? '<span style="font-size: 9px; background: rgba(0, 230, 118, 0.1); color: #00e676; padding: 1px 6px; border-radius: 4px; border: 1px solid rgba(0, 230, 118, 0.2);">High Priority Pop</span>' : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
            
            <div style="margin-top: 20px; text-align: center;">
                <button id="export-targets" class="text-btn" style="width: 100%; border: 1px dashed rgba(255,145,0,0.4); color: #ff9100; font-size: 11px; padding: 8px;">
                    Export Landbanking List (.CSV)
                </button>
            </div>
        </div>
    `;

    // Event Listeners
    container.querySelectorAll('.target-item').forEach(item => {
        item.addEventListener('click', () => {
            const id = item.getAttribute('data-id');
            const target = targets.find(t => t.id === id);
            if (target && onTargetClick) onTargetClick(target);
        });
    });

    const exportBtn = container.querySelector('#export-targets');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            alert('Exporting prioritized targets...');
            // Logic to be handled in main.js
        });
    }
}
