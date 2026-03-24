/**
 * TowerIntel Vietnam — Supabase Auth Gate
 * ─────────────────────────────────────────
 * Premium login UI · owner approval for view / upload / download.
 * Set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_OWNER_EMAIL in .env
 * If URL is unset → auth skipped (local dev, full access).
 */

import { createClient } from '@supabase/supabase-js';

let supabase = null;
let session = null;
let profile = null;

function ownerEmail() {
    return (import.meta.env.VITE_OWNER_EMAIL || '').trim().toLowerCase();
}

function authEnabled() {
    return !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

export function isOwner() {
    if (!authEnabled()) return true;
    const em = session?.user?.email?.toLowerCase();
    const o = ownerEmail();
    return !!(em && o && em === o);
}

export function canViewApp() {
    if (!authEnabled()) return true;
    if (isOwner()) return true;
    return profile?.active !== false && profile?.approved_view === true;
}

export function canUpload() {
    if (!authEnabled()) return true;
    if (isOwner()) return true;
    return profile?.active !== false && profile?.approved_upload === true;
}

export function canDownloadCsv() {
    if (!authEnabled()) return true;
    if (isOwner()) return true;
    return profile?.active !== false && profile?.approved_download === true;
}

/** Get currently logged-in user email (or null). */
export function currentUserEmail() {
    return session?.user?.email || null;
}

/** Get currently logged-in user id (UUID) or null. */
export function currentUserId() {
    return session?.user?.id || null;
}

export function getCurrentAccessState() {
    return {
        email: session?.user?.email || null,
        owner: isOwner(),
        active: isOwner() ? true : profile?.active !== false,
        canView: canViewApp(),
        canUpload: canUpload(),
        canDownload: canDownloadCsv()
    };
}

/** Sign out the current user (redirects to login overlay). */
export async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    session = null;
    profile = null;
    window.location.reload();
}

/* ───────────────────────── Profile helpers ───────────────────────── */

async function loadProfile() {
    if (!session?.user) { profile = null; return; }
    if (isOwner()) {
        profile = { active: true, approved_view: true, approved_upload: true, approved_download: true };
        return;
    }
    if (!supabase) return;
    const { data, error } = await supabase
        .from('profiles')
        .select('active, approved_view, approved_upload, approved_download, email')
        .eq('id', session.user.id)
        .maybeSingle();

    if (error && error.code !== 'PGRST116') {
        console.warn('[auth] profiles read:', error.message);
    }

    if (!data) {
        const ins = await supabase
            .from('profiles')
            .insert({
                id: session.user.id,
                email: session.user.email,
                active: true,
                approved_view: false,
                approved_upload: false,
                approved_download: false
            })
            .select('active, approved_view, approved_upload, approved_download, email')
            .maybeSingle();
        if (ins.error && ins.error.code !== '23505') {
            console.warn('[auth] profiles insert:', ins.error.message);
        }
        if (ins.data) {
            profile = ins.data;
        } else if (ins.error?.code === '23505') {
            const retry = await supabase
                .from('profiles')
                .select('active, approved_view, approved_upload, approved_download, email')
                .eq('id', session.user.id)
                .maybeSingle();
            profile = retry.data || { active: true, approved_view: false, approved_upload: false, approved_download: false };
        } else {
            profile = { active: true, approved_view: false, approved_upload: false, approved_download: false };
        }
    } else {
        profile = data;
    }
}

/* ───────────────────────── Styles ───────────────────────── */

