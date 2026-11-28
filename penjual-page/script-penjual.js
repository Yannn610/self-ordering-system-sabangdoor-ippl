/**
 * File: penjual-page/script-penjual.js
 * Dashboard Operasional Sabangdor (Rilis 1 s.d. Rilis 5):
 * - PB-024, PB-025, PB-029, PB-030, PB-031, PB-039: Validasi menu ketat & pesan galat ID
 * - PB-041: Status pesanan 3 tahap dapur (disiapkan -> siap -> selesai)
 * - PB-042: Supabase Realtime dengan fallback otomatis ke polling 3 detik
 * - PB-043: Notifikasi suara (Web Audio) & badge jumlah pesanan baru
 * - PB-045: Peran terpisah (pemilik / pegawai, kasir, dapur)
 * - PB-046: Retur / pembatalan pesanan setelah lunas dengan alasan & nominal pengembalian
 * - PB-047 & PB-048: Kelola menu bawaan + custom & urutan kategori dari dashboard
 * - PB-049 & PB-063: Stok harian otomatis & peringatan stok menipis
 * - PB-052..PB-076: Integrasi Laporan/Grafik/Ekspor, Shift, Jadwal, Voucher, Loyalitas, Apriori/Bundling,
 *                   Ulasan, Kelola Pegawai & 2FA, Audit/Error Monitor, Printer Thermal, Mode Offline POS.
 */

import {
    getPrinterStatus,
    isAutoPrintEnabled,
    setAutoPrintEnabled,
    connectBluetoothPrinter,
    connectSerialPrinter,
    disconnectPrinter,
    printThermalOrFallback
} from './thermal-printer.js';

import {
    getOfflineQueue,
    enqueueOfflinePosOrder,
    syncOfflineQueue,
    isOnline
} from './offline-pos.js';

import {
    getDateRangeForPreset,
    computeSalesAnalytics,
    renderTrendChartSvg,
    renderPeakHoursSvg,
    exportReportToExcel,
    exportReportToPdf
} from './analytics-export.js';

import {
    renderKategoriManager,
    renderShiftPanel,
    renderJadwalPreorderPanel,
    renderVoucherLoyalPanel,
    renderAprioriBundlingPanel,
    renderUlasanPanel,
    renderPegawai2faPanel,
    renderAuditTelemetryPanel
} from './dashboard-admin.js';

const supabase = window.supabaseClient;
const DEFAULT_MENU_IMG = 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80';
const SOUND_PREF_KEY = 'sabangdor_staff_sound_on';
const ALLOWED_STAFF_ROLES = ['pegawai', 'pemilik', 'kasir', 'dapur'];

function escHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
    return 'Rp' + Math.round(Number(n) || 0).toLocaleString('id-ID');
}

function hargaMulai(item) {
    const ukuran = Array.isArray(item.ukuran) ? item.ukuran : [];
    const valid = ukuran.map(u => Number(u.harga) || 0).filter(h => h > 0);
    return valid.length ? Math.min(...valid) : (Number(item.harga) || 0);
}

function fmtErr(err, ctx) {
    return window.SabangdorErrors ? window.SabangdorErrors.formatError(err, ctx || 'general') : (err && err.message ? err.message : String(err));
}

let currentSec = 'dashboard';
let activeKanbanFilter = 'proses-masak';
let activeRiwayatSubtab = 'transaksi';
let activeKelolaSubtab = 'jadwal';
let reportPreset = 'minggu';
let reportStartCustom = '';
let reportEndCustom = '';

let currentStaffRole = 'pegawai';
let currentStaffUser = null;
let pesananSupabase = [];
let lastPendingCount = null;
let lastCookingCount = null;
let pollIntervalId = null;
let realtimeMode = 'polling';
let returTargetOrder = null;

const isPemilikRole = () => currentStaffRole === 'pemilik' || currentStaffRole === 'pegawai';
const isDapurOnly = () => currentStaffRole === 'dapur';

// ==========================================
// PB-043: NOTIFIKASI SUARA WEB AUDIO
// ==========================================
function isSoundOn() {
    return localStorage.getItem(SOUND_PREF_KEY) !== '0';
}

function updateSoundButtonUi() {
    const btn = document.getElementById('btnSoundToggle');
    if (!btn) return;
    const on = isSoundOn();
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? 'Suara: Aktif' : 'Suara: Mati';
}

function playNewOrderSound() {
    if (!isSoundOn()) return;
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        const now = ctx.currentTime;
        [587.33, 880].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + i * 0.14);
            gain.gain.setValueAtTime(0.001, now + i * 0.14);
            gain.gain.exponentialRampToValueAtTime(0.22, now + i * 0.14 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.14 + 0.32);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + i * 0.14);
            osc.stop(now + i * 0.14 + 0.34);
        });
    } catch (e) {}
}

function toggleNotifSuara() {
    const next = !isSoundOn();
    localStorage.setItem(SOUND_PREF_KEY, next ? '1' : '0');
    updateSoundButtonUi();
    if (next) playNewOrderSound();
}

// ==========================================
// AUTENTIKASI & RBAC PERAN (PB-045)
// ==========================================
function bersihkanSesiLokal() {
    sessionStorage.removeItem('sabangdor_logged_in');
    sessionStorage.removeItem('sabangdor_user_email');
    localStorage.removeItem('pegawai_session');
}

async function checkAuth() {
    try {
        if (supabase) {
            const { data } = await supabase.auth.getSession();
            if (data && data.session && data.session.user) {
                currentStaffUser = data.session.user;
                let profile = null;
                const resFull = await supabase
                    .from('profiles')
                    .select('role, username, is_active')
                    .eq('id', data.session.user.id)
                    .maybeSingle();

                if (resFull.error && /is_active/i.test(resFull.error.message || '')) {
                    const resLegacy = await supabase
                        .from('profiles')
                        .select('role, username')
                        .eq('id', data.session.user.id)
                        .maybeSingle();
                    profile = resLegacy.data;
                } else {
                    profile = resFull.data;
                }

                if (profile && ALLOWED_STAFF_ROLES.includes(String(profile.role || '')) && profile.is_active !== false) {
                    currentStaffRole = String(profile.role);
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

function terapkanHakAksesPeran() {
    const badge = document.getElementById('badgeStaffRole');
    if (badge) {
        badge.textContent = currentStaffRole.toUpperCase();
        badge.className = 'role-pill ' + (isPemilikRole() ? 'pill-green' : (isDapurOnly() ? 'pill-amber' : ''));
    }

    document.querySelectorAll('[data-role-hide]').forEach(el => {
        const hiddenRoles = String(el.dataset.roleHide || '').split(',').map(s => s.trim());
        el.style.display = hiddenRoles.includes(currentStaffRole) ? 'none' : '';
    });

    document.querySelectorAll('[data-role-only]').forEach(el => {
        const only = String(el.dataset.roleOnly || '').trim();
        if (only === 'pemilik' && !isPemilikRole()) {
            el.style.display = 'none';
        }
    });
}

async function handleLogout() {
    try { if (supabase) await supabase.auth.signOut(); } catch (e) {}
    bersihkanSesiLokal();
    window.location.href = '../login-pegawai.html';
}

// ==========================================
// PB-076: STATUS KONEKSI & SINKRONISASI OFFLINE POS
// ==========================================
function updateConnectionBadge() {
    const pill = document.getElementById('badgeConnectionState');
    const syncBtn = document.getElementById('btnSyncOffline');
    const qCnt = document.getElementById('offlineQueueCount');
    const queue = getOfflineQueue();
    const online = isOnline();

    if (pill) {
        pill.textContent = online ? 'Online' : 'Offline (POS Lokal)';
        pill.className = 'role-pill ' + (online ? 'pill-green' : 'pill-red');
    }
    if (syncBtn && qCnt) {
        qCnt.textContent = String(queue.length);
        syncBtn.style.display = queue.length > 0 ? 'inline-flex' : 'none';
    }
}

async function sinkronkanOfflineSekarang() {
    if (!isOnline()) {
        alert('Masih dalam mode offline. Pesanan akan otomatis tersinkron saat internet kembali.');
        return;
    }
    const res = await syncOfflineQueue(supabase);
    updateConnectionBadge();
    if (res.synced > 0) {
        await renderCurrentSection(true);
        alert(`${res.synced} pesanan offline berhasil disinkronkan ke server tanpa duplikasi.`);
    }
}

// ==========================================
// PB-042: SUPABASE REALTIME + FALLBACK POLLING
// ==========================================
function setRealtimeUi(mode) {
    realtimeMode = mode;
    const pill = document.getElementById('badgeRealtimeState');
    if (!pill) return;
    if (mode === 'realtime') {
        pill.textContent = 'Live Realtime';
        pill.className = 'role-pill pill-green';
    } else {
        pill.textContent = 'Polling 3d';
        pill.className = 'role-pill pill-amber';
    }
}

function startFallbackPolling(intervalMs) {
    if (pollIntervalId) clearInterval(pollIntervalId);
    pollIntervalId = setInterval(async () => {
        if (document.hidden || !isOnline()) return;
        await checkAndRenderAuto();
    }, intervalMs);
}

function initRealtimeSubscription() {
    if (!supabase || typeof supabase.channel !== 'function') {
        setRealtimeUi('polling');
        startFallbackPolling(3000);
        return;
    }

    const ch = supabase
        .channel('staff-dashboard-orders')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async () => {
            if (!document.hidden) await checkAndRenderAuto();
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                setRealtimeUi('realtime');
                // Beban database jauh lebih hemat saat Realtime aktif (heartbeat 30 detik)
                startFallbackPolling(30000);
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                setRealtimeUi('polling');
                startFallbackPolling(3000);
            }
        });
    window._staffRealtimeChannel = ch;
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
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('../sw.js').catch(() => {});
    }
    if (!supabase) {
        alert('Koneksi Supabase belum siap. Periksa ../config.js.');
        return;
    }
    if (!(await checkAuth())) return;

    terapkanHakAksesPeran();
    updateSoundButtonUi();
    updateConnectionBadge();

    window.addEventListener('online', async () => {
        updateConnectionBadge();
        await syncOfflineQueue(supabase);
        updateConnectionBadge();
        await renderCurrentSection(true);
    });
    window.addEventListener('offline', updateConnectionBadge);

    supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') {
            bersihkanSesiLokal();
            window.location.href = '../login-pegawai.html';
        }
    });

    if (!isDapurOnly()) await muatStatusToko();

    // Peran Dapur langsung diarahkan ke tab Dapur (PB-045)
    const defaultSec = isDapurOnly() ? 'pantau' : 'dashboard';
    const defaultTab = document.querySelector(`.tab-item[data-nav="${defaultSec}"]`);
    navigate(defaultSec, defaultTab);

    initRealtimeSubscription();

    // Tutup modal dengan Escape atau klik backdrop
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const mPos = document.getElementById('modalKasirOrder');
        if (mPos && mPos.style.display === 'flex') tutupModalKasirOrder();
        const mRet = document.getElementById('modalReturOrder');
        if (mRet && mRet.style.display === 'flex') tutupModalRetur();
        const mQris = document.getElementById('modalBuktiQris');
        if (mQris && mQris.style.display === 'flex') mQris.style.display = 'none';
    });

    const modalPos = document.getElementById('modalKasirOrder');
    if (modalPos) modalPos.addEventListener('click', (e) => { if (e.target === modalPos) tutupModalKasirOrder(); });
    const modalRet = document.getElementById('modalReturOrder');
    if (modalRet) modalRet.addEventListener('click', (e) => { if (e.target === modalRet) tutupModalRetur(); });
});

