/**
 * File: tests/regression.test.js
 * PB-033: Pengujian regresi otomatis (60 kasus uji) mencakup seluruh 48 kasus uji data error
 * (Login, Checkout, Menu Tambahan) serta verifikasi logika bisnis Rilis 2-5.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const V = require('../validation.js');
const E = require('../error-messages.js');
const I18n = require('../i18n.js');
const Apriori = require('../apriori_recommendation.js');

const ROOT = path.resolve(__dirname, '..');

// Helper mock localStorage untuk pengujian rate limiter & antrean
function makeMemoryStorage() {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k)
    };
}

// =========================================================================
// BAGIAN 1: FORM LOGIN & PESAN GALAT ID (10 KASUS: L-01 s.d. L-10)
// =========================================================================
test('L-01: Login menolak email kosong', () => {
    const r = V.validateLoginInput('', 'rahasia1234');
    assert.equal(r.valid, false);
});

test('L-02: Login menolak email hanya spasi', () => {
    const r = V.validateLoginInput('   ', 'rahasia1234');
    assert.equal(r.valid, false);
});

test('L-03: Login menolak format email tidak valid', () => {
    const r = V.validateLoginInput('pegawai-tanpa-at', 'rahasia1234');
    assert.equal(r.valid, false);
});

test('L-04: Login menolak kata sandi kosong', () => {
    const r = V.validateLoginInput('kasir@sabangdor.com', '');
    assert.equal(r.valid, false);
});

test('L-05: Login menerima kredensial format valid', () => {
    const r = V.validateLoginInput('  kasir@sabangdor.com ', 'Sandikuat123');
    assert.equal(r.valid, true);
    assert.equal(r.email, 'kasir@sabangdor.com');
});

test('L-06 (PB-030 / O-01): Galat kredensial Supabase diterjemahkan ke bahasa Indonesia', () => {
    const msg = E.formatError({ message: 'Invalid login credentials' }, 'login', 'id');
    assert.equal(msg, 'Email atau kata sandi salah.');
});

test('L-07 (PB-030 / O-01): Galat jaringan diterjemahkan tanpa detail teknis', () => {
    const msg = E.formatError(new TypeError('Failed to fetch'), 'login', 'id');
    assert.equal(msg, 'Tidak dapat terhubung, coba lagi.');
});

test('L-08 (PB-030): Galat sesi JWT habis diterjemahkan ramah', () => {
    const msg = E.formatError({ message: 'JWT expired' }, 'general', 'id');
    assert.match(msg, /Sesi login telah habis/i);
});

test('L-09 (PB-067): Kebijakan kata sandi menolak < 10 karakter atau tanpa angka', () => {
    assert.equal(V.validatePasswordPolicy('abc12345').valid, false);
    assert.equal(V.validatePasswordPolicy('abcdefghij').valid, false);
    assert.equal(V.validatePasswordPolicy('1234567890').valid, false);
});

test('L-10 (PB-067): Kebijakan kata sandi menerima >= 10 karakter huruf + angka', () => {
    assert.equal(V.validatePasswordPolicy('Sabangdor2026').valid, true);
});

// =========================================================================
// BAGIAN 2: FORM CHECKOUT & KEAMANAN (18 KASUS: C-01 s.d. C-18)
// =========================================================================
test('C-01: Checkout menolak nama kosong', () => {
    assert.equal(V.validateCustomerName('').valid, false);
});

test('C-02: Checkout menolak nama hanya spasi', () => {
    assert.equal(V.validateCustomerName('     ').valid, false);
});

test('C-03 (PB-028 / F-03): Checkout menolak nama > 50 karakter', () => {
    const res = V.validateCustomerName('A'.repeat(51));
    assert.equal(res.valid, false);
    assert.match(res.message, /50/);
});

test('C-04 (PB-028): Checkout menerima nama tepat 50 karakter', () => {
    const res = V.validateCustomerName('Budi ' + 'A'.repeat(45));
    assert.equal(res.valid, true);
});

test('C-05 (PB-023): Payload XSS <script> pada nama di-escape sempurna', () => {
    const raw = '<script>alert(1)</script>';
    const escaped = V.escapeHtml(raw);
    assert.equal(escaped.includes('<script>'), false);
    assert.equal(escaped, '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('C-06 (PB-023): Payload XSS atribut onerror di-escape sempurna', () => {
    const raw = '"><img src=x onerror=alert(1)>';
    const escaped = V.escapeHtml(raw);
    assert.equal(escaped.includes('<img'), false);
    assert.equal(V.containsHtmlScript(raw), true);
});

test('C-07 (PB-038): Checkout menolak nama 1 huruf', () => {
    const res = V.validateCustomerName('A');
    assert.equal(res.valid, false);
});

test('C-08 (PB-038): Checkout menerima nama 2 huruf', () => {
    const res = V.validateCustomerName('Al');
    assert.equal(res.valid, true);
});

test('C-09 (PB-038 / O-02): Checkout menolak nama hanya angka', () => {
    const res = V.validateCustomerName('123456');
    assert.equal(res.valid, false);
    assert.match(res.message, /huruf/i);
});

test('C-10 (PB-038 / O-02): Checkout menolak nama hanya simbol', () => {
    const res = V.validateCustomerName('!!!---@@@');
    assert.equal(res.valid, false);
    assert.match(res.message, /huruf/i);
});

test('C-11 (PB-038): Checkout menerima nama dengan kombinasi huruf & angka (mis. Meja 2 Budi)', () => {
    const res = V.validateCustomerName('Budi 02');
    assert.equal(res.valid, true);
});

test('C-12 (PB-035): Rate limiter perangkat mengizinkan 3 pesanan pertama dan memblokir ke-4 dalam 5 menit', () => {
    const store = makeMemoryStorage();
    const t0 = 1_700_000_000_000;
    assert.equal(V.checkDeviceRateLimit({ storage: store, now: t0 }).allowed, true);
    V.recordDeviceOrderTimestamp({ storage: store, now: t0 });
    assert.equal(V.checkDeviceRateLimit({ storage: store, now: t0 + 1000 }).needChallenge, true);
    V.recordDeviceOrderTimestamp({ storage: store, now: t0 + 1000 });
    V.recordDeviceOrderTimestamp({ storage: store, now: t0 + 2000 });
    const fourth = V.checkDeviceRateLimit({ storage: store, now: t0 + 3000 });
    assert.equal(fourth.allowed, false);
    assert.ok(fourth.waitSeconds > 0);
});

test('C-13 (PB-035): Rate limiter pulih otomatis setelah jendela 5 menit berakhir', () => {
    const store = makeMemoryStorage();
    const t0 = 1_700_000_000_000;
    V.recordDeviceOrderTimestamp({ storage: store, now: t0 });
    V.recordDeviceOrderTimestamp({ storage: store, now: t0 + 1000 });
    V.recordDeviceOrderTimestamp({ storage: store, now: t0 + 2000 });
    const after5m = V.checkDeviceRateLimit({ storage: store, now: t0 + 5 * 60 * 1000 + 5000 });
    assert.equal(after5m.allowed, true);
});

test('C-14 (PB-035): Tantangan verifikasi manusia menolak jawaban salah & honeypot terisi', () => {
    const ch = V.generateHumanChallenge();
    assert.equal(V.verifyHumanChallenge(ch, String(ch.answer + 1), '').valid, false);
    assert.equal(V.verifyHumanChallenge(ch, String(ch.answer), 'http://bot.spam').valid, false);
    assert.equal(V.verifyHumanChallenge(ch, String(ch.answer), '').valid, true);
});

test('C-15 (PB-003 / PB-027): Perhitungan paket optimal Bakpao 1..12 pcs akurat', () => {
    const expected = {
        1: 7000, 2: 14000, 3: 20000, 4: 27000, 5: 34000, 6: 36000,
        7: 43000, 8: 50000, 9: 56000, 10: 63000, 11: 70000, 12: 72000
    };
    Object.entries(expected).forEach(([pcs, price]) => {
        assert.equal(V.calculateBakpaoPrice(Number(pcs)), price, `Bakpao ${pcs} pcs`);
    });
});

test('C-16 (PB-066): Perhitungan diskon voucher persen (dengan cap maks_diskon) & nominal', () => {
    const vPct = { aktif: true, tipe: 'persen', nilai: 20, min_belanja: 20000, maks_diskon: 5000 };
    assert.equal(V.calculateVoucherDiscount(vPct, 15000).valid, false);
    assert.equal(V.calculateVoucherDiscount(vPct, 50000).discount, 5000);
    const vNom = { aktif: true, tipe: 'nominal', nilai: 10000, min_belanja: 0 };
    assert.equal(V.calculateVoucherDiscount(vNom, 7000).discount, 7000); // tidak boleh minus
});

test('C-17 (PB-074): Normalisasi & validasi nomor HP opsional untuk poin loyalitas', () => {
    assert.equal(V.validatePhoneOptional('').valid, true);
    assert.equal(V.validatePhoneOptional('+62 812-3456-7890').value, '081234567890');
    assert.equal(V.validatePhoneOptional('12345').valid, false);
});

test('C-18 (PB-068): Ulasan menolak komentar kosong & rating di luar 1-5', () => {
    assert.equal(V.validateReviewInput(5, '   ').valid, false);
    assert.equal(V.validateReviewInput(0, 'Enak banget').valid, false);
    assert.equal(V.validateReviewInput(6, 'Enak banget').valid, false);
    assert.equal(V.validateReviewInput(5, 'Dimsum hangat dan enak!').valid, true);
});

// =========================================================================
// BAGIAN 3: FORM MENU TAMBAHAN & KATALOG (20 KASUS: M-01 s.d. M-20)
// =========================================================================
const baseValidMenu = () => ({
    nama: 'Siomay Ayam Spesial',
    kategori: 'Dimsum Mentai',
    isKategoriBaru: false,
    ukuranRows: [{ nama: 'M', porsi: '6 pcs', harga: '22000' }],
    addonRows: [{ nama: 'Keju Parut', harga: '4000' }]
});

test('M-01: Menu menolak nama kosong', () => {
    const d = baseValidMenu(); d.nama = '';
    assert.equal(V.validateMenuForm(d, []).valid, false);
});

test('M-02: Menu menolak nama hanya spasi', () => {
    const d = baseValidMenu(); d.nama = '    ';
    assert.equal(V.validateMenuForm(d, []).valid, false);
});

test('M-03: Menu menolak tanpa ukuran sama sekali', () => {
    const d = baseValidMenu(); d.ukuranRows = [];
    assert.equal(V.validateMenuForm(d, []).valid, false);
});

test('M-04: Menu menolak harga ukuran 0', () => {
    const d = baseValidMenu(); d.ukuranRows = [{ nama: 'S', porsi: '3 pcs', harga: '0' }];
    assert.equal(V.validateMenuForm(d, []).valid, false);
});

test('M-05: Menu menolak harga ukuran negatif', () => {
    const d = baseValidMenu(); d.ukuranRows = [{ nama: 'S', porsi: '3 pcs', harga: '-15000' }];
    assert.equal(V.validateMenuForm(d, []).valid, false);
});

test('M-06: Menu menolak kategori baru kosong saat opsi kategori baru dipilih', () => {
    const d = baseValidMenu(); d.isKategoriBaru = true; d.kategoriBaru = '  ';
    assert.equal(V.validateMenuForm(d, []).valid, false);
});

test('M-07: Menu menerima kategori baru valid', () => {
    const d = baseValidMenu(); d.isKategoriBaru = true; d.kategoriBaru = 'Minuman';
    const r = V.validateMenuForm(d, []);
    assert.equal(r.valid, true);
    assert.equal(r.data.kategori, 'Minuman');
});

test('M-08 (PB-025 / F-02): Menu menolak harga ukuran melebihi Rp1.000.000', () => {
    const d = baseValidMenu(); d.ukuranRows = [{ nama: 'XL', porsi: '16 pcs', harga: '1000001' }];
    const r = V.validateMenuForm(d, []);
    assert.equal(r.valid, false);
    assert.match(r.message, /1\.000\.000/);
});

test('M-09 (PB-039 / O-04): Menu menolak harga desimal / bukan bilangan bulat Rupiah', () => {
    const d = baseValidMenu(); d.ukuranRows = [{ nama: 'M', porsi: '6 pcs', harga: '15000.5' }];
    const r = V.validateMenuForm(d, []);
    assert.equal(r.valid, false);
    assert.match(r.message, /bilangan bulat/i);
});

test('M-10 (PB-024 / F-01): Menu menolak harga tambahan opsional negatif', () => {
    const d = baseValidMenu(); d.addonRows = [{ nama: 'Diskon Palsu', harga: '-5000' }];
    const r = V.validateMenuForm(d, []);
    assert.equal(r.valid, false);
    assert.equal(r.message, 'Harga tambahan tidak boleh negatif.');
});

test('M-11 (PB-039 / O-03): Menu menampilkan peringatan bila baris tambahan tanpa nama', () => {
    const d = baseValidMenu(); d.addonRows = [{ nama: '   ', harga: '3000' }];
    const r = V.validateMenuForm(d, []);
    assert.equal(r.valid, false);
    assert.equal(r.message, 'Nama tambahan wajib diisi.');
});

test('M-12 (PB-024): Menu menerima tambahan opsional gratis (harga 0)', () => {
    const d = baseValidMenu(); d.addonRows = [{ nama: 'Sendok Plastik', harga: '0' }];
    const r = V.validateMenuForm(d, []);
    assert.equal(r.valid, true);
    assert.equal(r.data.addon[0].harga, 0);
});

test('M-13 (PB-023): XSS pada nama menu di-escape saat render HTML', () => {
    const escaped = V.escapeHtml('<svg onload=alert(1)>Siomay');
    assert.equal(escaped.includes('<svg'), false);
});

test('M-14 (PB-023): XSS pada nama tambahan di-escape saat render HTML', () => {
    const escaped = V.escapeHtml('<b>Saus</b><script>x()</script>');
    assert.equal(escaped.includes('<script>'), false);
});

test('M-15 (PB-029 / F-04): Menu menolak nama menu > 60 karakter', () => {
    const d = baseValidMenu(); d.nama = 'Dimsum '.repeat(12); // > 60 char
    const r = V.validateMenuForm(d, []);
    assert.equal(r.valid, false);
    assert.match(r.message, /60/);
});

test('M-16 (PB-029): Menu menerima nama menu tepat 60 karakter', () => {
    const d = baseValidMenu(); d.nama = 'M'.repeat(60);
    assert.equal(V.validateMenuForm(d, []).valid, true);
});

test('M-17 (PB-031 / F-05): Menu menolak nama duplikat tak peka huruf besar/kecil', () => {
    const d = baseValidMenu(); d.nama = 'siomay ayam';
    const existing = [{ id: 'custom-1', nama: 'Siomay Ayam' }];
    const r = V.validateMenuForm(d, existing);
    assert.equal(r.valid, false);
    assert.equal(r.message, 'Nama menu sudah dipakai.');
});

test('M-18 (PB-031 / F-06): Menu baru menolak nama yang bentrok dengan menu bawaan', () => {
    const d = baseValidMenu(); d.nama = 'mentai ori';
    const r = V.validateMenuForm(d, []);
    assert.equal(r.valid, false);
    assert.equal(r.message, 'Nama menu sudah dipakai.');
});

test('M-19 (PB-047): Mengedit menu bawaan yang sedang aktif (isEditingBuiltin=true) diizinkan', () => {
    const d = baseValidMenu();
    d.nama = 'Mentai Ori';
    d.editingId = 'builtin-mentai-ori';
    d.isEditingBuiltin = true;
    const existing = [{ id: 'builtin-mentai-ori', nama: 'Mentai Ori', is_bawaan: true }];
    assert.equal(V.validateMenuForm(d, existing).valid, true);
});

test('M-20 (PB-030): Galat unique constraint PG 23505 diterjemahkan tanpa bocor detail DB', () => {
    const msg = E.formatError({ code: '23505', message: 'duplicate key value violates unique constraint "idx_menu_custom_nama_lower"' }, 'menu', 'id');
    assert.equal(msg, 'Nama menu sudah dipakai.');
    assert.equal(msg.includes('constraint'), false);
    assert.equal(msg.includes('23505'), false);
});

// =========================================================================
// BAGIAN 4: LOGIKA FITUR RILIS 3-5 (12 KASUS: F-01 s.d. F-12)
// =========================================================================
test('F-01 (PB-083 / PB-054): Apriori menyaring add-on dari rekomendasi populer & menghitung cross-sell', () => {
    const baskets = [
        ['Mentai Ori', 'Bakpao', 'Extra Mentai'],
        ['Mentai Ori', 'Bakpao', 'Extra Mentai'],
        ['Mentai Ori', 'Chilli Oil Extra'],
        ['Mentai Cheese', 'Dimsum aja']
    ];
    const model = Apriori.trainApriori(baskets, 0.1, 0.2);
    const pop = Apriori.getPopularRecommendations(model.frequentItemsets, 5);
    assert.ok(pop.length > 0);
    assert.equal(pop.some(p => p.isAddon), false, 'Add-on tidak boleh tampil di Paling Rekomendasi');
    const cross = Apriori.recommend(model.rules, ['Mentai Ori'], 2);
    assert.ok(cross.length > 0);
});

test('F-02 (PB-049): Validasi stok harian menolak stok negatif dan desimal', () => {
    const d1 = baseValidMenu(); d1.stokHarian = '-3';
    assert.equal(V.validateMenuForm(d1, []).valid, false);
    const d2 = baseValidMenu(); d2.stokHarian = '12.5';
    assert.equal(V.validateMenuForm(d2, []).valid, false);
    const d3 = baseValidMenu(); d3.stokHarian = '25'; d3.ambangStok = '5';
    const r3 = V.validateMenuForm(d3, []);
    assert.equal(r3.valid, true);
    assert.equal(r3.data.stok_harian, 25);
});

test('F-03 (PB-072): Kamus i18n ID & EN memiliki kunci yang sinkron', () => {
    const idKeys = Object.keys(I18n.TRANSLATIONS.id).sort();
    const enKeys = Object.keys(I18n.TRANSLATIONS.en).sort();
    assert.deepEqual(idKeys, enKeys);
});

test('F-04 (PB-030 + PB-072): Error messages mendukung terjemahan bahasa Inggris', () => {
    const msgEn = E.formatError({ message: 'Invalid login credentials' }, 'login', 'en');
    assert.equal(msgEn, 'Incorrect email or password.');
});

test('F-05 (PB-032): Berkas warisan duplikat config/supabaseClient.js sudah dihapus', () => {
    assert.equal(fs.existsSync(path.join(ROOT, 'config', 'supabaseClient.js')), false);
    assert.equal(fs.existsSync(path.join(ROOT, 'server', 'services', 'orderService.js')), false);
    assert.equal(fs.existsSync(path.join(ROOT, 'config.js')), true);
});

test('F-06 (PB-053): Berkas PWA manifest.webmanifest dan sw.js tersedia dan valid JSON', () => {
    const manifestPath = path.join(ROOT, 'manifest.webmanifest');
    assert.equal(fs.existsSync(manifestPath), true);
    assert.equal(fs.existsSync(path.join(ROOT, 'sw.js')), true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.display, 'standalone');
    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2);
});

test('F-07 (PB-044 / PB-051 / PB-071): Halaman baru status-pesanan, layar-antrean, riwayat-pembeli tersedia', () => {
    assert.equal(fs.existsSync(path.join(ROOT, 'status-pesanan.html')), true);
    assert.equal(fs.existsSync(path.join(ROOT, 'layar-antrean.html')), true);
    assert.equal(fs.existsSync(path.join(ROOT, 'riwayat-pembeli.html')), true);
});

test('F-08 (PB-055 / PB-058): Modul analitik menghitung omzet kotor, diskon, retur, AOV, menu terlaris', async () => {
    const { computeSalesAnalytics } = await import('../penjual-page/analytics-export.js');
    const orders = [
        {
            tanggalKey: '2026-11-28',
            createdAt: '2026-11-28T05:00:00.000Z', // 12:00 WIB
            statusPembayaranDb: 'lunas',
            metodeBayar: 'CASH',
            subtotalKotor: 30000,
            diskonVoucher: 5000,
            diskonPoin: 0,
            totalHarga: 25000,
            items: [{ nama: 'Mentai Ori', qty: 2, totalHargaItem: 30000 }]
        },
        {
            tanggalKey: '2026-11-28',
            createdAt: '2026-11-28T06:00:00.000Z', // 13:00 WIB
            statusPembayaranDb: 'retur',
            metodeBayar: 'QRIS',
            totalHarga: 15000,
            nominalRetur: 15000,
            items: [{ nama: 'Bakpao', qty: 1, totalHargaItem: 15000 }]
        }
    ];
    const stats = computeSalesAnalytics(orders, '2026-11-28', '2026-11-28');
    assert.equal(stats.jumlahPesanan, 1);
    assert.equal(stats.omzetKotor, 30000);
    assert.equal(stats.totalDiskon, 5000);
    assert.equal(stats.omzetBersih, 25000);
    assert.equal(stats.totalRetur, 15000);
    assert.equal(stats.aov, 25000);
    assert.equal(stats.topMenus[0].nama, 'Mentai Ori');
    assert.equal(stats.hourCounts[12], 1);
});

test('F-09 (PB-073): Generator ESC/POS thermal 58mm menghasilkan byte valid untuk struk & tiket dapur', async () => {
    const { buildEscPosReceipt } = await import('../penjual-page/thermal-printer.js');
    const order = {
        idOrder: 'ANT-07',
        namaPelanggan: 'Budi',
        tanggal: '28/11/2026',
        waktu: '14:10',
        metodeBayar: 'QRIS',
        totalHarga: 26000,
        totalHargaFormatted: 'Rp26.000',
        items: [{ nama: 'Mentai Cheese', varian: 'M (6 pcs)', qty: 1, totalHargaItem: 26000 }]
    };
    const strukBytes = buildEscPosReceipt(order, 'struk');
    const dapurBytes = buildEscPosReceipt(order, 'dapur');
    assert.ok(strukBytes instanceof Uint8Array && strukBytes.length > 40);
    assert.ok(dapurBytes instanceof Uint8Array && dapurBytes.length > 30);
    // Diawali perintah ESC @ (0x1B 0x40)
    assert.equal(strukBytes[0], 0x1B);
    assert.equal(strukBytes[1], 0x40);
});

test('F-10 (PB-076): Antrean POS offline menyimpan & menyinkronkan dengan client_tx_id tanpa duplikat', async () => {
    global.localStorage = makeMemoryStorage();
    const { enqueueOfflinePosOrder, getOfflineQueue, syncOfflineQueue } = await import('../penjual-page/offline-pos.js');
    const queued = enqueueOfflinePosOrder({
        p_nama: 'Walk-in Andi',
        p_tipe: 'cash',
        p_items: [{ nama_item: 'Mentai Ori', jumlah: 1, harga_satuan: 23000, subtotal: 23000 }]
    });
    assert.ok(queued.client_tx_id.startsWith('pos-'));
    assert.equal(getOfflineQueue().length, 1);

    const seenIds = [];
    const mockClient = {
        rpc: async (_fn, params) => {
            seenIds.push(params.p_client_tx_id);
            return { data: { id_order: 101, nomor_antrean: 1 }, error: null };
        }
    };
    const res = await syncOfflineQueue(mockClient);
    assert.equal(res.synced, 1);
    assert.equal(res.remaining, 0);
    assert.deepEqual(seenIds, [queued.client_tx_id]);
});

test('F-11 (PB-064): Evaluasi jadwal operasional menghormati hari libur dan override manual', () => {
    // Load settings-store.js dalam konteks simulasi window
    const prevWin = global.window;
    global.window = {};
    delete require.cache[require.resolve('../settings-store.js')];
    require('../settings-store.js');
    const { evaluateStoreStatus } = global.window.SabangdorSettings;
    global.window = prevWin;

    // 2026-11-28 05:00 UTC = 12:00 WIB (Sabtu = dow 6)
    const noonWib = new Date('2026-11-28T05:00:00Z');
    const jadwal = JSON.stringify({
        enabled: true,
        days: { '6': { aktif: true, buka: '10:00', tutup: '21:00' } }
    });

    assert.equal(evaluateStoreStatus({ jadwal_operasional: jadwal }, noonWib).status, 'buka');
    assert.equal(evaluateStoreStatus({ jadwal_operasional: jadwal, tanggal_libur: '["2026-11-28"]' }, noonWib).status, 'tutup');
    assert.equal(
        evaluateStoreStatus({
            jadwal_operasional: jadwal,
            tanggal_libur: '["2026-11-28"]',
            status_toko_override: '{"tanggal":"2026-11-28","status":"buka"}'
        }, noonWib).status,
        'buka'
    );
});

test('F-12 (SQL): Migrasi terpadu supabase/migration_v2_lengkap.sql memuat seluruh fungsi RPC & tabel v2', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'migration_v2_lengkap.sql'), 'utf8');
    const mustContain = [
        'idx_menu_custom_nama_lower',
        'validate_menu_custom_row',
        'menu_categories',
        'audit_logs',
        'shift_closures',
        'vouchers',
        'order_reviews',
        'loyalty_accounts',
        'app_telemetry',
        'apriori_rules',
        'hitung_apriori_server',
        'verifikasi_pembayaran',
        'dapur_tandai_siap',
        'serahkan_pesanan',
        'retur_pesanan',
        'lacak_pesanan',
        'get_estimasi_tunggu',
        'get_layar_antrean',
        'get_slot_preorder',
        'is_toko_buka_sekarang',
        'validasi_voucher',
        'cek_poin_loyalitas',
        'kirim_ulasan',
        'riwayat_pesanan_saya'
    ];
    mustContain.forEach(token => {
        assert.equal(sql.includes(token), true, `SQL harus memuat ${token}`);
    });
});