function mountStyles() {
    if (document.getElementById('auth-gate-styles')) return;
    const s = document.createElement('style');
    s.id = 'auth-gate-styles';
    s.textContent = `
/* ═══════════════════ AUTH OVERLAY ═══════════════════ */
.ti-auth-overlay {
    position: fixed; inset: 0; z-index: 99999;
    display: flex; align-items: center; justify-content: center;
    padding: 24px; box-sizing: border-box;
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    overflow: hidden;
}

/* Animated gradient background */
.ti-auth-overlay::before {
    content: ''; position: absolute; inset: -40%;
    background: conic-gradient(from 180deg at 50% 50%,
        #0b1121 0deg, #0d1f3c 60deg, #0b1121 120deg,
        #111d33 180deg, #0b1121 240deg, #0f1e35 300deg, #0b1121 360deg);
    animation: ti-bg-rotate 20s linear infinite;
}
@keyframes ti-bg-rotate { to { transform: rotate(360deg); } }

/* Floating orbs */
.ti-auth-overlay::after {
    content: ''; position: absolute; inset: 0;
    background:
        radial-gradient(600px circle at 20% 30%, rgba(0,229,255,0.06), transparent 60%),
        radial-gradient(500px circle at 80% 70%, rgba(0,230,118,0.04), transparent 60%),
        radial-gradient(400px circle at 50% 50%, rgba(124,58,237,0.03), transparent 50%);
    animation: ti-orbs-float 8s ease-in-out infinite alternate;
}
@keyframes ti-orbs-float {
    0% { opacity: 0.7; transform: scale(1) translateY(0); }
    100% { opacity: 1; transform: scale(1.03) translateY(-10px); }
}

/* ═══════════════════ LOGIN CARD ═══════════════════ */
.ti-auth-card {
    position: relative; z-index: 2;
    max-width: 440px; width: 100%;
    background: rgba(17,24,39,0.85);
    border: 1px solid rgba(100,116,139,0.2);
    border-radius: 20px; padding: 0;
    box-shadow: 0 25px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.03) inset;
    backdrop-filter: blur(40px);
    animation: ti-card-enter 0.6s cubic-bezier(0.16, 1, 0.3, 1);
    overflow: hidden;
}
@keyframes ti-card-enter {
    0% { opacity: 0; transform: translateY(30px) scale(0.96); }
    100% { opacity: 1; transform: translateY(0) scale(1); }
}

/* Accent line at top */
.ti-auth-card::before {
    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
    background: linear-gradient(90deg, #00e5ff, #00e676, #7c3aed, #00e5ff);
    background-size: 300% 100%;
    animation: ti-line-slide 4s linear infinite;
}
@keyframes ti-line-slide {
    0% { background-position: 0% 50%; }
    100% { background-position: 300% 50%; }
}

.ti-auth-body { padding: 36px 32px 32px; }

/* Logo area */
.ti-auth-logo {
    text-align: center; margin-bottom: 28px;
}
.ti-auth-logo-icon {
    width: 56px; height: 56px; margin: 0 auto 14px;
    border-radius: 16px;
    background: linear-gradient(135deg, rgba(0,229,255,0.15), rgba(0,230,118,0.1));
    border: 1px solid rgba(0,229,255,0.2);
    display: flex; align-items: center; justify-content: center;
    font-size: 28px;
    box-shadow: 0 4px 20px rgba(0,229,255,0.1);
}
.ti-auth-title {
    margin: 0; font-size: 22px; font-weight: 800; letter-spacing: 0.5px;
    background: linear-gradient(135deg, #00e5ff, #69f0ae);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    background-clip: text;
}
.ti-auth-subtitle {
    margin: 6px 0 0; font-size: 13px; color: #94a3b8; line-height: 1.5;
}

/* Tabs */
.ti-auth-tabs {
    display: flex; gap: 0; margin-bottom: 24px;
    background: rgba(0,0,0,0.2); border-radius: 10px; padding: 3px;
}
.ti-auth-tab {
    flex: 1; padding: 10px; border: none;
    background: transparent; color: #94a3b8;
    font-size: 13px; font-weight: 600; font-family: inherit;
    border-radius: 8px; cursor: pointer;
    transition: all 0.25s ease;
}
.ti-auth-tab:hover { color: #e2e8f0; }
.ti-auth-tab.active {
    background: rgba(0,229,255,0.12); color: #00e5ff;
    box-shadow: 0 2px 8px rgba(0,229,255,0.1);
}

/* Forms */
.ti-auth-form { display: flex; flex-direction: column; gap: 16px; }
.ti-auth-form.hidden { display: none; }

.ti-auth-field { position: relative; }
.ti-auth-field label {
    display: block; font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.6px;
    color: #64748b; margin-bottom: 6px;
}
.ti-auth-field input {
    width: 100%; padding: 12px 14px; border-radius: 10px;
    border: 1px solid rgba(100,116,139,0.25);
    background: rgba(0,0,0,0.25); color: #f1f5f9;
    font-size: 14px; font-family: inherit;
    box-sizing: border-box; outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
}
.ti-auth-field input:focus {
    border-color: rgba(0,229,255,0.5);
    box-shadow: 0 0 0 3px rgba(0,229,255,0.08);
}
.ti-auth-field input::placeholder { color: #475569; }

.ti-auth-submit {
    width: 100%; padding: 13px; border-radius: 12px;
    border: none; font-weight: 700; font-size: 14px;
    font-family: inherit; cursor: pointer;
    background: linear-gradient(135deg, #00e5ff, #00b8d4);
    color: #0b1121; letter-spacing: 0.3px;
    box-shadow: 0 4px 15px rgba(0,229,255,0.25);
    transition: transform 0.15s, box-shadow 0.2s, opacity 0.2s;
}
.ti-auth-submit:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(0,229,255,0.35);
}
.ti-auth-submit:active { transform: translateY(0); }
.ti-auth-submit:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

.ti-auth-submit.signup-btn {
    background: linear-gradient(135deg, #7c3aed, #6d28d9);
    box-shadow: 0 4px 15px rgba(124,58,237,0.25);
    color: #fff;
}
.ti-auth-submit.signup-btn:hover {
    box-shadow: 0 6px 20px rgba(124,58,237,0.35);
}

/* Forgot link */
.ti-auth-forgot {
    text-align: right; margin-top: -8px;
}
.ti-auth-forgot a {
    color: #64748b; font-size: 12px; text-decoration: none;
    cursor: pointer; transition: color 0.2s;
}
.ti-auth-forgot a:hover { color: #00e5ff; }

/* Messages */
.ti-auth-msg {
    margin-top: 4px; padding: 10px 14px; border-radius: 10px;
    font-size: 12px; line-height: 1.5; display: none;
}
.ti-auth-msg.show { display: block; }
.ti-auth-msg.info {
    background: rgba(0,229,255,0.06); border: 1px solid rgba(0,229,255,0.15);
    color: #67e8f9;
}
.ti-auth-msg.err {
    background: rgba(248,113,113,0.08); border: 1px solid rgba(248,113,113,0.2);
    color: #fca5a5;
}
.ti-auth-msg.success {
    background: rgba(0,230,118,0.06); border: 1px solid rgba(0,230,118,0.15);
    color: #6ee7b7;
}

/* Pending notice */
.ti-auth-pending {
    display: none; margin-top: 16px; padding: 18px;
    background: rgba(251,191,36,0.06);
    border: 1px solid rgba(251,191,36,0.2);
    border-radius: 14px; text-align: center;
}
.ti-auth-pending-icon { font-size: 32px; margin-bottom: 8px; }
.ti-auth-pending-title {
    font-size: 15px; font-weight: 700; color: #fbbf24; margin-bottom: 6px;
}
.ti-auth-pending-text { font-size: 12px; color: #cbd5e1; line-height: 1.6; }
.ti-auth-pending-email {
    display: inline-block; margin-top: 8px; padding: 4px 12px;
    background: rgba(251,191,36,0.1); border-radius: 6px;
    font-size: 12px; font-weight: 600; color: #fde68a; font-family: monospace;
}
.ti-auth-pending-logout {
    display: inline-block; margin-top: 12px; padding: 8px 20px;
    background: rgba(100,116,139,0.15); border: 1px solid rgba(100,116,139,0.3);
    border-radius: 8px; color: #94a3b8; font-size: 12px; font-weight: 600;
    font-family: inherit; cursor: pointer; transition: all 0.2s;
}
.ti-auth-pending-logout:hover {
    background: rgba(248,113,113,0.1); border-color: rgba(248,113,113,0.3);
    color: #fca5a5;
}

/* Footer */
.ti-auth-footer {
    text-align: center; padding: 16px 32px 20px;
    border-top: 1px solid rgba(100,116,139,0.1);
    font-size: 11px; color: #475569;
}

/* ═══════════════════ USER BAR (top-right in app) ═══════════════════ */
.ti-user-bar {
    position: fixed; top: 14px; right: 14px; z-index: 10050;
    display: flex; align-items: center; gap: 8px;
    background: rgba(17,24,39,0.9); border: 1px solid rgba(100,116,139,0.2);
    border-radius: 12px; padding: 6px 10px 6px 14px;
    backdrop-filter: blur(16px);
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    font-family: 'Inter', system-ui, sans-serif;
    animation: ti-user-bar-in 0.4s ease;
}
@keyframes ti-user-bar-in {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
}
.ti-user-email {
    font-size: 11px; color: #94a3b8; font-weight: 500;
    max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ti-user-badges {
    display: flex; gap: 4px;
}
.ti-user-badge {
    font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px;
    padding: 2px 6px; border-radius: 4px;
}
.ti-badge-owner { background: rgba(124,58,237,0.2); color: #a78bfa; }
.ti-badge-view { background: rgba(0,229,255,0.12); color: #67e8f9; }
.ti-badge-upload { background: rgba(0,230,118,0.12); color: #6ee7b7; }
.ti-badge-download { background: rgba(251,191,36,0.12); color: #fde68a; }
.ti-user-logout {
    background: rgba(100,116,139,0.15); border: 1px solid rgba(100,116,139,0.2);
    color: #94a3b8; font-size: 11px; font-weight: 600; font-family: inherit;
    padding: 5px 10px; border-radius: 8px; cursor: pointer;
    transition: all 0.2s;
}
.ti-user-logout:hover {
    background: rgba(248,113,113,0.12); border-color: rgba(248,113,113,0.3);
    color: #fca5a5;
}

/* ═══════════════════ ADMIN PANEL ═══════════════════ */
.ti-admin-btn {
    position: fixed; bottom: 20px; right: 20px; z-index: 10050;
    padding: 10px 16px; border-radius: 12px;
    background: linear-gradient(135deg, #7c3aed, #6d28d9);
    color: #fff; font-weight: 700; font-size: 12px; font-family: inherit;
    border: 1px solid rgba(167,139,250,0.3);
    cursor: pointer;
    box-shadow: 0 8px 30px rgba(124,58,237,0.3);
    transition: transform 0.15s, box-shadow 0.2s;
}
.ti-admin-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 12px 35px rgba(124,58,237,0.4);
}
.ti-admin-panel {
    position: fixed; inset: 0; z-index: 10060;
    background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center;
    padding: 20px;
    animation: ti-admin-fade-in 0.25s ease;
}
@keyframes ti-admin-fade-in { from { opacity: 0; } to { opacity: 1; } }
.ti-admin-inner {
    max-width: 780px; width: 100%; max-height: 85vh;
    overflow: auto; background: #111827;
    border: 1px solid rgba(100,116,139,0.2);
    border-radius: 16px; padding: 24px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
}
.ti-admin-inner h2 {
    margin: 0 0 6px; color: #a78bfa; font-size: 18px;
}
.ti-admin-table {
    width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 12px;
}
.ti-admin-table th, .ti-admin-table td {
    padding: 10px 12px; border-bottom: 1px solid rgba(100,116,139,0.15);
    text-align: left; color: #e2e8f0;
}
.ti-admin-table th {
    color: #94a3b8; font-weight: 600; text-transform: uppercase;
    font-size: 10px; letter-spacing: 0.5px;
}
.ti-admin-table tbody tr:hover { background: rgba(100,116,139,0.07); }
.ti-admin-table input[type=checkbox] {
    accent-color: #00e5ff; cursor: pointer;
    width: 16px; height: 16px;
}
.ti-admin-close-btn {
    padding: 10px 20px; border-radius: 10px;
    background: rgba(100,116,139,0.15); border: 1px solid rgba(100,116,139,0.25);
    color: #e2e8f0; font-weight: 600; font-size: 13px; font-family: inherit;
    cursor: pointer; transition: all 0.2s;
}
.ti-admin-close-btn:hover {
    background: rgba(100,116,139,0.25);
}
    `;
    document.head.appendChild(s);
}

