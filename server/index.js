const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Konfigurasi Koneksi PostgreSQL Lokal
// Konfigurasi Koneksi PostgreSQL Lokal
const pool = new Pool({
    user: 'postgres',              // Username bawaan server PostgreSQL
    host: 'localhost',
    database: 'impal',             // Nama database di pgAdmin
    password: 'dokja', // <-- Masukkan password pgAdmin Anda di sini
    port: 5432,                    // Port default PostgreSQL
});

// Tes Koneksi ke Database saat server dinyalakan
pool.connect((err, client, release) => {
    if (err) {
        return console.error('Gagal terhubung ke database PostgreSQL "impal":', err.stack);
    }
    console.log('Berhasil terhubung ke database PostgreSQL lokal "impal"!');
    release();
});

// 1. API: Login Pegawai
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query(
            'SELECT * FROM profiles WHERE email = $1 AND password = $2',
            [email, password]
        );

        if (result.rows.length > 0) {
            const pegawai = result.rows[0];
            res.json({
                success: true,
                message: 'Login berhasil',
                user: { email: pegawai.email, role: pegawai.role }
            });
        } else {
            res.status(401).json({ success: false, message: 'Email atau sandi salah!' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. API: Ambil Semua Menu
app.get('/api/menus', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM menus');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. API: Ambil Semua Menu Custom
app.get('/api/menu-custom', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM menu_custom');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. API: Simpan / Edit Menu Custom
app.post('/api/menu-custom', async (req, res) => {
    const { id, nama, kategori, deskripsi, img_url, gratis, ukuran, addon, habis } = req.body;
    try {
        const query = `
            INSERT INTO menu_custom (id, nama, kategori, deskripsi, img_url, gratis, ukuran, addon, habis)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (id) DO UPDATE SET
                nama = EXCLUDED.nama,
                kategori = EXCLUDED.kategori,
                deskripsi = EXCLUDED.deskripsi,
                img_url = EXCLUDED.img_url,
                gratis = EXCLUDED.gratis,
                ukuran = EXCLUDED.ukuran,
                addon = EXCLUDED.addon,
                habis = EXCLUDED.habis
            RETURNING *;
        `;
        const values = [
            id, nama, kategori, deskripsi, img_url, gratis,
            JSON.stringify(ukuran), JSON.stringify(addon), habis || false
        ];
        const result = await pool.query(query, values);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. API: Hapus Menu Custom
app.delete('/api/menu-custom/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM menu_custom WHERE id = $1', [id]);
        res.json({ message: 'Menu berhasil dihapus' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. API: Ambil Pesanan (Orders & Order Items)
app.get('/api/orders', async (req, res) => {
    try {
        const query = `
            SELECT o.*, 
                   json_agg(
                       json_build_object(
                           'id_detail', od.id_detail, 
                           'jumlah', od.jumlah, 
                           'subtotal', od.subtotal, 
                           'menus', json_build_object('nama_dimsum', m.nama_dimsum)
                       )
                   ) as order_items
            FROM orders o
            LEFT JOIN order_items od ON o.id_order = od.id_order
            LEFT JOIN menus m ON od.id_menu = m.id_menu
            GROUP BY o.id_order
            ORDER BY o.created_at DESC;
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 7. API: Update Status Pembayaran & Pesanan
app.put('/api/orders/:id', async (req, res) => {
    const { id } = req.params;
    const { status_pembayaran, status_pesanan } = req.body;
    try {
        const result = await pool.query(
            'UPDATE orders SET status_pembayaran = $1, status_pesanan = $2 WHERE id_order = $3 RETURNING *',
            [status_pembayaran, status_pesanan, id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 8. API REKOMENDASI AI (APRIORI ML ENGINE)
// ==========================================
const AprioriEngine = require('../apriori_recommendation.js');

// 8A. Rekomendasi Menu Paling Populer (Tab 'Paling Rekomendasi' di index.html)
app.get('/api/recommendations', async (req, res) => {
    try {
        let baskets = [];
        try {
            const query = `
                SELECT o.id_order, array_agg(m.nama_dimsum) as items
                FROM orders o
                JOIN order_items od ON o.id_order = od.id_order
                JOIN menus m ON od.id_menu = m.id_menu
                GROUP BY o.id_order;
            `;
            const result = await pool.query(query);
            if (result && result.rows.length > 0) {
                baskets = result.rows.map(r => (r.items || []).map(AprioriEngine.normalizeMenuName).filter(Boolean));
            }
        } catch (dbErr) {
            // Jika database belum aktif/kosong, Apriori otomatis menggunakan benchmark Sabangdor
        }

        const { frequentItemsets } = AprioriEngine.trainApriori(baskets);
        const topMenu = AprioriEngine.getPopularRecommendations(frequentItemsets, 5);
        res.json(topMenu);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 8B. Rekomendasi Pelengkap Keranjang (Cross-Selling Apriori Rules)
app.get('/api/recommend', async (req, res) => {
    try {
        const rawCart = req.query.cart || "";
        const cartItems = rawCart.split(',').map(s => s.trim()).filter(Boolean);
        let baskets = [];

        try {
            const query = `
                SELECT o.id_order, array_agg(m.nama_dimsum) as items
                FROM orders o
                JOIN order_items od ON o.id_order = od.id_order
                JOIN menus m ON od.id_menu = m.id_menu
                GROUP BY o.id_order;
            `;
            const result = await pool.query(query);
            if (result && result.rows.length > 0) {
                baskets = result.rows.map(r => (r.items || []).map(AprioriEngine.normalizeMenuName).filter(Boolean));
            }
        } catch (dbErr) {}

        const { frequentItemsets, rules } = AprioriEngine.trainApriori(baskets);
        const recommendations = AprioriEngine.recommend(rules, cartItems, 5, frequentItemsets);
        res.json(recommendations);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server Express berjalan di http://localhost:${PORT}`);
});