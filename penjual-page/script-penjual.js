/**
 * File: penjual-page/script-penjual.js (Versi Integrasi Supabase & Class Diagram)
 * Deskripsi: Mengelola manajemen stok, verifikasi pembayaran, kitchen display, menu tambahan, dan POS kasir secara real-time menggunakan Supabase.
 */

// Klien Supabase dibuat oleh ../config.js (window.supabaseClient) -> 1 sesi login yang sama
const supabase = window.supabaseClient;

const DEFAULT_MENU_IMG = "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80";

function escHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function safeImgSrc(src, fallback) {
    const fb = fallback || DEFAULT_MENU_IMG;
    if (!src || typeof src !== 'string') return fb;
    const trimmed = src.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) return trimmed;
    return fb;
}

function rupiah(n) {
    return "Rp" + Math.round(Number(n) || 0).toLocaleString("id-ID");
}

function hargaMulai(item) {
    const ukuran = Array.isArray(item.ukuran) ? item.ukuran : [];
    if (!ukuran.length) return item.harga || 0;
    return Math.min(...ukuran.map(u => Number(u.harga) || 0));
}

// Menu bawaan (sesuai judul kartu di halaman pembeli) untuk pengaturan stok habis/tersedia
const MENU_BAWAAN = ['Mentai Ori', 'Mentai Cheese', 'Mentai Tanuki', 'Mentai Mix', 'Dimsum aja', 'Bakpao'];

let currentSec = 'dashboard';
let activeKanbanFilter = 'proses-masak';
let pesananSupabase = [];

// ==========================================
// AUTENTIKASI & INITIALIZATION
// ==========================================
function bersihkanSesiLokal() {
    sessionStorage.removeItem("sabangdor_logged_in");
    sessionStorage.removeItem("sabangdor_user_email");
    localStorage.removeItem('pegawai_session');
}

// Wajib punya sesi Supabase yang valid & terdaftar sebagai pegawai di profiles
async function checkAuth() {
    try {
        if (supabase) {
            const { data } = await supabase.auth.getSession();
            if (data && data.session && data.session.user) {
                const { data: profile, error: profError } = await supabase
                    .from('profiles')
                    .select('role')
                    .eq('id', data.session.user.id)
                    .maybeSingle();
                if (!profError && profile && profile.role === 'pegawai') {
                    return true;
                }
                await supabase.auth.signOut();
            }
        }
    } catch (e) {
        console.warn('Gagal membaca sesi login:', e);
    }
    bersihkanSesiLokal();
    window.location.href = '../login-pegawai.html';
    return false;
}

async function handleLogout() {
    try { if (supabase) await supabase.auth.signOut(); } catch (e) {}
    bersihkanSesiLokal();
    window.location.href = '../login-pegawai.html';
}

let pesanGalatTerakhir = '';
function tampilkanGalat(pesan) {
    let el = document.getElementById('banner-galat-db');
    if (!pesan) { if (el) el.remove(); pesanGalatTerakhir = ''; return; }
    if (pesan === pesanGalatTerakhir && el) return;
    pesanGalatTerakhir = pesan;
    if (!el) {
        el = document.createElement('div');
        el.id = 'banner-galat-db';
        el.style.cssText = 'background:#FEF2F2;border:1px solid #E11D48;color:#B91C1C;padding:10px 12px;border-radius:10px;font-size:12px;font-weight:700;margin-bottom:10px;';
        const body = document.querySelector('.app-body');
        if (body) body.insertBefore(el, body.firstChild);
    }
    el.textContent = pesan;
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!supabase) {
        alert('Koneksi Supabase belum siap. Periksa ../config.js dan koneksi internet.');
        return;
    }
    if (!(await checkAuth())) return;

    supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') {
            bersihkanSesiLokal();
            window.location.href = '../login-pegawai.html';
        }
    });

    await muatStatusToko();

    const firstTab = document.querySelectorAll('.tab-item')[0];
    navigate('dashboard', firstTab);

    // Auto-refresh setiap 3 detik (hanya saat tab terlihat)
    setInterval(async () => {
        if (document.hidden) return;
        await checkAndRenderAuto();
    }, 3000);

    // Tutup modal POS dengan Escape atau klik area luar modal (R-32)
    document.addEventListener('keydown', (e) => {
        const modal = document.getElementById('modalKasirOrder');
        if (e.key === 'Escape' && modal && modal.style.display === 'flex') {
            tutupModalKasirOrder();
        }
    });
    const modal = document.getElementById('modalKasirOrder');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) tutupModalKasirOrder();
        });
    }
});

// ==========================================
// SERVICE LAYER SUPABASE (DB REPOSITORY)
// ==========================================

async function fetchCustomMenusFromSupabase() {
    try {
        const { data, error } = await supabase.from('menu_custom').select('*');
        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error("Gagal ambil menu custom dari Supabase:", err);
        return [];
    }
}

let galatDbTerakhir = '';

async function saveCustomMenuToSupabase(menuData) {
    galatDbTerakhir = '';
    try {
        const { error } = await supabase
            .from('menu_custom')
            .upsert([{
                id: menuData.id,
                nama: menuData.nama,
                kategori: menuData.kategori,
                deskripsi: menuData.deskripsi,
                img_url: menuData.img || menuData.img_url,
                gratis: menuData.gratis,
                ukuran: menuData.ukuran,
                addon: menuData.addon,
                habis: menuData.habis || false
            }]);
        if (error) throw error;
        return true;
    } catch (err) {
        console.error("Gagal simpan menu custom ke Supabase:", err);
        galatDbTerakhir = err.message || String(err);
        return false;
    }
}

async function deleteCustomMenuFromSupabase(menuId) {
    try {
        const { error } = await supabase.from('menu_custom').delete().eq('id', menuId);
        if (error) throw error;
        return true;
    } catch (err) {
        console.error("Gagal hapus menu custom dari Supabase:", err);
        galatDbTerakhir = err.message || String(err);
        return false;
    }
}

function pad2(n) { return String(n).padStart(2, '0'); }

async function fetchOrdersFromSupabase() {
    try {
        const { data, error } = await supabase
            .from('orders')
            .select(`*, order_items (*)`)
            .order('created_at', { ascending: false });

        if (error) throw error;
        tampilkanGalat('');

        return (data || []).map(o => {
            const d = new Date(o.created_at);
            return {
                db_id_order: o.id_order,
                idOrder: `ANT-${String(o.nomor_antrean).padStart(2, '0')}`,
                nomorAntrean: o.nomor_antrean,
                namaPelanggan: o.nama_pembeli,
                metodeBayar: o.tipe_pembayaran ? o.tipe_pembayaran.toUpperCase() : 'CASH',
                totalHarga: Number(o.total_harga),
                totalHargaFormatted: `Rp${Number(o.total_harga).toLocaleString('id-ID')}`,
                statusPembayaranDb: o.status_pembayaran,
                statusPesananDb: o.status_pesanan,
                waktu: d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
                tanggal: `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`,
                tanggalKey: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
                items: (o.order_items || []).map(i => ({
                    nama: i.nama_item || 'Menu',
                    varian: i.varian || '',
                    catatan: i.catatan || '',
                    qty: i.jumlah,
                    hargaSatuan: Number(i.harga_satuan) || 0,
                    totalHargaItem: Number(i.subtotal) || 0
                }))
            };
        });
    } catch (err) {
        console.error("Gagal ambil pesanan dari Supabase:", err);
        tampilkanGalat('Gagal memuat pesanan: ' + (err.message || err) + ' (cek koneksi / login ulang)');
        return null;
    }
}

// ----- Pengaturan bersama (tabel app_settings) -----
async function getSetting(key, fallback = null) {
    try {
        const { data, error } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
        if (error) throw error;
        return data && data.value != null ? data.value : fallback;
    } catch (err) {
        console.warn('Gagal membaca pengaturan', key, err.message || err);
        return fallback;
    }
}

async function setSetting(key, value) {
    const { error } = await supabase
        .from('app_settings')
        .upsert({ key: key, value: value, updated_at: new Date().toISOString() });
    if (error) throw error;
}

async function ambilMenuHabisBawaan() {
    try {
        const arr = JSON.parse(await getSetting('menu_habis', '[]'));
        return Array.isArray(arr) ? arr : [];
    } catch (e) {
        return [];
    }
}

async function checkAndRenderAuto() {
    const aktif = document.activeElement;
    if (aktif && (aktif.tagName === 'INPUT' || aktif.tagName === 'TEXTAREA' || aktif.tagName === 'SELECT')) {
        return;
    }
    // Halaman stok/QRIS & form menu tidak di-render ulang otomatis
    // (agar dialog pilih file & isian form tidak hilang); hanya badge yang diperbarui.
    if (currentSec === 'dashboard' || currentSec === 'menu') {
        await perbaruiBadgeBayar();
        return;
    }
    await renderCurrentSection();
}

async function perbaruiBadgeBayar() {
    try {
        const { count, error } = await supabase
            .from('orders')
            .select('id_order', { count: 'exact', head: true })
            .eq('status_pembayaran', 'pending');
        if (error) throw error;
        tampilBadgeBayar(count || 0);
    } catch (e) { /* abaikan */ }
}

function tampilBadgeBayar(jumlah) {
    const badgeEl = document.getElementById('badge-notif-bayar');
    if (!badgeEl) return;
    if (jumlah > 0) {
        badgeEl.style.display = 'inline-block';
        badgeEl.innerText = jumlah;
    } else {
        badgeEl.style.display = 'none';
    }
}

