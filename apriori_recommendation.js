(() => {
    'use strict';

    const SEP = '\0';
    const MAX_ROWS = 20000;
    const IMG = 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80';
    const SIZES = 'S / M / XL | 3 / 6 / 16 pcs';

    /** Katalog menu induk beserta metadata tampilan (harga mulai-dari, link detail, gambar). */
    const MENU_CATALOG = {
        "Mentai Ori":       { nama: "Mentai Ori",       variantInfo: SIZES, harga: 13000, hargaFormatted: "Mulai Rp13.000", linkDetail: "dimsum-mentai-ori.html",    imgSrc: IMG },
        "Mentai Cheese":    { nama: "Mentai Cheese",    variantInfo: SIZES, harga: 15000, hargaFormatted: "Mulai Rp15.000", linkDetail: "dimsum-mentai-cheese.html", imgSrc: IMG },
        "Mentai Tanuki":    { nama: "Mentai Tanuki",    variantInfo: SIZES, harga: 15000, hargaFormatted: "Mulai Rp15.000", linkDetail: "dimsum-mentai-tanuki.html", imgSrc: IMG },
        "Dimsum Mix":       { nama: "Dimsum Mix",       variantInfo: "M / XL | S tidak tersedia", harga: 26000, hargaFormatted: "Mulai Rp26.000", linkDetail: "dimsum-mix.html", imgSrc: IMG },
        "Dimsum Aja":       { nama: "Dimsum Aja",       variantInfo: SIZES, harga: 10000, hargaFormatted: "Mulai Rp10.000", linkDetail: "dimsum-aja.html", imgSrc: "https://images.unsplash.com/photo-1496116218417-1a781b1c416c?auto=format&fit=crop&w=600&q=80" },
        "Bakpao":           { nama: "Bakpao",           variantInfo: "5 Varian | 1 / 3 / 6 pcs", harga: 7000, hargaFormatted: "Mulai Rp7.000", linkDetail: "detail-menu-bakpao.html", imgSrc: "https://images.unsplash.com/photo-1563245372-f21724e3856d?auto=format&fit=crop&w=600&q=80" },
        "Extra Mentai":     { nama: "Extra Mentai",     variantInfo: "Add-on Saus Mentai Gurih",    harga: 3000, hargaFormatted: "Rp3.000", linkDetail: "index.html#section-mentai", imgSrc: IMG },
        "Chilli Oil Extra": { nama: "Chilli Oil Extra", variantInfo: "Add-on Minyak Cabai Spesial", harga: 3000, hargaFormatted: "Rp3.000", linkDetail: "index.html#section-mentai", imgSrc: IMG }
    };

    /**
     * Membuat kunci pencarian dari nama menu agar ejaan lama dan nama katalog cocok.
     * @param {string} s Nama menu.
     * @returns {string} Kunci pencarian.
     */
    const key = s => s.toLowerCase().replace(/^dimsum /, '').replace('cheeze', 'cheese');
    const BY_KEY = new Map(Object.keys(MENU_CATALOG).map(n => [key(n), n]));
    BY_KEY.set('mentai mix', 'Dimsum Mix');

    /**
     * Mengambil metadata menu dari katalog, atau metadata cadangan untuk menu di luar katalog.
     * @param {string} n Nama menu yang sudah dinormalisasi.
     * @returns {object} Metadata menu.
     */
    const meta = n => Object.hasOwn(MENU_CATALOG, n)
        ? MENU_CATALOG[n]
        : { nama: n, harga: 10000, hargaFormatted: 'Rp10.000', linkDetail: 'index.html' };

    /**
     * Melipat nama varian ke menu induknya, mis. "Bakpao Salted Egg (1 pcs)" -> "Bakpao".
     * Nama yang tidak dikenal (menu custom) dikembalikan apa adanya.
     * @param {*} raw Nama menu mentah.
     * @returns {string} Nama menu induk, atau string kosong jika input tidak valid.
     */
    function normalizeMenuName(raw) {
        if (typeof raw !== 'string') return '';
        const name = raw.trim().slice(0, 80);
        const k = key(name.replace(/\s*[-(].*$/, ''));
        return BY_KEY.get(k) || (k.startsWith('bakpao') ? 'Bakpao' : name);
    }

    /**
     * Membaca riwayat pesanan dari localStorage ("sabangdor_semua_pesanan").
     * @returns {string[][]} Daftar keranjang, masing-masing berisi nama menu mentah; [] jika gagal.
     */
    function getRealTransactions() {
        try {
            const orders = JSON.parse(localStorage.getItem('sabangdor_semua_pesanan')) || [];
            return orders.map(o => (o.items || []).map(i => i?.nama));
        } catch {
            return [];
        }
    }

    /**
     * Membaca riwayat pesanan dari tabel order_items di Supabase, dikelompokkan per id_order.
     * @param {object} [client] Klien Supabase; default window.supabaseClient.
     * @returns {Promise<string[][]>} Daftar keranjang berisi nama menu mentah; [] jika gagal.
     */
    async function getSupabaseTransactions(client) {
        try {
            const { data } = await (client || window.supabaseClient).from('order_items')
                .select('id_order, nama_item, menus(nama_dimsum)')
                .order('id_order', { ascending: false })
                .limit(MAX_ROWS);
            const orders = new Map();
            for (const r of data || []) {
                const name = r.nama_item || r.menus?.nama_dimsum;
                if (!name) continue;
                if (!orders.has(r.id_order)) orders.set(r.id_order, []);
                orders.get(r.id_order).push(name);
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

    /**
     * Menyusun daftar menu terpopuler berdasarkan support.
     * @param {Object<string,{count:number,support:number}>} frequentItemsets Hasil trainApriori().frequentItemsets.
     * @param {number} [limit=5] Jumlah maksimum menu.
     * @returns {object[]} Metadata menu ditambah support dan count, terurut dari yang terbanyak.
     */
    function getPopularRecommendations(frequentItemsets, limit = 5) {
        return Object.keys(frequentItemsets || {})
            .map(nama => ({ ...meta(nama), support: frequentItemsets[nama].support, count: frequentItemsets[nama].count }))
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
