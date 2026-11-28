/**
 * File: telemetry.js
 * PB-059: Pemantauan error (JS error, unhandledrejection, kegagalan RPC) & analitik penggunaan
 * tanpa menyimpan data pribadi (PII) pelanggan.
 */
(function () {
    'use strict';

    const LOCAL_LOG_KEY = 'sabangdor_telemetry_buffer';
    const MAX_LOCAL_LOGS = 50;
    const RATE_WINDOW_MS = 60 * 1000;
    let sentInWindow = 0;
    let windowStart = Date.now();

    function getCurrentPage() {
        try {
            const path = window.location.pathname || '';
            return (path.split('/').pop() || 'index.html').slice(0, 80);
        } catch (e) {
            return 'unknown';
        }
    }

    function sanitizeMessage(msg) {
        // Hapus potensi email atau nomor HP agar tidak menyimpan PII
        return String(msg || '')
            .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
            .replace(/\b08\d{7,13}\b/g, '[phone]')
            .slice(0, 300);
    }

    function pushLocal(entry) {
        try {
            const arr = JSON.parse(localStorage.getItem(LOCAL_LOG_KEY) || '[]');
            const list = Array.isArray(arr) ? arr : [];
            list.unshift(entry);
            localStorage.setItem(LOCAL_LOG_KEY, JSON.stringify(list.slice(0, MAX_LOCAL_LOGS)));
        } catch (e) {}
    }

    async function track(tipe, sumber, pesan, meta) {
        const now = Date.now();
        if (now - windowStart > RATE_WINDOW_MS) {
            windowStart = now;
            sentInWindow = 0;
        }
        if (sentInWindow >= 20) return;
        sentInWindow++;

        const entry = {
            tipe: ['error', 'rpc_error', 'event'].includes(tipe) ? tipe : 'event',
            sumber: String(sumber || 'app').slice(0, 60),
            pesan: sanitizeMessage(pesan),
            halaman: getCurrentPage(),
            metadata: meta && typeof meta === 'object' ? meta : {},
            created_at: new Date().toISOString()
        };

        pushLocal(entry);

        const client = typeof window !== 'undefined' ? window.supabaseClient : null;
        if (!client || typeof client.rpc !== 'function') return;

        try {
            await client.rpc('catat_telemetri', {
                p_tipe: entry.tipe,
                p_sumber: entry.sumber,
                p_pesan: entry.pesan,
                p_halaman: entry.halaman,
                p_meta: entry.metadata
            });
        } catch (e) {
            // Jangan memicu error berantai jika RPC telemetri belum dimigrasi atau offline
        }
    }

    function trackError(sumber, err, meta) {
        const msg = err && err.message ? err.message : String(err || 'Unknown error');
        return track('error', sumber, msg, meta);
    }

    function trackRpcError(rpcName, err) {
        const msg = err && err.message ? err.message : String(err || 'RPC failed');
        return track('rpc_error', rpcName, msg, { code: err && err.code ? String(err.code) : '' });
    }

    function trackEvent(eventName, meta) {
        return track('event', eventName, eventName, meta);
    }

    function getLocalLogs() {
        try {
            const arr = JSON.parse(localStorage.getItem(LOCAL_LOG_KEY) || '[]');
            return Array.isArray(arr) ? arr : [];
        } catch (e) {
            return [];
        }
    }

    if (typeof window !== 'undefined') {
        window.addEventListener('error', function (evt) {
            if (!evt || !evt.message) return;
            trackError('window.onerror', evt.message, {
                file: evt.filename ? String(evt.filename).split('/').pop() : '',
                line: evt.lineno || 0
            });
        });

        window.addEventListener('unhandledrejection', function (evt) {
            const reason = evt && evt.reason ? (evt.reason.message || String(evt.reason)) : 'Unhandled Promise Rejection';
            trackError('unhandledrejection', reason);
        });

        window.addEventListener('DOMContentLoaded', function () {
            trackEvent('page_view', { lang: (localStorage.getItem('sabangdor_lang') || 'id') });
        });

        window.SabangdorTelemetry = {
            track,
            trackError,
            trackRpcError,
            trackEvent,
            getLocalLogs
        };
    }
})();
