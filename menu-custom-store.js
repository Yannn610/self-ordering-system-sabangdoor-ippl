/**
 * - File: menu-custom-store.js (Versi Backend Express.js & PostgreSQL)
 * - Penyimpanan & helper bersama untuk "Menu Tambahan"
 */

const API_BASE_URL = 'http://localhost:5000/api';
const DEFAULT_MENU_IMG = 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80';

// Kategori bawaan -> id section yang sudah ada di index.html
const KATEGORI_BAWAAN = {
    'Dimsum Mentai': 'section-mentai',
    'Dimsum aja': 'section-dimsum-aja',
    'Bakpao': 'section-bakpao'
};

// Cache lokal untuk menyimpan data menu custom sementara di browser
let cachedCustomMenus = [];

// Ambil data menu custom dari Backend PostgreSQL
async function getCustomMenusFromSupabase() { // nama fungsi dipertahankan agar kompatibel
    try {
        const response = await fetch(`${API_BASE_URL}/menu-custom`);
        if (!response.ok) throw new Error('Gagal mengambil data menu custom');
        const data = await response.json();

        // Konversi format JSONB dari database kembali ke array objek JS jika diperlukan
        cachedCustomMenus = data.map(item => ({
            ...item,
            img: item.img_url || item.img || DEFAULT_MENU_IMG,
            ukuran: typeof item.ukuran === 'string' ? JSON.parse(item.ukuran) : (item.ukuran || []),
            addon: typeof item.addon === 'string' ? JSON.parse(item.addon) : (item.addon || [])
        }));

        return cachedCustomMenus;
    } catch (e) {
        console.error("Error mengambil menu custom:", e);
        return cachedCustomMenus;
    }
}

// Fungsi sinkronus cadangan yang mengembalikan data dari cache lokal
function getCustomMenus() {
    return cachedCustomMenus;
}