function navigate(secKey, el) {
    currentSec = secKey;

    document.querySelectorAll('.tab-item').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');

    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    const secEl = document.getElementById(`sec-${secKey}`);
    if (secEl) secEl.classList.add('active');

    const titleMap = {
        'dashboard': { t: 'Manajemen Stok & QRIS', s: 'Atur Ketersediaan Menu & Gambar QRIS Toko' },
        'pembayaran': { t: 'Verifikasi Pembayaran', s: 'Konfirmasi pembayaran QRIS & Tunai dari pembeli' },
        'pantau': { t: 'Display Kitchen (Dapur)', s: 'Kelola antrian proses masak hingga selesai' },
        'menu': { t: 'Menu Tambahan', s: 'Tambah menu baru tanpa perlu membuat halaman HTML' },
        'riwayat': { t: 'Riwayat Transaksi', s: 'Arsip transaksi selesai & total omzet harian' }
    };

    if (titleMap[secKey]) {
        const titleEl = document.getElementById('page-title');
        const subEl = document.getElementById('page-subtitle');
        if (titleEl) titleEl.innerText = titleMap[secKey].t;
        if (subEl) subEl.innerText = titleMap[secKey].s;
    }

    renderCurrentSection(true);
}

async function renderCurrentSection(force = false) {
    if (currentSec === 'dashboard') { await perbaruiBadgeBayar(); await renderStokMenu(); return; }
    if (currentSec === 'menu') { await perbaruiBadgeBayar(); await renderMenuTambahan(); return; }

    const hasil = await fetchOrdersFromSupabase();
    if (hasil === null) return; // gagal ambil data: pertahankan tampilan terakhir
    pesananSupabase = hasil;

    const semuaPesanan = pesananSupabase;
    const riwayat = pesananSupabase.filter(p => p.statusPesananDb === 'selesai');

    tampilBadgeBayar(semuaPesanan.filter(p => p.statusPembayaranDb === 'pending').length);

    if (currentSec === 'pembayaran') renderPembayaran(semuaPesanan, force);
    else if (currentSec === 'pantau') renderKitchenDisplay(semuaPesanan, riwayat);
    else if (currentSec === 'riwayat') renderRiwayat(riwayat);
}

// ==========================================
// 1. MANAJEMEN STOK & QRIS
// ==========================================
async function renderStokMenu() {
    const grid = document.getElementById('grid-stok-menu');
    if (!grid) return;

    const customQrisImg = await getSetting('qris_image', '');
    const qrisSafe = customQrisImg ? safeImgSrc(customQrisImg, '') : '';
    const habisBawaan = await ambilMenuHabisBawaan();

    let html = `
        <div class="card">
            <div class="card-title">Pengaturan QRIS Outlet</div>
            <div class="card-sub">Gambar QRIS ini tampil di halaman checkout semua pembeli</div>

            <div class="upload-wrapper">
                <button type="button" class="btn-upload-custom" onclick="document.getElementById('inputFileQris').click()">
                    + Pilih Gambar QRIS
                </button>
                <input type="file" id="inputFileQris" accept="image/*" style="display:none;">
            </div>
            <div id="qrisMsg" class="mt-hint" style="margin-top:6px;"></div>

            ${qrisSafe ? `
                <div class="qris-preview-container">
                    <span style="font-size:12px; font-weight:700; color:#047857;">Gambar QRIS Aktif</span><br>
                    <img src="${escHtml(qrisSafe)}" class="qris-preview-img" width="140" height="140" alt="QRIS Toko"><br>
                    <button type="button" class="mt-btn-small danger" style="margin-top:8px;" onclick="hapusQris()">Hapus QRIS</button>
                </div>
            ` : ''}
        </div>

        <div class="card-title" style="margin-top:10px;">Stok Menu Bawaan</div>
        <div class="stok-grid">
    `;

    MENU_BAWAAN.forEach(nama => {
        const isHabis = habisBawaan.some(n => n.toLowerCase() === nama.toLowerCase());
        html += `
            <div class="stok-card">
                <div class="stok-left">
                    <img src="${escHtml(DEFAULT_MENU_IMG)}" class="stok-thumb" width="44" height="44" alt="${escHtml(nama)}">
                    <span class="stok-name">${escHtml(nama)}</span>
                </div>
                <button type="button" class="btn-toggle-stok ${isHabis ? 'empty' : 'ready'}" data-nama="${escHtml(nama)}" onclick="toggleStokBawaan(this.dataset.nama)">
                    <span class="status-dot" aria-hidden="true"></span>${isHabis ? 'HABIS' : 'TERSEDIA'}
                </button>
            </div>
        `;
    });

    html += `</div><div class="card-title" style="margin-top:14px;">Stok Menu Tambahan (Custom)</div>`;

    const customList = await fetchCustomMenusFromSupabase();
    if (customList.length === 0) {
        html += `<div class="empty-info">Belum ada menu custom terdaftar di database.</div>`;
    } else {
        html += `<div class="stok-grid">`;
        customList.forEach(item => {
            const isHabis = !!item.habis;
            const imgUrl = safeImgSrc(item.img_url, DEFAULT_MENU_IMG);
            html += `
                <div class="stok-card">
                    <div class="stok-left">
                        <img src="${escHtml(imgUrl)}" class="stok-thumb" width="44" height="44" alt="${escHtml(item.nama)}">
                        <span class="stok-name">${escHtml(item.nama)}</span>
                    </div>
                    <button type="button" class="btn-toggle-stok ${isHabis ? 'empty' : 'ready'}" data-id="${escHtml(item.id)}" onclick="toggleStokCustom(this.dataset.id)">
                        <span class="status-dot" aria-hidden="true"></span>${isHabis ? 'HABIS' : 'TERSEDIA'}
                    </button>
                </div>
            `;
        });
        html += `</div>`;
    }

    grid.innerHTML = html;

    const fileInput = document.getElementById("inputFileQris");
    if (fileInput) {
        fileInput.addEventListener("change", function (e) {
            const file = e.target.files[0];
            if (file) simpanQrisDariFile(file);
        });
    }
}

