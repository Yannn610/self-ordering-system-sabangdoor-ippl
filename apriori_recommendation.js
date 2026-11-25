(() => {
    'use strict';

    const LIMITS = { MAX_NAME_LEN: 80, MAX_BASKET_ITEMS: 30, MAX_ORDERS: 20000 };

    /** Mencegah manipulasi objek katalog dari script eksternal */
    function deepFreeze(obj) {
        if (!obj || typeof obj !== 'object') return obj;
        Object.freeze(obj);
        Object.keys(obj).forEach(k => {
            if (obj[k] && typeof obj[k] === 'object' && !Object.isFrozen(obj[k])) deepFreeze(obj[k]);
        });
        return obj;
    }

    /** Katalog metadata menu untuk integrasi antarmuka pengguna (UI) */
    const MENU_CATALOG = deepFreeze({
        "Mentai Ori": { nama: "Mentai Ori", variantInfo: "S / M / XL • 3 / 6 / 16 pcs", defaultVarian: "S (3 pcs)", harga: 13000, hargaFormatted: "Mulai Rp13.000", linkDetail: "dimsum-mentai-ori.html", imgSrc: "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80" },
        "Mentai Cheese": { nama: "Mentai Cheese", variantInfo: "S / M / XL • 3 / 6 / 16 pcs", defaultVarian: "S (3 pcs)", harga: 15000, hargaFormatted: "Mulai Rp15.000", linkDetail: "dimsum-mentai-cheese.html", imgSrc: "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80" },
        "Mentai Tanuki": { nama: "Mentai Tanuki", variantInfo: "S / M / XL • 3 / 6 / 16 pcs", defaultVarian: "S (3 pcs)", harga: 15000, hargaFormatted: "Mulai Rp15.000", linkDetail: "dimsum-mentai-tanuki.html", imgSrc: "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80" },
        "Mentai Mix": { nama: "Mentai Mix", variantInfo: "M / XL • S tidak tersedia", defaultVarian: "M (6 pcs)", harga: 26000, hargaFormatted: "Mulai Rp26.000", linkDetail: "dimsum-mix.html", imgSrc: "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80" },
        "Dimsum aja": { nama: "Dimsum aja", variantInfo: "S / M / XL • 3 / 6 / 16 pcs", defaultVarian: "S (3 pcs)", harga: 10000, hargaFormatted: "Mulai Rp10.000", linkDetail: "dimsum-aja.html", imgSrc: "https://images.unsplash.com/photo-1496116218417-1a781b1c416c?auto=format&fit=crop&w=600&q=80" },
        "Bakpao": { nama: "Bakpao", variantInfo: "5 Varian • 1 / 3 / 6 pcs", defaultVarian: "1 pcs: 1x Salted Egg", harga: 7000, hargaFormatted: "Mulai Rp7.000", linkDetail: "detail-menu-bakpao.html", imgSrc: "https://images.unsplash.com/photo-1563245372-f21724e3856d?auto=format&fit=crop&w=600&q=80" },
        "Extra Mentai": { nama: "Extra Mentai", isAddon: true, variantInfo: "Tambahan Saus Mentai", defaultVarian: "M (+Rp3.000)", harga: 3000, hargaFormatted: "Rp3.000", linkDetail: "index.html#section-mentai", imgSrc: "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80" },
        "Chilli Oil Extra": { nama: "Chilli Oil Extra", isAddon: true, variantInfo: "Tambahan Minyak Cabai", defaultVarian: "Tambahan", harga: 3000, hargaFormatted: "Rp3.000", linkDetail: "index.html#section-mentai", imgSrc: "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80" }
    });

    /** Menormalisasi nama menu dan mencegah injeksi XSS serta prototype pollution */
    function normalizeMenuName(rawName) {
        if (!rawName || typeof rawName !== 'string') return '';
        const clean = rawName.replace(/[<>'"\\;`]/g, '').trim().slice(0, LIMITS.MAX_NAME_LEN);
        if (!clean || clean === '__proto__' || clean === 'constructor' || clean === 'prototype') return '';

        const lower = clean.toLowerCase();
        if (lower.includes('bakpao')) return 'Bakpao';
        if (lower.includes('extra mentai') || lower.includes('saus mentai')) return 'Extra Mentai';
        if (lower.includes('chilli') || lower.includes('cabai') || lower.includes('minyak')) return 'Chilli Oil Extra';
        if (lower.includes('cheese') || lower.includes('cheeze')) return 'Mentai Cheese';
        if (lower.includes('tanuki')) return 'Mentai Tanuki';
        if (lower.includes('mix')) return 'Dimsum Mix';
        if (lower.includes('mentai') || lower.includes('ori')) return 'Mentai Ori';
        if (lower.includes('dimsum')) return 'Dimsum Aja';
        return clean;
    }

    /** Memvalidasi dan membatasi ukuran keranjang transaksi */
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

    /** Mengambil riwayat transaksi dari penyimpanan lokal browser (LocalStorage) */
    function getRealTransactions() {
        try {
            const orders = JSON.parse(localStorage.getItem('sabangdor_semua_pesanan')) || [];
            return orders.map(o => (o.items || []).map(i => i?.nama));
        } catch {
            return [];
        }
    }

    /** Mengambil riwayat transaksi riil dari Supabase database */
    async function getSupabaseTransactions(customClient) {
        const client = customClient || (typeof window !== 'undefined' ? window.supabaseClient : null);
        if (!client || typeof client.from !== 'function') return [];
        try {
            const { data, error } = await client.from('order_items')
                .select('id_order, nama_item, menus(nama_dimsum)')
                .limit(LIMITS.MAX_ORDERS);

            if (error || !Array.isArray(data) || data.length === 0) return [];
            const orders = new Map();
            for (const r of data) {
                const id = r?.id_order;
                const name = normalizeMenuName(r?.nama_item || r?.menus?.nama_dimsum);
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

    /**
     * Menghitung menu yang sering dipesan dan aturan asosiasi A -> B.
     * shortcut: hanya itemset k<=2, upgrade bila butuh bundle 3+ item.
     * @param {string[][]} baskets Daftar keranjang berisi nama menu (mentah atau sudah dinormalisasi).
     * @param {number} [minSupport=0.05] Ambang minimum support.
     * @param {number} [minConfidence=0.1] Ambang minimum confidence.
     * @returns {{frequentItemsets: Object<string,{count:number,support:number}>,
     *            rules: {antecedent:string,consequent:string,support:number,confidence:number,lift:number}[],
     *            totalTransactions: number}} Hasil model; rules terurut dari yang terkuat.
     */
    function trainApriori(baskets, minSupport = 0.05, minConfidence = 0.1) {
        const clean = (Array.isArray(baskets) ? baskets : [])
            .map(b => [...new Set((Array.isArray(b) ? b : []).map(normalizeMenuName).filter(Boolean))].sort())
            .filter(b => b.length);
        const total = clean.length;
        if (!total) return { frequentItemsets: {}, rules: [], totalTransactions: 0 };

        const items = new Map();
        const pairs = new Map();
        for (const b of clean) {
            b.forEach((a, i) => {
                items.set(a, (items.get(a) || 0) + 1);
                for (const c of b.slice(i + 1)) pairs.set(a + SEP + c, (pairs.get(a + SEP + c) || 0) + 1);
            });
        }

        const frequentItemsets = Object.create(null);
        items.forEach((count, item) => {
            if (count / total >= minSupport) frequentItemsets[item] = { count, support: count / total };
        });

        const rules = [];
        pairs.forEach((countAB, k) => {
            if (countAB / total < minSupport) return;
            const [x, y] = k.split(SEP);
            for (const [a, b] of [[x, y], [y, x]]) {
                const confidence = countAB / items.get(a);
                if (confidence >= minConfidence) {
                    rules.push({ antecedent: a, consequent: b, support: countAB / total, confidence, lift: confidence / (items.get(b) / total) });
                }
            }
        });
        rules.sort((a, b) => b.lift * b.confidence - a.lift * a.confidence); // heuristik urutan, bukan metrik standar

        return { frequentItemsets, rules, totalTransactions: total };
    }

    /** Menghasilkan daftar menu terpopuler berdasarkan nilai support transaksi riil */
    function getPopularRecommendations(frequentItemsets, limit = 5) {
        if (!frequentItemsets || typeof frequentItemsets !== 'object') return [];
        const maxLimit = Math.max(1, Math.min(20, Number(limit) || 5));

        return Object.keys(frequentItemsets)
            .map(nama => ({
                ...(MENU_CATALOG[nama] || { nama, harga: 10000, hargaFormatted: "Rp10.000", linkDetail: "index.html" }),
                support: frequentItemsets[nama].support,
                count: frequentItemsets[nama].count
            }))
            .sort((a, b) => b.support - a.support)
            .slice(0, limit);
    }

    /**
     * Menyarankan menu pelengkap untuk isi keranjang (cross-selling).
     * @param {object[]} rules Hasil trainApriori().rules.
     * @param {string[]} [cartItems=[]] Nama menu di keranjang saat ini.
     * @param {number} [limit=3] Jumlah maksimum saran.
     * @returns {object[]} Metadata menu ditambah support, confidence, lift, dan alasan.
     */
    function recommend(rules, cartItems = [], limit = 3) {
        const cart = new Set(cartItems.map(normalizeMenuName).filter(Boolean));
        const seen = new Set();
        const results = [];
        for (const r of rules || []) {
            if (results.length >= limit) break;
            if (!cart.has(r.antecedent) || cart.has(r.consequent) || seen.has(r.consequent)) continue;
            seen.add(r.consequent);
            results.push({ ...meta(r.consequent), support: r.support, confidence: r.confidence, lift: r.lift, alasan: `Sering dipesan bersama ${r.antecedent}` });
        }
        return results;
    }

    const engine = { getRealTransactions, getSupabaseTransactions, trainApriori, getPopularRecommendations, recommend };
    if (typeof module !== 'undefined') module.exports = engine;
    else window.AprioriEngine = engine;
})();
