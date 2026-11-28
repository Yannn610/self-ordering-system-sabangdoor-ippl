/**
 * File: script-riwayat-pembeli.js
 * PB-071: Riwayat pesanan pembeli (riwayat lokal perangkat + login opsional Email OTP + tombol "Pesan Lagi").
 */
(function () {
    'use strict';

    const HISTORY_KEY = 'sabangdor_buyer_history';
    const CART_KEY = 'sabangdor_cart';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
    const rupiah = (n) => 'Rp' + Math.round(Number(n) || 0).toLocaleString('id-ID');

    let combinedOrders = [];

    function getLocalHistory() {
        try {
            const arr = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
            return Array.isArray(arr) ? arr : [];
        } catch (e) {
            return [];
        }
    }

    function showAuthMsg(msg, isOk) {
        const el = document.getElementById('buyerAuthMsg');
        if (!el) return;
        el.textContent = msg;
        el.style.background = isOk ? '#DCFCE7' : '';
        el.style.borderColor = isOk ? '#86EFAC' : '';
        el.style.color = isOk ? '#15803D' : '';
        el.classList.toggle('show', Boolean(msg));
    }

    function reorder(idx) {
        const order = combinedOrders[idx];
        if (!order || !Array.isArray(order.items) || order.items.length === 0) return;

        const cartItems = order.items.map(i => {
            const qty = Math.max(1, Math.min(99, Number(i.qty || i.jumlah || 1)));
            const harga = Math.max(1, Math.round(Number(i.harga || i.subtotal || 10000)));
            return {
                nama: i.nama || i.nama_item || 'Menu',
                varian: i.varian || 'S (3 pcs)',
                catatan: i.catatan || '',
                qty: qty,
                harga: harga,
                hargaFormatted: rupiah(harga),
                imgSrc: i.imgSrc || ''
            };
        });

        localStorage.setItem(CART_KEY, JSON.stringify(cartItems));
        window.location.href = 'keranjang.html';
    }

    function renderHistory(orders) {
        combinedOrders = orders;
        const host = document.getElementById('buyerHistoryList');
        if (!host) return;

        if (!orders || orders.length === 0) {
            host.innerHTML = `<p style="color:var(--text-muted); font-size:0.875rem; text-align:center; padding:16px 0;">Belum ada riwayat pesanan di perangkat ini.</p>`;
            return;
        }

        host.innerHTML = orders.map((o, idx) => {
            const nomor = 'ANT-' + String(o.nomor_antrean || 0).padStart(2, '0');
            const tgl = o.created_at ? new Date(o.created_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '';
            const itemsSummary = (o.items || []).map(i => `${Number(i.qty || i.jumlah || 1)}x ${esc(i.nama || i.nama_item || 'Menu')}`).join(', ');
            const trackLink = o.tracking_token ? `status-pesanan.html?token=${encodeURIComponent(o.tracking_token)}` : '';

            return `
                <div style="border:1px solid var(--border-line); border-radius:12px; padding:14px; margin-bottom:10px; background:var(--bg-app);">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:4px;">
                        <strong style="color:var(--primary-red-hover);">#${esc(nomor)}</strong>
                        <span style="font-size:0.75rem; color:var(--text-muted);">${esc(tgl)}</span>
                    </div>
                    <p style="font-size:0.875rem; color:var(--text-main); margin-bottom:6px;">${itemsSummary || '-'}</p>
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
                        <strong>${rupiah(o.total_harga)}</strong>
                        <div style="display:flex; gap:8px;">
                            ${trackLink ? `<a href="${trackLink}" class="btn btn--secondary" style="width:auto; min-height:40px; padding:6px 12px; font-size:0.8125rem;">Lacak</a>` : ''}
                            <button type="button" class="btn btn--primary" data-reorder="${idx}" style="width:auto; min-height:40px; padding:6px 14px; font-size:0.8125rem;">Pesan Lagi</button>
                        </div>
                    </div>
                </div>`;
        }).join('');

        host.querySelectorAll('[data-reorder]').forEach(btn => {
            btn.addEventListener('click', () => reorder(Number(btn.dataset.reorder)));
        });
    }

    async function refreshHistory() {
        const local = getLocalHistory();
        const client = window.supabaseClient;
        let cloud = [];

        if (client && client.auth) {
            try {
                const { data } = await client.auth.getSession();
                const user = data && data.session && data.session.user;
                const statusEl = document.getElementById('buyerAuthStatus');
                const formWrap = document.getElementById('buyerAuthFormWrap');
                const signedWrap = document.getElementById('buyerSignedInWrap');
                const emailDisp = document.getElementById('buyerEmailDisplay');

                if (user) {
                    if (statusEl) statusEl.textContent = 'Terhubung';
                    if (formWrap) formWrap.style.display = 'none';
                    if (signedWrap) signedWrap.style.display = 'flex';
                    if (emailDisp) emailDisp.textContent = user.email;

                    const { data: rpcData, error } = await client.rpc('riwayat_pesanan_saya');
                    if (!error && Array.isArray(rpcData)) cloud = rpcData;
                } else {
                    if (statusEl) statusEl.textContent = 'Mode Tamu';
                    if (formWrap) formWrap.style.display = 'block';
                    if (signedWrap) signedWrap.style.display = 'none';
                }
            } catch (e) {}
        }

        // Gabungkan cloud & lokal tanpa duplikat berdasarkan id_order / tracking_token
        const seen = new Set();
        const merged = [];
        [...cloud, ...local].forEach(o => {
            const key = String(o.tracking_token || o.id_order || Math.random());
            if (!seen.has(key)) {
                seen.add(key);
                merged.push(o);
            }
        });
        merged.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        renderHistory(merged);
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (window.SabangdorI18n) window.SabangdorI18n.renderSwitcher('#langHost');

        const btnSend = document.getElementById('btnSendOtp');
        const btnVerify = document.getElementById('btnVerifyOtp');
        const btnOut = document.getElementById('btnBuyerSignOut');

        if (btnSend) {
            btnSend.addEventListener('click', async () => {
                const email = (document.getElementById('buyerEmailInput').value || '').trim();
                if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                    showAuthMsg('Masukkan alamat email yang valid.', false);
                    return;
                }
                btnSend.disabled = true;
                try {
                    const { error } = await window.supabaseClient.auth.signInWithOtp({ email });
                    if (error) throw error;
                    showAuthMsg('Kode OTP / tautan masuk telah dikirim ke email Anda.', true);
                    const box = document.getElementById('otpVerifyBox');
                    if (box) box.style.display = 'flex';
                } catch (err) {
                    const msg = window.SabangdorErrors ? window.SabangdorErrors.formatError(err, 'general') : 'Gagal mengirim OTP.';
                    showAuthMsg(msg, false);
                } finally {
                    btnSend.disabled = false;
                }
            });
        }

        if (btnVerify) {
            btnVerify.addEventListener('click', async () => {
                const email = (document.getElementById('buyerEmailInput').value || '').trim();
                const token = (document.getElementById('buyerOtpInput').value || '').trim();
                if (!token) { showAuthMsg('Masukkan kode OTP dari email Anda.', false); return; }
                btnVerify.disabled = true;
                try {
                    const { error } = await window.supabaseClient.auth.verifyOtp({ email, token, type: 'email' });
                    if (error) throw error;
                    showAuthMsg('Berhasil masuk! Memuat riwayat Anda...', true);
                    await refreshHistory();
                } catch (err) {
                    showAuthMsg('Kode OTP tidak valid atau sudah kedaluwarsa.', false);
                } finally {
                    btnVerify.disabled = false;
                }
            });
        }

        if (btnOut) {
            btnOut.addEventListener('click', async () => {
                try { await window.supabaseClient.auth.signOut(); } catch (e) {}
                await refreshHistory();
            });
        }

        refreshHistory();
    });
})();
