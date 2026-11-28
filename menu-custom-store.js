/**
 * File: menu-custom-store.js
 * Katalog terpadu (Menu Bawaan + Menu Tambahan + Urutan Kategori + Stok Harian)
 * Mencakup PB-030 (pesan galat ramah), PB-047 (kelola menu bawaan), PB-048 (urutan kategori), PB-049 (stok harian).
 */

window.DEFAULT_MENU_IMG = window.DEFAULT_MENU_IMG || 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80';
window.CUSTOM_MENU_KEY = window.CUSTOM_MENU_KEY || 'sabangdor_custom_menus';
window.CATEGORIES_KEY = window.CATEGORIES_KEY || 'sabangdor_menu_categories';

var DEFAULT_MENU_IMG = window.DEFAULT_MENU_IMG;
var CUSTOM_MENU_KEY = window.CUSTOM_MENU_KEY;
var CATEGORIES_KEY = window.CATEGORIES_KEY;

window.KATEGORI_BAWAAN = window.KATEGORI_BAWAAN || {
    'Dimsum Mentai': 'section-mentai',
    'Dimsum aja': 'section-dimsum-aja',
    'Bakpao': 'section-bakpao'
};
var KATEGORI_BAWAAN = window.KATEGORI_BAWAAN;

// Fallback katalog bawaan jika database belum dimigrasi atau sedang offline
window.DEFAULT_BUILTIN_MENUS = [
    {
        id: 'builtin-mentai-ori', nama: 'Mentai Ori', kategori: 'Dimsum Mentai',
        deskripsi: 'Dimsum lembut dibalut saus mentai khas Sabangdor yang dipanggang aromatik.',
        img: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80',
        img_url: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80',
        gratis: 'Free Chilli Oil', is_bawaan: true, tipe_menu: 'reguler', urutan: 1, habis: false, stok_harian: null, ambang_stok: 5,
        legacyHref: 'dimsum-mentai-ori.html',
        ukuran: [
            { nama: 'S', porsi: '3 pcs', harga: 13000 },
            { nama: 'M', porsi: '6 pcs', harga: 23000 },
            { nama: 'XL', porsi: '16 pcs', harga: 60000 }
        ],
        addon: [{ nama: 'Extra Mentai', harga: 3000 }, { nama: 'Chilli Oil tambahan', harga: 3000 }]
    },
    {
        id: 'builtin-mentai-cheese', nama: 'Mentai Cheese', kategori: 'Dimsum Mentai',
        deskripsi: 'Dimsum saus mentai creamy berpadu keju lumer gurih di atasnya.',
        img: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80',
        img_url: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80',
        gratis: 'Free Chilli Oil', is_bawaan: true, tipe_menu: 'reguler', urutan: 2, habis: false, stok_harian: null, ambang_stok: 5,
        legacyHref: 'dimsum-mentai-cheese.html',
        ukuran: [
            { nama: 'S', porsi: '3 pcs', harga: 15000 },
            { nama: 'M', porsi: '6 pcs', harga: 26000 },
            { nama: 'XL', porsi: '16 pcs', harga: 67000 }
        ],
        addon: [{ nama: 'Extra Mentai', harga: 3000 }, { nama: 'Chilli Oil tambahan', harga: 3000 }]
    },
    {
        id: 'builtin-mentai-tanuki', nama: 'Mentai Tanuki', kategori: 'Dimsum Mentai',
        deskripsi: 'Dimsum saus mentai khas dengan taburan tanuki renyah gurih.',
        img: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80',
        img_url: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80',
        gratis: 'Free Chilli Oil', is_bawaan: true, tipe_menu: 'reguler', urutan: 3, habis: false, stok_harian: null, ambang_stok: 5,
        legacyHref: 'dimsum-mentai-tanuki.html',
        ukuran: [
            { nama: 'S', porsi: '3 pcs', harga: 15000 },
            { nama: 'M', porsi: '6 pcs', harga: 26000 },
            { nama: 'XL', porsi: '16 pcs', harga: 67000 }
        ],
        addon: [{ nama: 'Extra Mentai', harga: 3000 }, { nama: 'Chilli Oil tambahan', harga: 3000 }]
    },
    {
        id: 'builtin-mentai-mix', nama: 'Mentai Mix', kategori: 'Dimsum Mentai',
        deskripsi: 'Kombinasi varian mentai dalam satu paket porsi M atau XL.',
        img: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80',
        img_url: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80',
        gratis: 'Free Chilli Oil', is_bawaan: true, tipe_menu: 'reguler', urutan: 4, habis: false, stok_harian: null, ambang_stok: 5,
        legacyHref: 'dimsum-mix.html',
        ukuran: [
            { nama: 'M', porsi: '6 pcs', harga: 26000 },
            { nama: 'XL', porsi: '16 pcs', harga: 67000 }
        ],
        addon: [{ nama: 'Extra Mentai', harga: 3000 }, { nama: 'Chilli Oil tambahan', harga: 3000 }]
    },
    {
        id: 'builtin-dimsum-aja', nama: 'Dimsum aja', kategori: 'Dimsum aja',
        deskripsi: 'Dimsum kukus hangat lembut dengan pilihan porsi S, M, atau XL.',
        img: 'https://images.unsplash.com/photo-1496116218417-1a781b1c416c?auto=format&fit=crop&w=600&q=80',
        img_url: 'https://images.unsplash.com/photo-1496116218417-1a781b1c416c?auto=format&fit=crop&w=600&q=80',
        gratis: 'Free Chilli Oil', is_bawaan: true, tipe_menu: 'reguler', urutan: 5, habis: false, stok_harian: null, ambang_stok: 5,
        legacyHref: 'dimsum-aja.html',
        ukuran: [
            { nama: 'S', porsi: '3 pcs', harga: 10000 },
            { nama: 'M', porsi: '6 pcs', harga: 18000 },
            { nama: 'XL', porsi: '16 pcs', harga: 47000 }
        ],
        addon: [{ nama: 'Chilli Oil tambahan', harga: 3000 }]
    },
    {
        id: 'builtin-bakpao', nama: 'Bakpao', kategori: 'Bakpao',
        deskripsi: '5 varian lembut, bebas campur dalam satu pesanan dengan harga paket hemat.',
        img: 'https://images.unsplash.com/photo-1563245372-f21724e3856d?auto=format&fit=crop&w=600&q=80',
        img_url: 'https://images.unsplash.com/photo-1563245372-f21724e3856d?auto=format&fit=crop&w=600&q=80',
        gratis: '', is_bawaan: true, tipe_menu: 'bakpao', urutan: 6, habis: false, stok_harian: null, ambang_stok: 5,
        varian_bakpao: ['Salted Egg', 'Kacang Tanah', 'Ayam Casio', 'Coklat Lumer', 'Keju Susu'],
        legacyHref: 'detail-menu-bakpao.html',
        ukuran: [
            { nama: '1 pcs', porsi: '1 pcs', harga: 7000 },
            { nama: '3 pcs', porsi: '3 pcs', harga: 20000 },
            { nama: '6 pcs', porsi: '6 pcs', harga: 36000 }
        ],
        addon: []
    }
];

