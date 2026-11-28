require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const { formatError } = require('../error-messages.js');
const { validateMenuForm, validatePasswordPolicy } = require('../validation.js');

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

// PB-035: Pembatasan laju per-IP in-memory untuk endpoint publik/API
const ipBuckets = new Map();
function rateLimitPerIp(maxReq, windowMs) {
    return (req, res, next) => {
        const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
        const now = Date.now();
        const entry = ipBuckets.get(ip) || [];
        const recent = entry.filter(ts => now - ts < windowMs);
        if (recent.length >= maxReq) {
            return res.status(429).json({
                success: false,
                error: 'Terlalu banyak permintaan dari perangkat ini. Coba lagi beberapa saat.'
            });
        }
        recent.push(now);
        ipBuckets.set(ip, recent);
        next();
    };
}

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'impal',
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT) || 5432
});

const ALL_STAFF_ROLES = ['pegawai', 'pemilik', 'kasir', 'dapur'];
const CASHIER_OR_OWNER_ROLES = ['pegawai', 'pemilik', 'kasir'];
const OWNER_ROLES = ['pegawai', 'pemilik'];

function requireStaffAuth(allowedRoles = CASHIER_OR_OWNER_ROLES) {
    return async (req, res, next) => {
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
                return res.status(401).json({ success: false, message: 'Sesi login telah habis, silakan masuk kembali.' });
            }
            const user = await authRes.json();
            const profileRes = await pool.query(
                'SELECT role::TEXT AS role, COALESCE(is_active, true) AS is_active FROM profiles WHERE id = $1 LIMIT 1',
                [user.id]
            );
            const prof = profileRes.rows[0];
            if (!prof || !prof.is_active || !allowedRoles.includes(prof.role)) {
                return res.status(403).json({ success: false, message: 'Anda tidak memiliki izin untuk mengakses fitur ini.' });
            }
            req.staffUser = { ...user, role: prof.role };
            next();
        } catch (err) {
            console.error('Auth verification failed:', err.message);
            res.status(500).json({ success: false, message: formatError(err, 'general') });
        }
    };
}

// 1. API: Login Pegawai (diteruskan aman ke Supabase Auth)
app.post('/api/login', rateLimitPerIp(15, 60 * 1000), async (req, res) => {
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
            headers: { 'Content-Type': 'application/json', apikey: supabaseAnonKey },
            body: JSON.stringify({ email, password })
        });
        const authData = await authRes.json();
        if (!authRes.ok || !authData.user) {
            return res.status(401).json({ success: false, message: 'Email atau kata sandi salah.' });
        }

        const profileRes = await pool.query(
            'SELECT role::TEXT AS role, COALESCE(is_active, true) AS is_active FROM profiles WHERE id = $1 LIMIT 1',
            [authData.user.id]
        );
        const prof = profileRes.rows[0];
        if (!prof || !ALL_STAFF_ROLES.includes(prof.role)) {
            return res.status(403).json({ success: false, message: 'Akun ini tidak memiliki hak akses pegawai.' });
        }
        if (!prof.is_active) {
            return res.status(403).json({ success: false, message: 'Akun pegawai ini sedang dinonaktifkan.' });
        }

        res.json({
            success: true,
            message: 'Login berhasil',
            access_token: authData.access_token,
            user: { id: authData.user.id, email: authData.user.email, role: prof.role }
        });
    } catch (err) {
        console.error('Login error:', err.message);
        res.status(500).json({ success: false, message: formatError(err, 'login') });
    }
});

// 2. API: Ambil Semua Menu Custom / Katalog (publik)
app.get('/api/menu-custom', rateLimitPerIp(60, 60 * 1000), async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM menu_custom ORDER BY urutan ASC, created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('GET /api/menu-custom error:', err.message);
        res.status(500).json({ error: formatError(err, 'general') });
    }
});

