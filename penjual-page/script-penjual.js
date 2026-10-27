/**
 * File: penjual-page/script-penjual.js (Versi Integrasi Supabase & Class Diagram)
 * Deskripsi: Mengelola manajemen stok, verifikasi pembayaran, kitchen display, menu tambahan, dan POS kasir secara real-time menggunakan Supabase.
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Konfigurasi Klien Supabase (Sesuaikan dengan URL & Anon Key Proyek Anda)
const SUPABASE_URL = 'https://cdzoqbbywzdggawhkmik.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_aIwYjs2YGk7OXqtTQ52NTA_N_l6iSo5';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const QRIS_STORAGE_KEY = "sabangdor_custom_qris";
const DEFAULT_MENU_IMG = "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80";

const masterMenuSabangdor = [
    { id: 'mentai-cheese', nama: 'Mentai Cheese', harga: 15000, status: 'tersedia', img: DEFAULT_MENU_IMG },
    { id: 'mentai-tanuki', nama: 'Mentai Tanuki', harga: 15000, status: 'tersedia', img: DEFAULT_MENU_IMG },
    { id: 'mentai-ori', nama: 'Mentai Ori', harga: 13000, status: 'tersedia', img: DEFAULT_MENU_IMG },
    { id: 'mentai-mix', nama: 'Mentai Mix', harga: 26000, status: 'tersedia', img: DEFAULT_MENU_IMG },
    { id: 'dimsum-aja', nama: 'Dimsum aja', harga: 26000, status: 'tersedia', img: DEFAULT_MENU_IMG },
    { id: 'bakpao', nama: 'Bakpao', harga: 26000, status: 'tersedia', img: DEFAULT_MENU_IMG }
];

let currentSec = 'dashboard';
let activeKanbanFilter = 'proses-masak';
let pesananSupabase = [];

// ==========================================
// AUTENTIKASI & INITIALIZATION
// ==========================================
function checkAuth() {
    const isLoggedIn = sessionStorage.getItem("sabangdor_logged_in") || localStorage.getItem('pegawai_session');
    if (!isLoggedIn) {
        window.location.href = '../login-pegawai.html';
    }
}

function handleLogout() {
    sessionStorage.removeItem("sabangdor_logged_in");
    sessionStorage.removeItem("sabangdor_user_email");
    localStorage.removeItem('pegawai_session');
    window.location.href = '../login-pegawai.html';
}

document.addEventListener('DOMContentLoaded', async () => {
    checkAuth();
    updateUIStatusToko();

    const firstTab = document.querySelectorAll('.tab-item')[0];
    navigate('dashboard', firstTab);

    // Auto-refresh data setiap 3 detik secara real-time
    setInterval(async () => {
        await checkAndRenderAuto();
    }, 3000);
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

async function saveCustomMenuToSupabase(menuData) {
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
        return false;
    }
}

async function fetchOrdersFromSupabase() {
    try {
        const { data, error } = await supabase
            .from('orders')
            .select(`*, order_items (*)`)
            .order('created_at', { ascending: false });

        if (error) throw error;

        return (data || []).map(o => ({
            db_id_order: o.id_order,
            idOrder: `ANT-${String(o.nomor_antrean).padStart(2, '0')}`,
            nomorAntrean: o.nomor_antrean,
            namaPelanggan: o.nama_pembeli,
            metodeBayar: o.tipe_pembayaran.toUpperCase(),
            totalHarga: Number(o.total_harga),
            totalHargaFormatted: `Rp${Number(o.total_harga).toLocaleString('id-ID')}`,
            statusPembayaranDb: o.status_pembayaran, // 'pending' | 'lunas' | 'batal'
            statusPesananDb: o.status_pesanan,       // 'menunggu' | 'disiapkan' | 'selesai'
            waktu: new Date(o.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
            tanggal: new Date(o.created_at).toLocaleDateString('id-ID'),
            items: (o.order_items || []).map(i => ({
                nama: i.nama_item,
                varian: i.varian,
                catatan: i.catatan,
                qty: i.jumlah,
                hargaSatuan: Number(i.harga_satuan),
                totalHargaItem: Number(i.subtotal)
            }))
        }));
    } catch (err) {
        console.error("Gagal ambil pesanan dari Supabase:", err);
        return [];
    }
}

async function checkAndRenderAuto() {
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'SELECT')) {
        return;
    }
    await renderCurrentSection();
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
    pesananSupabase = await fetchOrdersFromSupabase();

    let semuaPesanan = pesananSupabase;
    let riwayat = pesananSupabase.filter(p => p.statusPesananDb === 'selesai');

    let pendingPay = semuaPesanan.filter(p => p.statusPembayaranDb === 'pending').length;
    const badgeEl = document.getElementById('badge-notif-bayar');
    if (badgeEl) {
        if (pendingPay > 0) {
            badgeEl.style.display = 'inline-block';
            badgeEl.innerText = pendingPay;
        } else {
            badgeEl.style.display = 'none';
        }
    }

    if (currentSec === 'dashboard') await renderStokMenu();
    else if (currentSec === 'pembayaran') renderPembayaran(semuaPesanan, force);
    else if (currentSec === 'pantau') renderKitchenDisplay(semuaPesanan, riwayat);
    else if (currentSec === 'menu') await renderMenuTambahan();
    else if (currentSec === 'riwayat') renderRiwayat(riwayat);
}

// ==========================================
// 1. MANAJEMEN STOK & QRIS
// ==========================================
async function renderStokMenu() {
    const grid = document.getElementById('grid-stok-menu');
    if (!grid) return;

    let customQrisImg = localStorage.getItem(QRIS_STORAGE_KEY);

    let html = `
        <div class="card">
            <div class="card-title">📷 Setting QRIS Outlet</div>
            <div class="card-sub">Unggah gambar QRIS untuk halaman checkout pembeli</div>
            
            <div class="upload-wrapper">
                <button type="button" class="btn-upload-custom" onclick="document.getElementById('inputFileQris').click()">
                    ➕ Pilih Gambar QRIS
                </button>
                <input type="file" id="inputFileQris" accept="image/*" style="display:none;">
            </div>

            ${customQrisImg ? `
                <div class="qris-preview-container">
                    <span style="font-size:11px; font-weight:800; color:#10B981;">✓ Gambar QRIS Aktif</span><br>
                    <img src="${customQrisImg}" class="qris-preview-img" alt="QRIS Toko">
                </div>
            ` : ''}
        </div>
        <div class="card-title" style="margin-top:10px;">Daftar Stok Menu Custom & Tambahan (Supabase)</div>
    `;

    const customList = await fetchCustomMenusFromSupabase();
    if (customList.length === 0) {
        html += `<div class="empty-info">Belum ada menu custom terdaftar di database.</div>`;
    }

    customList.forEach(item => {
        const isHabis = !!item.habis;
        const imgUrl = item.img_url || DEFAULT_MENU_IMG;
        html += `
            <div class="stok-card">
                <div class="stok-left">
                    <img src="${escHtml(imgUrl)}" class="stok-thumb" alt="${escHtml(item.nama)}">
                    <span class="stok-name">${escHtml(item.nama)}</span>
                </div>
                <button class="btn-toggle-stok ${isHabis ? 'empty' : 'ready'}" data-id="${escHtml(item.id)}" onclick="toggleStokCustom(this.dataset.id)">
                    ${isHabis ? '🔴 HABIS' : '🟢 TERSEDIA'}
                </button>
            </div>
        `;
    });

    grid.innerHTML = html;

    const fileInput = document.getElementById("inputFileQris");
    if (fileInput) {
        fileInput.addEventListener("change", function (e) {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function (evt) {
                    localStorage.setItem(QRIS_STORAGE_KEY, evt.target.result);
                    renderStokMenu();
                };
                reader.readAsDataURL(file);
            }
        });
    }
}

async function toggleStokCustom(menuId) {
    const customList = await fetchCustomMenusFromSupabase();
    const m = customList.find(x => String(x.id) === String(menuId));
    if (!m) return;
    
    const statusHabisBaru = !m.habis;
    await saveCustomMenuToSupabase({ ...m, habis: statusHabisBaru });
    await renderStokMenu();
}

function getItemSubtotal(i) {
    if (i.totalHargaItem && !isNaN(i.totalHargaItem) && i.totalHargaItem > 0) return i.totalHargaItem;
    if (i.hargaSatuan && !isNaN(i.hargaSatuan) && i.hargaSatuan > 0) return i.hargaSatuan * (i.qty || 1);
    return 0;
}

// ==========================================
// 2. VERIFIKASI PEMBAYARAN
// ==========================================
function renderPembayaran(pesananList, force = false) {
    const container = document.getElementById('container-pembayaran');
    if (!container) return;

    let pending = pesananList.filter(p => p.statusPembayaranDb === 'pending');

    if (pending.length === 0) {
        container.innerHTML = `<div class="empty-info">Tidak ada pembayaran menunggu verifikasi.</div>`;
        return;
    }

    let html = '';
    pending.forEach((order) => {
        let itemList = order.items.map(i => {
            const itemHarga = getItemSubtotal(i);
            return `
                <li class="order-item-row">
                    <div><span><b>${i.qty || 1}x</b> ${i.nama}</span></div>
                    <b>Rp${itemHarga.toLocaleString('id-ID')}</b>
                </li>
            `;
        }).join('');

        const isTunais = order.metodeBayar === 'CASH' || order.metodeBayar === 'TUNAI';

        html += `
            <div class="order-card-merchant">
                <div class="order-head">
                    <span class="order-id-txt">#${order.idOrder} (${order.namaPelanggan})</span>
                    <span class="order-badge-pay ${isTunais ? 'tag-cash' : 'tag-qris'}">${order.metodeBayar}</span>
                </div>
                <div style="font-size:0.75rem; color:var(--text-muted);">
                    ${order.waktu} WIB | Total Tagihan: <b style="color:var(--primary-red); font-size:0.85rem;">${order.totalHargaFormatted}</b>
                </div>
                <ul class="order-item-list">${itemList}</ul>
                <div class="btn-group">
                    <button class="btn-primary-merchant" onclick="konfirmasiPembayaran(${order.db_id_order})">
                        ${isTunais ? 'Terima Tunai & Kirim Dapur' : 'Verifikasi QRIS & Kirim Dapur'}
                    </button>
                    <button class="btn-outline-merchant" onclick="cetakStrukLangsungById(${order.db_id_order})">🖨️ Struk</button>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

async function konfirmasiPembayaran(dbIdOrder) {
    try {
        const { error } = await supabase
            .from('orders')
            .update({ status_pembayaran: 'lunas' })
            .eq('id_order', dbIdOrder);

        if (error) throw error;
        await renderCurrentSection(true);
    } catch (err) {
        console.error("Gagal update status pembayaran ke Supabase:", err);
        alert("Gagal memverifikasi pembayaran.");
    }
}

// ==========================================
// 3. DISPLAY KITCHEN (DAPUR)
// ==========================================
function switchKitchenTab(type, evt) {
    activeKanbanFilter = type;
    document.querySelectorAll('.k-tab').forEach(b => b.classList.remove('active'));
    if (evt && evt.target) evt.target.classList.add('active');
    renderCurrentSection(true);
}

function renderKitchenDisplay(pesananList, riwayatList) {
    const container = document.getElementById('kanban-content-mobile');
    if (!container) return;

    let listProsesMasak = pesananList.filter(p => p.statusPembayaranDb === 'lunas' && p.statusPesananDb !== 'selesai');
    let listSelesai = pesananList.filter(p => p.statusPesananDb === 'selesai');

    const countProsesEl = document.getElementById('count-terkirim') || document.getElementById('count-proses-masak');
    const countSelesaiEl = document.getElementById('count-selesai');
    if (countProsesEl) countProsesEl.innerText = listProsesMasak.length;
    if (countSelesaiEl) countSelesaiEl.innerText = listSelesai.length;

    let filtered = activeKanbanFilter === 'proses-masak' ? listProsesMasak : listSelesai;

    if (filtered.length === 0) {
        container.innerHTML = `<div class="empty-info">Tidak ada pesanan dalam kategori ini.</div>`;
        return;
    }

    let html = '';
    filtered.forEach((order) => {
        let itemList = order.items ? order.items.map(i => `<li><b>${i.qty || 1}x ${i.nama}</b></li>`).join('') : '';

        html += `
            <div class="order-card-merchant">
                <div class="order-head">
                    <span class="order-id-txt">#${order.idOrder} (${order.namaPelanggan})</span>
                    <span style="font-size:0.75rem; color:var(--text-muted);">${order.waktu} WIB</span>
                </div>
                <ul class="order-item-list">${itemList}</ul>
        `;

        if (activeKanbanFilter === 'proses-masak') {
            html += `<button class="btn-primary-merchant" style="background:#3B82F6;" onclick="tandaiSelesaiDapur(${order.db_id_order})">Selesai & Sajikan</button></div>`;
        } else {
            html += `<p style="font-size:0.8rem; color:var(--green-text); font-weight:800;">Status: Selesai & Disajikan</p></div>`;
        }
    });

    container.innerHTML = html;
}

async function tandaiSelesaiDapur(dbIdOrder) {
    try {
        const { error } = await supabase
            .from('orders')
            .update({ status_pesanan: 'selesai' })
            .eq('id_order', dbIdOrder);

        if (error) throw error;
        await renderCurrentSection(true);
    } catch (err) {
        console.error("Gagal update status selesai ke Supabase:", err);
        alert("Gagal menyelesaikan pesanan.");
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

    let selectedDate = filterInput ? filterInput.value : '';
    let formattedSelectedDate = '';
    if (selectedDate) {
        const parts = selectedDate.split('-');
        if (parts.length === 3) {
            formattedSelectedDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
        }
    }

    let filteredList = riwayatList;
    if (formattedSelectedDate) {
        filteredList = riwayatList.filter(item => item.tanggal === formattedSelectedDate);
    }

    let totalOmzet = filteredList.reduce((sum, item) => sum + (item.totalHarga || 0), 0);

    if (banner) {
        let labelOmzet = formattedSelectedDate ? `Omzet Tanggal ${formattedSelectedDate}` : 'Total Omzet Keseluruhan';
        banner.innerHTML = `
            <div class="omzet-banner">
                <p>${labelOmzet}</p>
                <h2>Rp${totalOmzet.toLocaleString('id-ID')}</h2>
            </div>
        `;
    }

    if (filteredList.length === 0) {
        container.innerHTML = `<div class="empty-info">Tidak ada riwayat transaksi pada tanggal ini.</div>`;
        return;
    }

    let html = '';
    filteredList.forEach((item) => {
        html += `
            <div class="order-card-merchant" style="flex-direction:row; justify-content:space-between; align-items:center;">
                <div>
                    <div style="font-weight:800; font-size:0.85rem;">#${item.idOrder} (${item.namaPelanggan} - ${item.metodeBayar})</div>
                    <div style="font-size:0.75rem; color:var(--text-muted);">${item.tanggal} ${item.waktu} WIB</div>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <b style="color:var(--green-text); font-size:0.85rem;">${item.totalHargaFormatted}</b>
                    <button class="btn-outline-merchant" style="padding:6px 10px; font-size:0.75rem;" onclick="cetakStrukLangsungById(${item.db_id_order})">🖨️</button>
                </div>
            </div>
        `;
    });
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
            <td style="padding:2px 0;">${i.qty}x ${i.nama}</td>
            <td style="text-align:right; vertical-align:top;">Rp${getItemSubtotal(i).toLocaleString('id-ID')}</td>
        </tr>
    `).join('');

    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Struk #${order.idOrder}</title>
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
                <div>No: <strong>#${order.idOrder}</strong></div>
                <div>Nama: ${order.namaPelanggan}</div>
                <div>Tgl: ${order.tanggal || new Date().toLocaleDateString('id-ID')} ${order.waktu}</div>
                <div>Bayar: ${order.metodeBayar}</div>
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
                <span>${order.totalHargaFormatted}</span>
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

function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function rupiah(n) {
    return "Rp" + Math.round(n).toLocaleString("id-ID");
}

function hargaMulai(item) {
    const ukuran = Array.isArray(item.ukuran) ? item.ukuran : [];
    if (!ukuran.length) return item.harga || 0;
    return Math.min(...ukuran.map(u => Number(u.harga) || 0));
}

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
        + `<option value="${MT_KATEGORI_BARU}">➕ Kategori baru…</option>`;
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
    if (title) title.textContent = '➕ Tambah Menu Baru';
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
                <div class="card-title" id="mtFormTitle">➕ Tambah Menu Baru</div>
                <div class="card-sub">Menu langsung tampil di halaman pembeli lengkap dengan detail menunya</div>

                <form id="formTambahMenuCustom" onsubmit="handleSimpanMenuCustom(event)" novalidate>
                    <div class="mt-field">
                        <label>Foto menu</label>
                        <div class="mt-photo">
                            <img id="mtFotoPreview" src="${DEFAULT_MENU_IMG}" alt="Foto menu">
                            <div>
                                <button type="button" class="btn-upload-custom" onclick="document.getElementById('mtFotoInput').click()">📷 Pilih Foto</button>
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
        const imgSrc = item.img_url || DEFAULT_MENU_IMG;
        const idAttr = escHtml(item.id);
        return `
            <div class="stok-card" style="margin-top:10px;">
                <div class="stok-left">
                    <img src="${escHtml(imgSrc)}" class="stok-thumb" alt="${escHtml(item.nama)}">
                    <div class="mt-info">
                        <div class="stok-name"><b>${escHtml(item.nama)}</b></div>
                        <div class="mt-meta">${escHtml(item.kategori || 'Umum')} • mulai ${rupiah(hargaMin)}${infoUkuran}${infoAddon}</div>
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

    document.getElementById('mtFormTitle').textContent = '✏️ Edit Menu';
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
        mtShowMsg('Gagal menghapus menu dari penyimpanan.', 'error');
    }
}

// ==========================================
// FITUR BUKA / TUTUP TOKO (HEADER)
// ==========================================
function cekStatusTokoAktif() {
    return localStorage.getItem('sabangdor_status_toko') !== 'tutup';
}

function toggleStatusToko() {
    const sedangBuka = cekStatusTokoAktif();
    const statusBaru = sedangBuka ? 'tutup' : 'buka';
    
    localStorage.setItem('sabangdor_status_toko', statusBaru);
    updateUIStatusToko();
}

function updateUIStatusToko() {
    const btn = document.getElementById('btn-toggle-toko');
    if (!btn) return;

    const bimbinganBuka = cekStatusTokoAktif();

    if (bimbinganBuka) {
        btn.className = 'btn-toggle-stok ready';
        btn.innerText = '🟢 TOKO BUKA';
    } else {
        btn.className = 'btn-toggle-stok empty';
        btn.innerText = '🔴 TOKO TUTUP';
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
    select.innerHTML = semuaMenu.map((m, idx) => `<option value="${idx}">${m.nama}</option>`).join('');

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
                        <div class="bakpao-var-row" data-varian="${v}" style="display: flex; justify-content: space-between; align-items: center; background: #F8FAFC; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--border-line);">
                            <span style="font-size: 0.85rem; font-weight: 700;">${v}</span>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <button type="button" class="mt-btn-x" onclick="ubahQtyBakpaoKasir('${v}', -1)">-</button>
                                <span class="bakpao-qty-val" id="b_qty_${v}" style="font-weight: 800; min-width: 20px; text-align: center;">0</span>
                                <button type="button" class="mt-btn-x" style="background: var(--red-tint); color: var(--primary-red);" onclick="ubahQtyBakpaoKasir('${v}', 1)">+</button>
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
            <button type="button" class="btn-outline-merchant size-chip ${idx === 0 ? 'active-chip' : ''}" 
                onclick="pilihUkuranKasir('${u.nama}')" style="flex: 1; padding: 8px; font-size: 0.8rem;">
                <b>${u.nama}</b><br><small>${u.porsi || ''} Rp${Number(u.harga).toLocaleString('id-ID')}</small>
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
                <span>${a.name || a.nama} (+Rp${Number(a.harga).toLocaleString('id-ID')})</span>
                <input type="checkbox" class="kasir-addon-checkbox" value="${idx}" onchange="updateKasirAddonSelection()">
            </label>
        `).join('');
    } else {
        addonContainer.innerHTML = `<span style="font-size: 11px; color: var(--text-muted);">Tidak ada tambahan opsional untuk menu ini.</span>`;
    }
}

let kasirBakpaoQtyMap = { 'Salted Egg': 0, 'Kacang Tanah': 0, 'Ayam Casio': 0, 'Coklat Lumer': 0, 'Keju Susu': 0 };

function ubahQtyBakpaoKasir(varian, delta) {
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

    document.querySelectorAll('.size-chip').forEach(btn => {
        if (btn.innerText.includes(namaUkuran)) {
            btn.style.borderColor = 'var(--primary-red)';
            btn.style.background = 'var(--red-tint)';
        } else {
            btn.style.borderColor = 'var(--border-line)';
            btn.style.background = '#FFF';
        }
    });
}

function updateKasirAddonSelection() {
    kasirActiveAddons = [];
    document.querySelectorAll('.kasir-addon-checkbox:checked').forEach(cb => {
        const addonObj = kasirSelectedMenu.addon[cb.value];
        if (addonObj) {
            kasirActiveAddons.push({
                nama: addonObj.name || addonObj.nama,
                harga: Number(addonObj.harga) || 0
            });
        }
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
        const qtyPorsi = parseInt(document.getElementById('kasirQtyItem').value, 10) || 1;

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

    const qty = parseInt(document.getElementById('kasirQtyItem').value, 10) || 1;
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
                    <b>${item.qty}x</b> ${item.namaMenu} <small style="color:var(--text-muted);">(${item.varian})</small>
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
        const { data: nomorAntrean, error: qError } = await supabase.rpc('generate_daily_queue_number');
        if (qError) throw qError;

        const antreanFinal = nomorAntrean || 1;
        const idOrderFormatted = `ANT-${String(antreanFinal).padStart(2, '0')}`;

        const { data: insertedOrder, error: orderError } = await supabase
            .from('orders')
            .insert([{
                nomor_antrean: antreanFinal,
                nama_pembeli: `[${sumberPesanan}] ${namaPelanggan}`,
                tipe_pembayaran: tipePembayaranDb,
                status_pembayaran: statusPembayaranDb,
                status_pesanan: 'disiapkan',
                total_harga: totalHarga
            }])
            .select()
            .single();

        if (orderError) throw orderError;
        const orderId = insertedOrder.id_order;

        const orderItemsPayload = kasirCart.map(i => ({
            id_order: orderId,
            jumlah: i.qty,
            nama_item: i.namaItemDb,
            varian: i.varian,
            catatan: `POS Manual (${sumberPesanan})`,
            harga_satuan: i.hargaSatuan,
            subtotal: i.subtotal
        }));

        const { error: itemsError } = await supabase
            .from('order_items')
            .insert(orderItemsPayload);

        if (itemsError) throw itemsError;

        tutupModalKasirOrder();
        await renderCurrentSection(true);

        const pesananBaruObjek = {
            db_id_order: orderId,
            idOrder: idOrderFormatted,
            namaPelanggan: `[${sumberPesanan}] ${namaPelanggan}`,
            metodeBayar: metodeBayar.toUpperCase(),
            totalHargaFormatted: `Rp${totalHarga.toLocaleString('id-ID')}`,
            tanggal: new Date().toLocaleDateString("id-ID"),
            waktu: new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }),
            items: kasirCart.map(i => ({ qty: i.qty, nama: i.namaItemDb, varian: i.varian, hargaSatuan: i.hargaSatuan, subtotal: i.subtotal }))
        };

        if (confirm("Pesanan berhasil disimpan & dikirim ke Dapur!\nApakah Anda ingin mencetak struk sekarang?")) {
            cetakStrukLangsung(pesananBaruObjek);
        }

    } catch (err) {
        console.error("Gagal menyimpan pesanan POS manual ke Supabase:", err);
        msgBox.textContent = "Error: " + err.message;
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
window.ubahQtyBakpaoKasir = ubahQtyBakpaoKasir;