// Perkecil gambar QRIS lalu simpan ke database (dibaca pembeli di halaman checkout)
function simpanQrisDariFile(file) {
    const msg = document.getElementById('qrisMsg');
    if (!file || !file.type || !file.type.startsWith('image/')) {
        if (msg) msg.textContent = 'Pilih file gambar yang valid (PNG/JPG/WebP).';
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        if (msg) msg.textContent = 'Ukuran gambar maksimal 5 MB.';
        return;
    }
    if (msg) msg.textContent = 'Menyimpan gambar QRIS...';

    const reader = new FileReader();
    reader.onload = function (evt) {
        const img = new Image();
        img.onload = async function () {
            const maxSide = 700;
            const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            try {
                await setSetting('qris_image', canvas.toDataURL('image/png'));
                await renderStokMenu();
            } catch (err) {
                console.error('Gagal simpan QRIS:', err);
                if (msg) msg.textContent = 'Gagal menyimpan QRIS: ' + (err.message || err);
            }
        };
        img.onerror = function () { if (msg) msg.textContent = 'File gambar tidak bisa dibaca.'; };
        img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
}

async function hapusQris() {
    if (!confirm('Hapus gambar QRIS? Pembeli akan diminta scan QRIS fisik di kasir sampai Anda mengunggah gambar baru.')) return;
    try {
        await setSetting('qris_image', '');
        await renderStokMenu();
    } catch (err) {
        alert('Gagal menghapus QRIS: ' + (err.message || err));
    }
}

async function toggleStokBawaan(nama) {
    try {
        const daftar = await ambilMenuHabisBawaan();
        const idx = daftar.findIndex(n => n.toLowerCase() === String(nama).toLowerCase());
        if (idx > -1) daftar.splice(idx, 1); else daftar.push(nama);
        await setSetting('menu_habis', JSON.stringify(daftar));
        await renderStokMenu();
    } catch (err) {
        alert('Gagal mengubah stok: ' + (err.message || err));
    }
}

async function toggleStokCustom(menuId) {
    const customList = await fetchCustomMenusFromSupabase();
    const m = customList.find(x => String(x.id) === String(menuId));
    if (!m) return;

    const ok = await saveCustomMenuToSupabase({ ...m, img: m.img_url, habis: !m.habis });
    if (!ok) alert('Gagal mengubah stok: ' + (galatDbTerakhir || 'periksa koneksi / login ulang'));
    await renderStokMenu();
}

function getItemSubtotal(i) {
    if (i.totalHargaItem && !isNaN(i.totalHargaItem) && i.totalHargaItem > 0) return i.totalHargaItem;
    if (i.hargaSatuan && !isNaN(i.hargaSatuan) && i.hargaSatuan > 0) return i.hargaSatuan * (i.qty || 1);
    return 0;
}

// Detail varian & catatan item (wajib terlihat jelas oleh dapur)
function detailItemHtml(i) {
    let h = '';
    if (i.varian) h += `<div style="font-size:12px; color:var(--text-muted); font-weight:600;">${escHtml(i.varian)}</div>`;
    if (i.catatan) h += `<div style="font-size:12px; color:#B45309; font-weight:700;">Catatan: ${escHtml(i.catatan)}</div>`;
    return h;
}

// Update status pesanan dan pastikan benar-benar ada baris yang berubah
// (RLS memblokir tanpa error jika sesi login sudah habis)
async function updateOrderRow(dbIdOrder, perubahan) {
    const { data, error } = await supabase
        .from('orders')
        .update(perubahan)
        .eq('id_order', dbIdOrder)
        .select('id_order');
    if (error) throw error;
    if (!data || data.length === 0) {
        throw new Error('Perubahan ditolak database. Sesi login mungkin habis, silakan login ulang.');
    }
}

// ==========================================
// 2. VERIFIKASI PEMBAYARAN
// ==========================================
function renderPembayaran(pesananList, force = false) {
    const container = document.getElementById('container-pembayaran');
    if (!container) return;

    const pending = pesananList.filter(p => p.statusPembayaranDb === 'pending');

    if (pending.length === 0) {
        container.innerHTML = `<div class="empty-info">Tidak ada pembayaran menunggu verifikasi.</div>`;
        return;
    }

    let html = '<div class="orders-grid">';
    pending.forEach((order) => {
        const itemList = order.items.map(i => {
            const itemHarga = getItemSubtotal(i);
            return `
                <li class="order-item-row">
                    <div><span><b>${i.qty || 1}x</b> ${escHtml(i.nama)}</span>${detailItemHtml(i)}</div>
                    <b>Rp${itemHarga.toLocaleString('id-ID')}</b>
                </li>
            `;
        }).join('');

        const isTunais = order.metodeBayar === 'CASH' || order.metodeBayar === 'TUNAI';

        html += `
            <div class="order-card-merchant">
                <div class="order-head">
                    <span class="order-id-txt">#${escHtml(order.idOrder)} (${escHtml(order.namaPelanggan)})</span>
                    <span class="order-badge-pay ${isTunais ? 'tag-cash' : 'tag-qris'}">${escHtml(order.metodeBayar)}</span>
                </div>
                <div style="font-size:12.5px; color:var(--text-muted);">
                    ${escHtml(order.waktu)} WIB | Total Tagihan: <b style="color:var(--primary-red); font-size:14px;">${escHtml(order.totalHargaFormatted)}</b>
                </div>
                <ul class="order-item-list">${itemList}</ul>
                <div class="btn-group">
                    <button type="button" class="btn-primary-merchant" onclick="konfirmasiPembayaran(${Number(order.db_id_order)})">
                        ${isTunais ? 'Terima Tunai & Kirim Dapur' : 'Verifikasi QRIS & Kirim Dapur'}
                    </button>
                    <button type="button" class="btn-outline-merchant" onclick="cetakStrukLangsungById(${Number(order.db_id_order)})">Struk</button>
                    <button type="button" class="btn-outline-merchant" style="color:#BE123C;" onclick="batalkanPesanan(${Number(order.db_id_order)})">Batalkan</button>
                </div>
            </div>
        `;
    });
    html += '</div>';
    container.innerHTML = html;
}

async function konfirmasiPembayaran(dbIdOrder) {
    try {
        await updateOrderRow(dbIdOrder, { status_pembayaran: 'lunas', status_pesanan: 'disiapkan' });
        await renderCurrentSection(true);
    } catch (err) {
        console.error("Gagal update status pembayaran ke Supabase:", err);
        alert("Gagal memverifikasi pembayaran: " + (err.message || err));
    }
}

async function batalkanPesanan(dbIdOrder) {
    if (!confirm('Batalkan pesanan ini? (misalnya pembeli tidak jadi bayar)')) return;
    try {
        await updateOrderRow(dbIdOrder, { status_pembayaran: 'batal', status_pesanan: 'selesai' });
        await renderCurrentSection(true);
    } catch (err) {
        alert("Gagal membatalkan pesanan: " + (err.message || err));
    }
}

// ==========================================
// 3. DISPLAY KITCHEN (DAPUR)
// ==========================================
function switchKitchenTab(type, evt) {
    activeKanbanFilter = type;
    document.querySelectorAll('.k-tab').forEach(b => b.classList.remove('active'));
    if (evt && evt.currentTarget) evt.currentTarget.classList.add('active');
    renderCurrentSection(true);
}

function renderKitchenDisplay(pesananList, riwayatList) {
    const container = document.getElementById('kanban-content-mobile');
    if (!container) return;

    // Urutan dapur: pesanan terlama dikerjakan lebih dulu
    const listProsesMasak = pesananList
        .filter(p => p.statusPembayaranDb === 'lunas' && p.statusPesananDb !== 'selesai')
        .slice().reverse();
    const listSelesai = pesananList.filter(p => p.statusPesananDb === 'selesai' && p.statusPembayaranDb === 'lunas');

    const countProsesEl = document.getElementById('count-terkirim') || document.getElementById('count-proses-masak');
    const countSelesaiEl = document.getElementById('count-selesai');
    if (countProsesEl) countProsesEl.innerText = listProsesMasak.length;
    if (countSelesaiEl) countSelesaiEl.innerText = listSelesai.length;

    const filtered = activeKanbanFilter === 'proses-masak' ? listProsesMasak : listSelesai;

    if (filtered.length === 0) {
        container.innerHTML = `<div class="empty-info">Tidak ada pesanan dalam kategori ini.</div>`;
        return;
    }

    let html = '<div class="orders-grid">';
    filtered.forEach((order) => {
        const itemList = order.items.map(i =>
            `<li><b>${i.qty || 1}x ${escHtml(i.nama)}</b>${detailItemHtml(i)}</li>`
        ).join('');

        html += `
            <div class="order-card-merchant">
                <div class="order-head">
                    <span class="order-id-txt">#${escHtml(order.idOrder)} (${escHtml(order.namaPelanggan)})</span>
                    <span style="font-size:12px; color:var(--text-muted);">${escHtml(order.waktu)} WIB</span>
                </div>
                <ul class="order-item-list">${itemList}</ul>
        `;

        if (activeKanbanFilter === 'proses-masak') {
            html += `<button type="button" class="btn-primary-merchant" style="background:#1D4ED8;" onclick="tandaiSelesaiDapur(${Number(order.db_id_order)})">Selesai & Sajikan</button></div>`;
        } else {
            html += `<p style="font-size:13px; color:var(--green-text); font-weight:700;">Status: Selesai & Disajikan</p></div>`;
        }
    });
    html += '</div>';

    container.innerHTML = html;
}

async function tandaiSelesaiDapur(dbIdOrder) {
    try {
        await updateOrderRow(dbIdOrder, { status_pesanan: 'selesai' });
        await renderCurrentSection(true);
    } catch (err) {
        console.error("Gagal update status selesai ke Supabase:", err);
        alert("Gagal menyelesaikan pesanan: " + (err.message || err));
    }
}

// ==========================================
// 4. RIWAYAT TRANSAKSI
// ==========================================
function resetFilterTanggal() {
    const inputEl = document.getElementById('filterTanggal');
    if (inputEl) inputEl.value = '';
    renderCurrentSection(true);
}

function renderRiwayat(riwayatList) {
    const banner = document.getElementById('summary-omzet-card');
    const container = document.getElementById('history-cards-container');
    const filterInput = document.getElementById('filterTanggal');
    if (!container) return;

    // Hanya transaksi yang benar-benar lunas yang dihitung sebagai omzet
    const lunasList = riwayatList.filter(p => p.statusPembayaranDb === 'lunas');

    const selectedDate = filterInput ? filterInput.value : ''; // format yyyy-mm-dd
    let formattedSelectedDate = '';
    if (selectedDate) {
        const parts = selectedDate.split('-');
        if (parts.length === 3) formattedSelectedDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
    }

    const filteredList = selectedDate ? lunasList.filter(item => item.tanggalKey === selectedDate) : lunasList;
    const totalOmzet = filteredList.reduce((sum, item) => sum + (item.totalHarga || 0), 0);

    if (banner) {
        const labelOmzet = formattedSelectedDate ? `Omzet Tanggal ${formattedSelectedDate}` : 'Total Omzet Keseluruhan';
        banner.innerHTML = `
            <div class="omzet-banner">
                <p>${labelOmzet} (${filteredList.length} transaksi)</p>
                <h2>Rp${totalOmzet.toLocaleString('id-ID')}</h2>
            </div>
        `;
    }

    if (filteredList.length === 0) {
        container.innerHTML = `<div class="empty-info">Tidak ada riwayat transaksi pada tanggal ini.</div>`;
        return;
    }

    let html = '<div class="orders-grid">';
    filteredList.forEach((item) => {
        html += `
            <div class="order-card-merchant" style="flex-direction:row; justify-content:space-between; align-items:center;">
                <div>
                    <div style="font-weight:800; font-size:14px;">#${escHtml(item.idOrder)} (${escHtml(item.namaPelanggan)} - ${escHtml(item.metodeBayar)})</div>
                    <div style="font-size:12px; color:var(--text-muted);">${escHtml(item.tanggal)} ${escHtml(item.waktu)} WIB</div>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <b style="color:var(--green-text); font-size:14px;">${escHtml(item.totalHargaFormatted)}</b>
                    <button type="button" class="btn-outline-merchant" style="padding:8px 12px; font-size:12px;" onclick="cetakStrukLangsungById(${Number(item.db_id_order)})">Struk</button>
                </div>
            </div>
        `;
    });
    html += '</div>';
    container.innerHTML = html;
}

// ==========================================
// 5. CETAK STRUK
// ==========================================
function cetakStrukLangsungById(dbIdOrder) {
    const order = pesananSupabase.find(p => p.db_id_order === dbIdOrder);
    if (order) {
        cetakStrukLangsung(order);
    }
}

function cetakStrukLangsung(order) {
    const printWindow = window.open('', '', 'width=320,height=600');
    if (!printWindow) {
        alert("Pop-up diblokir browser!");
        return;
    }

    const itemsHtml = order.items.map(i => `
        <tr>
            <td style="padding:2px 0;">${i.qty}x ${escHtml(i.nama)}${i.varian ? `<br><small>${escHtml(i.varian)}</small>` : ''}</td>
            <td style="text-align:right; vertical-align:top;">Rp${getItemSubtotal(i).toLocaleString('id-ID')}</td>
        </tr>
    `).join('');

    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Struk #${escHtml(order.idOrder)}</title>
            <style>
                @page { size: 58mm; margin: 0; }
                body {
                    font-family: 'Courier New', Courier, monospace;
                    width: 48mm;
                    margin: 0 auto;
                    padding: 8px 0;
                    font-size: 11px;
                    color: #000;
                }
                .text-center { text-align: center; }
                .divider { border-bottom: 1px dashed #000; margin: 6px 0; }
                table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
            </style>
        </head>
        <body>
            <div class="text-center">
                <strong style="font-size:14px;">SABANGDOR</strong><br>
                <span>Outlet Ambil Sendiri</span><br>
            </div>

            <div class="divider"></div>

            <div>
                <div>No: <strong>#${escHtml(order.idOrder)}</strong></div>
                <div>Nama: ${escHtml(order.namaPelanggan)}</div>
                <div>Tgl: ${escHtml(order.tanggal || new Date().toLocaleDateString('id-ID'))} ${escHtml(order.waktu)}</div>
                <div>Bayar: ${escHtml(order.metodeBayar)}</div>
            </div>

            <div class="divider"></div>

            <table>
                <tbody>
                    ${itemsHtml}
                </tbody>
            </table>

            <div class="divider"></div>

            <div style="display:flex; justify-content:space-between; font-weight:bold; font-size:12px;">
                <span>TOTAL:</span>
                <span>${escHtml(order.totalHargaFormatted)}</span>
            </div>

            <div class="divider"></div>

            <div class="text-center" style="margin-top:8px;">
                <span>Terima Kasih!</span><br>
                <small>Selamat Menikmati</small>
            </div>

            <script>
                window.onload = function() {
                    window.print();
                    setTimeout(function() { window.close(); }, 500);
                };
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

// ==========================================
// 6. RENDER MENU TAMBAHAN
// ==========================================
let mtEditingId = null;
let mtFotoData = '';
let mtMsgTimer = null;

function mtBarisUkuranHtml(u) {
    u = u || {};
    return `
        <div class="mt-row mt-ukuran-row">
            <input type="text" class="mt-input mt-u-nama" placeholder="Ukuran" value="${escHtml(u.nama || '')}">
            <input type="text" class="mt-input mt-u-porsi" placeholder="1 porsi" value="${escHtml(u.porsi || '')}">
            <input type="number" class="mt-input mt-u-harga" placeholder="Harga" min="0" inputmode="numeric" value="${u.harga ? Number(u.harga) : ''}">
            <button type="button" class="mt-btn-x" aria-label="Hapus baris" onclick="this.closest('.mt-row').remove()">✕</button>
        </div>`;
}

function mtBarisAddonHtml(a) {
    a = a || {};
    return `
        <div class="mt-row mt-addon-row">
            <input type="text" class="mt-input mt-a-nama" placeholder="Nama tambahan" value="${escHtml(a.nama || '')}">
            <input type="number" class="mt-input mt-a-harga" placeholder="Harga" min="0" inputmode="numeric" value="${a.harga ? Number(a.harga) : ''}">
            <button type="button" class="mt-btn-x" aria-label="Hapus baris" onclick="this.closest('.mt-row').remove()">✕</button>
        </div>`;
}

function mtTambahUkuran(data) {
    const el = document.getElementById('mtUkuranList');
    if (el) el.insertAdjacentHTML('beforeend', mtBarisUkuranHtml(data));
}

function mtTambahAddon(data) {
    const el = document.getElementById('mtAddonList');
    if (el) el.insertAdjacentHTML('beforeend', mtBarisAddonHtml(data));
}

function mtShowMsg(teks, tipe) {
    const el = document.getElementById('mtMsg');
    if (!el) return;
    el.textContent = teks;
    el.className = 'mt-msg show ' + (tipe || 'ok');
    clearTimeout(mtMsgTimer);
    if ((tipe || 'ok') === 'ok') {
        mtMsgTimer = setTimeout(() => { el.className = 'mt-msg'; }, 3500);
    }
}

function mtPilihFoto(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (!file.type || !file.type.startsWith('image/')) {
        mtShowMsg('Pilih file gambar yang valid (PNG/JPG/WebP).', 'error');
        input.value = '';
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        mtShowMsg('Ukuran foto maksimal 5 MB.', 'error');
        input.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = function (evt) {
        const img = new Image();
        img.onload = function () {
            const maxSide = 600;
            const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            mtFotoData = canvas.toDataURL('image/jpeg', 0.75);
            const prev = document.getElementById('mtFotoPreview');
            if (prev) prev.src = mtFotoData;
        };
        img.onerror = function () { mtShowMsg('File foto tidak bisa dibaca.', 'error'); };
        img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
    input.value = '';
}

const MT_KATEGORI_BARU = '__kategori_baru__';
const MT_KATEGORI_BAWAAN = ['Dimsum Mentai', 'Dimsum aja', 'Bakpao'];

async function mtDaftarKategori() {
    const hasil = MT_KATEGORI_BAWAAN.slice();
    const customMenus = await fetchCustomMenusFromSupabase();
    customMenus.forEach(m => {
        const k = String(m.kategori || '').trim();
        if (k && !hasil.some(x => x.toLowerCase() === k.toLowerCase())) hasil.push(k);
    });
    return hasil;
}

function mtOnKategoriChange(fokus) {
    const sel = document.getElementById('mtKategori');
    const wrap = document.getElementById('mtKategoriBaruWrap');
    if (!sel || !wrap) return;
    const baru = sel.value === MT_KATEGORI_BARU;
    wrap.style.display = baru ? 'block' : 'none';
    if (baru && fokus) {
        const inp = document.getElementById('mtKategoriBaru');
        if (inp) inp.focus();
    }
}

async function mtIsiKategori(pilih) {
    const sel = document.getElementById('mtKategori');
    if (!sel) return;

    const daftar = await mtDaftarKategori();
    const sig = daftar.join('|');
    if (pilih === undefined && sel.dataset.sig === sig) return;

    const sekarang = pilih !== undefined ? pilih : sel.value;
    sel.innerHTML = daftar.map(k => `<option value="${escHtml(k)}">${escHtml(k)}</option>`).join('')
        + `<option value="${MT_KATEGORI_BARU}">+ Kategori baru…</option>`;
    sel.dataset.sig = sig;

    const cocok = daftar.find(k => k.toLowerCase() === String(sekarang || '').toLowerCase());
    if (cocok) sel.value = cocok;
    else if (sekarang === MT_KATEGORI_BARU) sel.value = MT_KATEGORI_BARU;
    else sel.selectedIndex = 0;

    mtOnKategoriChange(false);
}

function mtResetForm() {
    mtEditingId = null;
    mtFotoData = '';

    const form = document.getElementById('formTambahMenuCustom');
    if (form) form.reset();
    mtIsiKategori('');

    const u = document.getElementById('mtUkuranList');
    const a = document.getElementById('mtAddonList');
    if (u) u.innerHTML = '';
    if (a) a.innerHTML = '';

    const prev = document.getElementById('mtFotoPreview');
    if (prev) prev.src = DEFAULT_MENU_IMG;

    const title = document.getElementById('mtFormTitle');
    if (title) title.textContent = 'Tambah Menu Baru';
    const btn = document.getElementById('btnSimpanMenuCustom');
    if (btn) btn.textContent = 'Simpan Menu';
    const batal = document.getElementById('btnBatalEditMenu');
    if (batal) batal.style.display = 'none';
}

async function renderMenuTambahan() {
    let secEl = document.getElementById('sec-menu');
    if (!secEl) return;

    if (!document.getElementById('formTambahMenuCustom')) {
        secEl.innerHTML = `
            <div class="card" id="mt-form-card">
                <div class="card-title" id="mtFormTitle">Tambah Menu Baru</div>
                <div class="card-sub">Menu langsung tampil di halaman pembeli lengkap dengan detail menunya</div>

                <form id="formTambahMenuCustom" onsubmit="handleSimpanMenuCustom(event)" novalidate>
                    <div class="mt-field">
                        <label>Foto menu</label>
                        <div class="mt-photo">
                            <img id="mtFotoPreview" src="${DEFAULT_MENU_IMG}" width="72" height="72" alt="Foto menu">
                            <div>
                                <button type="button" class="btn-upload-custom" onclick="document.getElementById('mtFotoInput').click()">Pilih Foto</button>
                                <input type="file" id="mtFotoInput" accept="image/*" style="display:none;" onchange="mtPilihFoto(this)">
                                <div class="mt-hint">Kosongkan jika belum ada foto</div>
                            </div>
                        </div>
                    </div>

                    <div class="mt-field">
                        <label for="mtNama">Nama menu</label>
                        <input type="text" id="mtNama" class="mt-input" placeholder="Contoh: Siomay Ayam" autocomplete="off">
                    </div>

                    <div class="mt-field">
                        <label for="mtKategori">Kategori</label>
                        <select id="mtKategori" class="mt-input" onchange="mtOnKategoriChange(true)">
                            <option value="Dimsum Mentai">Dimsum Mentai</option>
                            <option value="Dimsum aja">Dimsum aja</option>
                            <option value="Bakpao">Bakpao</option>
                        </select>
                        <div id="mtKategoriBaruWrap" style="display:none; margin-top:8px;">
                            <input type="text" id="mtKategoriBaru" class="mt-input" placeholder="Nama kategori baru, contoh: Minuman" autocomplete="off">
                            <div class="mt-hint">Kategori baru otomatis muncul di daftar pilihan setelah menu disimpan.</div>
                        </div>
                    </div>

                    <div class="mt-field">
                        <label for="mtDeskripsi">Deskripsi singkat</label>
                        <textarea id="mtDeskripsi" class="mt-input" rows="2" placeholder="Contoh: Dimsum ayam lembut dengan saus spesial."></textarea>
                    </div>

                    <div class="mt-field">
                        <label>Ukuran / porsi &amp; harga</label>
                        <div class="mt-hint" style="margin:0 0 8px;">Menu satu harga? Isi satu baris saja, misalnya Reguler • 1 porsi • 10000.</div>
                        <div id="mtUkuranList"></div>
                        <button type="button" class="mt-btn-add" onclick="mtTambahUkuran()">+ Tambah ukuran</button>
                    </div>

                    <div class="mt-field">
                        <label for="mtGratis">Bonus gratis (opsional)</label>
                        <input type="text" id="mtGratis" class="mt-input" placeholder="Contoh: Free Chilli Oil" autocomplete="off">
                    </div>

                    <div class="mt-field">
                        <label>Tambahan opsional (opsional)</label>
                        <div id="mtAddonList"></div>
                        <button type="button" class="mt-btn-add" onclick="mtTambahAddon()">+ Tambah pilihan tambahan</button>
                    </div>

                    <div id="mtMsg" class="mt-msg"></div>

                    <div class="btn-group">
                        <button type="submit" id="btnSimpanMenuCustom" class="btn-primary-merchant">Simpan Menu</button>
                        <button type="button" id="btnBatalEditMenu" class="btn-outline-merchant" style="display:none;" onclick="mtResetForm()">Batal</button>
                    </div>
                </form>
            </div>

            <div class="card-title" style="margin-top:16px;">Daftar Menu Custom Terpasang</div>
            <div id="listMenuCustom"></div>
        `;
    }

    const selKat = document.getElementById('mtKategori');
    if (selKat && document.activeElement !== selKat) await mtIsiKategori();

    const listEl = document.getElementById('listMenuCustom');
    if (!listEl) return;

    let customList = await fetchCustomMenusFromSupabase();

    if (customList.length === 0) {
        listEl.innerHTML = `<div class="empty-info" style="margin-top:12px;">Belum ada menu custom tambahan.</div>`;
        return;
    }

    listEl.innerHTML = customList.map(item => {
        const ukuran = Array.isArray(item.ukuran) ? item.ukuran : [];
        const hargaMin = ukuran.length ? hargaMulai(item) : (item.harga || 0);
        const infoUkuran = ukuran.length > 1 ? ` • ${ukuran.length} ukuran` : '';
        const infoAddon = Array.isArray(item.addon) && item.addon.length ? ` • ${item.addon.length} tambahan` : '';
        const imgSrc = safeImgSrc(item.img_url, DEFAULT_MENU_IMG);
        const idAttr = escHtml(item.id);
        return `
            <div class="stok-card" style="margin-top:10px;">
                <div class="stok-left">
                    <img src="${escHtml(imgSrc)}" class="stok-thumb" width="44" height="44" alt="${escHtml(item.nama)}">
                    <div class="mt-info">
                        <div class="stok-name"><b>${escHtml(item.nama)}</b></div>
                        <div class="mt-meta">${escHtml(item.kategori || 'Umum')} • Mulai ${rupiah(hargaMin)}${infoUkuran}${infoAddon}</div>
                    </div>
                </div>
                <div class="mt-actions">
                    <button type="button" class="mt-btn-small" data-id="${idAttr}" onclick="mulaiEditMenuCustom(this.dataset.id)">Edit</button>
                    <button type="button" class="mt-btn-small danger" data-id="${idAttr}" onclick="hapusMenuCustom(this.dataset.id)">Hapus</button>
                </div>
            </div>
        `;
    }).join('');
}

async function mulaiEditMenuCustom(menuId) {
    const customList = await fetchCustomMenusFromSupabase();
    const m = customList.find(x => String(x.id) === String(menuId));
    if (!m) return;

    mtResetForm();
    mtEditingId = m.id;

    const foto = m.img_url || DEFAULT_MENU_IMG;
    mtFotoData = foto === DEFAULT_MENU_IMG ? '' : foto;

    document.getElementById('mtNama').value = m.nama || '';
    await mtIsiKategori(m.kategori || 'Dimsum Mentai');
    document.getElementById('mtDeskripsi').value = m.deskripsi || '';
    document.getElementById('mtGratis').value = m.gratis || '';
    document.getElementById('mtFotoPreview').src = foto || DEFAULT_MENU_IMG;

    (Array.isArray(m.ukuran) ? m.ukuran : []).forEach(u => mtTambahUkuran(u));
    (Array.isArray(m.addon) ? m.addon : []).forEach(a => mtTambahAddon(a));

    document.getElementById('mtFormTitle').textContent = 'Edit Menu';
    document.getElementById('btnSimpanMenuCustom').textContent = 'Simpan Perubahan';
    document.getElementById('btnBatalEditMenu').style.display = '';

    const card = document.getElementById('mt-form-card');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function handleSimpanMenuCustom(e) {
    e.preventDefault();

    const nama = document.getElementById('mtNama').value.trim();
    let kategori = document.getElementById('mtKategori').value;
    const deskripsi = document.getElementById('mtDeskripsi').value.trim();
    const gratis = document.getElementById('mtGratis').value.trim();

    if (!nama) {
        mtShowMsg('Nama menu wajib diisi.', 'error');
        return;
    }

    if (kategori === MT_KATEGORI_BARU) {
        const baru = document.getElementById('mtKategoriBaru').value.trim();
        if (!baru) {
            mtShowMsg('Nama kategori baru wajib diisi.', 'error');
            return;
        }
        const daftarKat = await mtDaftarKategori();
        kategori = daftarKat.find(k => k.toLowerCase() === baru.toLowerCase()) || baru;
    }

    const ukuran = [];
    let ukuranError = false;
    document.querySelectorAll('#mtUkuranList .mt-ukuran-row').forEach(row => {
        const uNama = row.querySelector('.mt-u-nama').value.trim();
        const uPorsi = row.querySelector('.mt-u-porsi').value.trim();
        const uHarga = Number(row.querySelector('.mt-u-harga').value) || 0;
        if (!uNama && !uPorsi && !uHarga) return;
        if (uHarga <= 0) { ukuranError = true; return; }
        ukuran.push({ nama: uNama || 'Reguler', porsi: uPorsi, harga: uHarga });
    });

    if (ukuranError) {
        mtShowMsg('Harga pada setiap baris ukuran harus lebih dari 0.', 'error');
        return;
    }
    if (ukuran.length === 0) {
        mtShowMsg('Tambahkan minimal satu ukuran/porsi beserta harganya.', 'error');
        return;
    }

    const addon = [];
    document.querySelectorAll('#mtAddonList .mt-addon-row').forEach(row => {
        const aNama = row.querySelector('.mt-a-nama').value.trim();
        const aHarga = Number(row.querySelector('.mt-a-harga').value) || 0;
        if (aNama) addon.push({ nama: aNama, harga: aHarga });
    });

    const customList = await fetchCustomMenusFromSupabase();
    const lama = mtEditingId ? customList.find(x => String(x.id) === String(mtEditingId)) : null;

    const menuData = {
        ...(lama || {}),
        id: mtEditingId || ('custom-' + Date.now()),
        nama: nama,
        kategori: kategori,
        deskripsi: deskripsi,
        img: mtFotoData || (lama ? lama.img_url : DEFAULT_MENU_IMG),
        gratis: gratis,
        ukuran: ukuran,
        addon: addon
    };

    const btn = document.getElementById('btnSimpanMenuCustom');
    if (btn) btn.disabled = true;

    try {
        const ok = await saveCustomMenuToSupabase(menuData);
        if (ok) {
            const wasEdit = !!mtEditingId;
            mtResetForm();
            mtShowMsg(wasEdit ? 'Perubahan menu berhasil disimpan!' : 'Menu berhasil ditambahkan!', 'ok');
            await renderMenuTambahan();
        } else {
            const duplikat = /duplicate|unique/i.test(galatDbTerakhir) ? ' (nama menu sudah dipakai)' : '';
            mtShowMsg('Gagal menyimpan menu: ' + (galatDbTerakhir || 'periksa koneksi / login ulang') + duplikat, 'error');
        }
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function hapusMenuCustom(menuId) {
    if (!confirm("Apakah Anda yakin ingin menghapus menu ini?")) return;

    const ok = await deleteCustomMenuFromSupabase(menuId);
    if (ok) {
        if (String(mtEditingId) === String(menuId)) mtResetForm();
        mtShowMsg('Menu berhasil dihapus.', 'ok');
        await renderMenuTambahan();
    } else {
        mtShowMsg('Gagal menghapus menu: ' + (galatDbTerakhir || 'periksa koneksi / login ulang'), 'error');
    }
}

// ==========================================
// FITUR BUKA / TUTUP TOKO (HEADER)
// ==========================================
let tokoBuka = true;

async function muatStatusToko() {
    tokoBuka = (await getSetting('status_toko', 'buka')) !== 'tutup';
    updateUIStatusToko();
}

async function toggleStatusToko() {
    const statusBaru = tokoBuka ? 'tutup' : 'buka';
    try {
        await setSetting('status_toko', statusBaru);
        tokoBuka = statusBaru === 'buka';
        updateUIStatusToko();
    } catch (err) {
        alert('Gagal mengubah status toko: ' + (err.message || err));
    }
}

function updateUIStatusToko() {
    const btn = document.getElementById('btn-toggle-toko');
    if (!btn) return;

    if (tokoBuka) {
        btn.className = 'btn-toggle-stok ready';
        btn.innerHTML = '<span class="status-dot" aria-hidden="true"></span>TOKO BUKA';
    } else {
        btn.className = 'btn-toggle-stok empty';
        btn.innerHTML = '<span class="status-dot" aria-hidden="true"></span>TOKO TUTUP';
    }
}

// ==========================================
// 7. POS KASIR MANUAL & PESANAN
// ==========================================
let kasirCart = [];
let kasirSelectedMenu = null;
let kasirActiveSize = null;
let kasirActiveAddons = [];

async function bukaModalKasirOrder() {
    kasirCart = [];
    Object.keys(kasirBakpaoQtyMap).forEach(v => { kasirBakpaoQtyMap[v] = 0; });
    const namaInp = document.getElementById('kasirNamaPelanggan');
    const uangInp = document.getElementById('kasirUangDiterima');
    const kembalianTxt = document.getElementById('kasirKembalianTxt');
    const msgEl = document.getElementById('kasirMsg');

    if (namaInp) namaInp.value = '';
    if (uangInp) uangInp.value = '';
    if (kembalianTxt) kembalianTxt.style.display = 'none';
    if (msgEl) msgEl.className = 'mt-msg';
    
    await isiDropdownMenuKasirInteractive();
    renderKasirCartList();
    onChangeKasirMetodeBayar();

    const modal = document.getElementById('modalKasirOrder');
    if (modal) modal.style.display = 'flex';
}

function tutupModalKasirOrder() {
    const modal = document.getElementById('modalKasirOrder');
    if (modal) modal.style.display = 'none';
}

const masterMenuStruktur = [
    {
        id: 'mentai-ori', nama: 'Mentai Ori', kategori: 'Dimsum Mentai',
        ukuran: [
            { nama: 'S', porsi: '3 pcs', harga: 13000 },
            { nama: 'M', porsi: '6 pcs', harga: 23000 },
            { nama: 'XL', porsi: '16 pcs', harga: 60000 }
        ],
        addon: [ { nama: 'Extra Mentai', harga: 3000 }, { nama: 'Chilli Oil tambahan', harga: 3000 } ]
    },
    {
        id: 'mentai-cheese', nama: 'Mentai Cheese', kategori: 'Dimsum Mentai',
        ukuran: [
            { nama: 'S', porsi: '3 pcs', harga: 15000 },
            { nama: 'M', porsi: '6 pcs', harga: 26000 },
            { nama: 'XL', porsi: '16 pcs', harga: 67000 }
        ],
        addon: [ { nama: 'Extra Mentai', harga: 3000 }, { nama: 'Chilli Oil tambahan', harga: 3000 } ]
    },
    {
        id: 'mentai-tanuki', nama: 'Mentai Tanuki', kategori: 'Dimsum Mentai',
        ukuran: [
            { nama: 'S', porsi: '3 pcs', harga: 15000 },
            { nama: 'M', porsi: '6 pcs', harga: 26000 },
            { nama: 'XL', porsi: '16 pcs', harga: 67000 }
        ],
        addon: [ { nama: 'Extra Mentai', harga: 3000 }, { nama: 'Chilli Oil tambahan', harga: 3000 } ]
    },
    {
        id: 'mentai-mix', nama: 'Mentai Mix', kategori: 'Dimsum Mentai',
        ukuran: [
            { nama: 'M', porsi: '6 pcs', harga: 26000 },
            { nama: 'XL', porsi: '16 pcs', harga: 67000 }
        ],
        addon: [ { nama: 'Extra Mentai', harga: 3000 }, { nama: 'Chilli Oil tambahan', harga: 3000 } ]
    },
    {
        id: 'dimsum-aja', nama: 'Dimsum aja', kategori: 'Dimsum aja',
        ukuran: [
            { nama: 'S', porsi: '3 pcs', harga: 10000 },
            { nama: 'M', porsi: '6 pcs', harga: 18000 },
            { nama: 'XL', porsi: '16 pcs', harga: 47000 }
        ],
        addon: [ { nama: 'Chilli Oil tambahan', harga: 3000 } ]
    },
    {
        id: 'bakpao', nama: 'Bakpao', kategori: 'Bakpao',
        ukuran: [
            { nama: '1 pcs', porsi: '1 pcs', harga: 7000 },
            { nama: '3 pcs', porsi: '3 pcs', harga: 20000 },
            { nama: '6 pcs', porsi: '6 pcs', harga: 36000 }
        ],
        addon: []
    }
];

async function isiDropdownMenuKasirInteractive() {
    const select = document.getElementById('kasirPilihMenu');
    if (!select) return;

    let semuaMenu = [...masterMenuStruktur];
    const customList = await fetchCustomMenusFromSupabase();
    
    customList.forEach(c => {
        if (!c.habis) {
            semuaMenu.push({
                id: c.id,
                nama: c.nama,
                kategori: c.kategori || 'Custom',
                ukuran: Array.isArray(c.ukuran) && c.ukuran.length > 0 ? c.ukuran : [{ nama: 'Reguler', porsi: '1 porsi', harga: c.harga || 10000 }],
                addon: Array.isArray(c.addon) ? c.addon : []
            });
        }
    });

    select.dataset.menuCollection = JSON.stringify(semuaMenu);
    select.innerHTML = semuaMenu.map((m, idx) => `<option value="${idx}">${escHtml(m.nama)}</option>`).join('');

    onKasirMenuChange();
}

function onKasirMenuChange() {
    const select = document.getElementById('kasirPilihMenu');
    if (!select || !select.dataset.menuCollection) return;

    const collection = JSON.parse(select.dataset.menuCollection);
    kasirSelectedMenu = collection[select.value];
    if (!kasirSelectedMenu) return;

    const ukuranContainer = document.getElementById('kasirUkuranContainer');
    const addonContainer = document.getElementById('kasirAddonContainer');

    if (kasirSelectedMenu.id === 'bakpao') {
        kasirActiveSize = { nama: 'Paket Bakpao', porsi: 'custom', harga: 0 };
        
        const varianBakpao = ['Salted Egg', 'Kacang Tanah', 'Ayam Casio', 'Coklat Lumer', 'Keju Susu'];
        
        ukuranContainer.innerHTML = `
            <div style="width: 100%; display: flex; flex-direction: column; gap: 6px;">
                <span style="font-size: 11px; color: var(--text-muted);">Atur jumlah tiap varian bakpao:</span>
                <div id="bakpaoVariantList" style="display: flex; flex-direction: column; gap: 6px; margin-top: 4px;">
                    ${varianBakpao.map(v => `
                        <div class="bakpao-var-row" data-varian="${escHtml(v)}" style="display: flex; justify-content: space-between; align-items: center; background: #F8FAFC; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--border-line);">
                            <span style="font-size: 13.5px; font-weight: 700;">${escHtml(v)}</span>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <button type="button" class="mt-btn-x" aria-label="Kurangi ${escHtml(v)}" data-varian="${escHtml(v)}" onclick="ubahQtyBakpaoKasir(this.dataset.varian, -1)">-</button>
                                <span class="bakpao-qty-val" id="b_qty_${escHtml(v)}" style="font-weight: 800; min-width: 20px; text-align: center;">0</span>
                                <button type="button" class="mt-btn-x" aria-label="Tambah ${escHtml(v)}" data-varian="${escHtml(v)}" style="background: var(--red-tint); color: #BE123C;" onclick="ubahQtyBakpaoKasir(this.dataset.varian, 1)">+</button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        
        addonContainer.innerHTML = `<span style="font-size: 11px; color: var(--text-muted);">Tidak ada tambahan opsional untuk bakpao.</span>`;
        kasirActiveAddons = [];
        return;
    }

    if (kasirSelectedMenu.ukuran && kasirSelectedMenu.ukuran.length > 0) {
        kasirActiveSize = kasirSelectedMenu.ukuran[0];
        ukuranContainer.innerHTML = kasirSelectedMenu.ukuran.map((u, idx) => `
            <button type="button" class="btn-outline-merchant size-chip ${idx === 0 ? 'active-chip' : ''}" data-ukuran="${escHtml(u.nama)}"
                onclick="pilihUkuranKasir(this.dataset.ukuran)" style="flex: 1; padding: 8px; font-size: 0.8rem;${idx === 0 ? ' border-color: var(--primary-red); background: var(--red-tint);' : ''}">
                <b>${escHtml(u.nama)}</b><br><small>${escHtml(u.porsi || '')} Rp${Number(u.harga).toLocaleString('id-ID')}</small>
            </button>
        `).join('');
    } else {
        kasirActiveSize = { nama: 'Reguler', porsi: '1 porsi', harga: 0 };
        ukuranContainer.innerHTML = `<span style="font-size:12px; color:var(--text-muted);">Tidak ada pilihan ukuran.</span>`;
    }

    if (kasirSelectedMenu.addon && kasirSelectedMenu.addon.length > 0) {
        kasirActiveAddons = [];
        addonContainer.innerHTML = kasirSelectedMenu.addon.map((a, idx) => `
            <label style="display: flex; justify-content: space-between; align-items: center; background: #F8FAFC; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border-line); font-size: 0.85rem; cursor: pointer;">
                <span>${escHtml(a.name || a.nama)} (<span class="kasir-addon-harga" data-idx="${idx}">+Rp${Number(a.harga).toLocaleString('id-ID')}</span>)</span>
                <input type="checkbox" class="kasir-addon-checkbox" value="${idx}" onchange="updateKasirAddonSelection()">
            </label>
        `).join('');
        refreshLabelHargaAddonKasir();
    } else {
        addonContainer.innerHTML = `<span style="font-size: 11px; color: var(--text-muted);">Tidak ada tambahan opsional untuk menu ini.</span>`;
    }
}

let kasirBakpaoQtyMap = { 'Salted Egg': 0, 'Kacang Tanah': 0, 'Ayam Casio': 0, 'Coklat Lumer': 0, 'Keju Susu': 0 };

function ubahQtyBakpaoKasir(varian, delta) {
    const totalSekarang = Object.values(kasirBakpaoQtyMap).reduce((s, v) => s + (v || 0), 0);
    if (delta > 0 && totalSekarang >= 99) return;
    kasirBakpaoQtyMap[varian] = Math.max(0, (kasirBakpaoQtyMap[varian] || 0) + delta);
    const el = document.getElementById(`b_qty_${varian}`);
    if (el) el.innerText = kasirBakpaoQtyMap[varian];
}

function hitungHargaBakpaoKasir(totalPcs) {
    const PACKS = [{ pcs: 6, price: 36000 }, { pcs: 3, price: 20000 }, { pcs: 1, price: 7000 }];
    const cost = [0];
    for (let i = 1; i <= totalPcs; i++) {
        cost[i] = Infinity;
        PACKS.forEach(p => {
            if (i >= p.pcs && cost[i - p.pcs] + p.price < cost[i]) {
                cost[i] = cost[i - p.pcs] + p.price;
            }
        });
    }
    return cost[totalPcs] || (totalPcs * 7000);
}

function pilihUkuranKasir(namaUkuran) {
    if (!kasirSelectedMenu) return;
    kasirActiveSize = kasirSelectedMenu.ukuran.find(u => u.nama === namaUkuran);
    updateKasirAddonSelection();

    document.querySelectorAll('.size-chip').forEach(btn => {
        if (btn.dataset.ukuran === namaUkuran) {
            btn.style.borderColor = 'var(--primary-red)';
            btn.style.background = 'var(--red-tint)';
        } else {
            btn.style.borderColor = 'var(--border-line)';
            btn.style.background = '#FFF';
        }
    });
}

// Extra Mentai: M = Rp3.000, XL = Rp5.000, tidak tersedia untuk ukuran S
function hargaAddonKasir(addonObj, ukuran) {
    const nama = addonObj.name || addonObj.nama || '';
    const namaUkuran = ukuran ? String(ukuran.nama).trim().toUpperCase() : '';
    if (/extra mentai/i.test(nama) && namaUkuran === 'XL') return 5000;
    return Number(addonObj.harga) || 0;
}

function updateKasirAddonSelection() {
    kasirActiveAddons = [];
    if (!kasirSelectedMenu || !kasirSelectedMenu.addon) return;
    document.querySelectorAll('.kasir-addon-checkbox:checked').forEach(cb => {
        const addonObj = kasirSelectedMenu.addon[cb.value];
        if (addonObj) {
            kasirActiveAddons.push({
                nama: addonObj.name || addonObj.nama,
                harga: hargaAddonKasir(addonObj, kasirActiveSize)
            });
        }
    });
    refreshLabelHargaAddonKasir();
}

function refreshLabelHargaAddonKasir() {
    if (!kasirSelectedMenu || !kasirSelectedMenu.addon) return;
    const isSizeS = kasirActiveSize && String(kasirActiveSize.nama).trim().toUpperCase() === 'S';
    document.querySelectorAll('.kasir-addon-checkbox').forEach(cb => {
        const addonObj = kasirSelectedMenu.addon[cb.value];
        if (!addonObj) return;
        const isExtraMentai = /extra mentai/i.test(addonObj.name || addonObj.nama || '');
        const label = cb.closest('label');
        if (isExtraMentai && isSizeS) {
            cb.checked = false;
            cb.disabled = true;
            if (label) label.style.opacity = '0.45';
        } else {
            cb.disabled = false;
            if (label) label.style.opacity = '';
        }
    });
    document.querySelectorAll('.kasir-addon-harga').forEach(el => {
        const addonObj = kasirSelectedMenu.addon[el.dataset.idx];
        if (addonObj) el.textContent = '+Rp' + hargaAddonKasir(addonObj, kasirActiveSize).toLocaleString('id-ID');
    });
}

function tambahItemKeKasirCartCustom() {
    if (!kasirSelectedMenu) return;

    if (kasirSelectedMenu.id === 'bakpao') {
        const pickedVarians = Object.keys(kasirBakpaoQtyMap).filter(v => kasirBakpaoQtyMap[v] > 0);
        const totalPcs = pickedVarians.reduce((sum, v) => sum + kasirBakpaoQtyMap[v], 0);

        if (totalPcs === 0) {
            alert('Pilih minimal 1 pcs bakpao!');
            return;
        }

        const hargaTotalBakpao = hitungHargaBakpaoKasir(totalPcs);
        const varianDetail = pickedVarians.map(v => `${kasirBakpaoQtyMap[v]}x ${v}`).join(', ');
        const rawQty = parseInt(document.getElementById('kasirQtyItem').value, 10);
        if (isNaN(rawQty) || rawQty < 1 || rawQty > 99) {
            alert('Jumlah porsi harus antara 1 sampai 99!');
            return;
        }
        const qtyPorsi = rawQty;

        const subtotalFinal = hargaTotalBakpao * qtyPorsi;
        const varianFinal = `${totalPcs} pcs: ${varianDetail}`;

        kasirCart.push({
            namaMenu: 'Bakpao',
            namaItemDb: 'Bakpao',
            varian: varianFinal,
            hargaSatuan: hargaTotalBakpao,
            qty: qtyPorsi,
            subtotal: subtotalFinal
        });

        Object.keys(kasirBakpaoQtyMap).forEach(v => {
            kasirBakpaoQtyMap[v] = 0;
            const el = document.getElementById(`b_qty_${v}`);
            if (el) el.innerText = '0';
        });
        document.getElementById('kasirQtyItem').value = 1;
        renderKasirCartList();
        return;
    }

    if (!kasirActiveSize) return;

    updateKasirAddonSelection();
    if (String(kasirActiveSize.nama).trim().toUpperCase() === 'S' && kasirActiveAddons.some(a => /extra mentai/i.test(a.nama))) {
        alert('Extra Mentai hanya tersedia untuk ukuran M dan XL.');
        return;
    }

    const rawQtyReg = parseInt(document.getElementById('kasirQtyItem').value, 10);
    if (isNaN(rawQtyReg) || rawQtyReg < 1 || rawQtyReg > 99) {
        alert('Jumlah porsi harus antara 1 sampai 99!');
        return;
    }
    const qty = rawQtyReg;
    let hargaSatuan = Number(kasirActiveSize.harga) || 0;
    
    let addonTextDetail = '';
    let totalAddonHarga = 0;
    if (kasirActiveAddons.length > 0) {
        const addonNames = kasirActiveAddons.map(a => a.nama);
        totalAddonHarga = kasirActiveAddons.reduce((sum, a) => sum + a.harga, 0);
        addonTextDetail = ` + ${addonNames.join(', ')}`;
    }

    const hargaTotalPerItem = (hargaSatuan + totalAddonHarga) * qty;
    const varianFinal = `${kasirActiveSize.nama} (${kasirActiveSize.porsi || '1 porsi'})${addonTextDetail}`;

    const existingIdx = kasirCart.findIndex(i => i.namaMenu === kasirSelectedMenu.nama && i.varian === varianFinal);
    if (existingIdx > -1) {
        if (kasirCart[existingIdx].qty + qty > 99) {
            alert('Maksimal 99 porsi per item pesanan.');
            return;
        }
        kasirCart[existingIdx].qty += qty;
        kasirCart[existingIdx].subtotal += hargaTotalPerItem;
    } else {
        kasirCart.push({
            namaMenu: kasirSelectedMenu.nama,
            namaItemDb: kasirSelectedMenu.nama,
            varian: varianFinal,
            hargaSatuan: hargaSatuan + totalAddonHarga,
            qty: qty,
            subtotal: hargaTotalPerItem
        });
    }

    document.getElementById('kasirQtyItem').value = 1;
    // reset pilihan tambahan agar tidak terbawa ke item berikutnya
    document.querySelectorAll('.kasir-addon-checkbox').forEach(cb => { cb.checked = false; });
    kasirActiveAddons = [];
    refreshLabelHargaAddonKasir();
    renderKasirCartList();
}

function hapusKasirCartItem(index) {
    kasirCart.splice(index, 1);
    renderKasirCartList();
}

function renderKasirCartList() {
    const container = document.getElementById('kasirCartList');
    const totalTxt = document.getElementById('kasirTotalHargaTxt');
    if (!container) return;

    if (kasirCart.length === 0) {
        container.innerHTML = `<li style="font-size:0.8rem; color:var(--text-muted); text-align:center; padding:8px;">Belum ada item dipilih.</li>`;
        if (totalTxt) totalTxt.innerText = 'Rp0';
        return;
    }

    let grandTotal = 0;
    container.innerHTML = kasirCart.map((item, idx) => {
        grandTotal += item.subtotal;
        return `
            <li class="order-item-row" style="align-items:center;">
                <div>
                    <b>${item.qty}x</b> ${escHtml(item.namaMenu)} <small style="color:var(--text-muted);">(${escHtml(item.varian)})</small>
                    <div style="font-size:0.75rem; color:var(--text-muted);">Rp${item.hargaSatuan.toLocaleString('id-ID')} / porsi</div>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <b>Rp${item.subtotal.toLocaleString('id-ID')}</b>
                    <button type="button" class="mt-btn-x" onclick="hapusKasirCartItem(${idx})">✕</button>
                </div>
            </li>
        `;
    }).join('');

    if (totalTxt) totalTxt.innerText = `Rp${grandTotal.toLocaleString('id-ID')}`;
    hitungKembalianKasirDirect();
}

function onChangeKasirMetodeBayar() {
    const metode = document.getElementById('kasirMetodeBayar').value;
    const boxTunai = document.getElementById('kasirBoxTunai');
    if (boxTunai) {
        boxTunai.style.display = metode === 'TUNAI' ? 'block' : 'none';
    }
}

function hitungKembalianKasirDirect() {
    const totalTagihan = kasirCart.reduce((sum, i) => sum + i.subtotal, 0);
    const valTunai = Number(document.getElementById('kasirUangDiterima').value) || 0;
    const boxKembalian = document.getElementById('kasirKembalianTxt');

    if (!boxKembalian) return;

    if (valTunai >= totalTagihan && totalTagihan > 0) {
        boxKembalian.style.display = 'block';
        boxKembalian.style.color = 'var(--green-text)';
        boxKembalian.innerText = `Kembalian: Rp${(valTunai - totalTagihan).toLocaleString('id-ID')}`;
    } else if (valTunai > 0 && valTunai < totalTagihan) {
        boxKembalian.style.display = 'block';
        boxKembalian.style.color = 'var(--primary-red)';
        boxKembalian.innerText = `Kurang: Rp${(totalTagihan - valTunai).toLocaleString('id-ID')}`;
    } else {
        boxKembalian.style.display = 'none';
    }
}

async function prosesSimpanPesananKasir() {
    const msgBox = document.getElementById('kasirMsg');
    const namaPelangganInput = document.getElementById('kasirNamaPelanggan').value.trim();
    const sumberPesanan = document.getElementById('kasirSumberPesanan').value;
    const metodeBayar = document.getElementById('kasirMetodeBayar').value;
    const totalHarga = kasirCart.reduce((sum, i) => sum + i.subtotal, 0);

    if (kasirCart.length === 0) {
        msgBox.textContent = 'Pilih minimal 1 item pesanan!';
        msgBox.className = 'mt-msg show error';
        return;
    }

    const namaPelanggan = namaPelangganInput || `${sumberPesanan}`;
    const tipePembayaranDb = metodeBayar.toUpperCase() === 'TUNAI' ? 'cash' : 'qris';
    const statusPembayaranDb = 'lunas';

    if (metodeBayar === 'TUNAI') {
        const valTunai = Number(document.getElementById('kasirUangDiterima').value) || 0;
        if (valTunai < totalHarga) {
            msgBox.textContent = 'Nominal pembayaran tunai masih kurang!';
            msgBox.className = 'mt-msg show error';
            return;
        }
    }

    const btnSimpan = document.getElementById('btnProsesKasirOrder');
    if (btnSimpan) btnSimpan.disabled = true;

    try {
        const namaFinal = namaPelangganInput ? `[${sumberPesanan}] ${namaPelangganInput}` : sumberPesanan;
        const itemsPayload = kasirCart.map(i => ({
            nama_item: i.namaItemDb,
            varian: i.varian,
            catatan: `POS Manual (${sumberPesanan})`,
            jumlah: i.qty,
            harga_satuan: i.hargaSatuan,
            subtotal: i.subtotal
        }));

        // 1 transaksi atomik: order + semua item (nomor antrean dibuat otomatis oleh database)
        const { data: hasil, error: rpcError } = await supabase.rpc('buat_pesanan', {
            p_nama: namaFinal,
            p_tipe: tipePembayaranDb,
            p_items: itemsPayload,
            p_status_bayar: statusPembayaranDb,
            p_status_pesanan: 'disiapkan'
        });
        if (rpcError) throw rpcError;
        if (!hasil || !hasil.id_order) throw new Error('Respon server tidak valid.');

        const idOrderFormatted = `ANT-${String(hasil.nomor_antrean).padStart(2, '0')}`;
        const itemsCetak = kasirCart.map(i => ({ qty: i.qty, nama: i.namaItemDb, varian: i.varian, hargaSatuan: i.hargaSatuan, totalHargaItem: i.subtotal }));

        tutupModalKasirOrder();
        kasirCart = [];

        const pesananBaruObjek = {
            db_id_order: hasil.id_order,
            idOrder: idOrderFormatted,
            namaPelanggan: namaFinal,
            metodeBayar: metodeBayar.toUpperCase(),
            totalHargaFormatted: `Rp${totalHarga.toLocaleString('id-ID')}`,
            tanggal: new Date().toLocaleDateString("id-ID"),
            waktu: new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }),
            items: itemsCetak
        };

        await renderCurrentSection(true);

        if (confirm(`Pesanan ${idOrderFormatted} berhasil disimpan & dikirim ke Dapur!\nApakah Anda ingin mencetak struk sekarang?`)) {
            cetakStrukLangsung(pesananBaruObjek);
        }

    } catch (err) {
        console.error("Gagal menyimpan pesanan POS manual ke Supabase:", err);
        let pesan = err.message || String(err);
        if (/buat_pesanan/i.test(pesan) && /(function|schema cache|not find)/i.test(pesan)) {
            pesan = 'Database belum diperbarui. Jalankan supabase/migration_perbaikan.sql di Supabase SQL Editor.';
        }
        msgBox.textContent = "Error: " + pesan;
        msgBox.className = 'mt-msg show error';
    } finally {
        if (btnSimpan) btnSimpan.disabled = false;
    }
}

// ==========================================
// EXPOSE FUNCTIONS TO WINDOW (Untuk Atribut onclick HTML)
// ==========================================
window.navigate = navigate;
window.toggleStatusToko = toggleStatusToko;
window.bukaModalKasirOrder = bukaModalKasirOrder;
window.tutupModalKasirOrder = tutupModalKasirOrder;
window.switchKitchenTab = switchKitchenTab;
window.resetFilterTanggal = resetFilterTanggal;
window.onKasirMenuChange = onKasirMenuChange;
window.pilihUkuranKasir = pilihUkuranKasir;
window.updateKasirAddonSelection = updateKasirAddonSelection;
window.tambahItemKeKasirCartCustom = tambahItemKeKasirCartCustom;
window.hapusKasirCartItem = hapusKasirCartItem;
window.onChangeKasirMetodeBayar = onChangeKasirMetodeBayar;
window.hitungKembalianKasirDirect = hitungKembalianKasirDirect;
window.prosesSimpanPesananKasir = prosesSimpanPesananKasir;
window.konfirmasiPembayaran = konfirmasiPembayaran;
window.tandaiSelesaiDapur = tandaiSelesaiDapur;
window.cetakStrukLangsungById = cetakStrukLangsungById;
window.toggleStokCustom = toggleStokCustom;
window.mulaiEditMenuCustom = mulaiEditMenuCustom;
window.hapusMenuCustom = hapusMenuCustom;
window.renderCurrentSection = renderCurrentSection;
window.handleLogout = handleLogout;
window.batalkanPesanan = batalkanPesanan;
window.toggleStokBawaan = toggleStokBawaan;
window.hapusQris = hapusQris;
window.ubahQtyBakpaoKasir = ubahQtyBakpaoKasir;
window.mtTambahUkuran = mtTambahUkuran;
window.mtTambahAddon = mtTambahAddon;
window.mtPilihFoto = mtPilihFoto;
window.mtOnKategoriChange = mtOnKategoriChange;
window.mtResetForm = mtResetForm;
window.handleSimpanMenuCustom = handleSimpanMenuCustom;