/* ───────────────────────── Helpers ───────────────────────── */

function showMsg(el, text, type = 'info') {
    if (!el) return;
    el.textContent = text;
    el.className = 'ti-auth-msg show ' + type;
}
function hideMsg(el) {
    if (!el) return;
    el.className = 'ti-auth-msg';
}

/* ───────────────────────── Owner Admin ───────────────────────── */

async function fetchAllProfilesForOwner() {
    if (!supabase || !isOwner()) return [];
    const { data, error } = await supabase
        .from('profiles')
        .select('id, email, active, approved_view, approved_upload, approved_download')
        .order('email');
    if (error) { console.warn('[auth] list profiles:', error.message); return []; }
    return data || [];
}

function mountOwnerAdmin() {
    if (!authEnabled() || !isOwner()) return;
    if (document.getElementById('ti-admin-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'ti-admin-btn';
    btn.type = 'button';
    btn.className = 'ti-admin-btn';
    btn.textContent = '👑 Access Approvals';
    btn.title = 'Approve view / upload / download for signed-up users';
    document.body.appendChild(btn);

    const panel = document.createElement('div');
    panel.id = 'ti-admin-panel';
    panel.style.display = 'none';
    document.body.appendChild(panel);

    async function renderTable() {
        const rows = await fetchAllProfilesForOwner();
        const oem = ownerEmail();
        panel.innerHTML = `
          <div class="ti-admin-panel" role="dialog" aria-modal="true">
            <div class="ti-admin-inner">
              <h2>👑 User Access Management</h2>
              <p style="font-size:12px;color:#94a3b8;margin:0 0 4px;">
                Owner: <strong style="color:#a78bfa">${oem || '—'}</strong>
              </p>
              <p style="font-size:11px;color:#64748b;margin:0 0 12px;">
                Activate/deactivate users and toggle permissions. Changes save instantly.
              </p>
              <table class="ti-admin-table">
                <thead><tr>
                  <th>Email</th><th style="text-align:center;">Active</th><th style="text-align:center;">View</th>
                  <th style="text-align:center;">Upload</th><th style="text-align:center;">Download</th>
                </tr></thead>
                <tbody>
                  ${rows.map((r) => {
                      const isSelf = r.email?.toLowerCase() === oem;
                      const disabled = isSelf ? ' disabled' : '';
                      const tag = isSelf
                          ? '<span style="font-size:9px;color:#a78bfa;background:rgba(124,58,237,0.15);padding:1px 6px;border-radius:4px;margin-left:6px;">OWNER</span>'
                          : '';
                      return `<tr data-id="${r.id}">
                        <td>${(r.email || '').replace(/</g, '&lt;')}${tag}</td>
                        <td style="text-align:center;"><input type="checkbox" data-field="active" ${r.active !== false ? 'checked' : ''}${disabled} /></td>
                        <td style="text-align:center;"><input type="checkbox" data-field="approved_view" ${r.approved_view ? 'checked' : ''}${disabled} /></td>
                        <td style="text-align:center;"><input type="checkbox" data-field="approved_upload" ${r.approved_upload ? 'checked' : ''}${disabled} /></td>
                        <td style="text-align:center;"><input type="checkbox" data-field="approved_download" ${r.approved_download ? 'checked' : ''}${disabled} /></td>
                      </tr>`;
                  }).join('')}
                </tbody>
              </table>
              <div style="margin-top:18px;display:flex;gap:10px;justify-content:flex-end;">
                <button type="button" class="ti-admin-close-btn" id="ti-admin-close">Close</button>
              </div>
            </div>
          </div>`;

        panel.querySelector('#ti-admin-close')?.addEventListener('click', () => {
            panel.style.display = 'none';
        });
        // Close on backdrop click
        panel.querySelector('.ti-admin-panel')?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) panel.style.display = 'none';
        });

        panel.querySelectorAll('tbody tr').forEach((tr) => {
            const id = tr.getAttribute('data-id');
            const activeEl = tr.querySelector('input[data-field="active"]');
            const viewEl = tr.querySelector('input[data-field="approved_view"]');
            const uploadEl = tr.querySelector('input[data-field="approved_upload"]');
            const dlEl = tr.querySelector('input[data-field="approved_download"]');
            const active = !!activeEl?.checked;
            const view = !!viewEl?.checked;
            if (uploadEl) uploadEl.disabled = !active || !view;
            if (dlEl) dlEl.disabled = !active || !view;

            tr.querySelectorAll('input[type=checkbox]').forEach((cb) => {
                cb.addEventListener('change', async () => {
                    const active = !!activeEl?.checked;
                    let view = !!viewEl?.checked;
                    let upload = !!uploadEl?.checked;
                    let dl = !!dlEl?.checked;

                    // Security guardrails: upload/download require view, and inactive users have no permissions.
                    if (!active) {
                        view = false; upload = false; dl = false;
                    } else if (!view) {
                        upload = false; dl = false;
                    }
                    if (viewEl) viewEl.checked = view;
                    if (uploadEl) uploadEl.checked = upload;
                    if (dlEl) dlEl.checked = dl;
                    if (uploadEl) uploadEl.disabled = !active || !view;
                    if (dlEl) dlEl.disabled = !active || !view;

                    const { error } = await supabase
                        .from('profiles')
                        .update({ active: !!active, approved_view: !!view, approved_upload: !!upload, approved_download: !!dl })
                        .eq('id', id);
                    if (error) alert('Update failed: ' + error.message);
                });
            });
        });
    }

    btn.addEventListener('click', async () => {
        panel.style.display = 'block';
        await renderTable();
    });
}

