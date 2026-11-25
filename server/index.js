require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5500,http://127.0.0.1:5500,http://localhost:3000')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error('Origin tidak diizinkan oleh kebijakan CORS'));
    }
}));
app.use(express.json({ limit: '1mb' }));

// Konfigurasi koneksi PostgreSQL dari file .env - JANGAN hardcode password
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'impal',
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT) || 5432,
});

// Middleware verifikasi token JWT Supabase dan role pegawai
async function requireStaffAuth(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) {
        return res.status(401).json({ success: false, message: 'Autentikasi pegawai diperlukan.' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
        return res.status(503).json({ success: false, message: 'Konfigurasi autentikasi server belum lengkap.' });
    }

    try {
        const authRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
            headers: {
                Authorization: `Bearer ${token}`,
                apikey: supabaseAnonKey
            }
        });
        if (!authRes.ok) {
            return res.status(401).json({ success: false, message: 'Sesi pegawai tidak valid atau kedaluwarsa.' });
        }
        const user = await authRes.json();
        const profileRes = await pool.query(
            'SELECT role FROM profiles WHERE id = $1 LIMIT 1',
            [user.id]
        );
        if (profileRes.rows.length === 0 || profileRes.rows[0].role !== 'pegawai') {
            return res.status(403).json({ success: false, message: 'Akses ditolak: akun bukan pegawai.' });
        }
        req.staffUser = user;
        next();
    } catch (err) {
        console.error('Auth verification failed:', err.message);
        res.status(500).json({ success: false, message: 'Gagal memverifikasi sesi pegawai.' });
    }
}

// 1. API: Login Pegawai (diteruskan aman ke Supabase Auth, bukan kueri plaintext)
app.post('/api/login', async (req, res) => {
    const email = String(req.body?.email || '').trim();
    const password = String(req.body?.password || '');
    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email dan kata sandi wajib diisi.' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
        return res.status(503).json({ success: false, message: 'Konfigurasi autentikasi server belum lengkap.' });
    }

    try {
        const authRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: supabaseAnonKey
            },
            body: JSON.stringify({ email, password })
        });
        const authData = await authRes.json();
        if (!authRes.ok || !authData.user) {
            return res.status(401).json({ success: false, message: 'Email atau sandi salah.' });
        }

        const profileRes = await pool.query(
            'SELECT role FROM profiles WHERE id = $1 LIMIT 1',
            [authData.user.id]
        );
        if (profileRes.rows.length === 0 || profileRes.rows[0].role !== 'pegawai') {
            return res.status(403).json({ success: false, message: 'Akun tidak memiliki akses pegawai.' });
        }

        res.json({
            success: true,
            message: 'Login berhasil',
            access_token: authData.access_token,
            user: { id: authData.user.id, email: authData.user.email, role: profileRes.rows[0].role }
        });
    } catch (err) {
        console.error('Login error:', err.message);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan saat memproses login.' });
    }
});

// 2. API: Ambil Semua Menu (publik)
app.get('/api/menus', async (req, res) => {
    try {
        const result = await pool.query('SELECT id_menu, nama_dimsum, harga, stok, foto_url FROM menus ORDER BY id_menu ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('GET /api/menus error:', err.message);
        res.status(500).json({ error: 'Gagal memuat daftar menu.' });
    }
});

// 3. API: Ambil Semua Menu Custom (publik)
app.get('/api/menu-custom', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, nama, kategori, deskripsi, img_url, gratis, ukuran, addon, habis FROM menu_custom ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('GET /api/menu-custom error:', err.message);
        res.status(500).json({ error: 'Gagal memuat menu custom.' });
    }
});

// 4. API: Simpan / Edit Menu Custom (khusus pegawai)
app.post('/api/menu-custom', requireStaffAuth, async (req, res) => {
    const { id, nama, kategori, deskripsi, img_url, gratis, ukuran, addon, habis } = req.body || {};
    if (!id || !nama || !kategori || !Array.isArray(ukuran) || ukuran.length === 0) {
        return res.status(400).json({ error: 'Data menu tidak lengkap (id, nama, kategori, dan ukuran wajib diisi).' });
    }
    const invalidHarga = ukuran.some(u => Number(u?.harga) <= 0 || !Number.isFinite(Number(u?.harga)));
    if (invalidHarga) {
        return res.status(400).json({ error: 'Setiap ukuran wajib memiliki harga lebih dari 0.' });
    }

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
            String(id).slice(0, 80),
            String(nama).trim().slice(0, 100),
            String(kategori).trim().slice(0, 60),
            String(deskripsi || '').trim().slice(0, 500),
            String(img_url || '').trim(),
            String(gratis || '').trim().slice(0, 100),
            JSON.stringify(ukuran),
            JSON.stringify(Array.isArray(addon) ? addon : []),
            Boolean(habis)
        ];
        const result = await pool.query(query, values);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('POST /api/menu-custom error:', err.message);
        res.status(500).json({ error: 'Gagal menyimpan menu custom.' });
    }
});