// ==========================================
// DATA LAYER SUPABASE
// ==========================================
async function fetchAllCatalogFromSupabase() {
    try {
        const { data, error } = await supabase.from('menu_custom').select('*').order('urutan', { ascending: true });
        if (error) throw error;
        if (Array.isArray(data) && data.length > 0) {
            localStorage.setItem('sabangdor_custom_menus', JSON.stringify(data));
            return data;
        }
    } catch (err) {
        console.warn('Gagal ambil katalog dari Supabase:', err.message || err);
    }
    // Fallback bawaan jika DB belum di-seed atau offline
    return typeof window.getAllCatalogMenus === 'function' ? window.getAllCatalogMenus() : [];
}

let galatDbTerakhir = '';

async function saveMenuToSupabase(menuData) {
    galatDbTerakhir = '';
    try {
        const payload = {
            id: menuData.id,
            nama: menuData.nama,
            kategori: menuData.kategori,
            deskripsi: menuData.deskripsi || '',
            img_url: menuData.img || menuData.img_url || DEFAULT_MENU_IMG,
            gratis: menuData.gratis || '',
            ukuran: menuData.ukuran || [],
            addon: menuData.addon || [],
            habis: Boolean(menuData.habis),
            is_bawaan: Boolean(menuData.is_bawaan),
            tipe_menu: menuData.tipe_menu || 'reguler',
            stok_harian: menuData.stok_harian === undefined ? null : menuData.stok_harian,
            ambang_stok: menuData.ambang_stok == null ? 5 : Number(menuData.ambang_stok),
            urutan: menuData.urutan == null ? 100 : Number(menuData.urutan)
        };
        let { error } = await supabase.from('menu_custom').upsert([payload]);
        // Fallback jika kolom v2 belum ada di DB
        if (error && /column .* does not exist/i.test(error.message || '')) {
            const legacyPayload = {
                id: payload.id, nama: payload.nama, kategori: payload.kategori,
                deskripsi: payload.deskripsi, img_url: payload.img_url, gratis: payload.gratis,
                ukuran: payload.ukuran, addon: payload.addon, habis: payload.habis
            };
            const retry = await supabase.from('menu_custom').upsert([legacyPayload]);
            error = retry.error;
        }
        if (error) throw error;
        return true;
    } catch (err) {
        console.error('Gagal simpan menu ke Supabase:', err);
        galatDbTerakhir = fmtErr(err, 'menu');
        return false;
    }
}

async function deleteCustomMenuFromSupabase(menuId) {
    galatDbTerakhir = '';
    try {
        const { error } = await supabase.from('menu_custom').delete().eq('id', menuId);
        if (error) throw error;
        return true;
    } catch (err) {
        galatDbTerakhir = fmtErr(err, 'menu');
        return false;
    }
}

function pad2(n) { return String(n).padStart(2, '0'); }

async function fetchOrdersFromSupabase() {
    try {
        const { data, error } = await supabase
            .from('orders')
            .select('*, order_items (*)')
            .order('created_at', { ascending: false })
            .limit(400);

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
                subtotalKotor: Number(o.subtotal_kotor != null ? o.subtotal_kotor : o.total_harga),
                kodeVoucher: o.kode_voucher || '',
                diskonVoucher: Number(o.diskon_voucher || 0),
                diskonPoin: Number(o.diskon_poin || 0),
                totalHarga: Number(o.total_harga),
                totalHargaFormatted: `Rp${Number(o.total_harga).toLocaleString('id-ID')}`,
                statusPembayaranDb: o.status_pembayaran,
                statusPesananDb: o.status_pesanan,
                alasanRetur: o.alasan_retur || '',
                nominalRetur: Number(o.nominal_retur || 0),
                buktiQrisUrl: o.bukti_qris_url || '',
                isPreorder: Boolean(o.is_preorder),
                jadwalAmbil: o.jadwal_ambil || null,
                jadwalAmbilLabel: o.jadwal_ambil ? new Date(o.jadwal_ambil).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB' : '',
                createdAt: o.created_at,
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
        console.error('Gagal ambil pesanan:', err);
        tampilkanGalat(fmtErr(err, 'order'));
        return null;
    }
}

async function getSetting(key, fallback = null) {
    try {
        const { data, error } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
        if (error) throw error;
        return data && data.value != null ? data.value : fallback;
    } catch (err) {
        return fallback;
    }
}

async function setSetting(key, value) {
    const { error } = await supabase
        .from('app_settings')
        .upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) throw error;
}

// ==========================================
// PERINGATAN STOK MENIPIS (PB-063)
// ==========================================
function updateLowStockBanner(catalogList) {
    const banner = document.getElementById('low-stock-global-banner');
    if (!banner || isDapurOnly()) return;
    const menipis = (catalogList || []).filter(m =>
        !m.habis &&
        m.stok_harian !== null &&
        m.stok_harian !== undefined &&
        Number(m.stok_harian) > 0 &&
        Number(m.stok_harian) <= Number(m.ambang_stok != null ? m.ambang_stok : 5)
    );
    if (menipis.length === 0) {
        banner.style.display = 'none';
        return;
    }
    banner.style.display = 'block';
    banner.textContent = 'Stok menipis: ' + menipis.map(m => `${m.nama} (sisa ${m.stok_harian})`).join(', ');
}

// ==========================================
// BADGE & AUTO-REFRESH
// ==========================================
function updateBadgesAndSound(semuaPesanan) {
    const pendingCnt = semuaPesanan.filter(p => p.statusPembayaranDb === 'pending').length;
    const cookingCnt = semuaPesanan.filter(p => p.statusPembayaranDb === 'lunas' && p.statusPesananDb === 'disiapkan').length;

    // PB-043: Bunyi notifikasi saat pesanan pending bertambah (kasir/pemilik) atau pesanan masak bertambah (dapur)
    if (!isDapurOnly()) {
        if (lastPendingCount !== null && pendingCnt > lastPendingCount) playNewOrderSound();
        lastPendingCount = pendingCnt;
    } else {
        if (lastCookingCount !== null && cookingCnt > lastCookingCount) playNewOrderSound();
        lastCookingCount = cookingCnt;
    }

    const bBayar = document.getElementById('badge-notif-bayar');
    if (bBayar) {
        bBayar.style.display = pendingCnt > 0 ? 'inline-block' : 'none';
        bBayar.textContent = String(pendingCnt);
    }
    const bDapur = document.getElementById('badge-notif-dapur');
    if (bDapur) {
        bDapur.style.display = cookingCnt > 0 ? 'inline-block' : 'none';
        bDapur.textContent = String(cookingCnt);
    }
}

async function perbaruiBadgeSaja() {
    try {
        const { data, error } = await supabase
            .from('orders')
            .select('status_pembayaran, status_pesanan')
            .in('status_pesanan', ['menunggu', 'disiapkan']);
        if (error) return;
        const mapped = (data || []).map(r => ({
            statusPembayaranDb: r.status_pembayaran,
            statusPesananDb: r.status_pesanan
        }));
        updateBadgesAndSound(mapped);
    } catch (e) {}
}

async function checkAndRenderAuto() {
    const aktif = document.activeElement;
    if (aktif && (aktif.tagName === 'INPUT' || aktif.tagName === 'TEXTAREA' || aktif.tagName === 'SELECT')) return;
    if (currentSec === 'dashboard' || currentSec === 'menu' || currentSec === 'kelola') {
        await perbaruiBadgeSaja();
        return;
    }
    await renderCurrentSection();
}