/* ───────────────────────── User Bar (session indicator + logout) ───────────────────────── */

function mountUserBar() {
    if (!authEnabled() || !session?.user) return;
    if (document.getElementById('ti-user-bar')) return;

    const email = session.user.email || 'User';
    const bar = document.createElement('div');
    bar.id = 'ti-user-bar';
    bar.className = 'ti-user-bar';

    let badges = '';
    if (isOwner()) {
        badges = '<span class="ti-user-badge ti-badge-owner">Owner</span>';
    } else {
        if (profile?.approved_view) badges += '<span class="ti-user-badge ti-badge-view">View</span>';
        if (profile?.approved_upload) badges += '<span class="ti-user-badge ti-badge-upload">Upload</span>';
        if (profile?.approved_download) badges += '<span class="ti-user-badge ti-badge-download">Download</span>';
    }

    bar.innerHTML = `
        <span class="ti-user-email" title="${email}">${email}</span>
        <span class="ti-user-badges">${badges}</span>
        <button type="button" class="ti-user-logout" id="ti-user-logout">Sign out</button>
    `;
    document.body.appendChild(bar);

    document.getElementById('ti-user-logout')?.addEventListener('click', () => signOut());
}

/* ───────────────────────── Overlay helpers ───────────────────────── */

function hideOverlay(overlay) {
    if (overlay && overlay.parentNode) overlay.remove();
    const app = document.getElementById('app');
    if (app) {
        app.style.visibility = '';
        app.style.pointerEvents = '';
    }
}