// 5. API: Hapus Menu Custom (khusus pegawai)
app.delete('/api/menu-custom/:id', requireStaffAuth, async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM menu_custom WHERE id = $1', [id]);
        res.json({ message: 'Menu berhasil dihapus' });
    } catch (err) {
        console.error('DELETE /api/menu-custom error:', err.message);
        res.status(500).json({ error: 'Gagal menghapus menu custom.' });
    }
});

// 6. API: Ambil Pesanan (khusus pegawai)
app.get('/api/orders', requireStaffAuth, async (req, res) => {
    try {
        const query = `
            SELECT o.*, 
                   json_agg(
                       json_build_object(
                           'id_detail', od.id_detail, 
                           'jumlah', od.jumlah, 
                           'subtotal', od.subtotal, 
                           'nama_item', COALESCE(od.nama_item, m.nama_dimsum), 'varian', od.varian, 'catatan', od.catatan, 'menus', json_build_object('nama_dimsum', COALESCE(od.nama_item, m.nama_dimsum))
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
        console.error('GET /api/orders error:', err.message);
        res.status(500).json({ error: 'Gagal memuat pesanan.' });
    }
});

// 7. API: Update Status Pembayaran & Pesanan (khusus pegawai)
app.put('/api/orders/:id', requireStaffAuth, async (req, res) => {
    const id = Number(req.params.id);
    const { status_pembayaran, status_pesanan } = req.body || {};
    const validPay = ['pending', 'lunas', 'batal'];
    const validOrder = ['menunggu', 'disiapkan', 'selesai'];

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'ID pesanan tidak valid.' });
    }
    if (!validPay.includes(status_pembayaran) || !validOrder.includes(status_pesanan)) {
        return res.status(400).json({ error: 'Status pembayaran atau pesanan tidak valid.' });
    }

    try {
        const result = await pool.query(
            'UPDATE orders SET status_pembayaran = $1, status_pesanan = $2 WHERE id_order = $3 RETURNING *',
            [status_pembayaran, status_pesanan, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('PUT /api/orders/:id error:', err.message);
        res.status(500).json({ error: 'Gagal memperbarui status pesanan.' });
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
                SELECT o.id_order, array_agg(COALESCE(od.nama_item, m.nama_dimsum)) as items
                FROM orders o
                JOIN order_items od ON o.id_order = od.id_order
                LEFT JOIN menus m ON od.id_menu = m.id_menu
                WHERE o.status_pembayaran <> 'batal'
                GROUP BY o.id_order
                LIMIT 500;
            `;
            const result = await pool.query(query);
            if (result && result.rows.length > 0) {
                baskets = result.rows.map(r => (r.items || []).map(AprioriEngine.normalizeMenuName).filter(Boolean));
            }
        } catch (dbErr) {
            // Jika database belum aktif/kosong, Apriori mengembalikan array kosong atau memakai data lokal
        }

        const { frequentItemsets } = AprioriEngine.trainApriori(baskets);
        const topMenu = AprioriEngine.getPopularRecommendations(frequentItemsets, 5);
        res.json(topMenu);
    } catch (err) {
        console.error('GET /api/recommendations error:', err.message);
        res.status(500).json({ error: 'Gagal menghitung rekomendasi.' });
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
                SELECT o.id_order, array_agg(COALESCE(od.nama_item, m.nama_dimsum)) as items
                FROM orders o
                JOIN order_items od ON o.id_order = od.id_order
                LEFT JOIN menus m ON od.id_menu = m.id_menu
                WHERE o.status_pembayaran <> 'batal'
                GROUP BY o.id_order
                LIMIT 500;
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
        console.error('GET /api/recommend error:', err.message);
        res.status(500).json({ error: 'Gagal menghitung rekomendasi pelengkap.' });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server Express berjalan di http://localhost:${PORT}`);
});