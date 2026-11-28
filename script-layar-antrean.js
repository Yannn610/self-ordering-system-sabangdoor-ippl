/**
 * File: script-layar-antrean.js
 * PB-051: Layar antrean publik (untuk TV/tablet) tanpa menampilkan nama pelanggan.
 * PB-042: Memakai Supabase Realtime dengan fallback polling otomatis.
 */
(function () {
    'use strict';

    let soundEnabled = false;
    let knownReadySet = new Set();
    let initialized = false;
    let pollTimer = null;

    function formatAntrean(n) {
        return 'ANT-' + String(n || 0).padStart(2, '0');
    }

    function playChime() {
        if (!soundEnabled) return;
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            const ctx = new Ctx();
            const now = ctx.currentTime;
            [659.25, 880].forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now + i * 0.16);
                gain.gain.setValueAtTime(0.001, now + i * 0.16);
                gain.gain.exponentialRampToValueAtTime(0.25, now + i * 0.16 + 0.03);
                gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.16 + 0.35);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + i * 0.16);
                osc.stop(now + i * 0.16 + 0.36);
            });
        } catch (e) {}
    }

    function updateClock() {
        const el = document.getElementById('queueClock');
        if (!el) return;
        try {
            el.textContent = new Date().toLocaleTimeString('id-ID', {
                timeZone: 'Asia/Jakarta',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            }) + ' WIB';
        } catch (e) {
            el.textContent = new Date().toLocaleTimeString('id-ID');
        }
    }

    function renderQueue(rows) {
        const prepList = document.getElementById('preparingList');
        const readyList = document.getElementById('readyList');
        const prepCount = document.getElementById('preparingCount');
        const readyCount = document.getElementById('readyCount');

        const safeRows = Array.isArray(rows) ? rows : [];
        const preparing = safeRows.filter(r => r.status_pesanan === 'disiapkan');
        const ready = safeRows
            .filter(r => r.status_pesanan === 'siap')
            .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));

        if (prepCount) prepCount.textContent = String(preparing.length);
        if (readyCount) readyCount.textContent = String(ready.length);

        const nextReadySet = new Set(ready.map(r => r.nomor_antrean));
        if (initialized) {
            let hasNew = false;
            nextReadySet.forEach(num => { if (!knownReadySet.has(num)) hasNew = true; });
            if (hasNew) playChime();
        }
        knownReadySet = nextReadySet;
        initialized = true;

        if (prepList) {
            prepList.innerHTML = preparing.length === 0
                ? '<p class="queue-empty">Belum ada pesanan diproses.</p>'
                : preparing.map(r => `<div class="queue-tile">${formatAntrean(r.nomor_antrean)}</div>`).join('');
        }

        if (readyList) {
            readyList.innerHTML = ready.length === 0
                ? '<p class="queue-empty">Belum ada pesanan siap diambil.</p>'
                : ready.map((r, idx) => `<div class="queue-tile ready${idx === 0 ? ' newest' : ''}">${formatAntrean(r.nomor_antrean)}</div>`).join('');
        }
    }

    async function fetchQueue() {
        const client = window.supabaseClient;
        if (!client) return;
        try {
            const { data, error } = await client.rpc('get_layar_antrean');
            if (error) throw error;
            renderQueue(data || []);
        } catch (e) {
            console.warn('Gagal memuat layar antrean:', e.message || e);
        }
    }

    function setPill(mode) {
        const pill = document.getElementById('liveStatusPill');
        if (!pill) return;
        if (mode === 'realtime') {
            pill.textContent = 'Live Realtime';
            pill.className = 'live-pill';
        } else {
            pill.textContent = 'Pembaruan Otomatis';
            pill.className = 'live-pill polling';
        }
    }

    function startPolling(ms) {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(fetchQueue, ms);
    }

    function initRealtime() {
        const client = window.supabaseClient;
        if (!client || typeof client.channel !== 'function') {
            setPill('polling');
            startPolling(3000);
            return;
        }

        const ch = client
            .channel('public-queue-board')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
                fetchQueue();
            })
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    setPill('realtime');
                    startPolling(20000); // heartbeat ringan
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                    setPill('polling');
                    startPolling(3000);
                }
            });
        window._queueChannel = ch;
    }

    document.addEventListener('DOMContentLoaded', () => {
        updateClock();
        setInterval(updateClock, 1000);

        const soundBtn = document.getElementById('btnSoundToggle');
        if (soundBtn) {
            soundBtn.addEventListener('click', () => {
                soundEnabled = !soundEnabled;
                soundBtn.setAttribute('aria-pressed', String(soundEnabled));
                soundBtn.textContent = soundEnabled ? 'Suara: Aktif' : 'Suara: Mati';
                if (soundEnabled) playChime();
            });
        }

        const fsBtn = document.getElementById('btnFullscreen');
        if (fsBtn) {
            fsBtn.addEventListener('click', () => {
                if (!document.fullscreenElement) {
                    document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
                } else {
                    document.exitFullscreen && document.exitFullscreen();
                }
            });
        }

        fetchQueue();
        initRealtime();
    });
})();
