/**
 * File: validation.js
 * Modul validasi terpusat Sabangdor (berjalan di Browser & Node.js untuk pengujian regresi PB-033).
 * Mencakup:
 *  - PB-024: Tolak harga tambahan opsional negatif
 *  - PB-025: Batas atas harga ukuran menu (maks Rp1.000.000, selaras NUMERIC(10,2))
 *  - PB-028: Batas panjang nama pemesan (maks 50 char checkout / 35 char POS)
 *  - PB-029: Batas panjang nama menu (maks 60 char)
 *  - PB-031: Cegah nama menu duplikat tak peka huruf & bentrok menu bawaan
 *  - PB-035: Rate limiter per perangkat & tantangan anti-bot lokal
 *  - PB-038: Validasi format nama pemesan (min 2 karakter & wajib mengandung huruf)
 *  - PB-039: Peringatan baris tambahan tanpa nama & validasi harga bilangan bulat Rupiah
 *  - PB-067: Kebijakan kata sandi minimal 10 karakter
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.SabangdorValidation = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const MAX_CUSTOMER_NAME_LEN = 50;
    const MIN_CUSTOMER_NAME_LEN = 2;
    const MAX_POS_NAME_LEN = 35;
    const MAX_MENU_NAME_LEN = 60;
    const MAX_CATEGORY_NAME_LEN = 40;
    const MAX_MENU_PRICE = 1000000; // Rp1.000.000 (selaras NUMERIC(10,2))
    const MIN_PASSWORD_LEN = 10;
    const MAX_QTY = 99;

    const BUILTIN_MENU_NAMES = Object.freeze([
        'Mentai Ori',
        'Dimsum Mentai Ori',
        'Mentai Cheese',
        'Mentai Cheeze',
        'Dimsum Mentai Cheese',
        'Dimsum Mentai Cheeze',
        'Mentai Tanuki',
        'Dimsum Mentai Tanuki',
        'Mentai Mix',
        'Dimsum Mix',
        'Dimsum Mentai Mix',
        'Dimsum aja',
        'Bakpao',
        'Extra Mentai',
        'Chilli Oil Extra',
        'Chilli Oil Tambahan'
    ]);

    function normalizeKey(str) {
        return String(str == null ? '' : str).trim().replace(/\s+/g, ' ').toLowerCase();
    }

    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function containsHtmlScript(str) {
        return /<\s*\/?\s*(script|iframe|object|embed|svg|img|style)\b|javascript\s*:|on\w+\s*=/i.test(String(str || ''));
    }

    /**
     * PB-028 & PB-038: Validasi nama pemesan pada Checkout.
     * - Tidak boleh kosong / hanya spasi
     * - Minimal 2 karakter, maksimal 50 karakter
     * - Harus memuat minimal 1 huruf (menolak hanya angka atau simbol)
     */
    function validateCustomerName(rawName, options) {
        const opts = options || {};
        const maxLen = opts.maxLen || MAX_CUSTOMER_NAME_LEN;
        const trimmed = String(rawName == null ? '' : rawName).trim();

        if (!trimmed) {
            return { valid: false, message: 'Silakan masukkan nama pemesan terlebih dahulu.' };
        }
        if (trimmed.length < MIN_CUSTOMER_NAME_LEN) {
            return { valid: false, message: 'Nama pemesan minimal 2 karakter dan harus mengandung huruf.' };
        }
        if (trimmed.length > maxLen) {
            return { valid: false, message: `Nama pemesan maksimal ${maxLen} karakter.` };
        }
        // Wajib memuat huruf (Unicode letter) agar tidak hanya angka/simbol (kasus C-09, C-10)
        if (!/[A-Za-z\u00C0-\u024F]/.test(trimmed)) {
            return { valid: false, message: 'Nama pemesan minimal 2 karakter dan harus mengandung huruf.' };
        }
        return { valid: true, value: trimmed };
    }

    /**
     * Validasi form Login pegawai.
     */
    function validateLoginInput(emailRaw, passwordRaw) {
        const email = String(emailRaw == null ? '' : emailRaw).trim();
        const password = String(passwordRaw == null ? '' : passwordRaw);
        if (!email) {
            return { valid: false, message: 'Email wajib diisi.' };
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return { valid: false, message: 'Format email tidak valid.' };
        }
        if (!password) {
            return { valid: false, message: 'Kata sandi wajib diisi.' };
        }
        return { valid: true, email, password };
    }

    /**
     * PB-067: Kebijakan kata sandi kuat (minimal 10 karakter, kombinasi huruf dan angka).
     */
    function validatePasswordPolicy(passwordRaw) {
        const pw = String(passwordRaw == null ? '' : passwordRaw);
        if (pw.length < MIN_PASSWORD_LEN) {
            return { valid: false, message: `Kata sandi minimal ${MIN_PASSWORD_LEN} karakter.` };
        }
        if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
            return { valid: false, message: 'Kata sandi harus mengandung huruf dan angka.' };
        }
        return { valid: true };
    }

    /**
     * Parse nilai numerik ketat untuk Rupiah (menolak NaN, Infinity, desimal/koma, notasi aneh).
     */
    function parseStrictRupiah(raw) {
        if (raw === '' || raw === null || raw === undefined) {
            return { empty: true, value: null, isInteger: false };
        }
        const str = String(raw).trim();
        if (str === '') return { empty: true, value: null, isInteger: false };
        const num = Number(str);
        if (!Number.isFinite(num)) {
            return { empty: false, value: NaN, isInteger: false };
        }
        const isInteger = Number.isInteger(num) && !/[.,]/.test(str);
        return { empty: false, value: num, isInteger };
    }

    /**
     * PB-024, PB-025, PB-029, PB-031, PB-039:
     * Validasi komprehensif form Menu (menu tambahan & edit menu bawaan).
     * @param {object} input { nama, kategori, kategoriBaru, isKategoriBaru, ukuranRows, addonRows, editingId, isEditingBuiltin }
     * @param {object[]} existingMenus daftar menu yang sudah ada di DB
     */
    function validateMenuForm(input, existingMenus) {
        const data = input || {};
        const list = Array.isArray(existingMenus) ? existingMenus : [];

        const nama = String(data.nama == null ? '' : data.nama).trim();
        if (!nama) {
            return { valid: false, message: 'Nama menu wajib diisi.' };
        }
        if (nama.length > MAX_MENU_NAME_LEN) {
            return { valid: false, message: `Nama menu maksimal ${MAX_MENU_NAME_LEN} karakter.` };
        }

        // PB-031: Cek duplikat tak peka huruf & bentrok menu bawaan
        const normNama = normalizeKey(nama);
        const editingId = data.editingId != null ? String(data.editingId) : null;
        const isEditingBuiltin = Boolean(data.isEditingBuiltin);

        if (!isEditingBuiltin) {
            const bentrokBawaan = BUILTIN_MENU_NAMES.some(b => normalizeKey(b) === normNama);
            // Jika sedang mengedit menu bawaan yang sudah tersimpan di DB (editingId cocok), jangan blokir
            const matchedOwnBuiltin = editingId && list.some(m => String(m.id) === editingId && normalizeKey(m.nama) === normNama);
            if (bentrokBawaan && !matchedOwnBuiltin) {
                return { valid: false, message: 'Nama menu sudah dipakai.' };
            }
        }

        const duplikatDb = list.some(m => {
            if (!m || !m.nama) return false;
            if (editingId && String(m.id) === editingId) return false;
            return normalizeKey(m.nama) === normNama;
        });
        if (duplikatDb) {
            return { valid: false, message: 'Nama menu sudah dipakai.' };
        }

        // Kategori
        let kategori = String(data.kategori || '').trim();
        if (data.isKategoriBaru) {
            const baru = String(data.kategoriBaru || '').trim();
            if (!baru) {
                return { valid: false, message: 'Nama kategori baru wajib diisi.' };
            }
            if (baru.length > MAX_CATEGORY_NAME_LEN) {
                return { valid: false, message: `Nama kategori maksimal ${MAX_CATEGORY_NAME_LEN} karakter.` };
            }
            kategori = baru;
        }
        if (!kategori) {
            return { valid: false, message: 'Kategori menu wajib dipilih.' };
        }

        // Ukuran & Harga (PB-025 & PB-039)
        const ukuranRows = Array.isArray(data.ukuranRows) ? data.ukuranRows : [];
        const ukuranValid = [];
        for (let i = 0; i < ukuranRows.length; i++) {
            const r = ukuranRows[i] || {};
            const uNama = String(r.nama == null ? '' : r.nama).trim();
            const uPorsi = String(r.porsi == null ? '' : r.porsi).trim();
            const parsedHarga = parseStrictRupiah(r.harga);

            // Baris benar-benar kosong diabaikan
            if (!uNama && !uPorsi && parsedHarga.empty) continue;

            if (parsedHarga.empty || Number.isNaN(parsedHarga.value)) {
                return { valid: false, message: 'Harga pada setiap baris ukuran harus lebih dari 0.' };
            }
            if (!parsedHarga.isInteger) {
                return { valid: false, message: 'Harga harus berupa bilangan bulat Rupiah.' };
            }
            if (parsedHarga.value <= 0) {
                return { valid: false, message: 'Harga pada setiap baris ukuran harus lebih dari 0.' };
            }
            if (parsedHarga.value > MAX_MENU_PRICE) {
                return {
                    valid: false,
                    message: `Harga ukuran maksimal Rp${MAX_MENU_PRICE.toLocaleString('id-ID')}.`
                };
            }
            ukuranValid.push({
                nama: (uNama || 'Reguler').slice(0, 30),
                porsi: uPorsi.slice(0, 40),
                harga: parsedHarga.value
            });
        }

        if (ukuranValid.length === 0) {
            return { valid: false, message: 'Tambahkan minimal satu ukuran/porsi beserta harganya.' };
        }

        // Tambahan Opsional (PB-024 & PB-039)
        const addonRows = Array.isArray(data.addonRows) ? data.addonRows : [];
        const addonValid = [];
        for (let i = 0; i < addonRows.length; i++) {
            const r = addonRows[i] || {};
            const aNama = String(r.nama == null ? '' : r.nama).trim();
            const parsedHarga = parseStrictRupiah(r.harga);

            // Jika kedua field kosong, abaikan baris kosong
            if (!aNama && parsedHarga.empty) continue;

            // PB-039: Baris tambahan tanpa nama menampilkan peringatan (tidak dibuang diam-diam)
            if (!aNama) {
                return { valid: false, message: 'Nama tambahan wajib diisi.' };
            }

            const hargaVal = parsedHarga.empty ? 0 : parsedHarga.value;
            if (Number.isNaN(hargaVal)) {
                return { valid: false, message: 'Harga tambahan tidak valid.' };
            }
            if (!parsedHarga.empty && !parsedHarga.isInteger) {
                return { valid: false, message: 'Harga harus berupa bilangan bulat Rupiah.' };
            }
            // PB-024: Tolak harga tambahan negatif
            if (hargaVal < 0) {
                return { valid: false, message: 'Harga tambahan tidak boleh negatif.' };
            }
            if (hargaVal > MAX_MENU_PRICE) {
                return {
                    valid: false,
                    message: `Harga tambahan maksimal Rp${MAX_MENU_PRICE.toLocaleString('id-ID')}.`
                };
            }

            addonValid.push({
                nama: aNama.slice(0, 50),
                harga: hargaVal
            });
        }

        // Validasi stok harian opsional (PB-049)
        let stokHarian = null;
        if (data.stokHarian !== '' && data.stokHarian !== null && data.stokHarian !== undefined) {
            const parsedStok = parseStrictRupiah(data.stokHarian);
            if (!parsedStok.isInteger || parsedStok.value < 0 || parsedStok.value > 99999) {
                return { valid: false, message: 'Stok harian harus bilangan bulat antara 0 sampai 99.999.' };
            }
            stokHarian = parsedStok.value;
        }

        let ambangStok = 5;
        if (data.ambangStok !== '' && data.ambangStok !== null && data.ambangStok !== undefined) {
            const parsedAmbang = parseStrictRupiah(data.ambangStok);
            if (!parsedAmbang.isInteger || parsedAmbang.value < 0 || parsedAmbang.value > 9999) {
                return { valid: false, message: 'Ambang stok menipis harus bilangan bulat >= 0.' };
            }
            ambangStok = parsedAmbang.value;
        }

        return {
            valid: true,
            data: {
                nama,
                kategori,
                ukuran: ukuranValid,
                addon: addonValid,
                stok_harian: stokHarian,
                ambang_stok: ambangStok
            }
        };
    }

    /**
     * Perhitungan paket optimal Bakpao (1 pcs=7000, 3 pcs=20000, 6 pcs=36000).
     */
    function calculateBakpaoPrice(totalPcs, packPrices) {
        const n = Math.floor(Number(totalPcs) || 0);
        if (n <= 0) return 0;
        const packs = Array.isArray(packPrices) && packPrices.length
            ? packPrices
            : [{ pcs: 6, price: 36000 }, { pcs: 3, price: 20000 }, { pcs: 1, price: 7000 }];
        const cost = new Array(n + 1).fill(Infinity);
        cost[0] = 0;
        for (let i = 1; i <= n; i++) {
            for (const p of packs) {
                if (i >= p.pcs && cost[i - p.pcs] + p.price < cost[i]) {
                    cost[i] = cost[i - p.pcs] + p.price;
                }
            }
        }
        return cost[n];
    }

    /**
     * PB-035: Rate limiter per perangkat (client-side sliding window).
     * Membatasi maksimal `maxCount` pesanan dalam `windowMs` milidetik (default 3 pesanan / 5 menit).
     */
    const RATE_LIMIT_KEY = 'sabangdor_order_timestamps';
    const DEVICE_FP_KEY = 'sabangdor_device_fp';

    function getDeviceFingerprint(storage) {
        const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
        if (!store) return 'dev-anonymous';
        try {
            let fp = store.getItem(DEVICE_FP_KEY);
            if (!fp || fp.length < 8) {
                fp = 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
                store.setItem(DEVICE_FP_KEY, fp);
            }
            return fp;
        } catch (e) {
            return 'dev-anonymous';
        }
    }

    function checkDeviceRateLimit(options) {
        const opts = options || {};
        const maxCount = opts.maxCount || 3;
        const windowMs = opts.windowMs || 5 * 60 * 1000;
        const now = opts.now || Date.now();
        const store = opts.storage || (typeof localStorage !== 'undefined' ? localStorage : null);

        let timestamps = [];
        try {
            if (store) {
                const raw = JSON.parse(store.getItem(RATE_LIMIT_KEY) || '[]');
                if (Array.isArray(raw)) timestamps = raw.map(Number).filter(t => Number.isFinite(t));
            }
        } catch (e) {
            timestamps = [];
        }

        const recent = timestamps.filter(t => now - t < windowMs);
        if (recent.length >= maxCount) {
            const oldest = Math.min(...recent);
            const waitSec = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
            return {
                allowed: false,
                remaining: 0,
                recentCount: recent.length,
                waitSeconds: waitSec,
                needChallenge: true,
                message: `Batas pemesanan sementara tercapai (maks ${maxCount} pesanan per 5 menit). Coba lagi dalam ${waitSec} detik.`
            };
        }
        return {
            allowed: true,
            remaining: maxCount - recent.length,
            recentCount: recent.length,
            waitSeconds: 0,
            // Tampilkan tantangan verifikasi manusia bila sudah memesan >= 1x dalam 5 menit terakhir
            needChallenge: recent.length >= 1
        };
    }

    function recordDeviceOrderTimestamp(options) {
        const opts = options || {};
        const windowMs = opts.windowMs || 5 * 60 * 1000;
        const now = opts.now || Date.now();
        const store = opts.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
        if (!store) return;
        try {
            const raw = JSON.parse(store.getItem(RATE_LIMIT_KEY) || '[]');
            const recent = (Array.isArray(raw) ? raw : []).map(Number).filter(t => Number.isFinite(t) && now - t < windowMs);
            recent.push(now);
            store.setItem(RATE_LIMIT_KEY, JSON.stringify(recent));
        } catch (e) {}
    }

    /**
     * PB-035: Generator & validator tantangan anti-bot matematika sederhana + honeypot.
     */
    function generateHumanChallenge() {
        const a = Math.floor(Math.random() * 8) + 2; // 2..9
        const b = Math.floor(Math.random() * 8) + 1; // 1..8
        return {
            question: `Berapa hasil ${a} + ${b}?`,
            questionEn: `What is ${a} + ${b}?`,
            answer: a + b,
            createdAt: Date.now()
        };
    }

    function verifyHumanChallenge(challenge, userAnswer, honeypotValue) {
        if (honeypotValue && String(honeypotValue).trim() !== '') {
            return { valid: false, message: 'Verifikasi anti-bot gagal. Coba lagi.' };
        }
        if (!challenge) return { valid: true };
        const parsed = parseStrictRupiah(userAnswer);
        if (parsed.empty || !parsed.isInteger || parsed.value !== challenge.answer) {
            return { valid: false, message: 'Jawaban verifikasi keamanan salah. Silakan hitung ulang.' };
        }
        return { valid: true };
    }

    /**
     * PB-066: Hitung potongan voucher (preview client; server tetap otoritatif).
     */
    function calculateVoucherDiscount(voucher, subtotal) {
        const sub = Math.max(0, Math.round(Number(subtotal) || 0));
        if (!voucher || !voucher.aktif) return { valid: false, discount: 0, message: 'Kode voucher tidak aktif.' };
        const now = Date.now();
        if (voucher.berlaku_mulai && now < new Date(voucher.berlaku_mulai).getTime()) {
            return { valid: false, discount: 0, message: 'Voucher belum berlaku.' };
        }
        if (voucher.berlaku_sampai && now > new Date(voucher.berlaku_sampai).getTime()) {
            return { valid: false, discount: 0, message: 'Voucher sudah kedaluwarsa.' };
        }
        if (voucher.kuota != null && Number(voucher.terpakai || 0) >= Number(voucher.kuota)) {
            return { valid: false, discount: 0, message: 'Kuota voucher sudah habis.' };
        }
        const minBelanja = Number(voucher.min_belanja || 0);
        if (sub < minBelanja) {
            return {
                valid: false,
                discount: 0,
                message: `Belanja minimal Rp${minBelanja.toLocaleString('id-ID')} untuk memakai voucher ini.`
            };
        }
        let disc = 0;
        if (voucher.tipe === 'persen') {
            disc = Math.round(sub * (Number(voucher.nilai || 0) / 100));
            if (voucher.maks_diskon != null && Number(voucher.maks_diskon) > 0) {
                disc = Math.min(disc, Number(voucher.maks_diskon));
            }
        } else {
            disc = Math.round(Number(voucher.nilai || 0));
        }
        disc = Math.max(0, Math.min(disc, sub));
        return { valid: true, discount: disc };
    }

    /**
     * PB-068: Validasi ulasan dan rating pesanan.
     */
    function validateReviewInput(ratingRaw, commentRaw) {
        const rating = Number(ratingRaw);
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
            return { valid: false, message: 'Pilih rating antara 1 sampai 5 bintang.' };
        }
        const comment = String(commentRaw == null ? '' : commentRaw).trim();
        if (!comment) {
            return { valid: false, message: 'Komentar ulasan tidak boleh kosong.' };
        }
        if (comment.length > 500) {
            return { valid: false, message: 'Komentar ulasan maksimal 500 karakter.' };
        }
        return { valid: true, rating, comment };
    }

    /**
     * PB-074: Normalisasi nomor HP opsional untuk poin loyalitas.
     */
    function normalizePhone(raw) {
        const digits = String(raw == null ? '' : raw).replace(/[^0-9]/g, '');
        if (!digits) return '';
        if (digits.startsWith('62')) return '0' + digits.slice(2);
        return digits;
    }

    function validatePhoneOptional(raw) {
        const cleaned = normalizePhone(raw);
        if (!cleaned) return { valid: true, value: '' };
        if (cleaned.length < 9 || cleaned.length > 15 || !cleaned.startsWith('08')) {
            return { valid: false, message: 'Nomor HP harus diawali 08 dan terdiri dari 9-15 digit.' };
        }
        return { valid: true, value: cleaned };
    }

    return {
        MAX_CUSTOMER_NAME_LEN,
        MIN_CUSTOMER_NAME_LEN,
        MAX_POS_NAME_LEN,
        MAX_MENU_NAME_LEN,
        MAX_CATEGORY_NAME_LEN,
        MAX_MENU_PRICE,
        MIN_PASSWORD_LEN,
        MAX_QTY,
        BUILTIN_MENU_NAMES,
        normalizeKey,
        escapeHtml,
        containsHtmlScript,
        validateCustomerName,
        validateLoginInput,
        validatePasswordPolicy,
        parseStrictRupiah,
        validateMenuForm,
        calculateBakpaoPrice,
        getDeviceFingerprint,
        checkDeviceRateLimit,
        recordDeviceOrderTimestamp,
        generateHumanChallenge,
        verifyHumanChallenge,
        calculateVoucherDiscount,
        validateReviewInput,
        normalizePhone,
        validatePhoneOptional
    };
}));