// ==========================================
// NAVIGASI
// ==========================================
function navigate(secKey, el) {
    if (isDapurOnly() && secKey !== 'pantau') secKey = 'pantau';
    if (secKey === 'kelola' && !isPemilikRole()) secKey = 'dashboard';

    currentSec = secKey;
    document.querySelectorAll('.tab-item').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');

    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    const secEl = document.getElementById(`sec-${secKey}`);
    if (secEl) secEl.classList.add('active');

    const titleMap = {
        dashboard: { t: 'Stok Harian, QRIS & Printer', s: 'Atur stok otomatis, QRIS outlet, dan printer thermal 58 mm' },
        pembayaran: { t: 'Verifikasi Pembayaran', s: 'Konfirmasi pembayaran QRIS & Tunai dari pembeli' },
        pantau: { t: 'Display Kitchen (Dapur)', s: 'Antrean masak, pesanan siap diambil, hingga selesai' },
        menu: { t: 'Kelola Menu & Kategori', s: 'Ubah menu bawaan, tambah menu baru, dan atur urutan kategori' },
        riwayat: { t: 'Riwayat, Laporan & Shift', s: 'Arsip transaksi, retur, laporan grafik, ekspor Excel/PDF, dan rekap kas' },
        kelola: { t: 'Pengaturan Pemilik', s: 'Jadwal buka/tutup, voucher, loyalitas, Apriori, ulasan, pegawai, dan audit' }
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
    if (currentSec === 'dashboard') { await perbaruiBadgeSaja(); await renderStokMenu(); return; }
    if (currentSec === 'menu') { await perbaruiBadgeSaja(); await renderMenuTambahan(); return; }
    if (currentSec === 'kelola') { await perbaruiBadgeSaja(); await renderKelolaSection(); return; }

    const hasil = await fetchOrdersFromSupabase();
    if (hasil === null) return;
    pesananSupabase = hasil;
    updateBadgesAndSound(pesananSupabase);

    if (currentSec === 'pembayaran') renderPembayaran(pesananSupabase);
    else if (currentSec === 'pantau') renderKitchenDisplay(pesananSupabase);
    else if (currentSec === 'riwayat') await renderRiwayatSection(pesananSupabase);
}

// ==========================================
// 1. STOK HARIAN (PB-049, PB-063), QRIS & PRINTER THERMAL (PB-073)
// ==========================================
async function renderStokMenu() {
    const grid = document.getElementById('grid-stok-menu');
    if (!grid) return;

    const customQrisImg = await getSetting('qris_image', '');
    const qrisSafe = customQrisImg ? safeImgSrc(customQrisImg, '') : '';
    const catalogList = await fetchAllCatalogFromSupabase();
    updateLowStockBanner(catalogList);

    const pStat = getPrinterStatus();

    let html = `
        <div class="orders-grid">
            <div class="card">
                <div class="card-title">Pengaturan QRIS Outlet</div>
                <div class="card-sub">Gambar QRIS ini tampil di halaman checkout semua pembeli</div>
                <div class="upload-wrapper">
                    <button type="button" class="btn-upload-custom" onclick="document.getElementById('inputFileQris').click()">+ Pilih Gambar QRIS</button>
                    <input type="file" id="inputFileQris" accept="image/*" style="display:none;">
                </div>
                <div id="qrisMsg" class="mt-hint" style="margin-top:6px;"></div>
                ${qrisSafe ? `
                    <div class="qris-preview-container">
                        <span style="font-size:12px; font-weight:700; color:#047857;">Gambar QRIS Aktif</span><br>
                        <img src="${escHtml(qrisSafe)}" class="qris-preview-img" width="140" height="140" alt="QRIS Toko"><br>
                        <button type="button" class="mt-btn-small danger" style="margin-top:8px;" onclick="hapusQris()">Hapus QRIS</button>
                    </div>` : ''}
            </div>

            <div class="card">
                <div class="card-title">Printer Thermal 58 mm &amp; Layar Antrean</div>
                <div class="card-sub">Status: <strong>${escHtml(pStat.name)}</strong></div>
                <div class="btn-group" style="margin-bottom:10px;">
                    <button type="button" class="btn-outline-merchant" onclick="hubungkanBluetooth()">Bluetooth</button>
                    <button type="button" class="btn-outline-merchant" onclick="hubungkanSerial()">USB / Serial</button>
                    ${pStat.connected ? `<button type="button" class="mt-btn-small danger" onclick="putusPrinter()">Putus</button>` : ''}
                </div>
                <label style="display:flex; align-items:center; gap:8px; font-size:0.8125rem; font-weight:700; margin-bottom:12px;">
                    <input type="checkbox" ${pStat.autoPrint ? 'checked' : ''} onchange="ubahAutoPrint(this.checked)">
                    <span>Cetak struk otomatis saat verifikasi pembayaran</span>
                </label>
                <a href="../layar-antrean.html" target="_blank" rel="noopener" class="btn-outline-merchant" style="display:inline-flex; align-items:center; text-decoration:none;">
                    Buka Layar Antrean Publik (TV) ↗
                </a>
                <div id="printerMsg" class="mt-hint" style="margin-top:6px;"></div>
            </div>
        </div>

        <div class="card-title" style="margin-top:12px;">Ketersediaan &amp; Stok Harian Menu</div>
        <div class="card-sub">Isi angka stok awal harian agar stok berkurang otomatis saat pesanan lunas, atau kosongkan untuk kontrol manual.</div>
        <div class="stok-grid">
    `;

    catalogList.forEach(item => {
        const isHabis = Boolean(item.habis) || (item.stok_harian !== null && item.stok_harian !== undefined && Number(item.stok_harian) <= 0);
        const imgUrl = safeImgSrc(item.img_url || item.img, DEFAULT_MENU_IMG);
        const stokVal = item.stok_harian !== null && item.stok_harian !== undefined ? Number(item.stok_harian) : '';
        const lowBadge = (!isHabis && stokVal !== '' && stokVal <= Number(item.ambang_stok != null ? item.ambang_stok : 5))
            ? `<span class="role-pill pill-amber">Menipis</span>` : '';

        html += `
            <div class="stok-card" style="flex-direction:column; align-items:stretch;">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
                    <div class="stok-left">
                        <img src="${escHtml(imgUrl)}" class="stok-thumb" width="44" height="44" alt="${escHtml(item.nama)}">
                        <div style="min-width:0;">
                            <div class="stok-name">${escHtml(item.nama)} ${lowBadge}</div>
                            <div class="mt-meta">${escHtml(item.kategori || '')}</div>
                        </div>
                    </div>
                    <button type="button" class="btn-toggle-stok ${isHabis ? 'empty' : 'ready'}" data-id="${escHtml(item.id)}" onclick="toggleStokMenu(this.dataset.id)">
                        <span class="status-dot" aria-hidden="true"></span>${isHabis ? 'HABIS' : 'TERSEDIA'}
                    </button>
                </div>
                <div class="stok-qty-box">
                    <label style="font-size:0.75rem; color:var(--text-muted); font-weight:700;">Stok harian:</label>
                    <input type="number" class="stok-qty-input" min="0" max="99999" step="1" placeholder="∞" value="${stokVal}" id="stokQty_${escHtml(item.id)}">
                    <button type="button" class="mt-btn-small" data-id="${escHtml(item.id)}" onclick="simpanStokHarian(this.dataset.id)">Set</button>
                </div>
            </div>
        `;
    });

    html += `</div>`;
    grid.innerHTML = html;

    const fileInput = document.getElementById('inputFileQris');
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) simpanQrisDariFile(file);
        });
    }
}

async function simpanStokHarian(menuId) {
    const inp = document.getElementById(`stokQty_${menuId}`);
    if (!inp) return;
    const raw = inp.value.trim();
    const stokBaru = raw === '' ? null : Math.max(0, Math.floor(Number(raw) || 0));
    const habisBaru = stokBaru !== null && stokBaru === 0;
    try {
        const { error } = await supabase
            .from('menu_custom')
            .update({ stok_harian: stokBaru, habis: habisBaru })
            .eq('id', menuId);
        if (error) throw error;
        await renderStokMenu();
    } catch (err) {
        alert(fmtErr(err, 'menu'));
    }
}

async function toggleStokMenu(menuId) {
    const list = await fetchAllCatalogFromSupabase();
    const m = list.find(x => String(x.id) === String(menuId));
    if (!m) return;
    const nextHabis = !m.habis;
    const ok = await saveMenuToSupabase({ ...m, img: m.img_url || m.img, habis: nextHabis });
    if (!ok) alert(galatDbTerakhir || 'Gagal mengubah status stok.');
    await renderStokMenu();
}

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
    reader.onload = (evt) => {
        const img = new Image();
        img.onload = async () => {
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
                if (msg) msg.textContent = fmtErr(err);
            }
        };
        img.onerror = () => { if (msg) msg.textContent = 'File gambar tidak bisa dibaca.'; };
        img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
}

async function hapusQris() {
    if (!confirm('Hapus gambar QRIS?')) return;
    try {
        await setSetting('qris_image', '');
        await renderStokMenu();
    } catch (err) {
        alert(fmtErr(err));
    }
}

async function hubungkanBluetooth() {
    const msg = document.getElementById('printerMsg');
    try {
        await connectBluetoothPrinter();
        await renderStokMenu();
    } catch (err) {
        if (msg) msg.textContent = err.message || String(err);
    }
}

async function hubungkanSerial() {
    const msg = document.getElementById('printerMsg');
    try {
        await connectSerialPrinter();
        await renderStokMenu();
    } catch (err) {
        if (msg) msg.textContent = err.message || String(err);
    }
}

async function putusPrinter() {
    await disconnectPrinter();
    await renderStokMenu();
}

function ubahAutoPrint(checked) {
    setAutoPrintEnabled(Boolean(checked));
}

// ==========================================
// 2. VERIFIKASI PEMBAYARAN (+ BUKTI QRIS PB-069, STOK PB-049, AUTO-PRINT PB-073)
// ==========================================
function getItemSubtotal(i) {
    if (i.totalHargaItem && !isNaN(i.totalHargaItem) && i.totalHargaItem > 0) return i.totalHargaItem;
    if (i.hargaSatuan && !isNaN(i.hargaSatuan) && i.hargaSatuan > 0) return i.hargaSatuan * (i.qty || 1);
    return 0;
}

function detailItemHtml(i) {
    let h = '';
    if (i.varian) h += `<div style="font-size:12px; color:var(--text-muted); font-weight:600;">${escHtml(i.varian)}</div>`;
    if (i.catatan) h += `<div style="font-size:12px; color:#B45309; font-weight:700;">Catatan: ${escHtml(i.catatan)}</div>`;
    return h;
}