// Simpan atau Perbarui Menu Custom ke Backend PostgreSQL
async function saveCustomMenuToSupabase(menuObj) {
    try {
        const payload = {
            id: menuObj.id,
            nama: menuObj.nama,
            kategori: menuObj.kategori,
            deskripsi: menuObj.deskripsi,
            img_url: menuObj.img || menuObj.img_url || DEFAULT_MENU_IMG,
            gratis: menuObj.gratis || '',
            ukuran: menuObj.ukuran || [],
            addon: menuObj.addon || [],
            habis: menuObj.habis || false
        };

        const response = await fetch(`${API_BASE_URL}/menu-custom`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error('Gagal menyimpan menu ke database');

        // Refresh cache lokal
        await getCustomMenusFromSupabase();
        return true;
    } catch (e) {
        console.error("Gagal menyimpan menu:", e);
        alert('Gagal menyimpan menu ke database PostgreSQL lokal.');
        return false;
    }
}

// Hapus Menu Custom dari Backend PostgreSQL
async function deleteCustomMenuFromSupabase(id) {
    try {
        const response = await fetch(`${API_BASE_URL}/menu-custom/${id}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('Gagal menghapus menu dari database');

        // Refresh cache lokal
        await getCustomMenusFromSupabase();
        return true;
    } catch (e) {
        console.error("Gagal menghapus menu:", e);
        alert('Gagal menghapus menu dari database.');
        return false;
    }
}

function escHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function rupiah(n) {
    return 'Rp' + Number(n || 0).toLocaleString('id-ID');
}

function hargaMulai(menu) {
    const harga = (menu.ukuran || []).map(u => Number(u.harga) || 0).filter(h => h > 0);
    return harga.length ? Math.min(...harga) : 0;
}

function slugKategori(nama) {
    return String(nama).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'lainnya';
<<<<<<< HEAD
}//zero
=======
}

/* =====================================================================
 * SINKRONISASI SUPABASE (tabel: menu_custom)
 * Dipanggil oleh script-penjual.js. localStorage dipakai sebagai cache
 * supaya getCustomMenus() tetap sinkron & halaman pembeli tetap cepat.
 * Jika tabel belum dibuat / koneksi gagal, data tetap tersimpan di
 * localStorage (fallback) agar fitur tidak mati.
 * ===================================================================== */
const CUSTOM_MENU_TABLE = 'menu_custom';

function _sbReady() {
    return typeof supabaseClient !== 'undefined' && supabaseClient;
}

// Baris database -> objek menu yang dipakai UI
function _rowToMenu(row) {
    return {
        id: row.id,
        nama: row.nama,
        kategori: row.kategori,
        deskripsi: row.deskripsi || '',
        img: row.img_url || DEFAULT_MENU_IMG,
        img_url: row.img_url || DEFAULT_MENU_IMG,
        gratis: row.gratis || '',
        ukuran: Array.isArray(row.ukuran) ? row.ukuran : [],
        addon: Array.isArray(row.addon) ? row.addon : [],
        habis: !!row.habis
    };
}

// Objek menu -> baris database
function _menuToRow(menu) {
    const row = {
        id: String(menu.id),
        nama: menu.nama,
        kategori: menu.kategori,
        deskripsi: menu.deskripsi || '',
        img_url: menu.img || menu.img_url || DEFAULT_MENU_IMG,
        gratis: menu.gratis || '',
        ukuran: Array.isArray(menu.ukuran) ? menu.ukuran : [],
        addon: Array.isArray(menu.addon) ? menu.addon : []
    };
    if (typeof menu.habis === 'boolean') row.habis = menu.habis;
    return row;
}

async function getCustomMenusFromSupabase() {
    if (!_sbReady()) return getCustomMenus();
    try {
        const { data, error } = await supabaseClient
            .from(CUSTOM_MENU_TABLE)
            .select('*')
            .order('created_at', { ascending: true });
        if (error) throw error;

        const list = (data || []).map(_rowToMenu);
        // simpan ke cache lokal tanpa alert kalau penuh
        try { localStorage.setItem(CUSTOM_MENU_KEY, JSON.stringify(list)); } catch (e) {}
        return list;
    } catch (err) {
        console.warn('Gagal ambil menu custom dari Supabase, pakai cache lokal:', err.message || err);
        return getCustomMenus();
    }
}

async function saveCustomMenuToSupabase(menu) {
    // 1) Simpan ke cache lokal dulu
    const list = getCustomMenus();
    const idx = list.findIndex(m => String(m.id) === String(menu.id));
    const lokal = { ...menu, img_url: menu.img || menu.img_url };
    if (idx >= 0) list[idx] = lokal; else list.push(lokal);
    const okLokal = saveCustomMenus(list);
    if (!okLokal) return false;

    // 2) Kirim ke Supabase
    if (!_sbReady()) return true; // mode lokal saja
    try {
        const { error } = await supabaseClient
            .from(CUSTOM_MENU_TABLE)
            .upsert(_menuToRow(menu), { onConflict: 'id' });
        if (error) throw error;
        return true;
    } catch (err) {
        console.error('Gagal simpan ke Supabase (tersimpan lokal saja):', err.message || err);
        alert('Menu tersimpan di perangkat ini, tapi gagal sinkron ke database: ' +
              (err.message || err) + '\nCek tabel menu_custom dan RLS policy-nya (insert/update/delete).');
        return true;
    }
}

async function deleteCustomMenuFromSupabase(menuId) {
    // hapus di cache lokal
    saveCustomMenus(getCustomMenus().filter(m => String(m.id) !== String(menuId)));

    if (!_sbReady()) return true;
    try {
        const { error } = await supabaseClient
            .from(CUSTOM_MENU_TABLE)
            .delete()
            .eq('id', String(menuId));
        if (error) throw error;
        return true;
    } catch (err) {
        console.error('Gagal hapus di Supabase:', err.message || err);
        return false;
    }
}
>>>>>>> 37f1ff35d87754fc6f9f81685c5b529525d4dfdb
