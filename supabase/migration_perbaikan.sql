-- ==========================================================
-- MIGRASI PERBAIKAN SABANGDOR
-- Jalankan SEKALI di Supabase > SQL Editor (setelah sabangdor_db.sql).
-- Aman dijalankan ulang (idempotent).
-- ==========================================================

-- 1. order_items: simpan snapshot item (nama, varian, catatan, harga satuan)
--    supaya menu custom / varian / catatan tetap terbaca di dapur & struk.
ALTER TABLE order_items ALTER COLUMN id_menu DROP NOT NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS nama_item   TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS varian      TEXT DEFAULT '';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS catatan     TEXT DEFAULT '';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS harga_satuan NUMERIC(10,2) DEFAULT 0;

-- Isi nama_item untuk data lama (seed) dari tabel menus
UPDATE order_items oi
SET nama_item = m.nama_dimsum,
    harga_satuan = COALESCE(NULLIF(oi.harga_satuan, 0), m.harga)
FROM menus m
WHERE oi.id_menu = m.id_menu AND oi.nama_item IS NULL;

-- 2. Pengaturan bersama (status toko, gambar QRIS, daftar menu habis)
--    Sebelumnya disimpan di localStorage kasir sehingga TIDAK terlihat pembeli.
CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Publik: Lihat Pengaturan" ON app_settings;
CREATE POLICY "Publik: Lihat Pengaturan" ON app_settings
    FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Pegawai: Kelola Pengaturan" ON app_settings;
CREATE POLICY "Pegawai: Kelola Pengaturan" ON app_settings
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO app_settings (key, value) VALUES
    ('status_toko', 'buka'),
    ('menu_habis', '[]')
ON CONFLICT (key) DO NOTHING;

-- 3. Nomor antrean harian (dengan lock agar tidak kembar saat order bersamaan)
CREATE OR REPLACE FUNCTION generate_daily_queue_number()
RETURNS TRIGGER AS $$
DECLARE
    today_max_queue INT;
BEGIN
    PERFORM pg_advisory_xact_lock(727001);
    SELECT COALESCE(MAX(nomor_antrean), 0)
    INTO today_max_queue
    FROM orders
    WHERE DATE(created_at AT TIME ZONE 'Asia/Jakarta') = DATE(NOW() AT TIME ZONE 'Asia/Jakarta');

    NEW.nomor_antrean := today_max_queue + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Fungsi atomik pembuatan pesanan (order + semua item dalam 1 transaksi).
--    Dipakai halaman pembeli DAN POS kasir.
--    - Pembeli (anon) selalu masuk sebagai 'pending' / 'menunggu'.
--    - Ditolak jika toko sedang tutup (untuk pembeli).
CREATE OR REPLACE FUNCTION public.buat_pesanan(
    p_nama           TEXT,
    p_tipe           TEXT,
    p_items          JSONB,
    p_status_bayar   TEXT DEFAULT 'pending',
    p_status_pesanan TEXT DEFAULT 'menunggu'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_staff  BOOLEAN := (auth.role() = 'authenticated');
    v_total  NUMERIC;
    v_id     BIGINT;
    v_nomor  INT;
    v_tipe   payment_type;
    v_bayar  payment_status;
    v_status order_status;
    v_toko   TEXT;
BEGIN
    IF COALESCE(TRIM(p_nama), '') = '' THEN
        RAISE EXCEPTION 'Nama pemesan wajib diisi';
    END IF;
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Keranjang kosong';
    END IF;

    v_tipe := (CASE WHEN LOWER(p_tipe) IN ('cash', 'tunai') THEN 'cash' ELSE 'qris' END)::payment_type;

    IF v_staff THEN
        v_bayar  := (CASE WHEN p_status_bayar IN ('pending', 'lunas', 'batal') THEN p_status_bayar ELSE 'pending' END)::payment_status;
        v_status := (CASE WHEN p_status_pesanan IN ('menunggu', 'disiapkan', 'selesai') THEN p_status_pesanan ELSE 'menunggu' END)::order_status;
    ELSE
        SELECT value INTO v_toko FROM app_settings WHERE key = 'status_toko';
        IF v_toko = 'tutup' THEN
            RAISE EXCEPTION 'Mohon maaf, toko sedang tutup';
        END IF;
        v_bayar  := 'pending'::payment_status;
        v_status := 'menunggu'::order_status;
    END IF;

    SELECT COALESCE(SUM(GREATEST((i->>'subtotal')::NUMERIC, 0)), 0)
    INTO v_total
    FROM jsonb_array_elements(p_items) AS i;

    INSERT INTO orders (nomor_antrean, nama_pembeli, tipe_pembayaran, status_pembayaran, status_pesanan, total_harga)
    VALUES (0, LEFT(TRIM(p_nama), 50), v_tipe, v_bayar, v_status, v_total)
    RETURNING orders.id_order, orders.nomor_antrean INTO v_id, v_nomor;

    INSERT INTO order_items (id_order, id_menu, jumlah, nama_item, varian, catatan, harga_satuan, subtotal)
    SELECT v_id,
           NULL,
           GREATEST(COALESCE((i->>'jumlah')::INT, 1), 1),
           COALESCE(NULLIF(i->>'nama_item', ''), 'Menu'),
           COALESCE(i->>'varian', ''),
           COALESCE(i->>'catatan', ''),
           GREATEST(COALESCE((i->>'harga_satuan')::NUMERIC, 0), 0),
           GREATEST(COALESCE((i->>'subtotal')::NUMERIC, 0), 0)
    FROM jsonb_array_elements(p_items) AS i;

    RETURN jsonb_build_object(
        'id_order',        v_id,
        'nomor_antrean',   v_nomor,
        'nama_pembeli',    LEFT(TRIM(p_nama), 50),
        'tipe_pembayaran', v_tipe,
        'total_harga',     v_total
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.buat_pesanan(TEXT, TEXT, JSONB, TEXT, TEXT) TO anon, authenticated;

-- 5. Keamanan: pembeli tidak boleh INSERT langsung (bisa memalsukan status 'lunas').
--    Semua pembuatan pesanan lewat buat_pesanan().
DROP POLICY IF EXISTS "Pembeli: Buat Transaksi" ON orders;
DROP POLICY IF EXISTS "Pembeli: Buat Detail Pesanan" ON order_items;
