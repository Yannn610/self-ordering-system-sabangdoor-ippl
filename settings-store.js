/**
 * File: settings-store.js
 * Membaca pengaturan bersama dari Supabase (tabel app_settings):
 *   - status_toko (buka/tutup)
 *   - status_toko_override (JSON { tanggal, status } untuk menimpa jadwal manual PB-064)
 *   - jadwal_operasional (JSON jadwal per hari PB-064)
 *   - tanggal_libur (JSON array YYYY-MM-DD PB-064)
 *   - qris_image (data URL)
 *   - menu_habis (JSON array nama menu)
 *   - preorder_config (JSON konfigurasi pre-order PB-075)
 *   - apriori_config (JSON min_support & min_confidence PB-060)
 */
(function () {
    var KEY_TOKO = 'sabangdor_status_toko';
    var KEY_TOKO_REASON = 'sabangdor_status_toko_reason';
    var KEY_QRIS = 'sabangdor_custom_qris';
    var KEY_HABIS = 'sabangdor_menu_status';
    var KEY_JADWAL = 'sabangdor_jadwal_operasional';
    var KEY_LIBUR = 'sabangdor_tanggal_libur';
    var KEY_OVERRIDE = 'sabangdor_status_toko_override';
    var KEY_PREORDER = 'sabangdor_preorder_config';
    var KEY_APRIORI = 'sabangdor_apriori_config';

    function safeJson(raw, fallback) {
        if (!raw) return fallback;
        try { return JSON.parse(raw); } catch (e) { return fallback; }
    }

    function getWibNowParts(dateObj) {
        var d = dateObj || new Date();
        try {
            var fmt = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Asia/Jakarta',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                weekday: 'short',
                hour12: false
            });
            var parts = {};
            fmt.formatToParts(d).forEach(function (p) { parts[p.type] = p.value; });
            var dayMap = { Sun: '0', Mon: '1', Tue: '2', Wed: '3', Thu: '4', Fri: '5', Sat: '6' };
            var hh = parts.hour === '24' ? '00' : parts.hour;
            return {
                dateStr: parts.year + '-' + parts.month + '-' + parts.day,
                dow: dayMap[parts.weekday] || String(d.getDay()),
                hhmm: hh + ':' + parts.minute
            };
        } catch (e) {
            var pad = function (n) { return String(n).padStart(2, '0'); };
            return {
                dateStr: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
                dow: String(d.getDay()),
                hhmm: pad(d.getHours()) + ':' + pad(d.getMinutes())
            };
        }
    }

    /**
     * PB-064: Evaluasi status buka/tutup efektif (override manual > libur > jadwal > manual).
     */
    function evaluateStoreStatus(map, nowDate) {
        var manualStatus = map.status_toko === 'tutup' ? 'tutup' : 'buka';
        var jadwal = safeJson(map.jadwal_operasional, { enabled: false });
        if (!jadwal || !jadwal.enabled) {
            return { status: manualStatus, reason: manualStatus === 'tutup' ? 'manual' : 'open' };
        }

        var wib = getWibNowParts(nowDate);
        var overrideObj = safeJson(map.status_toko_override, null);
        if (overrideObj && overrideObj.tanggal === wib.dateStr && (overrideObj.status === 'buka' || overrideObj.status === 'tutup')) {
            return {
                status: overrideObj.status,
                reason: overrideObj.status === 'tutup' ? 'manual_override' : 'open_override'
            };
        }

        var libur = safeJson(map.tanggal_libur, []);
        if (Array.isArray(libur) && libur.indexOf(wib.dateStr) !== -1) {
            return { status: 'tutup', reason: 'holiday' };
        }

        var dayCfg = jadwal.days && jadwal.days[wib.dow];
        if (!dayCfg || !dayCfg.aktif) {
            return { status: 'tutup', reason: 'schedule' };
        }
        var buka = dayCfg.buka || '00:00';
        var tutup = dayCfg.tutup || '23:59';
        if (wib.hhmm < buka || wib.hhmm > tutup) {
            return { status: 'tutup', reason: 'schedule', buka: buka, tutup: tutup };
        }
        return { status: 'buka', reason: 'open', buka: buka, tutup: tutup };
    }

    async function muatPengaturan() {
        var client = window.supabaseClient;
        if (!client) return false;
        try {
            var res = await client.from('app_settings').select('key, value');
            if (res.error) throw res.error;

            var map = {};
            (res.data || []).forEach(function (r) { map[r.key] = r.value; });

            var evalRes = evaluateStoreStatus(map);
            localStorage.setItem(KEY_TOKO, evalRes.status);
            localStorage.setItem(KEY_TOKO_REASON, evalRes.reason || 'manual');

            if (map.jadwal_operasional) localStorage.setItem(KEY_JADWAL, map.jadwal_operasional);
            if (map.tanggal_libur) localStorage.setItem(KEY_LIBUR, map.tanggal_libur);
            if (map.status_toko_override != null) localStorage.setItem(KEY_OVERRIDE, map.status_toko_override);
            if (map.preorder_config) localStorage.setItem(KEY_PREORDER, map.preorder_config);
            if (map.apriori_config) localStorage.setItem(KEY_APRIORI, map.apriori_config);

            if (map.qris_image) localStorage.setItem(KEY_QRIS, map.qris_image);
            else localStorage.removeItem(KEY_QRIS);

            var daftar = safeJson(map.menu_habis, []);
            if (!Array.isArray(daftar)) daftar = [];
            localStorage.setItem(KEY_HABIS, JSON.stringify(
                daftar.map(function (nama) { return { nama: String(nama), status: 'habis' }; })
            ));
            return true;
        } catch (e) {
            console.warn('Gagal memuat pengaturan toko:', e.message || e);
            return false;
        }
    }

    function getPreorderConfig() {
        return safeJson(localStorage.getItem(KEY_PREORDER), { aktif: true, kuota_per_slot: 10, lead_menit: 30, slot_menit: 30 });
    }

    function getJadwalOperasional() {
        return safeJson(localStorage.getItem(KEY_JADWAL), { enabled: false, days: {} });
    }

    window.SabangdorSettings = {
        muat: muatPengaturan,
        evaluateStoreStatus: evaluateStoreStatus,
        getWibNowParts: getWibNowParts,
        getPreorderConfig: getPreorderConfig,
        getJadwalOperasional: getJadwalOperasional
    };
})();
