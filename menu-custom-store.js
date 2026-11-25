/**
 * File: menu-custom-store.js (Versi Integrasi Supabase Langsung)
 * Penyimpanan & helper bersama untuk "Menu Tambahan"
 */

window.DEFAULT_MENU_IMG = window.DEFAULT_MENU_IMG || 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80';
window.CUSTOM_MENU_KEY = window.CUSTOM_MENU_KEY || 'sabangdor_custom_menus';

var DEFAULT_MENU_IMG = window.DEFAULT_MENU_IMG;
var CUSTOM_MENU_KEY = window.CUSTOM_MENU_KEY;

// Kategori bawaan -> id section yang sudah ada di index.html
window.KATEGORI_BAWAAN = window.KATEGORI_BAWAAN || {
    'Dimsum Mentai': 'section-mentai',
    'Dimsum aja': 'section-dimsum-aja',
    'Bakpao': 'section-bakpao'
};
var KATEGORI_BAWAAN = window.KATEGORI_BAWAAN;

// Cache lokal untuk menyimpan data menu custom sementara di browser
let cachedCustomMenus = [];

// Helper untuk mengambil client Supabase yang tersedia
function dapatkanSupabaseClient() {
    if (typeof window !== 'undefined' && window.supabaseClient) {
        return window.supabaseClient;
    }
    return null;
}

function safeImgSrc(src, fallback) {
    var fb = fallback || DEFAULT_MENU_IMG;
    if (!src || typeof src !== 'string') return fb;
    var trimmed = src.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) return trimmed;
    return fb;
}

function safeParseArray(val) {
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
        try {
            var parsed = JSON.parse(val);
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }
    return [];
}

// Ambil data menu custom langsung dari Supabase
async function getCustomMenusFromSupabase() {
    try {
        const client = dapatkanSupabaseClient();
        if (client) {
            const { data, error } = await client
                .from('menu_custom')
                .select('*');

            if (error) throw error;

            if (Array.isArray(data)) {
                cachedCustomMenus = data.map(item => ({
                    ...item,
                    img: safeImgSrc(item.img_url || item.img, DEFAULT_MENU_IMG),
                    ukuran: safeParseArray(item.ukuran),
                    addon: safeParseArray(item.addon)
                }));

                localStorage.setItem(CUSTOM_MENU_KEY, JSON.stringify(cachedCustomMenus));
                return cachedCustomMenus;
            }
        }

        // Fallback ke localStorage jika koneksi/client belum siap
        cachedCustomMenus = safeParseArray(localStorage.getItem(CUSTOM_MENU_KEY));
        return cachedCustomMenus;
    } catch (e) {
        console.warn("Gagal memuat menu custom dari Supabase, memuat dari penyimpanan lokal:", e.message || e);
        cachedCustomMenus = safeParseArray(localStorage.getItem(CUSTOM_MENU_KEY));
        return cachedCustomMenus;
    }
}

// Fungsi sinkronus cadangan yang mengembalikan data dari cache lokal
function getCustomMenus() {
    if (cachedCustomMenus.length > 0) return cachedCustomMenus;
    try {
        return JSON.parse(localStorage.getItem(CUSTOM_MENU_KEY)) || [];
    } catch (e) {
        return [];
    }
}

// Simpan atau Perbarui Menu Custom langsung ke Supabase
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

        const client = dapatkanSupabaseClient();
        if (client) {
            const { error } = await client
                .from('menu_custom')
                .upsert([payload]);

            if (error) throw error;
        }

        // Simpan langsung ke cache lokal & localStorage
        const index = cachedCustomMenus.findIndex(m => String(m.id) === String(payload.id));
        if (index > -1) {
            cachedCustomMenus[index] = { ...cachedCustomMenus[index], ...payload };
        } else {
            cachedCustomMenus.push(payload);
        }
        localStorage.setItem(CUSTOM_MENU_KEY, JSON.stringify(cachedCustomMenus));

        // Segarkan ulang dari server jika online
        await getCustomMenusFromSupabase();
        return true;
    } catch (e) {
        console.error("Gagal menyimpan menu custom:", e);
        alert('Gagal menyimpan menu ke Supabase: ' + (e.message || e));
        return false;
    }
}

// Hapus Menu Custom langsung dari Supabase
async function deleteCustomMenuFromSupabase(id) {
    try {
        const client = dapatkanSupabaseClient();
        if (client) {
            const { error } = await client
                .from('menu_custom')
                .delete()
                .eq('id', id);

            if (error) throw error;
        }

        // Hapus dari cache lokal & localStorage
        cachedCustomMenus = cachedCustomMenus.filter(m => String(m.id) !== String(id));
        localStorage.setItem(CUSTOM_MENU_KEY, JSON.stringify(cachedCustomMenus));

        await getCustomMenusFromSupabase();
        return true;
    } catch (e) {
        console.error("Gagal menghapus menu custom:", e);
        alert('Gagal menghapus menu dari database: ' + (e.message || e));
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
}

// Ekspos fungsi utama ke window
window.getCustomMenusFromSupabase = getCustomMenusFromSupabase;
window.getCustomMenus = getCustomMenus;
window.saveCustomMenuToSupabase = saveCustomMenuToSupabase;
window.deleteCustomMenuFromSupabase = deleteCustomMenuFromSupabase;