window.DEFAULT_CATEGORIES = [
    { id: 'cat-mentai', nama: 'Dimsum Mentai', deskripsi: 'Dimsum Mentai • Free Chilli Oil', urutan: 1 },
    { id: 'cat-dimsum-aja', nama: 'Dimsum aja', deskripsi: 'Dimsum kukus hangat dengan pilihan porsi S, M, atau XL', urutan: 2 },
    { id: 'cat-bakpao', nama: 'Bakpao', deskripsi: '5 varian • bebas campur dalam satu paket', urutan: 3 }
];

let cachedCustomMenus = [];
let cachedCategories = [];

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

async function getCategoriesFromSupabase() {
    try {
        const client = dapatkanSupabaseClient();
        if (client) {
            const { data, error } = await client
                .from('menu_categories')
                .select('*')
                .order('urutan', { ascending: true });
            if (!error && Array.isArray(data) && data.length > 0) {
                cachedCategories = data;
                localStorage.setItem(CATEGORIES_KEY, JSON.stringify(cachedCategories));
                return cachedCategories;
            }
        }
    } catch (e) {
        console.warn('Memakai daftar kategori default:', e.message || e);
    }
    const local = safeParseArray(localStorage.getItem(CATEGORIES_KEY));
    cachedCategories = local.length ? local : window.DEFAULT_CATEGORIES.slice();
    return cachedCategories;
}

function getCategories() {
    if (cachedCategories.length > 0) return cachedCategories;
    const local = safeParseArray(localStorage.getItem(CATEGORIES_KEY));
    return local.length ? local : window.DEFAULT_CATEGORIES.slice();
}

async function getCustomMenusFromSupabase() {
    try {
        const client = dapatkanSupabaseClient();
        if (client) {
            const { data, error } = await client
                .from('menu_custom')
                .select('*')
                .order('urutan', { ascending: true });

            if (error) throw error;

            if (Array.isArray(data)) {
                cachedCustomMenus = data.map(item => ({
                    ...item,
                    img: safeImgSrc(item.img_url || item.img, DEFAULT_MENU_IMG),
                    ukuran: safeParseArray(item.ukuran),
                    addon: safeParseArray(item.addon),
                    varian_bakpao: safeParseArray(item.varian_bakpao)
                }));

                localStorage.setItem(CUSTOM_MENU_KEY, JSON.stringify(cachedCustomMenus));
                return cachedCustomMenus;
            }
        }

        cachedCustomMenus = safeParseArray(localStorage.getItem(CUSTOM_MENU_KEY));
        return cachedCustomMenus;
    } catch (e) {
        console.warn('Gagal memuat katalog menu dari Supabase, memuat dari cache lokal:', e.message || e);
        cachedCustomMenus = safeParseArray(localStorage.getItem(CUSTOM_MENU_KEY));
        return cachedCustomMenus;
    }
}

