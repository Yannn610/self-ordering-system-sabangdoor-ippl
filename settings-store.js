/**
 * File: settings-store.js
 * Membaca pengaturan bersama dari Supabase (tabel app_settings):
 *   status_toko (buka/tutup), qris_image (data URL), menu_habis (JSON array nama menu)
 * Hasilnya di-cache ke localStorage (kunci lama dipertahankan) agar kode lama tetap bekerja
 * dan tetap ada nilai saat koneksi sedang bermasalah.
 */
(function () {
    var KEY_TOKO = 'sabangdor_status_toko';
    var KEY_QRIS = 'sabangdor_custom_qris';
    var KEY_HABIS = 'sabangdor_menu_status';

    async function muatPengaturan() {
        var client = window.supabaseClient;
        if (!client) return false;
        try {
            var res = await client.from('app_settings').select('key, value');
            if (res.error) throw res.error;

            var map = {};
            (res.data || []).forEach(function (r) { map[r.key] = r.value; });

            localStorage.setItem(KEY_TOKO, map.status_toko === 'tutup' ? 'tutup' : 'buka');

            if (map.qris_image) localStorage.setItem(KEY_QRIS, map.qris_image);
            else localStorage.removeItem(KEY_QRIS);

            var daftar = [];
            try { daftar = JSON.parse(map.menu_habis || '[]'); } catch (e) { daftar = []; }
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

    window.SabangdorSettings = { muat: muatPengaturan };
})();
