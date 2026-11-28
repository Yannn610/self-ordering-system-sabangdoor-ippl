/**
 * File: apriori_recommendation.js
 * Engine rekomendasi menu populer & cross-selling Apriori Sabangdor.
 * - PB-026: Memakai RPC teranonimisasi get_apriori_baskets() (tidak baca tabel orders/order_items publik).
 * - PB-054: Memprioritaskan hasil aturan & popularitas yang sudah dihitung di server (apriori_rules & apriori_popular).
 * - PB-083: Menyaring add-on dari rekomendasi populer & menyediakan defaultVarian valid sesuai regex SQL.
 */
(() => {
    'use strict';

    const LIMITS = { MAX_NAME_LEN: 80, MAX_BASKET_ITEMS: 30, MAX_ORDERS: 2000 };
    const SEP = '\u0000';

    function deepFreeze(obj) {
        if (!obj || typeof obj !== 'object') return obj;
        Object.freeze(obj);
        Object.keys(obj).forEach(k => {
            if (obj[k] && typeof obj[k] === 'object' && !Object.isFrozen(obj[k])) deepFreeze(obj[k]);
        });
        return obj;
    }

    const MENU_CATALOG = deepFreeze({
        "Mentai Ori": {
            nama: "Mentai Ori",
            variantInfo: "S / M / XL • 3 / 6 / 16 pcs",
            defaultVarian: "S (3 pcs)",
            harga: 13000,
            hargaFormatted: "Mulai Rp13.000",
            linkDetail: "dimsum-mentai-ori.html",
            imgSrc: "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80"
        },
        "Mentai Cheese": {
            nama: "Mentai Cheese",
            variantInfo: "S / M / XL • 3 / 6 / 16 pcs",
            defaultVarian: "S (3 pcs)",
            harga: 15000,
            hargaFormatted: "Mulai Rp15.000",
            linkDetail: "dimsum-mentai-cheese.html",
            imgSrc: "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80"
        },
        "Mentai Tanuki": {
            nama: "Mentai Tanuki",
            variantInfo: "S / M / XL • 3 / 6 / 16 pcs",
            defaultVarian: "S (3 pcs)",
            harga: 15000,
            hargaFormatted: "Mulai Rp15.000",
            linkDetail: "dimsum-mentai-tanuki.html",
            imgSrc: "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80"
        },
        "Mentai Mix": {
            nama: "Mentai Mix",
            variantInfo: "M / XL • S tidak tersedia",
            defaultVarian: "M (6 pcs)",
            harga: 26000,
            hargaFormatted: "Mulai Rp26.000",
            linkDetail: "dimsum-mix.html",
            imgSrc: "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80"
        },
        "Dimsum aja": {
            nama: "Dimsum aja",
            variantInfo: "S / M / XL • 3 / 6 / 16 pcs",
            defaultVarian: "S (3 pcs)",
            harga: 10000,
            hargaFormatted: "Mulai Rp10.000",
            linkDetail: "dimsum-aja.html",
            imgSrc: "https://images.unsplash.com/photo-1496116218417-1a781b1c416c?auto=format&fit=crop&w=600&q=80"
        },
        "Bakpao": {
            nama: "Bakpao",
            variantInfo: "5 Varian • 1 / 3 / 6 pcs",
            defaultVarian: "1 pcs: 1x Salted Egg",
            harga: 7000,
            hargaFormatted: "Mulai Rp7.000",
            linkDetail: "detail-menu-bakpao.html",
            imgSrc: "https://images.unsplash.com/photo-1563245372-f21724e3856d?auto=format&fit=crop&w=600&q=80"
        },
        "Extra Mentai": {
            nama: "Extra Mentai",
            isAddon: true,
            variantInfo: "Tambahan Saus Mentai",
            defaultVarian: "M (+Rp3.000)",
            harga: 3000,
            hargaFormatted: "Rp3.000",
            linkDetail: "index.html#section-mentai",
            imgSrc: "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80"
        },
        "Chilli Oil Extra": {
            nama: "Chilli Oil Extra",
            isAddon: true,
            variantInfo: "Tambahan Minyak Cabai",
            defaultVarian: "Tambahan",
            harga: 3000,
            hargaFormatted: "Rp3.000",
            linkDetail: "index.html#section-mentai",
            imgSrc: "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80"
        }
    });

    function normalizeMenuName(rawName) {
        if (!rawName || typeof rawName !== 'string') return '';
        const clean = rawName.replace(/[<>'"\\;`]/g, '').trim().slice(0, LIMITS.MAX_NAME_LEN);
        if (!clean || clean === '__proto__' || clean === 'constructor' || clean === 'prototype') return '';

        const lower = clean.toLowerCase();
        if (lower.includes('bakpao')) return 'Bakpao';
        if (lower.includes('extra mentai') || lower.includes('saus mentai')) return 'Extra Mentai';
        if (lower.includes('chilli') || lower.includes('chili') || lower.includes('cabai') || lower.includes('minyak')) return 'Chilli Oil Extra';
        if (lower.includes('cheese') || lower.includes('cheeze')) return 'Mentai Cheese';
        if (lower.includes('tanuki')) return 'Mentai Tanuki';
        if (lower.includes('mix')) return 'Mentai Mix';
        if (lower.includes('mentai') || lower.includes('ori')) return 'Mentai Ori';
        if (lower.includes('dimsum aja') || lower === 'dimsum') return 'Dimsum aja';
        return clean;
    }

    function meta(nama) {
        if (MENU_CATALOG[nama]) {
            // Cek jika harga/foto menu bawaan sudah diubah kasir di menu_custom (PB-047)
            const dynamic = findDynamicCatalogItem(nama);
            if (dynamic) return { ...MENU_CATALOG[nama], ...dynamic };
            return { ...MENU_CATALOG[nama] };
        }
        const dynamic = findDynamicCatalogItem(nama);
        if (dynamic) return dynamic;
        return {
            nama,
            variantInfo: 'Reguler',
            defaultVarian: 'Reguler (1 porsi)',
            harga: 10000,
            hargaFormatted: 'Mulai Rp10.000',
            linkDetail: 'index.html',
            imgSrc: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80'
        };
    }

    function findDynamicCatalogItem(nama) {
        try {
            if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null;
            const raw = JSON.parse(localStorage.getItem('sabangdor_custom_menus') || '[]');
            if (!Array.isArray(raw)) return null;
            const lower = String(nama || '').trim().toLowerCase();
            const found = raw.find(m => m && String(m.nama || '').trim().toLowerCase() === lower);
            if (!found) return null;
            const ukuran = Array.isArray(found.ukuran) ? found.ukuran : [];
            const minHarga = ukuran.length ? Math.min(...ukuran.map(u => Number(u.harga) || 0).filter(h => h > 0)) : 10000;
            const firstUk = ukuran[0];
            const isBakpao = found.tipe_menu === 'bakpao' || lower === 'bakpao';
            return {
                nama: found.nama,
                variantInfo: ukuran.length ? ukuran.map(u => u.nama).join(' / ') : 'Reguler',
                defaultVarian: isBakpao
                    ? '1 pcs: 1x Salted Egg'
                    : (firstUk ? `${firstUk.nama} (${firstUk.porsi || '1 porsi'})` : 'Reguler (1 porsi)'),
                harga: minHarga || 10000,
                hargaFormatted: 'Mulai Rp' + Number(minHarga || 10000).toLocaleString('id-ID'),
                linkDetail: `detail-menu-custom.html?id=${encodeURIComponent(found.id)}`,
                imgSrc: found.img || found.img_url || 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80'
            };
        } catch (e) {
            return null;
        }
    }

    function sanitizeBasket(basket) {
        if (!Array.isArray(basket)) return [];
        const unique = new Set();
        for (let i = 0; i < basket.length; i++) {
            if (unique.size >= LIMITS.MAX_BASKET_ITEMS) break;
            const item = normalizeMenuName(basket[i]);
            if (item) unique.add(item);
        }
        return Array.from(unique);
    }

    function getRealTransactions() {
        try {
            if (typeof localStorage === 'undefined') return [];
            const orders = JSON.parse(localStorage.getItem('sabangdor_semua_pesanan')) || [];
            return orders.map(o => (o.items || []).map(i => i && i.nama));
        } catch {
            return [];
        }
    }

    /**
     * PB-054: Ambil hasil rekomendasi yang sudah dihitung dan disimpan di server.
     * Mengembalikan null jika tabel server belum terisi/belum dimigrasi sehingga caller bisa fallback.
     */
    async function getServerRecommendations(customClient) {
        const client = customClient || (typeof window !== 'undefined' ? window.supabaseClient : null);
        if (!client || typeof client.from !== 'function') return null;
        try {
            const [popRes, rulesRes] = await Promise.all([
                client.from('apriori_popular').select('nama_item, order_count, support').order('support', { ascending: false }).limit(20),
                client.from('apriori_rules').select('id, antecedent, consequent, support, confidence, lift, aktif').eq('aktif', true).order('lift', { ascending: false }).limit(100)
            ]);
            if (popRes.error || rulesRes.error) return null;
            const popData = popRes.data || [];
            const rulesData = rulesRes.data || [];
            if (popData.length === 0 && rulesData.length === 0) return null;

            const frequentItemsets = Object.create(null);
            popData.forEach(r => {
                const name = normalizeMenuName(r.nama_item);
                if (!name) return;
                frequentItemsets[name] = {
                    count: Number(r.order_count) || 0,
                    support: Number(r.support) || 0
                };
            });

            const rules = rulesData
                .map(r => ({
                    id: r.id,
                    antecedent: normalizeMenuName(r.antecedent),
                    consequent: normalizeMenuName(r.consequent),
                    support: Number(r.support) || 0,
                    confidence: Number(r.confidence) || 0,
                    lift: Number(r.lift) || 1
                }))
                .filter(r => r.antecedent && r.consequent && r.antecedent !== r.consequent);

            return { frequentItemsets, rules, source: 'server' };
        } catch {
            return null;
        }
    }

    /**
     * PB-026: Ambil basket transaksi teranonimisasi lewat RPC get_apriori_baskets()
     * (tidak lagi membaca tabel orders/order_items secara langsung dari browser publik).
     */
    async function getSupabaseTransactions(customClient) {
        const client = customClient || (typeof window !== 'undefined' ? window.supabaseClient : null);
        if (!client || typeof client.rpc !== 'function') return [];
        try {
            const { data, error } = await client.rpc('get_apriori_baskets', { p_limit: LIMITS.MAX_ORDERS });
            if (error || !Array.isArray(data) || data.length === 0) return [];

            const orders = new Map();
            for (const r of data) {
                const id = r && r.id_order;
                const name = normalizeMenuName(r && r.nama_item);
                if (id && name) {
                    if (!orders.has(id)) orders.set(id, []);
                    orders.get(id).push(name);
                }
            }
            return [...orders.values()];
        } catch {
            return [];
        }
    }

    function trainApriori(baskets, minSupport = 0.05, minConfidence = 0.1) {
        const clean = (Array.isArray(baskets) ? baskets : [])
            .map(b => sanitizeBasket(b).sort())
            .filter(b => b.length);
        const total = clean.length;
        if (!total) return { frequentItemsets: {}, rules: [], totalTransactions: 0 };

        const items = new Map();
        const pairs = new Map();
        for (const b of clean) {
            b.forEach((a, i) => {
                items.set(a, (items.get(a) || 0) + 1);
                for (const c of b.slice(i + 1)) {
                    const key = a + SEP + c;
                    pairs.set(key, (pairs.get(key) || 0) + 1);
                }
            });
        }

        const frequentItemsets = Object.create(null);
        items.forEach((count, item) => {
            if (count / total >= minSupport) {
                frequentItemsets[item] = { count, support: count / total };
            }
        });

        const rules = [];
        pairs.forEach((countAB, k) => {
            if (countAB / total < minSupport) return;
            const [x, y] = k.split(SEP);
            for (const [a, b] of [[x, y], [y, x]]) {
                const confidence = countAB / items.get(a);
                if (confidence >= minConfidence) {
                    rules.push({
                        antecedent: a,
                        consequent: b,
                        support: countAB / total,
                        confidence,
                        lift: confidence / (items.get(b) / total)
                    });
                }
            }
        });
        rules.sort((a, b) => (b.lift * b.confidence) - (a.lift * a.confidence));

        return { frequentItemsets, rules, totalTransactions: total };
    }

    /**
     * PB-083: Hanya menu utama (bukan isAddon) yang tampil di tab "Paling Rekomendasi".
     */
    function getPopularRecommendations(frequentItemsets, limit = 5) {
        if (!frequentItemsets || typeof frequentItemsets !== 'object') return [];
        const maxLimit = Math.max(1, Math.min(20, Number(limit) || 5));

        return Object.keys(frequentItemsets)
            .map(nama => ({
                ...meta(nama),
                support: frequentItemsets[nama].support,
                count: frequentItemsets[nama].count
            }))
            .filter(item => !item.isAddon)
            .sort((a, b) => b.support - a.support)
            .slice(0, maxLimit);
    }

    function recommend(rules, cartItems = [], limit = 3) {
        const cart = new Set((Array.isArray(cartItems) ? cartItems : []).map(normalizeMenuName).filter(Boolean));
        const seen = new Set();
        const results = [];
        for (const r of rules || []) {
            if (results.length >= limit) break;
            if (!cart.has(r.antecedent) || cart.has(r.consequent) || seen.has(r.consequent)) continue;
            seen.add(r.consequent);
            results.push({
                ...meta(r.consequent),
                support: r.support,
                confidence: r.confidence,
                lift: r.lift,
                alasan: `Sering dipesan bersama ${r.antecedent}`
            });
        }
        return results;
    }

    const engine = {
        MENU_CATALOG,
        normalizeMenuName,
        sanitizeBasket,
        getRealTransactions,
        getServerRecommendations,
        getSupabaseTransactions,
        trainApriori,
        getPopularRecommendations,
        recommend
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = engine;
    else if (typeof window !== 'undefined') window.AprioriEngine = engine;
})();
