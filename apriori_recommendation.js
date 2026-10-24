(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.AprioriEngine = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {

    // 1. Katalog Metadata Menu untuk Tampilan UI
    const MENU_CATALOG = {
        "Mentai Ori": {
            nama: "Mentai Ori",
            variantInfo: "S / M / XL | 3 / 6 / 16 pcs",
            harga: 13000,
            hargaFormatted: "Mulai Rp13.000",
            linkDetail: "dimsum-mentai-ori.html",
            imgSrc: "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80"
        },
        "Mentai Cheese": {
            nama: "Mentai Cheese",
            variantInfo: "S / M / XL | 3 / 6 / 16 pcs",
            harga: 15000,
            hargaFormatted: "Mulai Rp15.000",
            linkDetail: "dimsum-mentai-cheese.html",
            imgSrc: "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80"
        },
        "Mentai Tanuki": {
            nama: "Mentai Tanuki",
            variantInfo: "S / M / XL | 3 / 6 / 16 pcs",
            harga: 15000,
            hargaFormatted: "Mulai Rp15.000",
            linkDetail: "dimsum-mentai-tanuki.html",
            imgSrc: "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80"
        },
        "Dimsum Mix": {
            nama: "Dimsum Mix",
            variantInfo: "M / XL | S tidak tersedia",
            harga: 26000,
            hargaFormatted: "Mulai Rp26.000",
            linkDetail: "dimsum-mix.html",
            imgSrc: "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80"
        },
        "Dimsum Aja": {
            nama: "Dimsum Aja",
            variantInfo: "S / M / XL | 3 / 6 / 16 pcs",
            harga: 10000,
            hargaFormatted: "Mulai Rp10.000",
            linkDetail: "dimsum-aja.html",
            imgSrc: "https://images.unsplash.com/photo-1496116218417-1a781b1c416c?auto=format&fit=crop&w=600&q=80"
        },
        "Bakpao": {
            nama: "Bakpao",
            variantInfo: "5 Varian | 1 / 3 / 6 pcs",
            harga: 7000,
            hargaFormatted: "Mulai Rp7.000",
            linkDetail: "detail-menu-bakpao.html",
            imgSrc: "https://images.unsplash.com/photo-1563245372-f21724e3856d?auto=format&fit=crop&w=600&q=80"
        },
        "Extra Mentai": {
            nama: "Extra Mentai",
            variantInfo: "Add-on Saus Mentai Gurih",
            harga: 3000,
            hargaFormatted: "Rp3.000",
            linkDetail: "index.html#section-mentai",
            imgSrc: "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80"
        },
        "Chilli Oil Extra": {
            nama: "Chilli Oil Extra",
            variantInfo: "Add-on Minyak Cabai Spesial",
            harga: 3000,
            hargaFormatted: "Rp3.000",
            linkDetail: "index.html#section-mentai",
            imgSrc: "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80"
        }
    };

    // 2. Normalisasi Nama Menu
    function normalizeMenuName(rawName) {
        if (!rawName) return '';
        const s = String(rawName).toLowerCase().trim();
        if (s.includes('bakpao')) return 'Bakpao';
        if (s.includes('extra mentai') || s.includes('saus mentai')) return 'Extra Mentai';
        if (s.includes('chilli') || s.includes('cabai') || s.includes('minyak')) return 'Chilli Oil Extra';
        if (s.includes('cheese') || s.includes('cheeze')) return 'Mentai Cheese';
        if (s.includes('tanuki')) return 'Mentai Tanuki';
        if (s.includes('mix')) return 'Dimsum Mix';
        if (s.includes('mentai') || s.includes('ori')) return 'Mentai Ori';
        if (s.includes('dimsum')) return 'Dimsum Aja';
        return rawName.trim();
    }

    // 3. Ambil Transaksi Riil dari LocalStorage (Client-side)
    function getRealTransactions() {
        if (typeof window !== 'undefined' && window.localStorage) {
            try {
                const raw = JSON.parse(localStorage.getItem('sabangdor_semua_pesanan') || '[]');
                if (Array.isArray(raw) && raw.length > 0) {
                    return raw.map(order => {
                        const items = order.items || [];
                        return items.map(i => normalizeMenuName(i.nama)).filter(Boolean);
                    }).filter(basket => basket.length > 0);
                }
            } catch (e) {
                console.warn('Gagal membaca transaksi lokal:', e);
            }
        }
        return [];
    }

    // 3B. Ambil Transaksi Riil dari Supabase (Cloud Database)
    async function getSupabaseTransactions(customClient) {
        const client = customClient || (typeof window !== 'undefined' && window.supabaseClient);
        if (!client) return [];

        try {
            const { data, error } = await client
                .from('order_items')
                .select('id_order, menus(nama_dimsum)');

            if (error || !data || data.length === 0) return [];

            const ordersMap = {};
            data.forEach(row => {
                const id = row.id_order;
                const menuName = row.menus ? row.menus.nama_dimsum : null;
                if (id && menuName) {
                    if (!ordersMap[id]) ordersMap[id] = [];
                    ordersMap[id].push(normalizeMenuName(menuName));
                }
            });

            return Object.values(ordersMap).filter(b => b.length > 0);
        } catch (err) {
            console.warn('Gagal membaca transaksi Supabase:', err);
            return [];
        }
    }

    function trainApriori(baskets, minSupport = 0.05, minConfidence = 0.1) {
        // Jika tidak ada data transaksi yang dioper, ambil dari riwayat transaksi nyata
        if (!baskets || !Array.isArray(baskets) || baskets.length === 0) {
            baskets = getRealTransactions();
        }

        const totalTransactions = baskets.length;
        if (totalTransactions === 0) {
            return {
                frequentItemsets: {},
                rules: [],
                totalTransactions: 0,
                message: "Belum ada data transaksi yang tercatat."
            };
        }

        const itemCounts = {};
        const pairCounts = {};

        // Hitung frekuensi 1-item dan 2-item (Pasangan menu yang dibeli bersamaan)
        baskets.forEach(basket => {
            const uniqueItems = Array.from(new Set(basket.map(normalizeMenuName).filter(Boolean)));

            for (let i = 0; i < uniqueItems.length; i++) {
                const itemA = uniqueItems[i];
                itemCounts[itemA] = (itemCounts[itemA] || 0) + 1;

                for (let j = i + 1; j < uniqueItems.length; j++) {
                    const itemB = uniqueItems[j];
                    const key1 = `${itemA}__${itemB}`;
                    const key2 = `${itemB}__${itemA}`;
                    pairCounts[key1] = (pairCounts[key1] || 0) + 1;
                    pairCounts[key2] = (pairCounts[key2] || 0) + 1;
                }
            }
        });

        // Bentuk Frequent Itemsets
        const frequentItemsets = {};
        Object.keys(itemCounts).forEach(item => {
            const support = itemCounts[item] / totalTransactions;
            if (support >= minSupport) {
                frequentItemsets[item] = { count: itemCounts[item], support };
            }
        });

        // Bentuk Association Rules (A -> B)
        const rules = [];
        Object.keys(pairCounts).forEach(pairKey => {
            const [itemA, itemB] = pairKey.split('__');
            const countAB = pairCounts[pairKey];
            const supportAB = countAB / totalTransactions;
            const supportA = (itemCounts[itemA] || 0) / totalTransactions;
            const supportB = (itemCounts[itemB] || 0) / totalTransactions;

            if (supportAB >= minSupport && supportA > 0 && supportB > 0) {
                const confidence = supportAB / supportA;
                const lift = confidence / supportB;

                if (confidence >= minConfidence) {
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

        // Urutkan aturan berdasarkan Lift & Confidence tertinggi
        rules.sort((a, b) => (b.lift * b.confidence) - (a.lift * a.confidence));

        return {
            frequentItemsets,
            rules,
            totalTransactions
        };
    }

    // 5. Rekomendasi Menu Terpopuler (Berdasarkan Support Transaksi Nyata)
    function getPopularRecommendations(frequentItemsets, limit = 5) {
        if (!frequentItemsets || Object.keys(frequentItemsets).length === 0) return [];

        return Object.keys(frequentItemsets)
            .map(nama => {
                const meta = MENU_CATALOG[nama] || { nama, harga: 10000, hargaFormatted: "Rp10.000" };
                return {
                    ...meta,
                    support: frequentItemsets[nama].support,
                    count: frequentItemsets[nama].count
                };
            })
            .sort((a, b) => b.support - a.support)
            .slice(0, limit);
    }

    // 6. Rekomendasi Cross-Selling Berdasarkan Keranjang Belanja
    function recommend(rules, cartItems = [], limit = 3) {
        if (!rules || !Array.isArray(rules) || rules.length === 0) return [];

        const normalizedCart = cartItems.map(normalizeMenuName).filter(Boolean);
        const cartSet = new Set(normalizedCart);
        const recommendedSet = new Set();
        const results = [];

        for (const rule of rules) {
            if (cartSet.has(rule.antecedent) && !cartSet.has(rule.consequent) && !recommendedSet.has(rule.consequent)) {
                recommendedSet.add(rule.consequent);
                const meta = MENU_CATALOG[rule.consequent] || {
                    nama: rule.consequent,
                    varian: "Rekomendasi",
                    harga: 10000,
                    hargaFormatted: "Rp10.000",
                    imgSrc: "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80"
                };

                results.push({
                    ...meta,
                    support: rule.support,
                    confidence: rule.confidence,
                    lift: rule.lift,
                    alasan: `Sering dipesan bersama ${rule.antecedent}`
                });

                if (results.length >= limit) break;
            }
        }

        return results;
    }

    // API Publik Modul
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

    // CLI Runner (Jika dijalankan langsung: `node apriori_recommendation.js`)
    if (typeof process !== 'undefined' && process.argv && process.argv[1] && process.argv[1].endsWith('apriori_recommendation.js')) {
        console.log("============================================================");
        console.log("  SABANGDOR - APRIORI RECOMMENDATION ENGINE (REAL DATA ONLY)");
        console.log("============================================================");
        const { rules, frequentItemsets, totalTransactions } = trainApriori();
        console.log(`- Total Transaksi Riil : ${totalTransactions} transaksi.`);

        if (totalTransactions === 0) {
            console.log("\n[INFO] Belum ada transaksi riil yang tercatat di sistem.");
            console.log("      Lakukan pemesanan di web (checkout) untuk mulai menganalisis!");
        } else {
            console.log(`- Pola Menu Terdeteksi : ${Object.keys(frequentItemsets).length} menu.`);
            console.log(`- Aturan Asosiasi (Rules) : ${rules.length} aturan.`);
        }
        console.log("============================================================\n");
    }

    return engine;
}));