function getCustomMenus() {
    if (cachedCustomMenus.length > 0) return cachedCustomMenus;
    try {
        return JSON.parse(localStorage.getItem(CUSTOM_MENU_KEY)) || [];
    } catch (e) {
        return [];
    }
}

/**
 * Mengembalikan seluruh katalog menu aktif (gabungan bawaan dari DB atau fallback + menu tambahan).
 */
function getAllCatalogMenus() {
    const dbMenus = getCustomMenus();
    const byName = new Map();

    // Mulai dengan bawaan fallback, lalu timpa dengan data terbaru dari DB (PB-047)
    window.DEFAULT_BUILTIN_MENUS.forEach(m => {
        byName.set(String(m.nama).trim().toLowerCase(), { ...m });
    });

    dbMenus.forEach(m => {
        if (!m || !m.nama) return;
        const key = String(m.nama).trim().toLowerCase();
        const prev = byName.get(key);
        byName.set(key, {
            ...(prev || {}),
            ...m,
            img: safeImgSrc(m.img_url || m.img, prev ? prev.img : DEFAULT_MENU_IMG),
            ukuran: safeParseArray(m.ukuran),
            addon: safeParseArray(m.addon),
            varian_bakpao: safeParseArray(m.varian_bakpao).length
                ? safeParseArray(m.varian_bakpao)
                : (prev && prev.varian_bakpao ? prev.varian_bakpao : [])
        });
    });

    return Array.from(byName.values()).sort((a, b) => (Number(a.urutan) || 100) - (Number(b.urutan) || 100));
}

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
            habis: Boolean(menuObj.habis),
            is_bawaan: Boolean(menuObj.is_bawaan),
            tipe_menu: menuObj.tipe_menu || 'reguler',
            stok_harian: menuObj.stok_harian === undefined ? null : menuObj.stok_harian,
            ambang_stok: menuObj.ambang_stok == null ? 5 : Number(menuObj.ambang_stok),
            urutan: menuObj.urutan == null ? 100 : Number(menuObj.urutan)
        };

        const client = dapatkanSupabaseClient();
        if (client) {
            const { error } = await client.from('menu_custom').upsert([payload]);
            if (error) throw error;
        }

        const index = cachedCustomMenus.findIndex(m => String(m.id) === String(payload.id));
        if (index > -1) {
            cachedCustomMenus[index] = { ...cachedCustomMenus[index], ...payload, img: payload.img_url };
        } else {
            cachedCustomMenus.push({ ...payload, img: payload.img_url });
        }
        localStorage.setItem(CUSTOM_MENU_KEY, JSON.stringify(cachedCustomMenus));
        await getCustomMenusFromSupabase();
        return true;
    } catch (e) {
        console.error('Gagal menyimpan menu:', e);
        const msg = window.SabangdorErrors
            ? window.SabangdorErrors.formatError(e, 'menu')
            : 'Gagal menyimpan menu. Silakan coba lagi.';
        alert(msg);
        return false;
    }
}

async function deleteCustomMenuFromSupabase(id) {
    try {
        const client = dapatkanSupabaseClient();
        if (client) {
            const { error } = await client.from('menu_custom').delete().eq('id', id);
            if (error) throw error;
        }

        cachedCustomMenus = cachedCustomMenus.filter(m => String(m.id) !== String(id));
        localStorage.setItem(CUSTOM_MENU_KEY, JSON.stringify(cachedCustomMenus));
        await getCustomMenusFromSupabase();
        return true;
    } catch (e) {
        console.error('Gagal menghapus menu:', e);
        const msg = window.SabangdorErrors
            ? window.SabangdorErrors.formatError(e, 'menu')
            : 'Gagal menghapus menu. Silakan coba lagi.';
        alert(msg);
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

window.getCustomMenusFromSupabase = getCustomMenusFromSupabase;
window.getCustomMenus = getCustomMenus;
window.getAllCatalogMenus = getAllCatalogMenus;
window.getCategoriesFromSupabase = getCategoriesFromSupabase;
window.getCategories = getCategories;
window.saveCustomMenuToSupabase = saveCustomMenuToSupabase;
window.deleteCustomMenuFromSupabase = deleteCustomMenuFromSupabase;
