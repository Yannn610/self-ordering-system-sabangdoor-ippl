/**
 * File: i18n.js
 * PB-072: Dukungan dua bahasa (Indonesia & English) untuk seluruh antarmuka pembeli.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.SabangdorI18n = factory();
        root.t = root.SabangdorI18n.t;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const LANG_KEY = 'sabangdor_lang';

    const TRANSLATIONS = {
        id: {
            // Header & Menu Utama
            hero_title: 'Mau makan apa hari ini?',
            hero_subtitle: 'Pilih beberapa menu favoritmu, lalu ambil di outlet.',
            tab_recommended: 'Paling Rekomendasi',
            sec_rec_title: 'Paling Rekomendasi',
            sec_rec_desc: 'Menu yang paling sering dipesan pelanggan',
            loading_rec: 'Memuat rekomendasi menu...',
            empty_rec_title: 'Belum ada data rekomendasi menu',
            empty_rec_desc: 'Pilih kategori di atas untuk melihat seluruh menu yang tersedia.',
            btn_choose_menu: '+ Pilih menu',
            btn_sold_out: 'Habis',
            btn_store_closed: 'Toko Tutup',
            banner_store_closed: 'Toko sedang tutup dan belum menerima pesanan saat ini.',
            banner_store_closed_schedule: 'Toko sedang di luar jam operasional dan belum menerima pesanan saat ini.',
            price_from: 'Mulai',
            my_order: 'Pesanan Saya',
            clear_all: 'Hapus semua',
            total_payment: 'Total Pembayaran',
            btn_check_cart: 'Cek Keranjang',
            link_track_order: 'Lacak Pesanan',
            link_order_history: 'Riwayat',
            btn_install_app: 'Pasang Aplikasi',
            menu_unit: 'Menu',
            portion_unit: 'porsi',
            // Detail Menu
            detail_title: 'Detail menu',
            outlet_pick_portion: 'Pilih porsi',
            outlet_desc: 'Pesan dan ambil di outlet',
            choose_size: 'Pilih ukuran porsi',
            optional_addons: 'Tambahan opsional',
            qty_title: 'Jumlah porsi',
            note_title: 'Catatan (opsional)',
            note_placeholder: 'Tulis catatan untuk menu ini',
            price_breakdown: 'Rincian harga',
            portion_price: 'Harga porsi',
            total_product: 'Total produk',
            btn_add_to_cart: 'Tambah ke keranjang',
            // Keranjang
            cart_title: 'Keranjang',
            pickup_at_outlet: 'Ambil di outlet',
            btn_clear: 'Kosongkan',
            your_order: 'Pesanan kamu',
            cart_sub: 'Cek lagi jumlah pesananmu sebelum lanjut.',
            cart_empty_title: 'Keranjang masih kosong',
            cart_empty_sub: 'Tambahkan menu dulu untuk mulai memesan.',
            btn_pick_menu: 'Pilih menu',
            cross_sell_title: 'Pelengkap yang cocok',
            cross_sell_sub: 'Pelanggan lain sering memesan menu ini bersamaan:',
            btn_add_short: '+ Tambah',
            item_count: 'Jumlah item',
            subtotal: 'Subtotal',
            total: 'Total',
            btn_order_now: 'Pesan sekarang',
            cart_cleared: 'Keranjang dikosongkan',
            // Checkout
            checkout_title: 'Checkout',
            qris_title: 'Pembayaran QRIS',
            order_sent_title: 'Pesanan Dikirim',
            customer_info: 'Data Pemesan',
            customer_name_label: 'Nama Lengkap / Panggilan',
            customer_name_placeholder: 'Masukkan nama pemesan',
            phone_loyalty_label: 'Nomor HP (Opsional - Kumpulkan/Tukar Poin)',
            phone_loyalty_placeholder: 'Contoh: 081234567890',
            check_points: 'Cek Poin',
            redeem_points_label: 'Tukar 10 poin untuk potongan Rp5.000',
            voucher_label: 'Kode Promo / Voucher (Opsional)',
            voucher_placeholder: 'Masukkan kode promo',
            apply_voucher: 'Pakai',
            remove_voucher: 'Hapus',
            pickup_mode_title: 'Waktu Pengambilan',
            pickup_now: 'Ambil Sekarang',
            pickup_now_desc: 'Pesanan langsung diproses setelah verifikasi kasir',
            pickup_preorder: 'Pre-order (Jadwal Ambil)',
            pickup_preorder_desc: 'Pilih jam pengambilan sesuai jadwal operasional',
            select_slot: 'Pilih Jam Ambil',
            order_details: 'Rincian Pesanan',
            payment_method: 'Metode Pembayaran',
            pay_cash: 'Bayar Tunai',
            pay_cash_desc: 'Bayar langsung di kasir saat ambil pesanan',
            pay_qris: 'QRIS (E-Wallet / M-Banking)',
            pay_qris_desc: 'Scan kode QRIS outlet setelah konfirmasi',
            security_check_title: 'Verifikasi Keamanan',
            total_bill: 'Total Tagihan',
            discount_voucher: 'Diskon Voucher',
            discount_points: 'Potongan Poin',
            btn_continue_qris: 'Lanjut ke Pembayaran QRIS',
            btn_confirm_order: 'Konfirmasi & Kirim Pesanan',
            qris_scan_title: 'Scan QRIS Sabangdor',
            qris_scan_desc: 'Buka aplikasi e-wallet atau mobile banking Anda lalu bayar sesuai total tagihan.',
            qris_upload_proof: 'Unggah Bukti Pembayaran QRIS (Opsional)',
            qris_upload_hint: 'Tangkapan layar membantu kasir memverifikasi lebih cepat (PNG/JPG, maks 5 MB).',
            qris_amount_label: 'Total yang harus dibayar',
            btn_already_paid: 'Saya Sudah Bayar',
            sending_order: 'Mengirim ke Dapur...',
            success_title: 'Pesanan Berhasil Dibuat',
            queue_number: 'Nomor Antrean',
            est_wait_time: 'Estimasi Waktu Tunggu',
            status_pay: 'Status Bayar',
            status_waiting_verify: 'Menunggu Verifikasi Kasir',
            btn_track_live: 'Lacak Status Pesanan',
            btn_order_more: 'Pesan Menu Lain',
            // Status Pesanan
            track_title: 'Status Pesanan',
            step_pending: 'Menunggu Verifikasi',
            step_preparing: 'Sedang Disiapkan',
            step_ready: 'Siap Diambil',
            step_done: 'Selesai',
            btn_enable_notif: 'Aktifkan Notifikasi Saat Siap',
            notif_enabled: 'Notifikasi Aktif',
            review_title: 'Beri Ulasan Pesanan',
            review_placeholder: 'Ceritakan pengalamanmu dengan makanan dan layanan kami...',
            btn_send_review: 'Kirim Ulasan',
            // Riwayat Pembeli
            history_title: 'Riwayat Pesanan',
            btn_reorder: 'Pesan Lagi'
        },
        en: {
            hero_title: 'What are you craving today?',
            hero_subtitle: 'Pick your favorite dishes and pick them up at the outlet.',
            tab_recommended: 'Most Popular',
            sec_rec_title: 'Most Popular',
            sec_rec_desc: 'Customer favorites ordered most frequently',
            loading_rec: 'Loading menu recommendations...',
            empty_rec_title: 'No recommendations yet',
            empty_rec_desc: 'Browse the categories above to explore our full menu.',
            btn_choose_menu: '+ Choose',
            btn_sold_out: 'Sold Out',
            btn_store_closed: 'Store Closed',
            banner_store_closed: 'The store is currently closed and not accepting orders.',
            banner_store_closed_schedule: 'The store is currently outside operating hours.',
            price_from: 'From',
            my_order: 'My Order',
            clear_all: 'Clear all',
            total_payment: 'Total Payment',
            btn_check_cart: 'View Cart',
            link_track_order: 'Track Order',
            link_order_history: 'History',
            btn_install_app: 'Install App',
            menu_unit: 'Items',
            portion_unit: 'portions',
            detail_title: 'Menu details',
            outlet_pick_portion: 'Select portion',
            outlet_desc: 'Order and pick up at outlet',
            choose_size: 'Choose portion size',
            optional_addons: 'Optional add-ons',
            qty_title: 'Quantity',
            note_title: 'Note (optional)',
            note_placeholder: 'Write a note for this item',
            price_breakdown: 'Price summary',
            portion_price: 'Portion price',
            total_product: 'Item total',
            btn_add_to_cart: 'Add to cart',
            cart_title: 'Cart',
            pickup_at_outlet: 'Pickup at outlet',
            btn_clear: 'Clear',
            your_order: 'Your order',
            cart_sub: 'Review your items before proceeding.',
            cart_empty_title: 'Your cart is empty',
            cart_empty_sub: 'Add some menu items to get started.',
            btn_pick_menu: 'Browse menu',
            cross_sell_title: 'Great pairings',
            cross_sell_sub: 'Customers often order these together:',
            btn_add_short: '+ Add',
            item_count: 'Item count',
            subtotal: 'Subtotal',
            total: 'Total',
            btn_order_now: 'Order now',
            cart_cleared: 'Cart cleared',
            checkout_title: 'Checkout',
            qris_title: 'QRIS Payment',
            order_sent_title: 'Order Placed',
            customer_info: 'Customer Details',
            customer_name_label: 'Full Name / Nickname',
            customer_name_placeholder: 'Enter your name',
            phone_loyalty_label: 'Phone Number (Optional - Earn/Redeem Points)',
            phone_loyalty_placeholder: 'Example: 081234567890',
            check_points: 'Check Points',
            redeem_points_label: 'Redeem 10 points for Rp5.000 off',
            voucher_label: 'Promo / Voucher Code (Optional)',
            voucher_placeholder: 'Enter promo code',
            apply_voucher: 'Apply',
            remove_voucher: 'Remove',
            pickup_mode_title: 'Pickup Schedule',
            pickup_now: 'Pickup Now',
            pickup_now_desc: 'Prepared right after cashier verification',
            pickup_preorder: 'Pre-order (Scheduled Pickup)',
            pickup_preorder_desc: 'Choose a pickup time within operating hours',
            select_slot: 'Choose Pickup Time',
            order_details: 'Order Summary',
            payment_method: 'Payment Method',
            pay_cash: 'Pay Cash',
            pay_cash_desc: 'Pay directly at the counter upon pickup',
            pay_qris: 'QRIS (E-Wallet / Mobile Banking)',
            pay_qris_desc: 'Scan the outlet QRIS code after confirming',
            security_check_title: 'Security Verification',
            total_bill: 'Total Bill',
            discount_voucher: 'Voucher Discount',
            discount_points: 'Points Discount',
            btn_continue_qris: 'Continue to QRIS Payment',
            btn_confirm_order: 'Confirm & Place Order',
            qris_scan_title: 'Scan Sabangdor QRIS',
            qris_scan_desc: 'Open your e-wallet or mobile banking app and pay the exact total.',
            qris_upload_proof: 'Upload QRIS Payment Proof (Optional)',
            qris_upload_hint: 'A screenshot helps our cashier verify faster (PNG/JPG, max 5 MB).',
            qris_amount_label: 'Amount to pay',
            btn_already_paid: 'I Have Paid',
            sending_order: 'Sending to Kitchen...',
            success_title: 'Order Placed Successfully',
            queue_number: 'Queue Number',
            est_wait_time: 'Estimated Wait Time',
            status_pay: 'Payment Status',
            status_waiting_verify: 'Awaiting Cashier Verification',
            btn_track_live: 'Track Live Order Status',
            btn_order_more: 'Order More Items',
            track_title: 'Order Status',
            step_pending: 'Awaiting Verification',
            step_preparing: 'Preparing',
            step_ready: 'Ready for Pickup',
            step_done: 'Completed',
            btn_enable_notif: 'Notify Me When Ready',
            notif_enabled: 'Notifications Active',
            review_title: 'Rate Your Order',
            review_placeholder: 'Share your thoughts about the food and service...',
            btn_send_review: 'Submit Review',
            history_title: 'Order History',
            btn_reorder: 'Order Again'
        }
    };

    function getLang() {
        try {
            if (typeof localStorage !== 'undefined') {
                return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'id';
            }
        } catch (e) {}
        return 'id';
    }

    function setLang(lang) {
        const next = lang === 'en' ? 'en' : 'id';
        try {
            if (typeof localStorage !== 'undefined') localStorage.setItem(LANG_KEY, next);
        } catch (e) {}
        if (typeof document !== 'undefined') {
            document.documentElement.lang = next;
            applyToDom();
            window.dispatchEvent(new CustomEvent('sabangdor:langchange', { detail: { lang: next } }));
        }
        return next;
    }

    function t(key, fallback) {
        const lang = getLang();
        return (TRANSLATIONS[lang] && TRANSLATIONS[lang][key]) ||
               (TRANSLATIONS.id && TRANSLATIONS.id[key]) ||
               fallback ||
               key;
    }

    function applyToDom() {
        if (typeof document === 'undefined') return;
        const lang = getLang();
        document.documentElement.lang = lang;

        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (!key) return;
            const val = t(key);
            if (val) el.textContent = val;
        });

        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (!key) return;
            const val = t(key);
            if (val) el.setAttribute('placeholder', val);
        });

        document.querySelectorAll('.lang-toggle-btn').forEach(btn => {
            btn.setAttribute('aria-pressed', btn.dataset.lang === lang ? 'true' : 'false');
            btn.classList.toggle('active', btn.dataset.lang === lang);
        });
    }

    function renderSwitcher(containerSelector) {
        if (typeof document === 'undefined') return;
        const host = typeof containerSelector === 'string'
            ? document.querySelector(containerSelector)
            : containerSelector;
        if (!host || host.querySelector('.lang-switcher')) return;

        const wrap = document.createElement('div');
        wrap.className = 'lang-switcher';
        wrap.setAttribute('role', 'group');
        wrap.setAttribute('aria-label', 'Pilihan bahasa / Language');
        wrap.innerHTML = `
            <button type="button" class="lang-toggle-btn" data-lang="id" aria-pressed="${getLang() === 'id'}">ID</button>
            <button type="button" class="lang-toggle-btn" data-lang="en" aria-pressed="${getLang() === 'en'}">EN</button>
        `;
        wrap.addEventListener('click', (e) => {
            const btn = e.target.closest('.lang-toggle-btn');
            if (btn && btn.dataset.lang) setLang(btn.dataset.lang);
        });
        host.appendChild(wrap);
        applyToDom();
    }

    if (typeof document !== 'undefined') {
        document.addEventListener('DOMContentLoaded', applyToDom);
    }

    return {
        getLang,
        setLang,
        t,
        applyToDom,
        renderSwitcher,
        TRANSLATIONS
    };
}));