// 3. API: Simpan / Edit Menu Custom (kasir/pemilik) dengan validasi penuh PB-024..PB-039
app.post('/api/menu-custom', requireStaffAuth(CASHIER_OR_OWNER_ROLES), async (req, res) => {
    const { id, nama, kategori, deskripsi, img_url, gratis, ukuran, addon, habis, stok_harian, ambang_stok } = req.body || {};
    try {
        const existingRes = await pool.query('SELECT id, nama, is_bawaan FROM menu_custom');
        const editingRow = existingRes.rows.find(r => String(r.id) === String(id));
        const validation = validateMenuForm(
            {
                nama,
                kategori,
                ukuranRows: ukuran,
                addonRows: addon,
                editingId: id,
                isEditingBuiltin: Boolean(editingRow && editingRow.is_bawaan),
                stokHarian: stok_harian,
                ambangStok: ambang_stok
            },
            existingRes.rows
        );
        if (!validation.valid) {
            return res.status(400).json({ error: validation.message });
        }

        const query = `
            INSERT INTO menu_custom (id, nama, kategori, deskripsi, img_url, gratis, ukuran, addon, habis, stok_harian, ambang_stok)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (id) DO UPDATE SET
                nama = EXCLUDED.nama,
                kategori = EXCLUDED.kategori,
                deskripsi = EXCLUDED.deskripsi,
                img_url = EXCLUDED.img_url,
                gratis = EXCLUDED.gratis,
                ukuran = EXCLUDED.ukuran,
                addon = EXCLUDED.addon,
                habis = EXCLUDED.habis,
                stok_harian = EXCLUDED.stok_harian,
                ambang_stok = EXCLUDED.ambang_stok
            RETURNING *;
        `;
        const v = validation.data;
        const values = [
            String(id || ('custom-' + Date.now())).slice(0, 80),
            v.nama,
            v.kategori,
            String(deskripsi || '').trim().slice(0, 500),
            String(img_url || '').trim(),
            String(gratis || '').trim().slice(0, 100),
            JSON.stringify(v.ukuran),
            JSON.stringify(v.addon),
            Boolean(habis),
            v.stok_harian,
            v.ambang_stok
        ];
        const result = await pool.query(query, values);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('POST /api/menu-custom error:', err.message);
        res.status(400).json({ error: formatError(err, 'menu') });
    }
});

// 4. API: Hapus Menu Custom (kasir/pemilik)
app.delete('/api/menu-custom/:id', requireStaffAuth(CASHIER_OR_OWNER_ROLES), async (req, res) => {
    try {
        await pool.query('DELETE FROM menu_custom WHERE id = $1 AND COALESCE(is_bawaan, false) = false', [req.params.id]);
        res.json({ message: 'Menu berhasil dihapus.' });
    } catch (err) {
        console.error('DELETE /api/menu-custom error:', err.message);
        res.status(500).json({ error: formatError(err, 'menu') });
    }
});

