/**
 * File: error-messages.js
 * PB-030: Pemetaan pesan galat berbahasa Indonesia (dan Inggris via i18n) yang jelas
 * tanpa membocorkan detail teknis database/PostgREST/stack trace.
 * Mendukung Browser (window.SabangdorErrors) & Node.js (module.exports).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.SabangdorErrors = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function getLang() {
        try {
            if (typeof window !== 'undefined' && window.SabangdorI18n && typeof window.SabangdorI18n.getLang === 'function') {
                return window.SabangdorI18n.getLang();
            }
            if (typeof localStorage !== 'undefined') {
                return localStorage.getItem('sabangdor_lang') === 'en' ? 'en' : 'id';
            }
        } catch (e) {}
        return 'id';
    }

    const DICT = {
        id: {
            invalid_credentials: 'Email atau kata sandi salah.',
            email_not_confirmed: 'Email akun belum terverifikasi. Hubungi pemilik outlet.',
            account_disabled: 'Akun pegawai ini sedang dinonaktifkan.',
            not_staff: 'Akun ini tidak memiliki hak akses pegawai.',
            session_expired: 'Sesi login telah habis, silakan masuk kembali.',
            network_error: 'Tidak dapat terhubung, coba lagi.',
            duplicate_menu: 'Nama menu sudah dipakai.',
            store_closed: 'Mohon maaf, toko sedang tutup.',
            rate_limited: 'Terlalu banyak permintaan dalam waktu singkat. Coba lagi beberapa saat.',
            permission_denied: 'Anda tidak memiliki izin untuk melakukan tindakan ini.',
            db_not_migrated: 'Pembaruan database belum diterapkan. Hubungi admin outlet.',
            voucher_invalid: 'Kode voucher tidak valid atau sudah kedaluwarsa.',
            stock_insufficient: 'Stok menu tidak mencukupi untuk jumlah yang dipesan.',
            generic_error: 'Terjadi kendala saat memproses permintaan. Silakan coba lagi.'
        },
        en: {
            invalid_credentials: 'Incorrect email or password.',
            email_not_confirmed: 'Account email is not verified. Please contact the store owner.',
            account_disabled: 'This staff account is currently deactivated.',
            not_staff: 'This account does not have staff access.',
            session_expired: 'Your login session has expired. Please sign in again.',
            network_error: 'Unable to connect, please try again.',
            duplicate_menu: 'Menu name is already in use.',
            store_closed: 'Sorry, the store is currently closed.',
            rate_limited: 'Too many requests in a short time. Please wait a moment.',
            permission_denied: 'You do not have permission to perform this action.',
            db_not_migrated: 'Database updates have not been applied yet. Contact store admin.',
            voucher_invalid: 'Voucher code is invalid or expired.',
            stock_insufficient: 'Menu stock is insufficient for the requested quantity.',
            generic_error: 'Something went wrong while processing your request. Please try again.'
        }
    };

    function pick(key, lang) {
        const l = lang || getLang();
        return (DICT[l] && DICT[l][key]) || DICT.id[key] || DICT.id.generic_error;
    }

    // Pesan bisnis aman yang memang berasal dari validasi aplikasi / RAISE EXCEPTION yang sudah ramah
    const SAFE_BUSINESS_PATTERNS = [
        /^Nama pemesan /i,
        /^Nama menu /i,
        /^Harga /i,
        /^Nama tambahan /i,
        /^Menu ".+" sedang habis/i,
        /^Stok menu ".+" /i,
        /^Mohon maaf, toko sedang tutup/i,
        /^Extra Mentai tidak tersedia/i,
        /^Jumlah (item|pcs|porsi) /i,
        /^Keranjang /i,
        /^Terlalu banyak /i,
        /^Kode voucher /i,
        /^Voucher /i,
        /^Belanja minimal /i,
        /^Poin tidak mencukupi/i,
        /^Slot pre-order /i,
        /^Ulasan /i,
        /^Komentar /i,
        /^Alasan retur /i,
        /^Nominal /i,
        /^Ukuran ".+" tidak valid/i,
        /^Pesanan /i,
        /^Silakan /i,
        /^Pilih /i,
        /^Kata sandi /i,
        /^Kode verifikasi /i,
        /^Email atau kata sandi /i,
        /^Akun ini tidak memiliki/i,
        /^Akun pegawai ini/i,
        /^Tidak dapat terhubung/i,
        /^Sesi login /i
    ];

    /**
     * Terjemahkan error mentah (Supabase Auth, PostgREST, PostgreSQL, Fetch) menjadi pesan aman untuk pengguna.
     * @param {any} err Error object atau string
     * @param {string} [context] 'login' | 'menu' | 'order' | 'general'
     * @param {string} [lang] 'id' | 'en'
     * @returns {string}
     */
    function formatError(err, context, lang) {
        const l = lang || getLang();
        const code = String((err && err.code) || '').trim();
        const raw = String((err && (err.message || err.error_description || err.details)) || err || '').trim();
        const lower = raw.toLowerCase();

        // 1. Jaringan / koneksi terputus
        if (
            lower.includes('failed to fetch') ||
            lower.includes('networkerror') ||
            lower.includes('network request failed') ||
            lower.includes('load failed') ||
            lower.includes('err_internet_disconnected') ||
            lower.includes('timeout') ||
            lower.includes('econnrefused') ||
            lower.includes('enotfound')
        ) {
            return pick('network_error', l);
        }

        // 2. Konteks Login & Auth
        if (
            lower.includes('invalid login credentials') ||
            lower.includes('invalid_grant') ||
            lower.includes('invalid email or password')
        ) {
            return pick('invalid_credentials', l);
        }
        if (lower.includes('email not confirmed')) {
            return pick('email_not_confirmed', l);
        }
        if (
            lower.includes('jwt expired') ||
            lower.includes('session_not_found') ||
            lower.includes('refresh_token_not_found') ||
            lower.includes('invalid jwt')
        ) {
            return pick('session_expired', l);
        }

        // 3. Duplikat nama menu (PostgreSQL 23505 / unique constraint)
        if (
            code === '23505' ||
            lower.includes('duplicate key') ||
            lower.includes('unique constraint') ||
            lower.includes('menu_custom_nama') ||
            lower.includes('idx_menu_custom_nama_lower')
        ) {
            if (context === 'menu' || lower.includes('menu')) {
                return pick('duplicate_menu', l);
            }
            return l === 'en' ? 'This data already exists.' : 'Data tersebut sudah terdaftar.';
        }

        // 4. Rate limit
        if (
            lower.includes('too many requests') ||
            lower.includes('rate limit') ||
            lower.includes('terlalu banyak pesanan') ||
            code === '429'
        ) {
            return pick('rate_limited', l);
        }

        // 5. RLS / izin ditolak
        if (
            code === '42501' ||
            lower.includes('row-level security') ||
            lower.includes('permission denied') ||
            lower.includes('not authorized')
        ) {
            return pick('permission_denied', l);
        }

        // 6. Schema / RPC belum dimigrasi
        if (
            code === 'PGRST202' ||
            code === '42883' ||
            code === '42P01' ||
            (lower.includes('schema cache') && lower.includes('function')) ||
            (lower.includes('relation') && lower.includes('does not exist'))
        ) {
            return pick('db_not_migrated', l);
        }

        // 7. Numeric overflow / constraint teknis DB
        if (code === '22003' || lower.includes('numeric field overflow')) {
            return l === 'en'
                ? 'Price value exceeds the maximum allowed limit.'
                : 'Nilai harga melebihi batas maksimum yang diizinkan.';
        }

        // 8. Toko tutup / stok
        if (lower.includes('toko sedang tutup')) {
            return pick('store_closed', l);
        }

        // 9. Pesan bisnis yang sudah bersih & ramah (hindari teks teknis SQL/PG)
        const looksTechnical =
            /\b(postgres|postgrest|supabase|pgrst|sqlstate|column\s+"|relation\s+"|syntax error|constraint\s+"|stack|at\s+\w+\s+\(|null value in column|invalid input syntax)\b/i.test(raw);

        if (raw && !looksTechnical && SAFE_BUSINESS_PATTERNS.some(rx => rx.test(raw))) {
            return raw;
        }

        // 10. Default aman tanpa bocor detail teknis
        if (context === 'login') {
            return pick('invalid_credentials', l);
        }
        return pick('generic_error', l);
    }

    return {
        formatError,
        pick,
        DICT
    };
}));