/* ═══════════════════════════════════════════════════════════════════
   initAuthGate — blocks map init until user can view (signed in + approved, or owner).
   @returns {Promise<{ blocked: boolean, dev?: boolean }>}
   ═══════════════════════════════════════════════════════════════════ */
export async function initAuthGate() {
    mountStyles();

    /* ---- Dev mode (no Supabase env) ---- */
    if (!authEnabled()) {
        console.info('[auth] Supabase env not set — running without login (dev).');
        return { blocked: false, dev: true };
    }

    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
    supabase = createClient(url, key);

    /* hide app until authed */
    const app = document.getElementById('app');
    if (app) { app.style.visibility = 'hidden'; app.style.pointerEvents = 'none'; }

    /* ---- Build login overlay ---- */
    const overlay = document.createElement('div');
    overlay.className = 'ti-auth-overlay';
    overlay.innerHTML = `
    <div class="ti-auth-card" id="ti-auth-card">
        <div class="ti-auth-body">
            <!-- Logo -->
            <div class="ti-auth-logo">
                <div class="ti-auth-logo-icon">📡</div>
                <h1 class="ti-auth-title">TowerIntel Vietnam</h1>
                <p class="ti-auth-subtitle">Geospatial Tower Intelligence Platform</p>
            </div>

            <!-- Tabs -->
            <div class="ti-auth-tabs" id="ti-auth-tabs">
                <button type="button" class="ti-auth-tab active" data-tab="signin">Sign In</button>
                <button type="button" class="ti-auth-tab" data-tab="signup">Create Account</button>
            </div>

            <!-- Sign In Form -->
            <form class="ti-auth-form" id="ti-form-signin" autocomplete="on">
                <div class="ti-auth-field">
                    <label for="ti-signin-email">Email Address</label>
                    <input type="email" id="ti-signin-email" placeholder="name@company.com" autocomplete="username" required />
                </div>
                <div class="ti-auth-field">
                    <label for="ti-signin-pass">Password</label>
                    <input type="password" id="ti-signin-pass" placeholder="••••••••" autocomplete="current-password" required />
                </div>
                <div class="ti-auth-forgot">
                    <a href="#" id="ti-forgot-link">Forgot password?</a>
                </div>
                <button type="submit" class="ti-auth-submit">Sign In</button>
            </form>

            <!-- Sign Up Form -->
            <form class="ti-auth-form hidden" id="ti-form-signup" autocomplete="on">
                <div class="ti-auth-field">
                    <label for="ti-signup-email">Email Address</label>
                    <input type="email" id="ti-signup-email" placeholder="name@company.com" autocomplete="username" required />
                </div>
                <div class="ti-auth-field">
                    <label for="ti-signup-pass">Password</label>
                    <input type="password" id="ti-signup-pass" placeholder="Min 6 characters" autocomplete="new-password" required minlength="6" />
                </div>
                <button type="submit" class="ti-auth-submit signup-btn">Create Account</button>
            </form>

            <!-- Password Reset Form -->
            <form class="ti-auth-form hidden" id="ti-form-reset" autocomplete="on">
                <div class="ti-auth-field">
                    <label for="ti-reset-email">Email Address</label>
                    <input type="email" id="ti-reset-email" placeholder="name@company.com" autocomplete="username" required />
                </div>
                <button type="submit" class="ti-auth-submit">Send Reset Link</button>
                <div style="text-align:center;">
                    <a href="#" id="ti-back-signin" style="color:#64748b;font-size:12px;text-decoration:none;cursor:pointer;">← Back to Sign In</a>
                </div>
            </form>

            <!-- Messages -->
            <p class="ti-auth-msg" id="ti-auth-msg"></p>

            <!-- Pending approval -->
            <div class="ti-auth-pending" id="ti-auth-pending">
                <div class="ti-auth-pending-icon">⏳</div>
                <div class="ti-auth-pending-title">Access Pending</div>
                <div class="ti-auth-pending-text">
                    Your account is waiting for approval.<br>
                    The app owner will enable your access shortly.
                </div>
                <div class="ti-auth-pending-email" id="ti-pending-email"></div>
                <br>
                <button type="button" class="ti-auth-pending-logout" id="ti-pending-logout">Sign out & use different account</button>
            </div>
        </div>

        <div class="ti-auth-footer">
            Secured by Supabase · © ${new Date().getFullYear()} TowerIntel
        </div>
    </div>`;
    document.body.appendChild(overlay);

    /* ---- DOM refs ---- */
    const msgEl = overlay.querySelector('#ti-auth-msg');
    const pendingEl = overlay.querySelector('#ti-auth-pending');
    const formSignin = overlay.querySelector('#ti-form-signin');
    const formSignup = overlay.querySelector('#ti-form-signup');
    const formReset = overlay.querySelector('#ti-form-reset');
    const tabs = overlay.querySelector('#ti-auth-tabs');

    /* ---- Tab switching ---- */
    function switchTab(name) {
        tabs.querySelectorAll('.ti-auth-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === name);
        });
        formSignin.classList.toggle('hidden', name !== 'signin');
        formSignup.classList.toggle('hidden', name !== 'signup');
        formReset.classList.toggle('hidden', name !== 'reset');
        hideMsg(msgEl);
    }

    tabs.addEventListener('click', (e) => {
        const tab = e.target.closest('.ti-auth-tab');
        if (tab) switchTab(tab.dataset.tab);
    });

    overlay.querySelector('#ti-forgot-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        switchTab('reset');
    });
    overlay.querySelector('#ti-back-signin')?.addEventListener('click', (e) => {
        e.preventDefault();
        switchTab('signin');
    });

    /* ---- UI states ---- */
    const showPendingUI = () => {
        formSignin.classList.add('hidden');
        formSignup.classList.add('hidden');
        formReset.classList.add('hidden');
        tabs.style.display = 'none';
        pendingEl.style.display = 'block';
        const suspended = profile?.active === false;
        const title = pendingEl.querySelector('.ti-auth-pending-title');
        const text = pendingEl.querySelector('.ti-auth-pending-text');
        const icon = pendingEl.querySelector('.ti-auth-pending-icon');
        if (suspended) {
            if (icon) icon.textContent = '🚫';
            if (title) title.textContent = 'Account Deactivated';
            if (text) text.innerHTML = 'Your account has been deactivated by the app owner.<br>Please contact the owner to reactivate access.';
        } else {
            if (icon) icon.textContent = '⏳';
            if (title) title.textContent = 'Access Pending';
            if (text) text.innerHTML = 'Your account is waiting for approval.<br>The app owner will enable your access shortly.';
        }
        const pe = overlay.querySelector('#ti-pending-email');
        if (pe) pe.textContent = session?.user?.email || '';
    };

    const showLoginUI = () => {
        tabs.style.display = '';
        pendingEl.style.display = 'none';
        switchTab('signin');
    };

    /* Pending logout */
    overlay.querySelector('#ti-pending-logout')?.addEventListener('click', async () => {
        await supabase.auth.signOut();
        session = null;
        profile = null;
        showLoginUI();
    });

    /* ---- Gate promise ---- */
    let pollTimer = null;
    let resolveGate = null;
    const gatePromise = new Promise((resolve) => { resolveGate = resolve; });

    const finish = () => {
        if (pollTimer) clearInterval(pollTimer);
        hideOverlay(overlay);
        mountOwnerAdmin();
        mountUserBar();
        resolveGate({ blocked: false });
    };

    const tryEnterApp = async () => {
        await loadProfile();
        if (canViewApp()) { finish(); return true; }
        if (session?.user) showPendingUI();
        return false;
    };

    /* ---- Existing session ---- */
    const { data: sessData } = await supabase.auth.getSession();
    session = sessData?.session || null;
    if (session) await loadProfile();
    if (await tryEnterApp()) return { blocked: false };

    /* ---- Poll for approval while pending ---- */
    pollTimer = setInterval(async () => {
        if (!session?.user) return;
        await loadProfile();
        if (canViewApp()) finish();
    }, 5000);

    /* ---- Auth state changes ---- */
    supabase.auth.onAuthStateChange(async (_event, newSession) => {
        session = newSession;
        if (!newSession) { profile = null; showLoginUI(); return; }
        await tryEnterApp();
    });

    /* ---- Sign In ---- */
    formSignin.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = overlay.querySelector('#ti-signin-email').value.trim();
        const password = overlay.querySelector('#ti-signin-pass').value;
        showMsg(msgEl, 'Signing in…', 'info');
        formSignin.querySelector('.ti-auth-submit').disabled = true;
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        formSignin.querySelector('.ti-auth-submit').disabled = false;
        if (error) { showMsg(msgEl, error.message, 'err'); return; }
        hideMsg(msgEl);
    });

    /* ---- Sign Up ---- */
    formSignup.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = overlay.querySelector('#ti-signup-email').value.trim();
        const password = overlay.querySelector('#ti-signup-pass').value;
        if (password.length < 6) {
            showMsg(msgEl, 'Password must be at least 6 characters.', 'err');
            return;
        }
        showMsg(msgEl, 'Creating account…', 'info');
        formSignup.querySelector('.ti-auth-submit').disabled = true;
        const { error } = await supabase.auth.signUp({ email, password });
        formSignup.querySelector('.ti-auth-submit').disabled = false;
        if (error) { showMsg(msgEl, error.message, 'err'); return; }
        showMsg(msgEl, 'Account created! Check your email to confirm, then sign in. Access will be pending until the owner approves.', 'success');
    });

    /* ---- Password Reset ---- */
    formReset.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = overlay.querySelector('#ti-reset-email').value.trim();
        showMsg(msgEl, 'Sending reset link…', 'info');
        formReset.querySelector('.ti-auth-submit').disabled = true;
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        formReset.querySelector('.ti-auth-submit').disabled = false;
        if (error) { showMsg(msgEl, error.message, 'err'); return; }
        showMsg(msgEl, 'Password reset link sent! Check your inbox.', 'success');
    });

    return gatePromise;
}