function renderPembayaran(pesananList) {
    const container = document.getElementById('container-pembayaran');
    if (!container) return;

    const pending = pesananList.filter(p => p.statusPembayaranDb === 'pending');
    if (pending.length === 0) {
        container.innerHTML = `<div class="empty-info">Tidak ada pembayaran menunggu verifikasi.</div>`;
        return;
    }

    let html = '<div class="orders-grid">';
    pending.forEach((order) => {
        const itemList = order.items.map(i => `
            <li class="order-item-row">
                <div><span><b>${i.qty || 1}x</b> ${escHtml(i.nama)}</span>${detailItemHtml(i)}</div>
                <b>${rupiah(getItemSubtotal(i))}</b>
            </li>
        `).join('');

        const isTunai = order.metodeBayar === 'CASH' || order.metodeBayar === 'TUNAI';
        const buktiSafe = order.buktiQrisUrl ? safeImgSrc(order.buktiQrisUrl, '') : '';

        html += `
            <div class="order-card-merchant">
                <div class="order-head">
                    <span class="order-id-txt">#${escHtml(order.idOrder)} (${escHtml(order.namaPelanggan)})</span>
                    <span class="order-badge-pay ${isTunai ? 'tag-cash' : 'tag-qris'}">${escHtml(order.metodeBayar)}</span>
                </div>
                <div style="font-size:12.5px; color:var(--text-muted);">
                    ${escHtml(order.waktu)} WIB | Total: <b style="color:var(--primary-red); font-size:14px;">${escHtml(order.totalHargaFormatted)}</b>
                    ${order.kodeVoucher ? `<span class="role-pill pill-green" style="margin-left:4px;">${escHtml(order.kodeVoucher)}</span>` : ''}
                    ${order.isPreorder ? `<span class="role-pill pill-amber" style="margin-left:4px;">Pre-order ${escHtml(order.jadwalAmbilLabel)}</span>` : ''}
                </div>
                ${buktiSafe ? `
                    <div style="display:flex; align-items:center; gap:10px; background:var(--bg-app); padding:8px; border-radius:10px; border:1px solid var(--border-line);">
                        <img src="${escHtml(buktiSafe)}" alt="Bukti QRIS" class="qris-proof-thumb" onclick="bukaLightboxBukti('${escHtml(buktiSafe)}')">
                        <span style="font-size:0.75rem; font-weight:700; color:#047857;">Bukti bayar QRIS terlampir (klik untuk perbesar)</span>
                    </div>` : ''}
                <ul class="order-item-list">${itemList}</ul>
                <div class="btn-group">
                    <button type="button" class="btn-primary-merchant" onclick="konfirmasiPembayaran(${Number(order.db_id_order)})">
                        ${isTunai ? 'Terima Tunai &amp; Kirim Dapur' : 'Verifikasi QRIS &amp; Kirim Dapur'}
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

function bukaLightboxBukti(src) {
    const img = document.getElementById('imgBuktiQrisFull');
    const modal = document.getElementById('modalBuktiQris');
    if (img && modal) {
        img.src = src;
        modal.style.display = 'flex';
    }
}

async function konfirmasiPembayaran(dbIdOrder) {
    const targetOrder = pesananSupabase.find(p => p.db_id_order === dbIdOrder);
    try {
        let res = await supabase.rpc('verifikasi_pembayaran', { p_id_order: dbIdOrder });
        if (res.error && (res.error.code === 'PGRST202' || /could not find the function/i.test(res.error.message || ''))) {
            const upd = await supabase.from('orders').update({ status_pembayaran: 'lunas', status_pesanan: 'disiapkan' }).eq('id_order', dbIdOrder).select('id_order');
            if (upd.error || !upd.data || !upd.data.length) throw upd.error || new Error('Perubahan ditolak.');
        } else if (res.error) {
            throw res.error;
        }
        await renderCurrentSection(true);
        if (targetOrder && isAutoPrintEnabled()) {
            await printThermalOrFallback(targetOrder, 'struk', cetakStrukHtml);
        }
    } catch (err) {
        alert(fmtErr(err, 'order'));
    }
}

async function batalkanPesanan(dbIdOrder) {
    if (!confirm('Batalkan pesanan pending ini?')) return;
    try {
        const { data, error } = await supabase
            .from('orders')
            .update({ status_pembayaran: 'batal', status_pesanan: 'selesai' })
            .eq('id_order', dbIdOrder)
            .select('id_order');
        if (error) throw error;
        if (!data || !data.length) throw new Error('Sesi login telah habis, silakan masuk kembali.');
        await renderCurrentSection(true);
    } catch (err) {
        alert(fmtErr(err, 'order'));
    }
}

// ==========================================
// 3. DISPLAY KITCHEN 3 TAHAP (PB-041 & PB-075)
// ==========================================
function switchKitchenTab(type, evt) {
    activeKanbanFilter = type;
    document.querySelectorAll('.k-tab').forEach(b => b.classList.remove('active'));
    if (evt && evt.currentTarget) evt.currentTarget.classList.add('active');
    renderCurrentSection(true);
}

function renderKitchenDisplay(pesananList) {
    const container = document.getElementById('kanban-content-mobile');
    if (!container) return;

    const listProses = pesananList
        .filter(p => p.statusPembayaranDb === 'lunas' && p.statusPesananDb === 'disiapkan')
        .slice().reverse();
    const listSiap = pesananList
        .filter(p => p.statusPembayaranDb === 'lunas' && p.statusPesananDb === 'siap')
        .slice().reverse();
    const listSelesai = pesananList.filter(p => p.statusPembayaranDb === 'lunas' && p.statusPesananDb === 'selesai');

    const elP = document.getElementById('count-terkirim');
    const elSiap = document.getElementById('count-siap');
    const elS = document.getElementById('count-selesai');
    if (elP) elP.innerText = listProses.length;
    if (elSiap) elSiap.innerText = listSiap.length;
    if (elS) elS.innerText = listSelesai.length;

    const filtered = activeKanbanFilter === 'proses-masak'
        ? listProses
        : (activeKanbanFilter === 'siap-diambil' ? listSiap : listSelesai);

    if (filtered.length === 0) {
        container.innerHTML = `<div class="empty-info">Tidak ada pesanan dalam kategori ini.</div>`;
        return;
    }

    let html = '<div class="orders-grid">';
    filtered.forEach((order) => {
        const itemList = order.items.map(i => `<li><b>${i.qty || 1}x ${escHtml(i.nama)}</b>${detailItemHtml(i)}</li>`).join('');
        const preBadge = order.isPreorder
            ? `<div style="margin-bottom:4px;"><span class="role-pill pill-amber">Pre-order Ambil: ${escHtml(order.jadwalAmbilLabel)}</span></div>`
            : '';

        let actionHtml = '';
        if (activeKanbanFilter === 'proses-masak') {
            actionHtml = `
                <div class="btn-group">
                    <button type="button" class="btn-primary-merchant" style="background:#047857;" onclick="tandaiSiapDiambil(${Number(order.db_id_order)})">Tandai Siap Diambil</button>
                    <button type="button" class="btn-outline-merchant" onclick="cetakTiketDapurById(${Number(order.db_id_order)})">Tiket Dapur</button>
                </div>`;
        } else if (activeKanbanFilter === 'siap-diambil') {
            actionHtml = !isDapurOnly()
                ? `<button type="button" class="btn-primary-merchant" style="background:#1D4ED8;" onclick="serahkanPesananKePembeli(${Number(order.db_id_order)})">Serahkan &amp; Selesai</button>`
                : `<p style="font-size:13px; color:#047857; font-weight:700;">Menunggu diserahkan kasir ke pembeli</p>`;
        } else {
            actionHtml = `<p style="font-size:13px; color:var(--green-text); font-weight:700;">Status: Selesai &amp; Diserahkan</p>`;
        }

        html += `
            <div class="order-card-merchant">
                <div class="order-head">
                    <span class="order-id-txt">#${escHtml(order.idOrder)} (${escHtml(order.namaPelanggan)})</span>
                    <span style="font-size:12px; color:var(--text-muted);">${escHtml(order.waktu)} WIB</span>
                </div>
                ${preBadge}
                <ul class="order-item-list">${itemList}</ul>
                ${actionHtml}
            </div>
        `;
    });
    html += '</div>';
    container.innerHTML = html;
}

async function tandaiSiapDiambil(dbIdOrder) {
    try {
        let res = await supabase.rpc('dapur_tandai_siap', { p_id_order: dbIdOrder });
        if (res.error && (res.error.code === 'PGRST202' || /could not find the function/i.test(res.error.message || ''))) {
            res = await supabase.from('orders').update({ status_pesanan: 'siap' }).eq('id_order', dbIdOrder);
        }
        if (res.error) throw res.error;
        await renderCurrentSection(true);
    } catch (err) {
        alert(fmtErr(err, 'order'));
    }
}

async function serahkanPesananKePembeli(dbIdOrder) {
    try {
        let res = await supabase.rpc('serahkan_pesanan', { p_id_order: dbIdOrder });
        if (res.error && (res.error.code === 'PGRST202' || /could not find the function/i.test(res.error.message || ''))) {
            res = await supabase.from('orders').update({ status_pesanan: 'selesai' }).eq('id_order', dbIdOrder);
        }
        if (res.error) throw res.error;
        await renderCurrentSection(true);
    } catch (err) {
        alert(fmtErr(err, 'order'));
    }
}

// ==========================================
// 4. RIWAYAT, RETUR (PB-046), LAPORAN (PB-055/057/058) & SHIFT (PB-062)
// ==========================================
function switchRiwayatSubtab(sub, btn) {
    activeRiwayatSubtab = sub;
    document.querySelectorAll('#sec-riwayat .subtab-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    document.getElementById('riwayat-sub-transaksi').style.display = sub === 'transaksi' ? '' : 'none';
    document.getElementById('riwayat-sub-laporan').style.display = sub === 'laporan' ? '' : 'none';
    document.getElementById('riwayat-sub-shift').style.display = sub === 'shift' ? '' : 'none';
    renderCurrentSection(true);
}

function resetFilterTanggal() {
    const inputEl = document.getElementById('filterTanggal');
    if (inputEl) inputEl.value = '';
    renderCurrentSection(true);
}

async function renderRiwayatSection(allOrders) {
    if (activeRiwayatSubtab === 'laporan' && isPemilikRole()) {
        renderLaporanAnalitik(allOrders);
        return;
    }
    if (activeRiwayatSubtab === 'shift') {
        await renderShiftPanel(document.getElementById('riwayat-sub-shift'), supabase, allOrders, currentStaffUser);
        return;
    }
    renderRiwayatTransaksi(allOrders);
}

function renderRiwayatTransaksi(allOrders) {
    const banner = document.getElementById('summary-omzet-card');
    const container = document.getElementById('history-cards-container');
    const filterInput = document.getElementById('filterTanggal');
    if (!container) return;

    const list = allOrders.filter(p => p.statusPembayaranDb === 'lunas' || p.statusPembayaranDb === 'retur');
    const selectedDate = filterInput ? filterInput.value : '';
    const filteredList = selectedDate ? list.filter(item => item.tanggalKey === selectedDate) : list;

    const lunasFiltered = filteredList.filter(i => i.statusPembayaranDb === 'lunas');
    const returFiltered = filteredList.filter(i => i.statusPembayaranDb === 'retur');
    const omzetKotor = lunasFiltered.reduce((s, i) => s + Number(i.subtotalKotor || i.totalHarga), 0);
    const totalDiskon = lunasFiltered.reduce((s, i) => s + Number(i.diskonVoucher || 0) + Number(i.diskonPoin || 0), 0);
    const totalRetur = returFiltered.reduce((s, i) => s + Number(i.nominalRetur || i.totalHarga), 0);
    const omzetBersih = lunasFiltered.reduce((s, i) => s + Number(i.totalHarga || 0), 0);

    if (banner) {
        banner.innerHTML = `
            <div class="omzet-banner">
                <p>${selectedDate ? `Omzet Tanggal ${escHtml(selectedDate)}` : 'Total Omzet Bersih'} (${lunasFiltered.length} lunas${returFiltered.length ? ` • ${returFiltered.length} retur` : ''})</p>
                <h2>${rupiah(omzetBersih)}</h2>
                <p style="margin-top:6px;">Kotor: ${rupiah(omzetKotor)} | Diskon: ${rupiah(totalDiskon)} | Retur: ${rupiah(totalRetur)}</p>
            </div>
        `;
    }

    if (filteredList.length === 0) {
        container.innerHTML = `<div class="empty-info">Tidak ada riwayat transaksi pada tanggal ini.</div>`;
        return;
    }

    let html = '<div class="orders-grid">';
    filteredList.forEach((item) => {
        const isRetur = item.statusPembayaranDb === 'retur';
        html += `
            <div class="order-card-merchant">
                <div class="order-head">
                    <span class="order-id-txt">#${escHtml(item.idOrder)} (${escHtml(item.namaPelanggan)} - ${escHtml(item.metodeBayar)})</span>
                    ${isRetur ? `<span class="role-pill pill-red">RETUR</span>` : `<b style="color:var(--green-text);">${escHtml(item.totalHargaFormatted)}</b>`}
                </div>
                <div style="font-size:12px; color:var(--text-muted);">${escHtml(item.tanggal)} ${escHtml(item.waktu)} WIB</div>
                ${isRetur ? `<div style="font-size:12px; color:var(--primary-hover); font-weight:700;">Retur ${rupiah(item.nominalRetur)}: ${escHtml(item.alasanRetur)}</div>` : ''}
                <div class="btn-group">
                    <button type="button" class="btn-outline-merchant" style="padding:8px 12px; font-size:12px;" onclick="cetakStrukLangsungById(${Number(item.db_id_order)})">Cetak Ulang Struk</button>
                    ${!isRetur ? `<button type="button" class="btn-outline-merchant" style="padding:8px 12px; font-size:12px; color:#BE123C;" onclick="bukaModalRetur(${Number(item.db_id_order)})">Retur / Batalkan</button>` : ''}
                </div>
            </div>
        `;
    });
    html += '</div>';
    container.innerHTML = html;
}

function bukaModalRetur(dbIdOrder) {
    const order = pesananSupabase.find(p => p.db_id_order === dbIdOrder);
    if (!order) return;
    returTargetOrder = order;
    document.getElementById('returOrderSummary').textContent = `#${order.idOrder} (${order.namaPelanggan}) • Total ${order.totalHargaFormatted}`;
    document.getElementById('returAlasanInput').value = '';
    document.getElementById('returNominalInput').value = String(order.totalHarga);
    document.getElementById('returNominalInput').max = String(order.totalHarga);
    document.getElementById('returMsg').className = 'mt-msg';
    document.getElementById('modalReturOrder').style.display = 'flex';
}

function tutupModalRetur() {
    returTargetOrder = null;
    document.getElementById('modalReturOrder').style.display = 'none';
}

async function prosesReturPesanan() {
    if (!returTargetOrder) return;
    const alasan = document.getElementById('returAlasanInput').value.trim();
    const nominal = Number(document.getElementById('returNominalInput').value) || 0;
    const msg = document.getElementById('returMsg');

    if (!alasan) {
        msg.textContent = 'Alasan retur wajib diisi.';
        msg.className = 'mt-msg show error';
        return;
    }
    if (nominal <= 0 || nominal > returTargetOrder.totalHarga) {
        msg.textContent = `Nominal retur harus antara Rp1 sampai ${rupiah(returTargetOrder.totalHarga)}.`;
        msg.className = 'mt-msg show error';
        return;
    }

    try {
        const { error } = await supabase.rpc('retur_pesanan', {
            p_id_order: returTargetOrder.db_id_order,
            p_alasan: alasan,
            p_nominal: nominal
        });
        if (error) throw error;
        tutupModalRetur();
        await renderCurrentSection(true);
    } catch (err) {
        msg.textContent = fmtErr(err, 'order');
        msg.className = 'mt-msg show error';
    }
}

function renderLaporanAnalitik(allOrders) {
    const host = document.getElementById('riwayat-sub-laporan');
    if (!host) return;
    const range = getDateRangeForPreset(reportPreset, reportStartCustom, reportEndCustom);
    const stats = computeSalesAnalytics(allOrders, range.start, range.end);

    host.innerHTML = `
        <div class="card">
            <div class="card-title">Laporan Penjualan &amp; Ekspor</div>
            <div class="card-sub">${escHtml(range.label)}</div>
            <div class="subtab-bar" style="margin-bottom:10px;">
                ${[['hari', 'Hari Ini'], ['minggu', '7 Hari'], ['bulan', '30 Hari'], ['custom', 'Rentang Tanggal']].map(([k, lbl]) => `
                    <button type="button" class="subtab-btn ${reportPreset === k ? 'active' : ''}" data-preset="${k}">${lbl}</button>
                `).join('')}
            </div>
            ${reportPreset === 'custom' ? `
                <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px;">
                    <input type="date" id="repStartDate" class="mt-input" style="flex:1;" value="${escHtml(range.start)}">
                    <input type="date" id="repEndDate" class="mt-input" style="flex:1;" value="${escHtml(range.end)}">
                    <button type="button" id="btnApplyRepRange" class="btn-outline-merchant">Terapkan</button>
                </div>` : ''}
            <div class="btn-group">
                <button type="button" id="btnExportExcel" class="btn-primary-merchant" style="background:#047857;">Ekspor Excel (.xls)</button>
                <button type="button" id="btnExportPdf" class="btn-outline-merchant">Ekspor PDF / Cetak</button>
            </div>
        </div>

        <div class="kpi-grid">
            <div class="kpi-card"><small>Omzet Bersih</small><strong style="color:var(--primary-hover);">${rupiah(stats.omzetBersih)}</strong></div>
            <div class="kpi-card"><small>Omzet Kotor</small><strong>${rupiah(stats.omzetKotor)}</strong></div>
            <div class="kpi-card"><small>Diskon &amp; Retur</small><strong>${rupiah(stats.totalDiskon + stats.totalRetur)}</strong></div>
            <div class="kpi-card"><small>Pesanan Lunas / AOV</small><strong>${stats.jumlahPesanan} / ${rupiah(stats.aov)}</strong></div>
        </div>

        <div class="card">
            <div class="card-title">Tren Omzet Harian</div>
            ${renderTrendChartSvg(stats.trendSeries)}
        </div>

        <div class="orders-grid">
            <div class="card">
                <div class="card-title">Menu Terlaris</div>
                ${stats.topMenus.length === 0 ? '<div class="empty-info">Belum ada data penjualan.</div>' : `
                    <div class="admin-table-wrap">
                        <table class="admin-table">
                            <thead><tr><th>#</th><th>Menu</th><th>Terjual</th><th>Omzet</th></tr></thead>
                            <tbody>
                                ${stats.topMenus.slice(0, 10).map((m, i) => `
                                    <tr><td>${i + 1}</td><td><strong>${escHtml(m.nama)}</strong></td><td>${m.qty}</td><td>${rupiah(m.omzet)}</td></tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>`}
            </div>
            <div class="card">
                <div class="card-title">Jam Sibuk (08:00 - 22:00 WIB)</div>
                ${renderPeakHoursSvg(stats.hourCounts)}
            </div>
        </div>
    `;

    host.querySelectorAll('[data-preset]').forEach(btn => {
        btn.addEventListener('click', () => {
            reportPreset = btn.dataset.preset;
            renderLaporanAnalitik(allOrders);
        });
    });

    const btnRange = host.querySelector('#btnApplyRepRange');
    if (btnRange) {
        btnRange.addEventListener('click', () => {
            reportStartCustom = host.querySelector('#repStartDate').value;
            reportEndCustom = host.querySelector('#repEndDate').value;
            renderLaporanAnalitik(allOrders);
        });
    }

    host.querySelector('#btnExportExcel').addEventListener('click', () => exportReportToExcel(stats, range.label));
    host.querySelector('#btnExportPdf').addEventListener('click', () => exportReportToPdf(stats, range.label));
}

// ==========================================
// 5. CETAK STRUK & TIKET DAPUR (PB-015 & PB-073)
// ==========================================
async function cetakStrukLangsungById(dbIdOrder) {
    const order = pesananSupabase.find(p => p.db_id_order === dbIdOrder);
    if (order) await printThermalOrFallback(order, 'struk', cetakStrukHtml);
}

async function cetakTiketDapurById(dbIdOrder) {
    const order = pesananSupabase.find(p => p.db_id_order === dbIdOrder);
    if (order) await printThermalOrFallback(order, 'dapur', cetakStrukHtml);
}

function cetakStrukHtml(order, mode = 'struk') {
    const printWindow = window.open('', '', 'width=320,height=600');
    if (!printWindow) {
        alert('Pop-up diblokir browser.');
        return;
    }
    const itemsHtml = order.items.map(i => `
        <tr>
            <td style="padding:2px 0;">${i.qty}x ${escHtml(i.nama)}${i.varian ? `<br><small>${escHtml(i.varian)}</small>` : ''}${i.catatan ? `<br><small>Cat: ${escHtml(i.catatan)}</small>` : ''}</td>
            ${mode === 'dapur' ? '' : `<td style="text-align:right; vertical-align:top;">${rupiah(getItemSubtotal(i))}</td>`}
        </tr>
    `).join('');

    printWindow.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${mode === 'dapur' ? 'Tiket Dapur' : 'Struk'} #${escHtml(order.idOrder)}</title>
    <style>
        @page { size: 58mm; margin: 0; }
        body { font-family: 'Courier New', monospace; width: 48mm; margin: 0 auto; padding: 8px 0; font-size: 11px; color: #000; }
        .text-center { text-align: center; }
        .divider { border-bottom: 1px dashed #000; margin: 6px 0; }
        table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
    </style></head><body>
    <div class="text-center">
        <strong style="font-size:14px;">${mode === 'dapur' ? 'TIKET DAPUR' : 'SABANGDOR'}</strong><br>
        <span>${mode === 'dapur' ? 'SABANGDOR' : 'Outlet Ambil Sendiri'}</span>
    </div>
    <div class="divider"></div>
    <div>
        <div>No: <strong>#${escHtml(order.idOrder)}</strong></div>
        <div>Nama: ${escHtml(order.namaPelanggan)}</div>
        <div>Tgl: ${escHtml(order.tanggal || new Date().toLocaleDateString('id-ID'))} ${escHtml(order.waktu || '')}</div>
        ${mode === 'dapur' ? '' : `<div>Bayar: ${escHtml(order.metodeBayar)}</div>`}
        ${order.isPreorder ? `<div><strong>PRE-ORDER: ${escHtml(order.jadwalAmbilLabel)}</strong></div>` : ''}
    </div>
    <div class="divider"></div>
    <table><tbody>${itemsHtml}</tbody></table>
    ${mode === 'dapur' ? '' : `
    <div class="divider"></div>
    ${Number(order.diskonVoucher) > 0 ? `<div style="display:flex; justify-content:space-between;"><span>Diskon Voucher:</span><span>-${rupiah(order.diskonVoucher)}</span></div>` : ''}
    ${Number(order.diskonPoin) > 0 ? `<div style="display:flex; justify-content:space-between;"><span>Potongan Poin:</span><span>-${rupiah(order.diskonPoin)}</span></div>` : ''}
    <div style="display:flex; justify-content:space-between; font-weight:bold; font-size:12px;">
        <span>TOTAL:</span><span>${escHtml(order.totalHargaFormatted)}</span>
    </div>
    ${order.statusPembayaranDb === 'retur' ? `<div class="divider"></div><div><strong>STATUS: RETUR (-${rupiah(order.nominalRetur)})</strong><br><small>${escHtml(order.alasanRetur)}</small></div>` : ''}
    <div class="divider"></div>
    <div class="text-center" style="margin-top:8px;"><span>Terima Kasih!</span><br><small>Selamat Menikmati</small></div>
    `}
    <script>window.onload=function(){window.print();setTimeout(function(){window.close();},500);};</script>
    </body></html>`);
    printWindow.document.close();
}

// ==========================================
// 6. KELOLA MENU BAWAAN & CUSTOM (PB-024..031, PB-039, PB-047, PB-048)
// ==========================================
let mtEditingId = null;
let mtEditingIsBuiltin = false;
let mtFotoData = '';
let mtMsgTimer = null;

function mtBarisUkuranHtml(u) {
    u = u || {};
    return `
        <div class="mt-row mt-ukuran-row">
            <input type="text" class="mt-input mt-u-nama" placeholder="Ukuran" maxlength="30" value="${escHtml(u.nama || '')}">
            <input type="text" class="mt-input mt-u-porsi" placeholder="1 porsi" maxlength="40" value="${escHtml(u.porsi || '')}">
            <input type="number" class="mt-input mt-u-harga" placeholder="Harga" min="1" max="1000000" step="1" inputmode="numeric" value="${u.harga != null ? Number(u.harga) : ''}">
            <button type="button" class="mt-btn-x" aria-label="Hapus baris" onclick="this.closest('.mt-row').remove()">✕</button>
        </div>`;
}

function mtBarisAddonHtml(a) {
    a = a || {};
    return `
        <div class="mt-row mt-addon-row">
            <input type="text" class="mt-input mt-a-nama" placeholder="Nama tambahan" maxlength="50" value="${escHtml(a.nama || '')}">
            <input type="number" class="mt-input mt-a-harga" placeholder="Harga" min="0" max="1000000" step="1" inputmode="numeric" value="${a.harga != null ? Number(a.harga) : ''}">
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
    reader.onload = (evt) => {
        const img = new Image();
        img.onload = () => {
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
        img.onerror = () => mtShowMsg('File foto tidak bisa dibaca.', 'error');
        img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
    input.value = '';
}

const MT_KATEGORI_BARU = '__kategori_baru__';
const MT_KATEGORI_BAWAAN = ['Dimsum Mentai', 'Dimsum aja', 'Bakpao'];

async function mtDaftarKategori() {
    const hasil = MT_KATEGORI_BAWAAN.slice();
    try {
        const { data } = await supabase.from('menu_categories').select('nama').order('urutan', { ascending: true });
        (data || []).forEach(c => {
            const k = String(c.nama || '').trim();
            if (k && !hasil.some(x => x.toLowerCase() === k.toLowerCase())) hasil.push(k);
        });
    } catch (e) {}
    const menus = await fetchAllCatalogFromSupabase();
    menus.forEach(m => {
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
        + `<option value="${MT_KATEGORI_BARU}">+ Kategori baru...</option>`;
    sel.dataset.sig = sig;
    const cocok = daftar.find(k => k.toLowerCase() === String(sekarang || '').toLowerCase());
    if (cocok) sel.value = cocok;
    else if (sekarang === MT_KATEGORI_BARU) sel.value = MT_KATEGORI_BARU;
    else sel.selectedIndex = 0;
    mtOnKategoriChange(false);
}

function mtResetForm() {
    mtEditingId = null;
    mtEditingIsBuiltin = false;
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
    const secEl = document.getElementById('sec-menu');
    if (!secEl) return;

    if (!document.getElementById('formTambahMenuCustom')) {
        secEl.innerHTML = `
            <div class="card" id="mt-form-card">
                <div class="card-title" id="mtFormTitle">Tambah Menu Baru</div>
                <div class="card-sub">Tambah menu baru atau klik Edit pada menu bawaan (Mentai, Dimsum aja, Bakpao) di bawah untuk mengubah harga, foto, dan deskripsi.</div>

                <form id="formTambahMenuCustom" onsubmit="handleSimpanMenuCustom(event)" novalidate>
                    <div class="mt-field">
                        <label>Foto menu</label>
                        <div class="mt-photo">
                            <img id="mtFotoPreview" src="${DEFAULT_MENU_IMG}" width="72" height="72" alt="Foto menu">
                            <div>
                                <button type="button" class="btn-upload-custom" onclick="document.getElementById('mtFotoInput').click()">Pilih Foto</button>
                                <input type="file" id="mtFotoInput" accept="image/*" style="display:none;" onchange="mtPilihFoto(this)">
                                <div class="mt-hint">PNG/JPG/WebP maksimal 5 MB</div>
                            </div>
                        </div>
                    </div>

                    <div class="mt-field">
                        <label for="mtNama">Nama menu (maks. 60 karakter)</label>
                        <input type="text" id="mtNama" class="mt-input" maxlength="60" placeholder="Contoh: Siomay Ayam" autocomplete="off">
                    </div>

                    <div class="mt-field">
                        <label for="mtKategori">Kategori</label>
                        <select id="mtKategori" class="mt-input" onchange="mtOnKategoriChange(true)"></select>
                        <div id="mtKategoriBaruWrap" style="display:none; margin-top:8px;">
                            <input type="text" id="mtKategoriBaru" class="mt-input" maxlength="40" placeholder="Nama kategori baru, contoh: Minuman" autocomplete="off">
                        </div>
                    </div>

                    <div class="mt-field">
                        <label for="mtDeskripsi">Deskripsi singkat</label>
                        <textarea id="mtDeskripsi" class="mt-input" rows="2" maxlength="300" placeholder="Deskripsi menu untuk pembeli"></textarea>
                    </div>

                    <div class="mt-field">
                        <label>Ukuran / porsi &amp; harga (bilangan bulat, maks Rp1.000.000)</label>
                        <div id="mtUkuranList"></div>
                        <button type="button" class="mt-btn-add" onclick="mtTambahUkuran()">+ Tambah ukuran</button>
                    </div>

                    <div class="mt-field">
                        <label for="mtGratis">Bonus gratis (opsional)</label>
                        <input type="text" id="mtGratis" class="mt-input" maxlength="80" placeholder="Contoh: Free Chilli Oil" autocomplete="off">
                    </div>

                    <div class="mt-field">
                        <label>Tambahan opsional (harga >= 0, bilangan bulat)</label>
                        <div id="mtAddonList"></div>
                        <button type="button" class="mt-btn-add" onclick="mtTambahAddon()">+ Tambah pilihan tambahan</button>
                    </div>

                    <div class="kpi-grid" style="grid-template-columns:repeat(2,1fr); margin-top:12px;">
                        <div class="mt-field" style="margin-top:0;">
                            <label for="mtStokHarian">Stok Harian (kosong = manual)</label>
                            <input type="number" id="mtStokHarian" class="mt-input" min="0" max="99999" step="1" placeholder="Opsional">
                        </div>
                        <div class="mt-field" style="margin-top:0;">
                            <label for="mtAmbangStok">Ambang Peringatan Stok</label>
                            <input type="number" id="mtAmbangStok" class="mt-input" min="0" max="9999" step="1" value="5">
                        </div>
                    </div>

                    <div id="mtMsg" class="mt-msg"></div>

                    <div class="btn-group">
                        <button type="submit" id="btnSimpanMenuCustom" class="btn-primary-merchant">Simpan Menu</button>
                        <button type="button" id="btnBatalEditMenu" class="btn-outline-merchant" style="display:none;" onclick="mtResetForm()">Batal</button>
                    </div>
                </form>
            </div>

            <div class="card-title" style="margin-top:14px;">Seluruh Katalog Menu (Bawaan &amp; Tambahan)</div>
            <div id="listMenuCustom"></div>

            <div style="margin-top:14px;" id="kategoriManagerHost"></div>
        `;
    }

    const selKat = document.getElementById('mtKategori');
    if (selKat && document.activeElement !== selKat) await mtIsiKategori();

    const listEl = document.getElementById('listMenuCustom');
    const allMenus = await fetchAllCatalogFromSupabase();
    if (listEl) {
        listEl.innerHTML = allMenus.map(item => {
            const ukuran = Array.isArray(item.ukuran) ? item.ukuran : [];
            const hargaMin = hargaMulai(item);
            const imgSrc = safeImgSrc(item.img_url || item.img, DEFAULT_MENU_IMG);
            const idAttr = escHtml(item.id);
            const badgeBawaan = item.is_bawaan ? '<span class="role-pill" style="margin-left:4px;">Bawaan</span>' : '';
            return `
                <div class="stok-card" style="margin-top:8px;">
                    <div class="stok-left">
                        <img src="${escHtml(imgSrc)}" class="stok-thumb" width="44" height="44" alt="${escHtml(item.nama)}">
                        <div class="mt-info">
                            <div class="stok-name"><b>${escHtml(item.nama)}</b>${badgeBawaan}</div>
                            <div class="mt-meta">${escHtml(item.kategori || 'Umum')} • Mulai ${rupiah(hargaMin)} • ${ukuran.length} ukuran</div>
                        </div>
                    </div>
                    <div class="mt-actions">
                        <button type="button" class="mt-btn-small" data-id="${idAttr}" onclick="mulaiEditMenuCustom(this.dataset.id)">Edit</button>
                        ${!item.is_bawaan ? `<button type="button" class="mt-btn-small danger" data-id="${idAttr}" onclick="hapusMenuCustom(this.dataset.id)">Hapus</button>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    await renderKategoriManager(document.getElementById('kategoriManagerHost'), supabase);
}

async function mulaiEditMenuCustom(menuId) {
    const allMenus = await fetchAllCatalogFromSupabase();
    const m = allMenus.find(x => String(x.id) === String(menuId));
    if (!m) return;

    mtResetForm();
    mtEditingId = m.id;
    mtEditingIsBuiltin = Boolean(m.is_bawaan);

    const foto = m.img_url || m.img || DEFAULT_MENU_IMG;
    mtFotoData = foto === DEFAULT_MENU_IMG ? '' : foto;

    document.getElementById('mtNama').value = m.nama || '';
    await mtIsiKategori(m.kategori || 'Dimsum Mentai');
    document.getElementById('mtDeskripsi').value = m.deskripsi || '';
    document.getElementById('mtGratis').value = m.gratis || '';
    document.getElementById('mtStokHarian').value = m.stok_harian != null ? String(m.stok_harian) : '';
    document.getElementById('mtAmbangStok').value = m.ambang_stok != null ? String(m.ambang_stok) : '5';
    document.getElementById('mtFotoPreview').src = foto || DEFAULT_MENU_IMG;

    (Array.isArray(m.ukuran) ? m.ukuran : []).forEach(u => mtTambahUkuran(u));
    (Array.isArray(m.addon) ? m.addon : []).forEach(a => mtTambahAddon(a));

    document.getElementById('mtFormTitle').textContent = m.is_bawaan ? `Edit Menu Bawaan: ${m.nama}` : 'Edit Menu';
    document.getElementById('btnSimpanMenuCustom').textContent = 'Simpan Perubahan';
    document.getElementById('btnBatalEditMenu').style.display = '';
    const card = document.getElementById('mt-form-card');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function handleSimpanMenuCustom(e) {
    e.preventDefault();

    const nama = document.getElementById('mtNama').value.trim();
    const kategoriSel = document.getElementById('mtKategori').value;
    const isKategoriBaru = kategoriSel === MT_KATEGORI_BARU;
    const kategoriBaru = (document.getElementById('mtKategoriBaru')?.value || '').trim();
    const deskripsi = document.getElementById('mtDeskripsi').value.trim();
    const gratis = document.getElementById('mtGratis').value.trim();
    const stokHarianRaw = document.getElementById('mtStokHarian')?.value ?? '';
    const ambangStokRaw = document.getElementById('mtAmbangStok')?.value ?? '5';

    const ukuranRows = Array.from(document.querySelectorAll('#mtUkuranList .mt-ukuran-row')).map(row => ({
        nama: row.querySelector('.mt-u-nama').value,
        porsi: row.querySelector('.mt-u-porsi').value,
        harga: row.querySelector('.mt-u-harga').value
    }));

    const addonRows = Array.from(document.querySelectorAll('#mtAddonList .mt-addon-row')).map(row => ({
        nama: row.querySelector('.mt-a-nama').value,
        harga: row.querySelector('.mt-a-harga').value
    }));

    const existingMenus = await fetchAllCatalogFromSupabase();
    const lama = mtEditingId ? existingMenus.find(x => String(x.id) === String(mtEditingId)) : null;

    // PB-024, PB-025, PB-029, PB-031, PB-039: Validasi ketat via SabangdorValidation
    const resVal = window.SabangdorValidation.validateMenuForm({
        nama,
        kategori: kategoriSel,
        isKategoriBaru,
        kategoriBaru,
        ukuranRows,
        addonRows,
        editingId: mtEditingId,
        isEditingBuiltin: mtEditingIsBuiltin,
        stokHarian: stokHarianRaw,
        ambangStok: ambangStokRaw
    }, existingMenus);

    if (!resVal.valid) {
        mtShowMsg(resVal.message, 'error');
        return;
    }

    const v = resVal.data;
    // Pastikan kategori baru ikut terdaftar di tabel menu_categories (PB-048)
    if (isKategoriBaru) {
        try {
            await supabase.from('menu_categories').upsert([{
                id: 'cat-' + v.kategori.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                nama: v.kategori,
                deskripsi: 'Menu pilihan outlet',
                urutan: 50
            }]);
        } catch (e2) {}
    }

    const menuData = {
        ...(lama || {}),
        id: mtEditingId || ('custom-' + Date.now()),
        nama: v.nama,
        kategori: v.kategori,
        deskripsi,
        img: mtFotoData || (lama ? (lama.img_url || lama.img) : DEFAULT_MENU_IMG),
        gratis,
        ukuran: v.ukuran,
        addon: v.addon,
        stok_harian: v.stok_harian,
        ambang_stok: v.ambang_stok,
        habis: v.stok_harian !== null && v.stok_harian === 0 ? true : Boolean(lama && lama.habis),
        is_bawaan: mtEditingIsBuiltin
    };

    const btn = document.getElementById('btnSimpanMenuCustom');
    if (btn) btn.disabled = true;
    try {
        const ok = await saveMenuToSupabase(menuData);
        if (ok) {
            const wasEdit = !!mtEditingId;
            mtResetForm();
            mtShowMsg(wasEdit ? 'Perubahan menu berhasil disimpan!' : 'Menu berhasil ditambahkan!', 'ok');
            await renderMenuTambahan();
        } else {
            mtShowMsg(galatDbTerakhir || 'Gagal menyimpan menu.', 'error');
        }
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function hapusMenuCustom(menuId) {
    if (!confirm('Hapus menu ini secara permanen?')) return;
    const ok = await deleteCustomMenuFromSupabase(menuId);
    if (ok) {
        if (String(mtEditingId) === String(menuId)) mtResetForm();
        mtShowMsg('Menu berhasil dihapus.', 'ok');
        await renderMenuTambahan();
    } else {
        mtShowMsg(galatDbTerakhir || 'Gagal menghapus menu.', 'error');
    }
}

// ==========================================
// 7. KELOLA PEMILIK (SUBTABS)
// ==========================================
function switchKelolaSubtab(sub, btn) {
    activeKelolaSubtab = sub;
    document.querySelectorAll('#sec-kelola .subtab-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderKelolaSection();
}

async function renderKelolaSection() {
    if (!isPemilikRole()) return;
    const host = document.getElementById('kelola-panel-container');
    if (!host) return;
    host.innerHTML = '<div class="empty-info">Memuat panel pengelolaan...</div>';

    if (activeKelolaSubtab === 'jadwal') {
        await renderJadwalPreorderPanel(host, supabase, getSetting, setSetting);
    } else if (activeKelolaSubtab === 'voucher') {
        await renderVoucherLoyalPanel(host, supabase);
    } else if (activeKelolaSubtab === 'apriori') {
        const menus = await fetchAllCatalogFromSupabase();
        await renderAprioriBundlingPanel(host, supabase, getSetting, setSetting, menus);
    } else if (activeKelolaSubtab === 'ulasan') {
        await renderUlasanPanel(host, supabase);
    } else if (activeKelolaSubtab === 'pegawai') {
        await renderPegawai2faPanel(host, supabase, currentStaffUser);
    } else if (activeKelolaSubtab === 'audit') {
        await renderAuditTelemetryPanel(host, supabase);
    }
}

// ==========================================
// 8. BUKA / TUTUP TOKO (DENGAN OVERRIDE JADWAL PB-064)
// ==========================================
let tokoBuka = true;

async function muatStatusToko() {
    if (window.SabangdorSettings) {
        await window.SabangdorSettings.muat();
        tokoBuka = localStorage.getItem('sabangdor_status_toko') !== 'tutup';
    } else {
        tokoBuka = (await getSetting('status_toko', 'buka')) !== 'tutup';
    }
    updateUIStatusToko();
}

async function toggleStatusToko() {
    const statusBaru = tokoBuka ? 'tutup' : 'buka';
    try {
        await setSetting('status_toko', statusBaru);
        // PB-064: Simpan juga override hari ini agar menimpa jadwal otomatis bila jadwal aktif
        const wib = window.SabangdorSettings ? window.SabangdorSettings.getWibNowParts() : { dateStr: new Date().toISOString().slice(0, 10) };
        await setSetting('status_toko_override', JSON.stringify({ tanggal: wib.dateStr, status: statusBaru }));
        tokoBuka = statusBaru === 'buka';
        updateUIStatusToko();
    } catch (err) {
        alert(fmtErr(err));
    }
}

function updateUIStatusToko() {
    const btn = document.getElementById('btn-toggle-toko');
    if (!btn) return;
    btn.className = 'btn-toggle-stok ' + (tokoBuka ? 'ready' : 'empty');
    btn.innerHTML = `<span class="status-dot" aria-hidden="true"></span>${tokoBuka ? 'TOKO BUKA' : 'TOKO TUTUP'}`;
}

// ==========================================
// 9. POS KASIR MANUAL (+ MODE OFFLINE PB-076)
// ==========================================
let kasirCart = [];
let kasirSelectedMenu = null;
let kasirActiveSize = null;
let kasirActiveAddons = [];
let kasirBakpaoQtyMap = { 'Salted Egg': 0, 'Kacang Tanah': 0, 'Ayam Casio': 0, 'Coklat Lumer': 0, 'Keju Susu': 0 };

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

async function isiDropdownMenuKasirInteractive() {
    const select = document.getElementById('kasirPilihMenu');
    if (!select) return;

    const allMenus = await fetchAllCatalogFromSupabase();
    const semuaMenu = allMenus
        .filter(m => !m.habis && (m.stok_harian == null || Number(m.stok_harian) > 0))
        .map(m => ({
            id: m.id,
            nama: m.nama,
            kategori: m.kategori || 'Umum',
            tipe_menu: m.tipe_menu || (String(m.nama || '').toLowerCase() === 'bakpao' ? 'bakpao' : 'reguler'),
            ukuran: Array.isArray(m.ukuran) && m.ukuran.length ? m.ukuran : [{ nama: 'Reguler', porsi: '1 porsi', harga: 10000 }],
            addon: Array.isArray(m.addon) ? m.addon : []
        }));

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

    if (kasirSelectedMenu.tipe_menu === 'bakpao') {
        kasirActiveSize = { nama: 'Paket Bakpao', porsi: 'custom', harga: 0 };
        const varianBakpao = Object.keys(kasirBakpaoQtyMap);
        ukuranContainer.innerHTML = `
            <div style="width:100%; display:flex; flex-direction:column; gap:6px;">
                <span style="font-size:11px; color:var(--text-muted);">Atur jumlah tiap varian bakpao:</span>
                ${varianBakpao.map(v => `
                    <div style="display:flex; justify-content:space-between; align-items:center; background:#F8FAFC; padding:6px 10px; border-radius:8px; border:1px solid var(--border-line);">
                        <span style="font-size:13.5px; font-weight:700;">${escHtml(v)}</span>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <button type="button" class="mt-btn-x" data-varian="${escHtml(v)}" onclick="ubahQtyBakpaoKasir(this.dataset.varian, -1)">-</button>
                            <span id="b_qty_${escHtml(v)}" style="font-weight:800; min-width:20px; text-align:center;">${kasirBakpaoQtyMap[v] || 0}</span>
                            <button type="button" class="mt-btn-x" data-varian="${escHtml(v)}" style="background:var(--red-tint); color:#BE123C;" onclick="ubahQtyBakpaoKasir(this.dataset.varian, 1)">+</button>
                        </div>
                    </div>
                `).join('')}
            </div>`;
        addonContainer.innerHTML = `<span style="font-size:11px; color:var(--text-muted);">Tidak ada tambahan opsional untuk bakpao.</span>`;
        kasirActiveAddons = [];
        return;
    }

    kasirActiveSize = kasirSelectedMenu.ukuran[0];
    ukuranContainer.innerHTML = kasirSelectedMenu.ukuran.map((u, idx) => `
        <button type="button" class="btn-outline-merchant size-chip" data-ukuran="${escHtml(u.nama)}"
            onclick="pilihUkuranKasir(this.dataset.ukuran)" style="flex:1; padding:8px; font-size:0.8rem;${idx === 0 ? ' border-color:var(--primary-red); background:var(--red-tint);' : ''}">
            <b>${escHtml(u.nama)}</b><br><small>${escHtml(u.porsi || '')} ${rupiah(u.harga)}</small>
        </button>
    `).join('');

    if (kasirSelectedMenu.addon && kasirSelectedMenu.addon.length > 0) {
        kasirActiveAddons = [];
        addonContainer.innerHTML = kasirSelectedMenu.addon.map((a, idx) => `
            <label style="display:flex; justify-content:space-between; align-items:center; background:#F8FAFC; padding:8px 10px; border-radius:8px; border:1px solid var(--border-line); font-size:0.85rem;">
                <span>${escHtml(a.name || a.nama)} (<span class="kasir-addon-harga" data-idx="${idx}">+${rupiah(a.harga)}</span>)</span>
                <input type="checkbox" class="kasir-addon-checkbox" value="${idx}" onchange="updateKasirAddonSelection()">
            </label>
        `).join('');
        refreshLabelHargaAddonKasir();
    } else {
        addonContainer.innerHTML = `<span style="font-size:11px; color:var(--text-muted);">Tidak ada tambahan opsional untuk menu ini.</span>`;
    }
}

function ubahQtyBakpaoKasir(varian, delta) {
    const total = Object.values(kasirBakpaoQtyMap).reduce((s, v) => s + (v || 0), 0);
    if (delta > 0 && total >= 99) return;
    kasirBakpaoQtyMap[varian] = Math.max(0, (kasirBakpaoQtyMap[varian] || 0) + delta);
    const el = document.getElementById(`b_qty_${varian}`);
    if (el) el.innerText = kasirBakpaoQtyMap[varian];
}

function pilihUkuranKasir(namaUkuran) {
    if (!kasirSelectedMenu) return;
    kasirActiveSize = kasirSelectedMenu.ukuran.find(u => u.nama === namaUkuran);
    updateKasirAddonSelection();
    document.querySelectorAll('.size-chip').forEach(btn => {
        const active = btn.dataset.ukuran === namaUkuran;
        btn.style.borderColor = active ? 'var(--primary-red)' : 'var(--border-line)';
        btn.style.background = active ? 'var(--red-tint)' : '#FFF';
    });
}

function hargaAddonKasir(addonObj, ukuran) {
    const nama = addonObj.name || addonObj.nama || '';
    const namaUkuran = ukuran ? String(ukuran.nama).trim().toUpperCase() : '';
    if (/extra mentai/i.test(nama) && namaUkuran === 'XL') return 5000;
    return Math.max(0, Number(addonObj.harga) || 0);
}

function updateKasirAddonSelection() {
    kasirActiveAddons = [];
    if (!kasirSelectedMenu || !kasirSelectedMenu.addon) return;
    document.querySelectorAll('.kasir-addon-checkbox:checked').forEach(cb => {
        const addonObj = kasirSelectedMenu.addon[cb.value];
        if (addonObj) kasirActiveAddons.push({ nama: addonObj.name || addonObj.nama, harga: hargaAddonKasir(addonObj, kasirActiveSize) });
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
        if (addonObj) el.textContent = '+' + rupiah(hargaAddonKasir(addonObj, kasirActiveSize));
    });
}

function tambahItemKeKasirCartCustom() {
    if (!kasirSelectedMenu) return;
    const rawQty = parseInt(document.getElementById('kasirQtyItem').value, 10);
    if (isNaN(rawQty) || rawQty < 1 || rawQty > 99) {
        alert('Jumlah porsi harus antara 1 sampai 99.');
        return;
    }

    if (kasirSelectedMenu.tipe_menu === 'bakpao') {
        const picked = Object.keys(kasirBakpaoQtyMap).filter(v => kasirBakpaoQtyMap[v] > 0);
        const totalPcs = picked.reduce((s, v) => s + kasirBakpaoQtyMap[v], 0);
        if (totalPcs === 0) { alert('Pilih minimal 1 pcs bakpao.'); return; }
        const hargaUnit = window.SabangdorValidation.calculateBakpaoPrice(totalPcs);
        const varianDetail = picked.map(v => `${kasirBakpaoQtyMap[v]}x ${v}`).join(', ');
        kasirCart.push({
            namaMenu: 'Bakpao',
            namaItemDb: 'Bakpao',
            varian: `${totalPcs} pcs: ${varianDetail}`,
            hargaSatuan: hargaUnit,
            qty: rawQty,
            subtotal: hargaUnit * rawQty
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

    const base = Number(kasirActiveSize.harga) || 0;
    const addonTotal = kasirActiveAddons.reduce((s, a) => s + a.harga, 0);
    const unit = base + addonTotal;
    const addonTxt = kasirActiveAddons.length ? ` + ${kasirActiveAddons.map(a => a.nama).join(', ')}` : '';
    const varianFinal = `${kasirActiveSize.nama} (${kasirActiveSize.porsi || '1 porsi'})${addonTxt}`;

    const existingIdx = kasirCart.findIndex(i => i.namaMenu === kasirSelectedMenu.nama && i.varian === varianFinal);
    if (existingIdx > -1) {
        if (kasirCart[existingIdx].qty + rawQty > 99) { alert('Maksimal 99 porsi per item.'); return; }
        kasirCart[existingIdx].qty += rawQty;
        kasirCart[existingIdx].subtotal += unit * rawQty;
    } else {
        kasirCart.push({
            namaMenu: kasirSelectedMenu.nama,
            namaItemDb: kasirSelectedMenu.nama,
            varian: varianFinal,
            hargaSatuan: unit,
            qty: rawQty,
            subtotal: unit * rawQty
        });
    }

    document.getElementById('kasirQtyItem').value = 1;
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
                    <div style="font-size:0.75rem; color:var(--text-muted);">${rupiah(item.hargaSatuan)} / porsi</div>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <b>${rupiah(item.subtotal)}</b>
                    <button type="button" class="mt-btn-x" onclick="hapusKasirCartItem(${idx})">✕</button>
                </div>
            </li>`;
    }).join('');
    if (totalTxt) totalTxt.innerText = rupiah(grandTotal);
    hitungKembalianKasirDirect();
}

function onChangeKasirMetodeBayar() {
    const metode = document.getElementById('kasirMetodeBayar').value;
    const boxTunai = document.getElementById('kasirBoxTunai');
    if (boxTunai) boxTunai.style.display = metode === 'TUNAI' ? 'block' : 'none';
}

function hitungKembalianKasirDirect() {
    const totalTagihan = kasirCart.reduce((sum, i) => sum + i.subtotal, 0);
    const valTunai = Number(document.getElementById('kasirUangDiterima').value) || 0;
    const box = document.getElementById('kasirKembalianTxt');
    if (!box) return;
    if (valTunai >= totalTagihan && totalTagihan > 0) {
        box.style.display = 'block';
        box.style.color = 'var(--green-text)';
        box.innerText = `Kembalian: ${rupiah(valTunai - totalTagihan)}`;
    } else if (valTunai > 0 && valTunai < totalTagihan) {
        box.style.display = 'block';
        box.style.color = 'var(--primary-red)';
        box.innerText = `Kurang: ${rupiah(totalTagihan - valTunai)}`;
    } else {
        box.style.display = 'none';
    }
}

async function prosesSimpanPesananKasir() {
    const msgBox = document.getElementById('kasirMsg');
    const namaPelangganInput = document.getElementById('kasirNamaPelanggan').value.trim();
    const sumberPesanan = document.getElementById('kasirSumberPesanan').value;
    const metodeBayar = document.getElementById('kasirMetodeBayar').value;
    const totalHarga = kasirCart.reduce((sum, i) => sum + i.subtotal, 0);

    if (kasirCart.length === 0) {
        msgBox.textContent = 'Pilih minimal 1 item pesanan.';
        msgBox.className = 'mt-msg show error';
        return;
    }
    if (metodeBayar === 'TUNAI') {
        const valTunai = Number(document.getElementById('kasirUangDiterima').value) || 0;
        if (valTunai < totalHarga) {
            msgBox.textContent = 'Nominal pembayaran tunai masih kurang.';
            msgBox.className = 'mt-msg show error';
            return;
        }
    }

    const tipePembayaranDb = metodeBayar.toUpperCase() === 'TUNAI' ? 'cash' : 'qris';
    const namaFinal = namaPelangganInput ? `[${sumberPesanan}] ${namaPelangganInput}` : sumberPesanan;
    const itemsPayload = kasirCart.map(i => ({
        nama_item: i.namaItemDb,
        varian: i.varian,
        catatan: `POS Manual (${sumberPesanan})`,
        jumlah: i.qty,
        harga_satuan: i.hargaSatuan,
        subtotal: i.subtotal
    }));
    const itemsCetak = kasirCart.map(i => ({ qty: i.qty, nama: i.namaItemDb, varian: i.varian, hargaSatuan: i.hargaSatuan, totalHargaItem: i.subtotal }));

    // PB-076: Mode Offline POS saat internet terputus
    if (!isOnline()) {
        const queued = enqueueOfflinePosOrder({
            p_nama: namaFinal,
            p_tipe: tipePembayaranDb,
            p_items: itemsPayload,
            p_status_bayar: 'lunas',
            p_status_pesanan: 'disiapkan'
        });
        updateConnectionBadge();
        tutupModalKasirOrder();
        kasirCart = [];
        alert(`Mode Offline: Pesanan disimpan lokal (#OFF-${queued.local_queue_num}) dan akan otomatis tersinkron ke server saat online.`);
        return;
    }

    const btnSimpan = document.getElementById('btnProsesKasirOrder');
    if (btnSimpan) btnSimpan.disabled = true;

    try {
        const txId = 'pos-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        let res = await supabase.rpc('buat_pesanan', {
            p_nama: namaFinal,
            p_tipe: tipePembayaranDb,
            p_items: itemsPayload,
            p_status_bayar: 'lunas',
            p_status_pesanan: 'disiapkan',
            p_client_tx_id: txId
        });
        if (res.error && (res.error.code === 'PGRST202' || /could not find the function/i.test(res.error.message || ''))) {
            res = await supabase.rpc('buat_pesanan', {
                p_nama: namaFinal,
                p_tipe: tipePembayaranDb,
                p_items: itemsPayload,
                p_status_bayar: 'lunas',
                p_status_pesanan: 'disiapkan'
            });
        }
        if (res.error) throw res.error;
        const hasil = res.data;
        const idOrderFormatted = `ANT-${String(hasil.nomor_antrean).padStart(2, '0')}`;

        tutupModalKasirOrder();
        kasirCart = [];

        const pesananBaruObjek = {
            db_id_order: hasil.id_order,
            idOrder: idOrderFormatted,
            namaPelanggan: namaFinal,
            metodeBayar: metodeBayar.toUpperCase(),
            totalHarga: totalHarga,
            totalHargaFormatted: rupiah(totalHarga),
            tanggal: new Date().toLocaleDateString('id-ID'),
            waktu: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
            items: itemsCetak
        };

        await renderCurrentSection(true);
        if (isAutoPrintEnabled() || confirm(`Pesanan ${idOrderFormatted} tersimpan! Cetak struk sekarang?`)) {
            await printThermalOrFallback(pesananBaruObjek, 'struk', cetakStrukHtml);
        }
    } catch (err) {
        // Jika gagal karena jaringan terputus di tengah jalan, simpan ke antrean offline!
        if (/failed to fetch|network/i.test(String(err && err.message || err))) {
            enqueueOfflinePosOrder({
                p_nama: namaFinal,
                p_tipe: tipePembayaranDb,
                p_items: itemsPayload,
                p_status_bayar: 'lunas',
                p_status_pesanan: 'disiapkan'
            });
            updateConnectionBadge();
            tutupModalKasirOrder();
            kasirCart = [];
            alert('Koneksi terputus — pesanan disimpan ke antrean offline dan akan otomatis disinkronkan saat online.');
            return;
        }
        msgBox.textContent = fmtErr(err, 'order');
        msgBox.className = 'mt-msg show error';
    } finally {
        if (btnSimpan) btnSimpan.disabled = false;
    }
}

