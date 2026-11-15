(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.AprioriEngine = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
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
        "Mentai Ori": { nama: "Mentai Ori", variantInfo: "S / M / XL | 3 / 6 / 16 pcs", harga: 13000, hargaFormatted: "Mulai Rp13.000", linkDetail: "dimsum-mentai-ori.html", imgSrc: "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80" },
        "Mentai Cheese": { nama: "Mentai Cheese", variantInfo: "S / M / XL | 3 / 6 / 16 pcs", harga: 15000, hargaFormatted: "Mulai Rp15.000", linkDetail: "dimsum-mentai-cheese.html", imgSrc: "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80" },
        "Mentai Tanuki": { nama: "Mentai Tanuki", variantInfo: "S / M / XL | 3 / 6 / 16 pcs", harga: 15000, hargaFormatted: "Mulai Rp15.000", linkDetail: "dimsum-mentai-tanuki.html", imgSrc: "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80" },
        "Dimsum Mix": { nama: "Dimsum Mix", variantInfo: "M / XL | S tidak tersedia", harga: 26000, hargaFormatted: "Mulai Rp26.000", linkDetail: "dimsum-mix.html", imgSrc: "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80" },
        "Dimsum Aja": { nama: "Dimsum Aja", variantInfo: "S / M / XL | 3 / 6 / 16 pcs", harga: 10000, hargaFormatted: "Mulai Rp10.000", linkDetail: "dimsum-aja.html", imgSrc: "https://images.unsplash.com/photo-1496116218417-1a781b1c416c?auto=format&fit=crop&w=600&q=80" },
        "Bakpao": { nama: "Bakpao", variantInfo: "5 Varian | 1 / 3 / 6 pcs", harga: 7000, hargaFormatted: "Mulai Rp7.000", linkDetail: "detail-menu-bakpao.html", imgSrc: "https://images.unsplash.com/photo-1563245372-f21724e3856d?auto=format&fit=crop&w=600&q=80" },
        "Extra Mentai": { nama: "Extra Mentai", variantInfo: "Add-on Saus Mentai Gurih", harga: 3000, hargaFormatted: "Rp3.000", linkDetail: "index.html#section-mentai", imgSrc: "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80" },
        "Chilli Oil Extra": { nama: "Chilli Oil Extra", variantInfo: "Add-on Minyak Cabai Spesial", harga: 3000, hargaFormatted: "Rp3.000", linkDetail: "index.html#section-mentai", imgSrc: "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80" }
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
        if (typeof window === 'undefined' || !window.localStorage) return [];
        try {
            const raw = localStorage.getItem('sabangdor_semua_pesanan');
            const parsed = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(parsed)) return [];
            return parsed.slice(0, LIMITS.MAX_ORDERS).map(o => {
                const items = Array.isArray(o?.items) ? o.items : [];
                return items.map(i => normalizeMenuName(i?.nama)).filter(Boolean);
            }).filter(b => b.length > 0);
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
            return Array.from(orders.values()).filter(b => b.length > 0);
        } catch {
            return [];
        }
    }

    /**
     * Melatih model Apriori: menghitung frequent itemsets dan association rules (Support, Confidence, Lift)
     */
    function trainApriori(baskets, minSupport = 0.05, minConfidence = 0.1) {
        if (!Array.isArray(baskets) || baskets.length === 0) baskets = getRealTransactions();

        const validSupport = typeof minSupport === 'number' && minSupport > 0 && minSupport <= 1 ? minSupport : 0.05;
        const validConfidence = typeof minConfidence === 'number' && minConfidence >= 0 && minConfidence <= 1 ? minConfidence : 0.1;

        const cleanBaskets = baskets.slice(0, LIMITS.MAX_ORDERS).map(sanitizeBasket).filter(b => b.length > 0);
        const totalTransactions = cleanBaskets.length;
        if (totalTransactions === 0) return { frequentItemsets: {}, rules: [], totalTransactions: 0 };

        const itemCounts = new Map();
        const pairCounts = new Map();

        // Hitung frekuensi 1-itemset dan 2-itemset
        for (const items of cleanBaskets) {
            const len = items.length;
            for (let i = 0; i < len; i++) {
                const itemA = items[i];
                itemCounts.set(itemA, (itemCounts.get(itemA) || 0) + 1);
                for (let j = i + 1; j < len; j++) {
                    const itemB = items[j];
                    pairCounts.set(`${itemA}__${itemB}`, (pairCounts.get(`${itemA}__${itemB}`) || 0) + 1);
                    pairCounts.set(`${itemB}__${itemA}`, (pairCounts.get(`${itemB}__${itemA}`) || 0) + 1);
                }
            }
        }

        // Filter Frequent 1-Itemsets berdasarkan minSupport
        const frequentItemsets = Object.create(null);
        itemCounts.forEach((count, item) => {
            const support = count / totalTransactions;
            if (support >= validSupport) frequentItemsets[item] = { count, support: Number(support.toFixed(4)) };
        });

        // Bentuk Aturan Asosiasi (Rules: Antecedent -> Consequent)
        const rules = [];
        pairCounts.forEach((countAB, pairKey) => {
            const [itemA, itemB] = pairKey.split('__');
            const countA = itemCounts.get(itemA) || 0;
            const countB = itemCounts.get(itemB) || 0;
            if (!countA || !countB) return;

            const supportAB = countAB / totalTransactions;
            if (supportAB >= validSupport) {
                const confidence = supportAB / (countA / totalTransactions);
                const lift = confidence / (countB / totalTransactions);
                if (confidence >= validConfidence) {
                    rules.push({
                        antecedent: itemA,
                        consequent: itemB,
                        support: Number(supportAB.toFixed(3)),
                        confidence: Number(confidence.toFixed(3)),
                        lift: Number(lift.toFixed(3))
                    });
                }
            }
        });

        rules.sort((a, b) => (b.lift * b.confidence) - (a.lift * a.confidence));
        return { frequentItemsets, rules, totalTransactions };
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
            .slice(0, maxLimit);
    }

    /** Menghasilkan rekomendasi pelengkap (cross-selling) dari kombinasi menu di keranjang belanja */
    function recommend(rules, cartItems = [], limit = 3) {
        if (!Array.isArray(rules) || rules.length === 0) return [];
        const maxLimit = Math.max(1, Math.min(10, Number(limit) || 3));
        const cartSet = new Set((Array.isArray(cartItems) ? cartItems : []).map(normalizeMenuName).filter(Boolean));
        const recommendedSet = new Set();
        const results = [];

        for (const rule of rules) {
            if (cartSet.has(rule.antecedent) && !cartSet.has(rule.consequent) && !recommendedSet.has(rule.consequent)) {
                recommendedSet.add(rule.consequent);
                const meta = MENU_CATALOG[rule.consequent] || { nama: rule.consequent, harga: 10000, hargaFormatted: "Rp10.000" };
                results.push({
                    ...meta,
                    support: rule.support,
                    confidence: rule.confidence,
                    lift: rule.lift,
                    alasan: `Sering dipesan bersama ${rule.antecedent}`
                });
                if (results.length >= maxLimit) break;
            }
        }
        return results;
    }

    const engine = {
        MENU_CATALOG,
        normalizeMenuName,
        normalizeName: normalizeMenuName,
        getRealTransactions,
        getSupabaseTransactions,
        trainApriori,
        train: trainApriori,
        getPopularRecommendations,
        recommend
    };

    if (typeof process !== 'undefined' && process.argv && process.argv[1] && process.argv[1].endsWith('apriori_recommendation.js')) {
        const { rules, frequentItemsets, totalTransactions } = trainApriori();
        console.log(`[Sabangdor Apriori Engine] Transaksi: ${totalTransactions}, Menu terdeteksi: ${Object.keys(frequentItemsets).length}, Rules: ${rules.length}`);
    }

    return engine;
}));