// 5. API: Ambil Pesanan (staf sesuai peran PB-045)
app.get('/api/orders', requireStaffAuth(ALL_STAFF_ROLES), async (req, res) => {
    try {
        const isDapurOnly = req.staffUser.role === 'dapur';
        const whereClause = isDapurOnly
            ? `WHERE o.status_pembayaran::TEXT = 'lunas' AND o.status_pesanan::TEXT IN ('disiapkan', 'siap')`
            : '';
        const query = `
            SELECT o.*,
                   json_agg(
                       json_build_object(
                           'id_detail', od.id_detail,
                           'jumlah', od.jumlah,
                           'subtotal', od.subtotal,
                           'nama_item', COALESCE(od.nama_item, m.nama_dimsum),
                           'varian', od.varian,
                           'catatan', od.catatan
                       )
                   ) AS order_items
            FROM orders o
            LEFT JOIN order_items od ON o.id_order = od.id_order
            LEFT JOIN menus m ON od.id_menu = m.id_menu
            ${whereClause}
            GROUP BY o.id_order
            ORDER BY o.created_at DESC;
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error('GET /api/orders error:', err.message);
        res.status(500).json({ error: formatError(err, 'order') });
    }
});

// 6. API: Update Status Pesanan (mendukung PB-041 siap, PB-045 RBAC)
app.put('/api/orders/:id', requireStaffAuth(ALL_STAFF_ROLES), async (req, res) => {
    const id = Number(req.params.id);
    const { status_pembayaran, status_pesanan } = req.body || {};
    const validPay = ['pending', 'lunas', 'batal', 'retur'];
    const validOrder = ['menunggu', 'disiapkan', 'siap', 'selesai'];

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'ID pesanan tidak valid.' });
    }
    if (!validPay.includes(status_pembayaran) || !validOrder.includes(status_pesanan)) {
        return res.status(400).json({ error: 'Status pembayaran atau pesanan tidak valid.' });
    }
    if (req.staffUser.role === 'dapur' && (status_pembayaran !== 'lunas' || status_pesanan !== 'siap')) {
        return res.status(403).json({ error: 'Peran dapur hanya dapat menandai pesanan lunas menjadi siap diambil.' });
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
        res.status(500).json({ error: formatError(err, 'order') });
    }
});

// 7. API PB-065: Pemilik membuat akun pegawai baru (memerlukan SUPABASE_SERVICE_ROLE_KEY opsional)
app.post('/api/staff/invite', requireStaffAuth(OWNER_ROLES), async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const username = String(req.body?.username || email.split('@')[0] || 'pegawai').trim().slice(0, 50);
    const role = String(req.body?.role || 'kasir');

    if (!['pemilik', 'kasir', 'dapur', 'pegawai'].includes(role)) {
        return res.status(400).json({ error: 'Peran pegawai tidak valid.' });
    }
    const pwCheck = validatePasswordPolicy(password);
    if (!pwCheck.valid) {
        return res.status(400).json({ error: pwCheck.message });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
        return res.status(503).json({
            error: 'SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi di server. Buat akun lewat Supabase Dashboard lalu atur perannya di menu Kelola Pegawai.'
        });
    }

    try {
        const createRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: serviceKey,
                Authorization: `Bearer ${serviceKey}`
            },
            body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { username } })
        });
        const created = await createRes.json();
        if (!createRes.ok || !created.id) {
            return res.status(400).json({ error: formatError(created.msg || created.message, 'general') });
        }
        await pool.query(
            `INSERT INTO profiles (id, username, email, role, is_active)
             VALUES ($1, $2, $3, $4::user_role, true)
             ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, email = EXCLUDED.email, is_active = true`,
            [created.id, username, email, role]
        );
        res.json({ success: true, id: created.id, email, role });
    } catch (err) {
        console.error('POST /api/staff/invite error:', err.message);
        res.status(500).json({ error: formatError(err, 'general') });
    }
});

// 8. API Rekomendasi Apriori
const AprioriEngine = require('../apriori_recommendation.js');

app.get('/api/recommendations', rateLimitPerIp(60, 60 * 1000), async (req, res) => {
    try {
        let baskets = [];
        try {
            const query = `
                SELECT o.id_order, array_agg(COALESCE(od.nama_item, m.nama_dimsum)) AS items
                FROM orders o
                JOIN order_items od ON o.id_order = od.id_order
                LEFT JOIN menus m ON od.id_menu = m.id_menu
                WHERE o.status_pembayaran::TEXT NOT IN ('batal', 'retur')
                GROUP BY o.id_order
                LIMIT 500;
            `;
            const result = await pool.query(query);
            if (result && result.rows.length > 0) {
                baskets = result.rows.map(r => (r.items || []).map(AprioriEngine.normalizeMenuName).filter(Boolean));
            }
        } catch (dbErr) {}

        const { frequentItemsets } = AprioriEngine.trainApriori(baskets);
        const topMenu = AprioriEngine.getPopularRecommendations(frequentItemsets, 5);
        res.json(topMenu);
    } catch (err) {
        console.error('GET /api/recommendations error:', err.message);
        res.status(500).json({ error: formatError(err, 'general') });
    }
});

app.get('/api/recommend', rateLimitPerIp(60, 60 * 1000), async (req, res) => {
    try {
        const rawCart = req.query.cart || '';
        const cartItems = rawCart.split(',').map(s => s.trim()).filter(Boolean);
        let baskets = [];
        try {
            const query = `
                SELECT o.id_order, array_agg(COALESCE(od.nama_item, m.nama_dimsum)) AS items
                FROM orders o
                JOIN order_items od ON o.id_order = od.id_order
                LEFT JOIN menus m ON od.id_menu = m.id_menu
                WHERE o.status_pembayaran::TEXT NOT IN ('batal', 'retur')
                GROUP BY o.id_order
                LIMIT 500;
            `;
            const result = await pool.query(query);
            if (result && result.rows.length > 0) {
                baskets = result.rows.map(r => (r.items || []).map(AprioriEngine.normalizeMenuName).filter(Boolean));
            }
        } catch (dbErr) {}

        const { rules } = AprioriEngine.trainApriori(baskets);
        const recommendations = AprioriEngine.recommend(rules, cartItems, 5);
        res.json(recommendations);
    } catch (err) {
        console.error('GET /api/recommend error:', err.message);
        res.status(500).json({ error: formatError(err, 'general') });
    }
});

const PORT = process.env.PORT || 5000;
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server Express (opsional/legacy) berjalan di http://localhost:${PORT}`);
    });
}
module.exports = app;
