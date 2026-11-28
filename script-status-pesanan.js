/**
 * File: script-status-pesanan.js
 * PB-044: Lacak status pesanan oleh pembeli tanpa login (hanya data milik token tersebut).
 * PB-041: Stepper 4 tahap (Menunggu -> Disiapkan -> Siap Diambil -> Selesai).
 * PB-050: Estimasi waktu tunggu.
 * PB-061: Notifikasi opt-in browser (Notification API + suara + getar saat status menjadi 'siap').
 * PB-068: Form ulasan dan rating 1-5 setelah pesanan selesai.
 */
(function () {
    'use strict';

    const NOTIF_PREF_KEY = 'sabangdor_buyer_notif_optin';
    let currentToken = null;
    let lastKnownStatus = null;
    let notifiedReady = false;
    let selectedRating = 5;
    let pollTimer = null;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
    const rupiah = (n) => 'Rp' + Math.round(Number(n) || 0).toLocaleString('id-ID');
    const tr = (k, fb) => (window.SabangdorI18n ? window.SabangdorI18n.t(k, fb) : (fb || k));

    function playReadyAlert(nomorAntrean) {
        try {
            if (navigator.vibrate) navigator.vibrate([250, 120, 250, 120, 350]);
        } catch (e) {}

        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (Ctx) {
                const ctx = new Ctx();
                const now = ctx.currentTime;
                [523.25, 659.25, 783.99].forEach((f, i) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(f, now + i * 0.14);
                    gain.gain.setValueAtTime(0.001, now + i * 0.14);
                    gain.gain.exponentialRampToValueAtTime(0.25, now + i * 0.14 + 0.03);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.14 + 0.35);
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start(now + i * 0.14);
                    osc.stop(now + i * 0.14 + 0.36);
                });
            }
        } catch (e) {}

        try {
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                new Notification('Pesanan SABANGDOR Siap Diambil!', {
                    body: `Nomor antrean #ANT-${String(nomorAntrean || 0).padStart(2, '0')} sudah siap di konter kasir.`,
                    icon: 'assets/icon-192.svg'
                });
            }
        } catch (e) {}
    }

    function getOrderStepIndex(order) {
        if (order.status_pembayaran === 'batal' || order.status_pembayaran === 'retur') return -1;
        if (order.status_pembayaran === 'pending') return 0;
        if (order.status_pesanan === 'disiapkan') return 1;
        if (order.status_pesanan === 'siap') return 2;
        if (order.status_pesanan === 'selesai') return 3;
        return 0;
    }

    function renderOrder(order) {
        const host = document.getElementById('trackContent');
        if (!host) return;

        if (!order || !order.found) {
            host.innerHTML = `
                <div class="card-pembayaran" style="text-align:center;">
                    <h2 class="pay-card-title">Pesanan tidak ditemukan</h2>
                    <p style="font-size:0.875rem; color:var(--text-muted); margin-bottom:14px;">
                        Tautan pelacakan tidak valid atau belum ada pesanan aktif di perangkat ini.
                    </p>
                    <a href="riwayat-pembeli.html" class="btn btn--secondary">Lihat Riwayat Pesanan</a>
                </div>`;
            return;
        }

        const stepIdx = getOrderStepIndex(order);
        const nomor = 'ANT-' + String(order.nomor_antrean || 0).padStart(2, '0');

        // PB-061: Pemicu notifikasi saat status berpindah ke 'siap'
        const optIn = localStorage.getItem(NOTIF_PREF_KEY) === '1';
        if (order.status_pesanan === 'siap' && !notifiedReady && (lastKnownStatus !== null || optIn)) {
            notifiedReady = true;
            if (optIn) playReadyAlert(order.nomor_antrean);
        }
        lastKnownStatus = order.status_pesanan;

        const steps = [
            { label: tr('step_pending', 'Menunggu Verifikasi') },
            { label: tr('step_preparing', 'Sedang Disiapkan') },
            { label: tr('step_ready', 'Siap Diambil') },
            { label: tr('step_done', 'Selesai') }
        ];

        let statusBannerHtml = '';
        if (order.status_pembayaran === 'batal') {
            statusBannerHtml = `<div class="inline-error show" role="status">Pesanan ini telah dibatalkan.</div>`;
        } else if (order.status_pembayaran === 'retur') {
            statusBannerHtml = `<div class="inline-error show" role="status">Pesanan ini telah diretur oleh kasir.</div>`;
        } else if (order.status_pesanan === 'siap') {
            statusBannerHtml = `
                <div style="background:#DCFCE7; border:1.5px solid #047857; color:#047857; padding:14px; border-radius:12px; font-weight:800; text-align:center;">
                    Pesanan #${esc(nomor)} SUDAH SIAP! Silakan ambil di konter kasir.
                </div>`;
        }

        const estMenit = order.estimasi && order.estimasi.estimasi_menit ? order.estimasi.estimasi_menit : null;
        const showEst = stepIdx >= 0 && stepIdx <= 1 && estMenit != null;

        const notifActive = optIn && (typeof Notification === 'undefined' || Notification.permission !== 'denied');
        const showNotifBtn = stepIdx >= 0 && stepIdx < 2;

        const itemsHtml = (order.items || []).map(i => `
            <li class="order-item-row">
                <div>
                    <b>${Number(i.jumlah || 1)}x</b> ${esc(i.nama_item || 'Menu')}
                    ${i.varian ? `<div class="order-item-variant">${esc(i.varian)}</div>` : ''}
                    ${i.catatan ? `<div class="order-item-note">Catatan: "${esc(i.catatan)}"</div>` : ''}
                </div>
                <b>${rupiah(i.subtotal)}</b>
            </li>
        `).join('');

        let reviewHtml = '';
        if (order.status_pesanan === 'selesai' && order.status_pembayaran === 'lunas') {
            if (order.ulasan) {
                const stars = '★'.repeat(order.ulasan.rating) + '☆'.repeat(5 - order.ulasan.rating);
                reviewHtml = `
                    <div class="card-pembayaran">
                        <h2 class="pay-card-title">Ulasan Anda</h2>
                        <div style="color:#B45309; font-size:1.25rem; letter-spacing:2px; margin-bottom:6px;">${stars}</div>
                        <p style="font-size:0.9375rem; color:var(--text-main);">${esc(order.ulasan.komentar)}</p>
                    </div>`;
            } else {
                reviewHtml = `
                    <div class="card-pembayaran" id="reviewCard">
                        <h2 class="pay-card-title">${esc(tr('review_title', 'Beri Ulasan Pesanan'))}</h2>
                        <div class="rating-stars" role="radiogroup" aria-label="Pilih rating bintang" style="display:flex; gap:8px; margin-bottom:12px;">
                            ${[1, 2, 3, 4, 5].map(n => `
                                <button type="button" class="star-btn" data-star="${n}" aria-label="${n} bintang" aria-pressed="${n <= selectedRating}"
                                    style="min-width:44px; min-height:44px; border-radius:10px; border:1px solid var(--border-line); background:${n <= selectedRating ? '#FEF3C7' : '#F8F9FA'}; color:${n <= selectedRating ? '#B45309' : '#64748B'}; font-size:1.25rem; font-weight:800;">★</button>
                            `).join('')}
                        </div>
                        <label for="reviewComment" class="field-head">Komentar</label>
                        <textarea id="reviewComment" class="input-nama" rows="3" maxlength="500" placeholder="${esc(tr('review_placeholder', 'Ceritakan pengalamanmu...'))}"></textarea>
                        <p id="reviewErrorMsg" class="inline-error" role="alert"></p>
                        <button type="button" id="btnKirimUlasan" class="btn btn--primary" style="margin-top:12px;">
                            ${esc(tr('btn_send_review', 'Kirim Ulasan'))}
                        </button>
                    </div>`;
            }
        }

        host.innerHTML = `
            <div class="card-pembayaran" style="text-align:center;">
                <span style="font-size:0.8125rem; font-weight:700; color:var(--text-muted);">${esc(tr('queue_number', 'Nomor Antrean'))}</span>
                <div style="font-size:2.25rem; font-weight:800; color:var(--primary-red-hover); line-height:1.15; margin:4px 0;">#${esc(nomor)}</div>
                <div style="font-size:0.9375rem; font-weight:600; color:var(--text-main);">${esc(order.nama_pembeli)}</div>
                ${order.is_preorder && order.jadwal_ambil ? `
                    <div style="margin-top:8px; display:inline-block; padding:4px 10px; border-radius:8px; background:#E0E7FF; color:#3730A3; font-size:0.8125rem; font-weight:700;">
                        Pre-order: ${esc(new Date(order.jadwal_ambil).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }))} WIB
                    </div>` : ''}
                ${showEst ? `
                    <div style="margin-top:10px; padding:10px 12px; background:var(--surface-subtle); border-radius:10px; font-size:0.875rem; color:var(--text-main);">
                        ${esc(tr('est_wait_time', 'Estimasi Waktu Tunggu'))}: <strong>~${estMenit} menit</strong>
                    </div>` : ''}
            </div>

            ${statusBannerHtml}

            <div class="card-pembayaran">
                <h2 class="pay-card-title">Progres Pesanan</h2>
                <ol style="list-style:none; display:flex; flex-direction:column; gap:10px;">
                    ${steps.map((s, idx) => {
                        const done = stepIdx > idx;
                        const active = stepIdx === idx;
                        const bg = done ? '#047857' : (active ? '#E11D48' : '#E2E8F0');
                        const fg = (done || active) ? '#FFFFFF' : '#475569';
                        return `
                            <li style="display:flex; align-items:center; gap:12px;">
                                <span style="width:28px; height:28px; border-radius:50%; background:${bg}; color:${fg}; display:grid; place-items:center; font-weight:800; font-size:0.8125rem; flex-shrink:0;">
                                    ${done ? '✓' : (idx + 1)}
                                </span>
                                <span style="font-size:0.9375rem; font-weight:${active ? '800' : '600'}; color:${active ? 'var(--text-main)' : 'var(--text-muted)'};">
                                    ${esc(s.label)}
                                </span>
                            </li>`;
                    }).join('')}
                </ol>

                ${showNotifBtn ? `
                    <div style="margin-top:14px; display:flex; gap:8px; flex-wrap:wrap;">
                        <button type="button" id="btnOptInNotif" class="btn ${notifActive ? 'btn--success' : 'btn--secondary'}" style="flex:1;">
                            ${esc(notifActive ? tr('notif_enabled', 'Notifikasi Aktif') : tr('btn_enable_notif', 'Aktifkan Notifikasi Saat Siap'))}
                        </button>
                        <button type="button" id="btnCopyTrackLink" class="btn btn--secondary" style="flex:1;">Salin Tautan Lacak</button>
                    </div>` : `
                    <div style="margin-top:14px;">
                        <button type="button" id="btnCopyTrackLink" class="btn btn--secondary">Salin Tautan Lacak</button>
                    </div>`}
            </div>

            <div class="card-pembayaran">
                <h2 class="pay-card-title">${esc(tr('order_details', 'Rincian Pesanan'))}</h2>
                <ul class="order-summary-list">${itemsHtml}</ul>
                ${Number(order.diskon_voucher) > 0 ? `<div class="receipt-row"><span>Diskon Voucher</span><strong style="color:#047857;">-${rupiah(order.diskon_voucher)}</strong></div>` : ''}
                ${Number(order.diskon_poin) > 0 ? `<div class="receipt-row"><span>Potongan Poin</span><strong style="color:#047857;">-${rupiah(order.diskon_poin)}</strong></div>` : ''}
                <div class="receipt-row">
                    <span><strong>Total</strong></span>
                    <strong style="color:var(--primary-red-hover);">${rupiah(order.total_harga)}</strong>
                </div>
                ${Number(order.poin_didapat) > 0 ? `<div style="margin-top:8px; font-size:0.8125rem; font-weight:700; color:#047857;">+${order.poin_didapat} poin loyalitas ditambahkan!</div>` : ''}
            </div>

            ${reviewHtml}
        `;

        // Bind tombol opt-in notifikasi (PB-061)
        const btnNotif = document.getElementById('btnOptInNotif');
        if (btnNotif) {
            btnNotif.addEventListener('click', async () => {
                if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
                    try { await Notification.requestPermission(); } catch (e) {}
                }
                localStorage.setItem(NOTIF_PREF_KEY, '1');
                btnNotif.className = 'btn btn--success';
                btnNotif.textContent = tr('notif_enabled', 'Notifikasi Aktif');
                // Uji getar halus sebagai konfirmasi
                try { if (navigator.vibrate) navigator.vibrate(80); } catch (e) {}
            });
        }

        // Bind salin tautan
        const btnCopy = document.getElementById('btnCopyTrackLink');
        if (btnCopy) {
            btnCopy.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(window.location.href);
                    btnCopy.textContent = 'Tautan Tersalin!';
                    setTimeout(() => { btnCopy.textContent = 'Salin Tautan Lacak'; }, 2000);
                } catch (e) {
                    prompt('Salin tautan pelacakan ini:', window.location.href);
                }
            });
        }

        // Bind rating bintang & kirim ulasan (PB-068)
        document.querySelectorAll('.star-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                selectedRating = Number(btn.dataset.star) || 5;
                document.querySelectorAll('.star-btn').forEach(b => {
                    const n = Number(b.dataset.star);
                    b.setAttribute('aria-pressed', String(n <= selectedRating));
                    b.style.background = n <= selectedRating ? '#FEF3C7' : '#F8F9FA';
                    b.style.color = n <= selectedRating ? '#B45309' : '#64748B';
                });
            });
        });

        const btnRev = document.getElementById('btnKirimUlasan');
        if (btnRev) {
            btnRev.addEventListener('click', submitReview);
        }
    }

    async function submitReview() {
        const commentEl = document.getElementById('reviewComment');
        const errEl = document.getElementById('reviewErrorMsg');
        const btn = document.getElementById('btnKirimUlasan');
        const komentar = commentEl ? commentEl.value : '';

        if (window.SabangdorValidation) {
            const check = window.SabangdorValidation.validateReviewInput(selectedRating, komentar);
            if (!check.valid) {
                if (errEl) { errEl.textContent = check.message; errEl.classList.add('show'); }
                return;
            }
        } else if (!String(komentar || '').trim()) {
            if (errEl) { errEl.textContent = 'Komentar ulasan tidak boleh kosong.'; errEl.classList.add('show'); }
            return;
        }

        if (errEl) errEl.classList.remove('show');
        if (btn) { btn.disabled = true; btn.textContent = 'Mengirim...'; }

        try {
            const { error } = await window.supabaseClient.rpc('kirim_ulasan', {
                p_token: currentToken,
                p_rating: selectedRating,
                p_komentar: komentar.trim()
            });
            if (error) throw error;
            await loadStatus();
        } catch (err) {
            const msg = window.SabangdorErrors ? window.SabangdorErrors.formatError(err, 'general') : 'Gagal mengirim ulasan.';
            if (errEl) { errEl.textContent = msg; errEl.classList.add('show'); }
            if (btn) { btn.disabled = false; btn.textContent = tr('btn_send_review', 'Kirim Ulasan'); }
        }
    }

    async function loadStatus() {
        if (!currentToken || !window.supabaseClient) {
            renderOrder({ found: false });
            return;
        }
        try {
            const { data, error } = await window.supabaseClient.rpc('lacak_pesanan', { p_token: currentToken });
            if (error) throw error;
            renderOrder(data);
        } catch (err) {
            if (window.SabangdorTelemetry) window.SabangdorTelemetry.trackRpcError('lacak_pesanan', err);
            const pill = document.getElementById('trackLivePill');
            if (pill) pill.textContent = 'Koneksi terganggu';
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (window.SabangdorI18n) window.SabangdorI18n.renderSwitcher('#langHost');

        const params = new URLSearchParams(window.location.search);
        currentToken = params.get('token');
        if (!currentToken) {
            try {
                const last = JSON.parse(sessionStorage.getItem('sabangdor_last_order') || localStorage.getItem('sabangdor_last_order_token') || 'null');
                if (last && last.tracking_token) currentToken = last.tracking_token;
                else if (typeof last === 'string') currentToken = last;
            } catch (e) {}
        }

        loadStatus();
        pollTimer = setInterval(() => {
            if (!document.hidden) loadStatus();
        }, 5000);

        const pill = document.getElementById('trackLivePill');
        if (pill) pill.textContent = 'Diperbarui otomatis';

        window.addEventListener('sabangdor:langchange', () => loadStatus());
    });
})();