// ==========================================
// EXPOSE KE WINDOW
// ==========================================
Object.assign(window, {
    navigate,
    toggleStatusToko,
    toggleNotifSuara,
    sinkronkanOfflineSekarang,
    bukaModalKasirOrder,
    tutupModalKasirOrder,
    bukaModalRetur,
    tutupModalRetur,
    prosesReturPesanan,
    bukaLightboxBukti,
    switchKitchenTab,
    switchRiwayatSubtab,
    switchKelolaSubtab,
    resetFilterTanggal,
    onKasirMenuChange,
    pilihUkuranKasir,
    updateKasirAddonSelection,
    tambahItemKeKasirCartCustom,
    hapusKasirCartItem,
    onChangeKasirMetodeBayar,
    hitungKembalianKasirDirect,
    prosesSimpanPesananKasir,
    konfirmasiPembayaran,
    batalkanPesanan,
    tandaiSiapDiambil,
    serahkanPesananKePembeli,
    cetakStrukLangsungById,
    cetakTiketDapurById,
    toggleStokMenu,
    simpanStokHarian,
    mulaiEditMenuCustom,
    hapusMenuCustom,
    renderCurrentSection,
    handleLogout,
    hapusQris,
    hubungkanBluetooth,
    hubungkanSerial,
    putusPrinter,
    ubahAutoPrint,
    ubahQtyBakpaoKasir,
    mtTambahUkuran,
    mtTambahAddon,
    mtPilihFoto,
    mtOnKategoriChange,
    mtResetForm,
    handleSimpanMenuCustom
});
