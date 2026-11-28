-- ============================================================================
-- MIGRASI TERPADU SABANGDOR v2 (Rilis 2, Rilis 3, Rilis 4, Rilis 5)
-- Jalankan di Supabase > SQL Editor setelah sabangdoor_db.sql & migration_perbaikan.sql.
-- Aman dijalankan ulang (idempotent).
-- ============================================================================

-- ==========================================
-- 0. PERLUASAN TIPE ENUM (PB-041, PB-045, PB-046)
-- ==========================================
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'siap';
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'retur';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'kasir';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'dapur';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'pemilik';

-- ==========================================
-- 1. PROFILES & RBAC PERAN PEGAWAI (PB-045, PB-065)
-- ==========================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Helper peran pegawai aktif (memakai perbandingan ::TEXT agar aman di semua versi PG)
CREATE OR REPLACE FUNCTION public.get_staff_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p.role::TEXT
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND COALESCE(p.is_active, true) = true
    LIMIT 1;
$$;

-- is_staff: semua staf aktif (pegawai, pemilik, kasir, dapur)
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT auth.role() = 'authenticated'
       AND public.get_staff_role() IN ('pegawai', 'pemilik', 'kasir', 'dapur');
$$;

-- is_pegawai (dipertahankan untuk kompatibilitas): kasir, pemilik, atau pegawai (full)
CREATE OR REPLACE FUNCTION public.is_pegawai()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT auth.role() = 'authenticated'
       AND public.get_staff_role() IN ('pegawai', 'pemilik', 'kasir');
$$;

CREATE OR REPLACE FUNCTION public.is_pemilik()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT auth.role() = 'authenticated'
       AND public.get_staff_role() IN ('pegawai', 'pemilik');
$$;

GRANT EXECUTE ON FUNCTION public.get_staff_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_pegawai() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_pemilik() TO authenticated;

-- RLS profiles: staf bisa lihat profil sendiri; pemilik bisa lihat semua profil staf
DROP POLICY IF EXISTS "Pegawai: Lihat Profile" ON profiles;
CREATE POLICY "Pegawai: Lihat Profile" ON profiles
    FOR SELECT TO authenticated
    USING (
        (id = auth.uid() AND COALESCE(is_active, true) = true)
        OR public.is_pemilik()
    );

-- ==========================================
-- 2. KATEGORI & KATALOG MENU TERPADU + VALIDASI + STOK HARIAN (PB-024..031, PB-039, PB-047..049, PB-063)
-- ==========================================
CREATE TABLE IF NOT EXISTS menu_categories (
    id          TEXT PRIMARY KEY,
    nama        VARCHAR(40) NOT NULL UNIQUE,
    deskripsi   TEXT DEFAULT '',
    urutan      INT NOT NULL DEFAULT 100,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE menu_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Publik: Lihat Kategori" ON menu_categories;
CREATE POLICY "Publik: Lihat Kategori" ON menu_categories
    FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Pegawai: Kelola Kategori" ON menu_categories;
CREATE POLICY "Pegawai: Kelola Kategori" ON menu_categories
    FOR ALL TO authenticated USING (public.is_pegawai()) WITH CHECK (public.is_pegawai());

INSERT INTO menu_categories (id, nama, deskripsi, urutan) VALUES
    ('cat-mentai', 'Dimsum Mentai', 'Dimsum Mentai • Free Chilli Oil', 1),
    ('cat-dimsum-aja', 'Dimsum aja', 'Dimsum kukus hangat dengan pilihan porsi S, M, atau XL', 2),
    ('cat-bakpao', 'Bakpao', '5 varian • bebas campur dalam satu paket', 3)
ON CONFLICT (id) DO NOTHING;

-- Perluas tabel menu_custom agar menampung menu bawaan & stok harian
ALTER TABLE menu_custom ADD COLUMN IF NOT EXISTS is_bawaan BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE menu_custom ADD COLUMN IF NOT EXISTS tipe_menu TEXT NOT NULL DEFAULT 'reguler';
ALTER TABLE menu_custom ADD COLUMN IF NOT EXISTS varian_bakpao JSONB DEFAULT '[]'::jsonb;
ALTER TABLE menu_custom ADD COLUMN IF NOT EXISTS stok_harian INT DEFAULT NULL;
ALTER TABLE menu_custom ADD COLUMN IF NOT EXISTS ambang_stok INT NOT NULL DEFAULT 5;
ALTER TABLE menu_custom ADD COLUMN IF NOT EXISTS urutan INT NOT NULL DEFAULT 100;

-- PB-031: Indeks unik nama menu tak peka huruf besar/kecil
CREATE UNIQUE INDEX IF NOT EXISTS idx_menu_custom_nama_lower
    ON menu_custom (LOWER(TRIM(nama)));

-- PB-024, PB-025, PB-029, PB-039: Trigger validasi integritas data menu di sisi DB
CREATE OR REPLACE FUNCTION public.validate_menu_custom_row()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_uk JSONB;
    v_ad JSONB;
    v_harga NUMERIC;
    v_nama_ad TEXT;
BEGIN
    NEW.nama := TRIM(COALESCE(NEW.nama, ''));
    IF NEW.nama = '' THEN
        RAISE EXCEPTION 'Nama menu wajib diisi';
    END IF;
    IF char_length(NEW.nama) > 60 THEN
        RAISE EXCEPTION 'Nama menu maksimal 60 karakter';
    END IF;

    IF NEW.stok_harian IS NOT NULL AND NEW.stok_harian < 0 THEN
        RAISE EXCEPTION 'Stok harian tidak boleh negatif';
    END IF;

    IF jsonb_typeof(NEW.ukuran) <> 'array' OR jsonb_array_length(NEW.ukuran) = 0 THEN
        RAISE EXCEPTION 'Tambahkan minimal satu ukuran/porsi beserta harganya';
    END IF;

    FOR v_uk IN SELECT * FROM jsonb_array_elements(NEW.ukuran) LOOP
        v_harga := COALESCE((v_uk->>'harga')::NUMERIC, -1);
        IF v_harga <= 0 THEN
            RAISE EXCEPTION 'Harga pada setiap baris ukuran harus lebih dari 0';
        END IF;
        IF v_harga > 1000000 THEN
            RAISE EXCEPTION 'Harga ukuran maksimal Rp1.000.000';
        END IF;
        IF v_harga <> TRUNC(v_harga) THEN
            RAISE EXCEPTION 'Harga harus berupa bilangan bulat Rupiah';
        END IF;
    END LOOP;

    IF NEW.addon IS NOT NULL AND jsonb_typeof(NEW.addon) = 'array' THEN
        FOR v_ad IN SELECT * FROM jsonb_array_elements(NEW.addon) LOOP
            v_nama_ad := TRIM(COALESCE(v_ad->>'nama', v_ad->>'name', ''));
            IF v_nama_ad = '' THEN
                RAISE EXCEPTION 'Nama tambahan wajib diisi';
            END IF;
            v_harga := COALESCE((v_ad->>'harga')::NUMERIC, 0);
            IF v_harga < 0 THEN
                RAISE EXCEPTION 'Harga tambahan tidak boleh negatif';
            END IF;
            IF v_harga > 1000000 THEN
                RAISE EXCEPTION 'Harga tambahan maksimal Rp1.000.000';
            END IF;
            IF v_harga <> TRUNC(v_harga) THEN
                RAISE EXCEPTION 'Harga harus berupa bilangan bulat Rupiah';
            END IF;
        END LOOP;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_menu_custom ON menu_custom;
CREATE TRIGGER trg_validate_menu_custom
    BEFORE INSERT OR UPDATE ON menu_custom
    FOR EACH ROW EXECUTE FUNCTION public.validate_menu_custom_row();

-- PB-047: Seed 6 menu bawaan ke menu_custom agar bisa dikelola dari dashboard
INSERT INTO menu_custom (id, nama, kategori, deskripsi, img_url, gratis, ukuran, addon, habis, is_bawaan, tipe_menu, varian_bakpao, urutan)
VALUES
(
    'builtin-mentai-ori', 'Mentai Ori', 'Dimsum Mentai',
    'Dimsum lembut dibalut saus mentai khas Sabangdor yang dipanggang aromatik.',
    'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80',
    'Free Chilli Oil',
    '[{"nama":"S","porsi":"3 pcs","harga":13000},{"nama":"M","porsi":"6 pcs","harga":23000},{"nama":"XL","porsi":"16 pcs","harga":60000}]'::jsonb,
    '[{"nama":"Extra Mentai","harga":3000},{"nama":"Chilli Oil tambahan","harga":3000}]'::jsonb,
    false, true, 'reguler', '[]'::jsonb, 1
),
(
    'builtin-mentai-cheese', 'Mentai Cheese', 'Dimsum Mentai',
    'Dimsum saus mentai creamy berpadu keju lumer gurih di atasnya.',
    'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80',
    'Free Chilli Oil',
    '[{"nama":"S","porsi":"3 pcs","harga":15000},{"nama":"M","porsi":"6 pcs","harga":26000},{"nama":"XL","porsi":"16 pcs","harga":67000}]'::jsonb,
    '[{"nama":"Extra Mentai","harga":3000},{"nama":"Chilli Oil tambahan","harga":3000}]'::jsonb,
    false, true, 'reguler', '[]'::jsonb, 2
),
(
    'builtin-mentai-tanuki', 'Mentai Tanuki', 'Dimsum Mentai',
    'Dimsum saus mentai khas dengan taburan tanuki renyah gurih.',
    'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80',
    'Free Chilli Oil',
    '[{"nama":"S","porsi":"3 pcs","harga":15000},{"nama":"M","porsi":"6 pcs","harga":26000},{"nama":"XL","porsi":"16 pcs","harga":67000}]'::jsonb,
    '[{"nama":"Extra Mentai","harga":3000},{"nama":"Chilli Oil tambahan","harga":3000}]'::jsonb,
    false, true, 'reguler', '[]'::jsonb, 3
),
(
    'builtin-mentai-mix', 'Mentai Mix', 'Dimsum Mentai',
    'Kombinasi varian mentai dalam satu paket porsi M atau XL.',
    'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80',
    'Free Chilli Oil',
    '[{"nama":"M","porsi":"6 pcs","harga":26000},{"nama":"XL","porsi":"16 pcs","harga":67000}]'::jsonb,
    '[{"nama":"Extra Mentai","harga":3000},{"nama":"Chilli Oil tambahan","harga":3000}]'::jsonb,
    false, true, 'reguler', '[]'::jsonb, 4
),
(
    'builtin-dimsum-aja', 'Dimsum aja', 'Dimsum aja',
    'Dimsum kukus hangat lembut dengan pilihan porsi S, M, atau XL.',
    'https://images.unsplash.com/photo-1496116218417-1a781b1c416c?auto=format&fit=crop&w=600&q=80',
    'Free Chilli Oil',
    '[{"nama":"S","porsi":"3 pcs","harga":10000},{"nama":"M","porsi":"6 pcs","harga":18000},{"nama":"XL","porsi":"16 pcs","harga":47000}]'::jsonb,
    '[{"nama":"Chilli Oil tambahan","harga":3000}]'::jsonb,
    false, true, 'reguler', '[]'::jsonb, 5
),
(
    'builtin-bakpao', 'Bakpao', 'Bakpao',
    '5 varian lembut, bebas campur dalam satu pesanan dengan harga paket hemat.',
    'https://images.unsplash.com/photo-1563245372-f21724e3856d?auto=format&fit=crop&w=600&q=80',
    '',
    '[{"nama":"1 pcs","porsi":"1 pcs","harga":7000},{"nama":"3 pcs","porsi":"3 pcs","harga":20000},{"nama":"6 pcs","porsi":"6 pcs","harga":36000}]'::jsonb,
    '[]'::jsonb,
    false, true, 'bakpao', '["Salted Egg","Kacang Tanah","Ayam Casio","Coklat Lumer","Keju Susu"]'::jsonb, 6
)
ON CONFLICT (id) DO NOTHING;

-- ==========================================
-- 3. PERLUASAN TABEL ORDERS (PB-035, 041, 044, 046, 066, 069, 071, 074, 075, 076)
-- ==========================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_token UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_fp TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_tx_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS alasan_retur TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS nominal_retur NUMERIC(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS diretur_oleh UUID;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS diretur_pada TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal_kotor NUMERIC(10, 2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS kode_voucher TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS diskon_voucher NUMERIC(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS no_hp TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS poin_ditukar INT NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS diskon_poin NUMERIC(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS poin_didapat INT NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS bukti_qris_url TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_preorder BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS jadwal_ambil TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_tracking_token ON orders (tracking_token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_client_tx_id ON orders (client_tx_id) WHERE client_tx_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_client_fp_created ON orders (client_fp, created_at DESC) WHERE client_fp IS NOT NULL;

-- Pastikan subtotal_kotor terisi pada data lama
UPDATE orders SET subtotal_kotor = total_harga WHERE subtotal_kotor IS NULL;

-- ==========================================
-- 4. PENGATURAN DEFAULT JADWAL, APRIORI & PRE-ORDER (PB-060, PB-064, PB-075)
-- ==========================================
INSERT INTO app_settings (key, value) VALUES
    ('jadwal_operasional', '{"enabled":false,"days":{"0":{"aktif":true,"buka":"10:00","tutup":"21:00"},"1":{"aktif":true,"buka":"10:00","tutup":"21:00"},"2":{"aktif":true,"buka":"10:00","tutup":"21:00"},"3":{"aktif":true,"buka":"10:00","tutup":"21:00"},"4":{"aktif":true,"buka":"10:00","tutup":"21:00"},"5":{"aktif":true,"buka":"10:00","tutup":"21:00"},"6":{"aktif":true,"buka":"10:00","tutup":"21:00"}}}'),
    ('tanggal_libur', '[]'),
    ('status_toko_override', ''),
    ('apriori_config', '{"min_support":0.05,"min_confidence":0.10}'),
    ('preorder_config', '{"aktif":true,"kuota_per_slot":10,"lead_menit":30,"slot_menit":30}')
ON CONFLICT (key) DO NOTHING;

-- PB-064: Fungsi cek status buka/tutup toko (manual override > hari libur > jadwal operasional WIB)
CREATE OR REPLACE FUNCTION public.is_toko_buka_sekarang()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status_manual TEXT;
    v_override_raw  TEXT;
    v_override_json JSONB;
    v_jadwal_raw    TEXT;
    v_jadwal        JSONB;
    v_libur_raw     TEXT;
    v_libur         JSONB;
    v_now_wib       TIMESTAMP := (NOW() AT TIME ZONE 'Asia/Jakarta');
    v_today_str     TEXT := to_char(NOW() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD');
    v_dow           TEXT := EXTRACT(DOW FROM (NOW() AT TIME ZONE 'Asia/Jakarta'))::INT::TEXT;
    v_hhmm          TEXT := to_char(NOW() AT TIME ZONE 'Asia/Jakarta', 'HH24:MI');
    v_day_cfg       JSONB;
BEGIN
    SELECT value INTO v_status_manual FROM app_settings WHERE key = 'status_toko';
    SELECT value INTO v_override_raw FROM app_settings WHERE key = 'status_toko_override';
    SELECT value INTO v_jadwal_raw FROM app_settings WHERE key = 'jadwal_operasional';
    SELECT value INTO v_libur_raw FROM app_settings WHERE key = 'tanggal_libur';

    -- Jika jadwal otomatis tidak aktif, ikuti status_toko manual
    BEGIN
        v_jadwal := COALESCE(v_jadwal_raw::jsonb, '{}'::jsonb);
    EXCEPTION WHEN OTHERS THEN
        v_jadwal := '{}'::jsonb;
    END;

    IF COALESCE((v_jadwal->>'enabled')::BOOLEAN, false) = false THEN
        RETURN COALESCE(v_status_manual, 'buka') <> 'tutup';
    END IF;

    -- Jika ada override manual hari ini, override menimpa jadwal
    IF COALESCE(v_override_raw, '') <> '' THEN
        BEGIN
            v_override_json := v_override_raw::jsonb;
            IF (v_override_json->>'tanggal') = v_today_str AND (v_override_json->>'status') IN ('buka', 'tutup') THEN
                RETURN (v_override_json->>'status') = 'buka';
            END IF;
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END IF;

    -- Cek daftar tanggal libur
    BEGIN
        v_libur := COALESCE(v_libur_raw::jsonb, '[]'::jsonb);
        IF jsonb_typeof(v_libur) = 'array' AND EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(v_libur) AS d WHERE d = v_today_str
        ) THEN
            RETURN false;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    -- Cek jam operasional hari ini
    v_day_cfg := v_jadwal->'days'->v_dow;
    IF v_day_cfg IS NULL OR COALESCE((v_day_cfg->>'aktif')::BOOLEAN, false) = false THEN
        RETURN false;
    END IF;

    RETURN v_hhmm >= COALESCE(v_day_cfg->>'buka', '00:00')
       AND v_hhmm <= COALESCE(v_day_cfg->>'tutup', '23:59');
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_toko_buka_sekarang() TO anon, authenticated;

-- ==========================================
-- 5. VOUCHER & DISKON (PB-066)
-- ==========================================
CREATE TABLE IF NOT EXISTS vouchers (
    id              BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    kode            VARCHAR(32) NOT NULL,
    tipe            TEXT NOT NULL CHECK (tipe IN ('persen', 'nominal')),
    nilai           NUMERIC(10, 2) NOT NULL CHECK (nilai > 0),
    min_belanja     NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (min_belanja >= 0),
    maks_diskon     NUMERIC(10, 2) DEFAULT NULL CHECK (maks_diskon IS NULL OR maks_diskon > 0),
    kuota           INT DEFAULT NULL CHECK (kuota IS NULL OR kuota > 0),
    terpakai        INT NOT NULL DEFAULT 0 CHECK (terpakai >= 0),
    berlaku_mulai   TIMESTAMPTZ DEFAULT NULL,
    berlaku_sampai  TIMESTAMPTZ DEFAULT NULL,
    aktif           BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vouchers_kode_upper ON vouchers (UPPER(TRIM(kode)));
ALTER TABLE vouchers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Pegawai: Kelola Voucher" ON vouchers;
CREATE POLICY "Pegawai: Kelola Voucher" ON vouchers
    FOR ALL TO authenticated USING (public.is_pemilik()) WITH CHECK (public.is_pemilik());

CREATE OR REPLACE FUNCTION public.validasi_voucher(p_kode TEXT, p_subtotal NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_v RECORD;
    v_sub NUMERIC := GREATEST(COALESCE(p_subtotal, 0), 0);
    v_disc NUMERIC := 0;
BEGIN
    IF COALESCE(TRIM(p_kode), '') = '' THEN
        RETURN jsonb_build_object('valid', false, 'diskon', 0, 'pesan', 'Kode voucher kosong.');
    END IF;

    SELECT * INTO v_v
    FROM vouchers
    WHERE UPPER(TRIM(kode)) = UPPER(TRIM(p_kode))
    LIMIT 1;

    IF NOT FOUND OR NOT v_v.aktif THEN
        RETURN jsonb_build_object('valid', false, 'diskon', 0, 'pesan', 'Kode voucher tidak ditemukan atau tidak aktif.');
    END IF;
    IF v_v.berlaku_mulai IS NOT NULL AND NOW() < v_v.berlaku_mulai THEN
        RETURN jsonb_build_object('valid', false, 'diskon', 0, 'pesan', 'Voucher belum berlaku.');
    END IF;
    IF v_v.berlaku_sampai IS NOT NULL AND NOW() > v_v.berlaku_sampai THEN
        RETURN jsonb_build_object('valid', false, 'diskon', 0, 'pesan', 'Voucher sudah kedaluwarsa.');
    END IF;
    IF v_v.kuota IS NOT NULL AND v_v.terpakai >= v_v.kuota THEN
        RETURN jsonb_build_object('valid', false, 'diskon', 0, 'pesan', 'Kuota voucher sudah habis.');
    END IF;
    IF v_sub < COALESCE(v_v.min_belanja, 0) THEN
        RETURN jsonb_build_object('valid', false, 'diskon', 0, 'pesan', 'Belanja minimal Rp' || TO_CHAR(v_v.min_belanja, 'FM999,999,990') || ' untuk voucher ini.');
    END IF;

    IF v_v.tipe = 'persen' THEN
        v_disc := ROUND(v_sub * (v_v.nilai / 100.0));
        IF v_v.maks_diskon IS NOT NULL THEN
            v_disc := LEAST(v_disc, v_v.maks_diskon);
        END IF;
    ELSE
        v_disc := v_v.nilai;
    END IF;

    v_disc := LEAST(GREATEST(v_disc, 0), v_sub);

    RETURN jsonb_build_object(
        'valid', true,
        'kode', UPPER(TRIM(v_v.kode)),
        'tipe', v_v.tipe,
        'nilai', v_v.nilai,
        'diskon', v_disc,
        'pesan', 'Voucher berhasil diterapkan!'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validasi_voucher(TEXT, NUMERIC) TO anon, authenticated;

-- ==========================================
-- 6. PROGRAM LOYALITAS POIN (PB-074)
-- ==========================================
CREATE TABLE IF NOT EXISTS loyalty_accounts (
    no_hp           VARCHAR(20) PRIMARY KEY,
    nama            VARCHAR(60) DEFAULT '',
    poin            INT NOT NULL DEFAULT 0 CHECK (poin >= 0),
    total_transaksi INT NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
    id              BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    no_hp           VARCHAR(20) NOT NULL REFERENCES loyalty_accounts(no_hp) ON DELETE CASCADE,
    id_order        BIGINT REFERENCES orders(id_order) ON DELETE SET NULL,
    perubahan_poin  INT NOT NULL,
    keterangan      TEXT DEFAULT '',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE loyalty_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Pegawai: Lihat Loyalitas" ON loyalty_accounts;
CREATE POLICY "Pegawai: Lihat Loyalitas" ON loyalty_accounts
    FOR SELECT TO authenticated USING (public.is_pegawai());

DROP POLICY IF EXISTS "Pegawai: Lihat Transaksi Loyalitas" ON loyalty_transactions;
CREATE POLICY "Pegawai: Lihat Transaksi Loyalitas" ON loyalty_transactions
    FOR SELECT TO authenticated USING (public.is_pegawai());

CREATE OR REPLACE FUNCTION public.cek_poin_loyalitas(p_no_hp TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_hp TEXT := regexp_replace(COALESCE(p_no_hp, ''), '[^0-9]', '', 'g');
    v_acc RECORD;
BEGIN
    IF v_hp LIKE '62%' THEN v_hp := '0' || SUBSTRING(v_hp FROM 3); END IF;
    IF length(v_hp) < 9 OR length(v_hp) > 15 THEN
        RETURN jsonb_build_object('found', false, 'poin', 0, 'dapat_tukar', false);
    END IF;
    SELECT * INTO v_acc FROM loyalty_accounts WHERE no_hp = v_hp;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('found', false, 'no_hp', v_hp, 'poin', 0, 'dapat_tukar', false);
    END IF;
    RETURN jsonb_build_object(
        'found', true,
        'no_hp', v_acc.no_hp,
        'poin', v_acc.poin,
        'total_transaksi', v_acc.total_transaksi,
        'dapat_tukar', v_acc.poin >= 10
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cek_poin_loyalitas(TEXT) TO anon, authenticated;

-- ==========================================
-- 7. LOG AUDIT PERUBAHAN (PB-052)
-- ==========================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id            BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    actor_id      UUID,
    actor_email   TEXT,
    actor_role    TEXT,
    aksi          TEXT NOT NULL,
    entitas       TEXT NOT NULL,
    entitas_id    TEXT,
    data_sebelum  JSONB,
    data_sesudah  JSONB,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at DESC);
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Pemilik: Lihat Audit Log" ON audit_logs;
CREATE POLICY "Pemilik: Lihat Audit Log" ON audit_logs
    FOR SELECT TO authenticated USING (public.is_pemilik());

CREATE OR REPLACE FUNCTION public.fn_catat_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid   UUID := auth.uid();
    v_email TEXT;
    v_role  TEXT;
    v_ent_id TEXT;
    v_old   JSONB := NULL;
    v_new   JSONB := NULL;
BEGIN
    -- Hanya catat aksi pegawai terautentikasi agar pesanan publik tidak memenuhi log audit
    IF v_uid IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    SELECT COALESCE(p.email, p.username), p.role::TEXT INTO v_email, v_role
    FROM profiles p WHERE p.id = v_uid LIMIT 1;

    IF TG_TABLE_NAME = 'orders' THEN
        v_ent_id := COALESCE(NEW.id_order, OLD.id_order)::TEXT;
        IF TG_OP <> 'INSERT' THEN
            v_old := jsonb_build_object(
                'status_pembayaran', OLD.status_pembayaran,
                'status_pesanan', OLD.status_pesanan,
                'total_harga', OLD.total_harga,
                'nominal_retur', OLD.nominal_retur,
                'alasan_retur', OLD.alasan_retur
            );
        END IF;
        IF TG_OP <> 'DELETE' THEN
            v_new := jsonb_build_object(
                'status_pembayaran', NEW.status_pembayaran,
                'status_pesanan', NEW.status_pesanan,
                'total_harga', NEW.total_harga,
                'nominal_retur', NEW.nominal_retur,
                'alasan_retur', NEW.alasan_retur
            );
        END IF;
    ELSIF TG_TABLE_NAME = 'menu_custom' THEN
        v_ent_id := COALESCE(NEW.id, OLD.id)::TEXT;
        IF TG_OP <> 'INSERT' THEN
            v_old := jsonb_build_object('nama', OLD.nama, 'habis', OLD.habis, 'stok_harian', OLD.stok_harian, 'ukuran', OLD.ukuran);
        END IF;
        IF TG_OP <> 'DELETE' THEN
            v_new := jsonb_build_object('nama', NEW.nama, 'habis', NEW.habis, 'stok_harian', NEW.stok_harian, 'ukuran', NEW.ukuran);
        END IF;
    ELSIF TG_TABLE_NAME = 'app_settings' THEN
        v_ent_id := COALESCE(NEW.key, OLD.key)::TEXT;
        IF TG_OP <> 'INSERT' THEN
            v_old := jsonb_build_object('key', OLD.key, 'value', CASE WHEN OLD.key = 'qris_image' THEN '[gambar]' ELSE LEFT(COALESCE(OLD.value, ''), 200) END);
        END IF;
        IF TG_OP <> 'DELETE' THEN
            v_new := jsonb_build_object('key', NEW.key, 'value', CASE WHEN NEW.key = 'qris_image' THEN '[gambar]' ELSE LEFT(COALESCE(NEW.value, ''), 200) END);
        END IF;
    END IF;

    INSERT INTO audit_logs (actor_id, actor_email, actor_role, aksi, entitas, entitas_id, data_sebelum, data_sesudah)
    VALUES (v_uid, v_email, v_role, TG_OP, TG_TABLE_NAME, v_ent_id, v_old, v_new);

    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_orders ON orders;
CREATE TRIGGER trg_audit_orders
    AFTER UPDATE OR DELETE ON orders
    FOR EACH ROW EXECUTE FUNCTION public.fn_catat_audit();

DROP TRIGGER IF EXISTS trg_audit_menu_custom ON menu_custom;
CREATE TRIGGER trg_audit_menu_custom
    AFTER INSERT OR UPDATE OR DELETE ON menu_custom
    FOR EACH ROW EXECUTE FUNCTION public.fn_catat_audit();

DROP TRIGGER IF EXISTS trg_audit_app_settings ON app_settings;
CREATE TRIGGER trg_audit_app_settings
    AFTER INSERT OR UPDATE OR DELETE ON app_settings
    FOR EACH ROW EXECUTE FUNCTION public.fn_catat_audit();

-- ==========================================
-- 8. APRIORI SERVER-SIDE (PB-054, PB-060)
-- ==========================================
CREATE TABLE IF NOT EXISTS apriori_popular (
    nama_item    TEXT PRIMARY KEY,
    order_count  INT NOT NULL DEFAULT 0,
    support      NUMERIC(8, 5) NOT NULL DEFAULT 0,
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS apriori_rules (
    id          BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    antecedent  TEXT NOT NULL,
    consequent  TEXT NOT NULL,
    support     NUMERIC(8, 5) NOT NULL,
    confidence  NUMERIC(8, 5) NOT NULL,
    lift        NUMERIC(8, 5) NOT NULL,
    aktif       BOOLEAN NOT NULL DEFAULT true,
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (antecedent, consequent)
);

ALTER TABLE apriori_popular ENABLE ROW LEVEL SECURITY;
ALTER TABLE apriori_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Publik: Lihat Apriori Populer" ON apriori_popular;
CREATE POLICY "Publik: Lihat Apriori Populer" ON apriori_popular FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Publik: Lihat Apriori Rules" ON apriori_rules;
CREATE POLICY "Publik: Lihat Apriori Rules" ON apriori_rules FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Pemilik: Kelola Apriori Rules" ON apriori_rules;
CREATE POLICY "Pemilik: Kelola Apriori Rules" ON apriori_rules
    FOR ALL TO authenticated USING (public.is_pemilik()) WITH CHECK (public.is_pemilik());

CREATE OR REPLACE FUNCTION public.hitung_apriori_server(
    p_min_support    NUMERIC DEFAULT 0.05,
    p_min_confidence NUMERIC DEFAULT 0.10
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total INT := 0;
    v_pop_count INT := 0;
    v_rule_count INT := 0;
BEGIN
    IF NOT public.is_pemilik() THEN
        RAISE EXCEPTION 'Hanya pemilik yang dapat menghitung ulang aturan Apriori';
    END IF;

    -- Normalisasi nama menu dan kumpulkan basket per pesanan valid (non-batal/non-retur)
    WITH raw_items AS (
        SELECT DISTINCT
            oi.id_order,
            CASE
                WHEN LOWER(COALESCE(oi.nama_item, m.nama_dimsum, '')) LIKE '%bakpao%' THEN 'Bakpao'
                WHEN LOWER(COALESCE(oi.nama_item, m.nama_dimsum, '')) LIKE '%extra mentai%' THEN 'Extra Mentai'
                WHEN LOWER(COALESCE(oi.nama_item, m.nama_dimsum, '')) LIKE '%chilli%'
                  OR LOWER(COALESCE(oi.nama_item, m.nama_dimsum, '')) LIKE '%chili%' THEN 'Chilli Oil Extra'
                WHEN LOWER(COALESCE(oi.nama_item, m.nama_dimsum, '')) LIKE '%cheese%'
                  OR LOWER(COALESCE(oi.nama_item, m.nama_dimsum, '')) LIKE '%cheeze%' THEN 'Mentai Cheese'
                WHEN LOWER(COALESCE(oi.nama_item, m.nama_dimsum, '')) LIKE '%tanuki%' THEN 'Mentai Tanuki'
                WHEN LOWER(COALESCE(oi.nama_item, m.nama_dimsum, '')) LIKE '%mix%' THEN 'Mentai Mix'
                WHEN LOWER(COALESCE(oi.nama_item, m.nama_dimsum, '')) LIKE '%mentai%' THEN 'Mentai Ori'
                WHEN LOWER(COALESCE(oi.nama_item, m.nama_dimsum, '')) LIKE '%dimsum aja%' THEN 'Dimsum aja'
                ELSE TRIM(COALESCE(oi.nama_item, m.nama_dimsum, ''))
            END AS nama_norm
        FROM order_items oi
        JOIN orders o ON o.id_order = oi.id_order
        LEFT JOIN menus m ON m.id_menu = oi.id_menu
        WHERE o.status_pembayaran::TEXT NOT IN ('batal', 'retur')
    ),
    clean_items AS (
        SELECT id_order, nama_norm FROM raw_items WHERE nama_norm <> ''
    ),
    totals AS (
        SELECT COUNT(DISTINCT id_order) AS n FROM clean_items
    )
    SELECT n INTO v_total FROM totals;

    DELETE FROM apriori_popular;

    IF v_total > 0 THEN
        WITH raw_items AS (
            SELECT DISTINCT
                oi.id_order,
                CASE
                    WHEN LOWER(COALESCE(oi.nama_item, m.nama_dimsum, '')) LIKE '%bakpao%' THEN 'Bakpao'
                    WHEN LOWER(COALESCE(oi.nama_item, m.nama_dimsum, '')) LIKE '%extra mentai%' THEN 'Extra Mentai'
                    WHEN LOWER(COALESCE(oi.nama_item, m.nama_dimsum, '')) LIKE '%chilli%'
                      OR LOWER(COALESCE(oi.nama_item, m.nama_dimsum, '')) LIKE '%chili%' THEN 'Chilli Oil Extra'
                    WHEN LOWER(COALESCE(oi.nama_item, m.nama_dimsum, '')) LIKE '%cheese%'
                      OR LOWER(COALESCE(oi.nama_item, m.nama_dimsum, '')) LIKE '%cheeze%' THEN 'Mentai Cheese'
                    WHEN LOWER(COALESCE(oi.nama_item, m.nama_dimsum, '')) LIKE '%tanuki%' THEN 'Mentai Tanuki'
                    WHEN LOWER(COALESCE(oi.nama_item, m.nama_dimsum, '')) LIKE '%mix%' THEN 'Mentai Mix'
                    WHEN LOWER(COALESCE(oi.nama_item, m.nama_dimsum, '')) LIKE '%mentai%' THEN 'Mentai Ori'
                    WHEN LOWER(COALESCE(oi.nama_item, m.nama_dimsum, '')) LIKE '%dimsum aja%' THEN 'Dimsum aja'
                    ELSE TRIM(COALESCE(oi.nama_item, m.nama_dimsum, ''))
                END AS nama_norm
            FROM order_items oi
            JOIN orders o ON o.id_order = oi.id_order
            LEFT JOIN menus m ON m.id_menu = oi.id_menu
            WHERE o.status_pembayaran::TEXT NOT IN ('batal', 'retur')
        ),
        clean_items AS (
            SELECT id_order, nama_norm FROM raw_items WHERE nama_norm <> ''
        ),
        item_counts AS (
            SELECT nama_norm, COUNT(*) AS cnt, (COUNT(*)::NUMERIC / v_total) AS sup
            FROM clean_items
            GROUP BY nama_norm
        )
        INSERT INTO apriori_popular (nama_item, order_count, support, updated_at)
        SELECT nama_norm, cnt, ROUND(sup, 5), NOW()
        FROM item_counts
        WHERE sup >= COALESCE(p_min_support, 0.05);

        GET DIAGNOSTICS v_pop_count = ROW_COUNT;

        -- Simpan aturan pasangan A -> B (pertahankan flag aktif=false yang sudah disetel pemilik)
        WITH raw_items AS (
            SELECT DISTINCT
                oi.id_order,
                CASE
                    WHEN LOWER(COALESCE(oi.nama_item, m.nama_dimsum, '')) LIKE '%bakpao%' THEN 'Bakpao'
                    WHEN LOWER(COALESCE(oi.nama_item, m.nama_dimsum, '')) LIKE '%extra mentai%' THEN 'Extra Mentai'
                    WHEN LOWER(COALESCE(oi.nama_item, m.nama_dimsum, '')) LIKE '%chilli%'
                      OR LOWER(COALESCE(oi.nama_item, m.nama_dimsum, '')) LIKE '%chili%' THEN 'Chilli Oil Extra'
                    WHEN LOWER(COALESCE(oi.nama_item, m.nama_dimsum, '')) LIKE '%cheese%'
                      OR LOWER(COALESCE(oi.nama_item, m.nama_dimsum, '')) LIKE '%cheeze%' THEN 'Mentai Cheese'
                    WHEN LOWER(COALESCE(oi.nama_item, m.nama_dimsum, '')) LIKE '%tanuki%' THEN 'Mentai Tanuki'
                    WHEN LOWER(COALESCE(oi.nama_item, m.nama_dimsum, '')) LIKE '%mix%' THEN 'Mentai Mix'
                    WHEN LOWER(COALESCE(oi.nama_item, m.nama_dimsum, '')) LIKE '%mentai%' THEN 'Mentai Ori'
                    WHEN LOWER(COALESCE(oi.nama_item, m.nama_dimsum, '')) LIKE '%dimsum aja%' THEN 'Dimsum aja'
                    ELSE TRIM(COALESCE(oi.nama_item, m.nama_dimsum, ''))
                END AS nama_norm
            FROM order_items oi
            JOIN orders o ON o.id_order = oi.id_order
            LEFT JOIN menus m ON m.id_menu = oi.id_menu
            WHERE o.status_pembayaran::TEXT NOT IN ('batal', 'retur')
        ),
        clean_items AS (
            SELECT id_order, nama_norm FROM raw_items WHERE nama_norm <> ''
        ),
        item_counts AS (
            SELECT nama_norm, COUNT(*) AS cnt, (COUNT(*)::NUMERIC / v_total) AS sup
            FROM clean_items
            GROUP BY nama_norm
        ),
        pair_counts AS (
            SELECT a.nama_norm AS ant, b.nama_norm AS con, COUNT(*) AS cnt_ab
            FROM clean_items a
            JOIN clean_items b ON a.id_order = b.id_order AND a.nama_norm <> b.nama_norm
            GROUP BY a.nama_norm, b.nama_norm
        ),
        calc_rules AS (
            SELECT
                p.ant,
                p.con,
                ROUND(p.cnt_ab::NUMERIC / v_total, 5) AS sup,
                ROUND(p.cnt_ab::NUMERIC / ia.cnt, 5) AS conf,
                ROUND((p.cnt_ab::NUMERIC / ia.cnt) / NULLIF(ib.sup, 0), 5) AS lift
            FROM pair_counts p
            JOIN item_counts ia ON ia.nama_norm = p.ant
            JOIN item_counts ib ON ib.nama_norm = p.con
            WHERE (p.cnt_ab::NUMERIC / v_total) >= COALESCE(p_min_support, 0.05)
              AND (p.cnt_ab::NUMERIC / ia.cnt) >= COALESCE(p_min_confidence, 0.10)
        )
        INSERT INTO apriori_rules (antecedent, consequent, support, confidence, lift, updated_at)
        SELECT ant, con, sup, conf, COALESCE(lift, 1), NOW()
        FROM calc_rules
        ON CONFLICT (antecedent, consequent) DO UPDATE SET
            support = EXCLUDED.support,
            confidence = EXCLUDED.confidence,
            lift = EXCLUDED.lift,
            updated_at = NOW();

        GET DIAGNOSTICS v_rule_count = ROW_COUNT;
    END IF;

    RETURN jsonb_build_object(
        'total_transaksi', v_total,
        'jumlah_populer', v_pop_count,
        'jumlah_aturan', v_rule_count
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.hitung_apriori_server(NUMERIC, NUMERIC) TO authenticated;

-- ==========================================
-- 9. REKAP KAS & PENUTUPAN SHIFT (PB-062)
-- ==========================================
CREATE TABLE IF NOT EXISTS shift_closures (
    id              BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    kasir_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    kasir_email     TEXT,
    mulai_shift     TIMESTAMPTZ NOT NULL,
    selesai_shift   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    jumlah_pesanan  INT NOT NULL DEFAULT 0,
    total_tunai     NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_qris      NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_retur     NUMERIC(12, 2) NOT NULL DEFAULT 0,
    kas_awal        NUMERIC(12, 2) NOT NULL DEFAULT 0,
    kas_fisik       NUMERIC(12, 2) NOT NULL DEFAULT 0,
    selisih         NUMERIC(12, 2) NOT NULL DEFAULT 0,
    catatan         TEXT DEFAULT '',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE shift_closures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Kasir: Kelola Shift" ON shift_closures;
CREATE POLICY "Kasir: Kelola Shift" ON shift_closures
    FOR ALL TO authenticated USING (public.is_pegawai()) WITH CHECK (public.is_pegawai());

-- ==========================================
-- 10. ULASAN & RATING PESANAN (PB-068)
-- ==========================================
CREATE TABLE IF NOT EXISTS order_reviews (
    id            BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    id_order      BIGINT NOT NULL UNIQUE REFERENCES orders(id_order) ON DELETE CASCADE,
    nama_pembeli  VARCHAR(60) NOT NULL,
    rating        INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    komentar      TEXT NOT NULL CHECK (char_length(TRIM(komentar)) > 0 AND char_length(komentar) <= 500),
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE order_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Pemilik: Lihat Ulasan" ON order_reviews;
CREATE POLICY "Pemilik: Lihat Ulasan" ON order_reviews
    FOR SELECT TO authenticated USING (public.is_pemilik());

CREATE OR REPLACE FUNCTION public.kirim_ulasan(
    p_token    UUID,
    p_rating   INT,
    p_komentar TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order RECORD;
    v_clean TEXT := TRIM(COALESCE(p_komentar, ''));
BEGIN
    IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
        RAISE EXCEPTION 'Rating harus antara 1 sampai 5 bintang';
    END IF;
    IF v_clean = '' THEN
        RAISE EXCEPTION 'Komentar ulasan tidak boleh kosong';
    END IF;

    SELECT id_order, nama_pembeli, status_pesanan::TEXT AS st
    INTO v_order
    FROM orders
    WHERE tracking_token = p_token
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pesanan tidak ditemukan';
    END IF;
    IF v_order.st <> 'selesai' THEN
        RAISE EXCEPTION 'Ulasan hanya dapat diberikan setelah pesanan selesai';
    END IF;

    INSERT INTO order_reviews (id_order, nama_pembeli, rating, komentar)
    VALUES (v_order.id_order, v_order.nama_pembeli, p_rating, LEFT(v_clean, 500))
    ON CONFLICT (id_order) DO NOTHING;

    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.kirim_ulasan(UUID, INT, TEXT) TO anon, authenticated;

-- ==========================================
-- 11. TELEMETRI ERROR & ANALITIK TANPA PII (PB-059)
-- ==========================================
CREATE TABLE IF NOT EXISTS app_telemetry (
    id          BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    tipe        TEXT NOT NULL CHECK (tipe IN ('error', 'rpc_error', 'event')),
    sumber      VARCHAR(60) NOT NULL DEFAULT 'app',
    pesan       VARCHAR(300) NOT NULL DEFAULT '',
    halaman     VARCHAR(80) NOT NULL DEFAULT '',
    metadata    JSONB DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telemetry_created ON app_telemetry (created_at DESC);
ALTER TABLE app_telemetry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Pemilik: Lihat Telemetri" ON app_telemetry;
CREATE POLICY "Pemilik: Lihat Telemetri" ON app_telemetry
    FOR SELECT TO authenticated USING (public.is_pemilik());

CREATE OR REPLACE FUNCTION public.catat_telemetri(
    p_tipe    TEXT,
    p_sumber  TEXT,
    p_pesan   TEXT,
    p_halaman TEXT,
    p_meta    JSONB DEFAULT '{}'::jsonb
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cnt INT;
BEGIN
    SELECT COUNT(*) INTO v_cnt
    FROM app_telemetry
    WHERE created_at >= NOW() - INTERVAL '1 minute';
    IF v_cnt >= 120 THEN
        RETURN;
    END IF;

    INSERT INTO app_telemetry (tipe, sumber, pesan, halaman, metadata)
    VALUES (
        CASE WHEN p_tipe IN ('error', 'rpc_error', 'event') THEN p_tipe ELSE 'event' END,
        LEFT(COALESCE(p_sumber, 'app'), 60),
        LEFT(COALESCE(p_pesan, ''), 300),
        LEFT(COALESCE(p_halaman, ''), 80),
        COALESCE(p_meta, '{}'::jsonb)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.catat_telemetri(TEXT, TEXT, TEXT, TEXT, JSONB) TO anon, authenticated;

-- ==========================================
-- 12. PERHITUNGAN HARGA SERVER + STOK HARIAN + BUAT_PESANAN TERPADU
-- ==========================================
CREATE OR REPLACE FUNCTION public.hitung_harga_item_server(
    p_nama_item TEXT,
    p_varian    TEXT,
    p_habis_arr JSONB DEFAULT '[]'::jsonb,
    p_qty       INT DEFAULT 1
) RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_nama        TEXT := LOWER(TRIM(COALESCE(p_nama_item, '')));
    v_var         TEXT := COALESCE(p_varian, '');
    v_var_upper   TEXT := UPPER(v_var);
    v_ukuran_key  TEXT;
    v_base_price  NUMERIC := NULL;
    v_addon_total NUMERIC := 0;
    v_bakpao_pcs  INT := 0;
    v_rem         INT;
    v_best        NUMERIC;
    v_pack6       INT;
    v_pack3       INT;
    v_p6_price    NUMERIC := 36000;
    v_p3_price    NUMERIC := 20000;
    v_p1_price    NUMERIC := 7000;
    v_custom      RECORD;
    v_uk          JSONB;
    v_ad          JSONB;
    v_uk_name     TEXT;
    v_ad_name     TEXT;
    v_habis_elem  TEXT;
BEGIN
    -- Cek daftar menu habis legacy di app_settings
    FOR v_habis_elem IN SELECT LOWER(jsonb_array_elements_text(COALESCE(p_habis_arr, '[]'::jsonb))) LOOP
        IF v_habis_elem = v_nama
           OR (v_habis_elem = 'mentai mix' AND v_nama = 'dimsum mix')
           OR (v_habis_elem = 'mentai cheese' AND v_nama = 'mentai cheeze') THEN
            RAISE EXCEPTION 'Menu "%" sedang habis', p_nama_item;
        END IF;
    END LOOP;

    -- Cek katalog terpadu di menu_custom (mencakup menu bawaan & custom PB-047)
    SELECT * INTO v_custom
    FROM menu_custom
    WHERE LOWER(TRIM(nama)) = v_nama
       OR (v_nama = 'dimsum mix' AND LOWER(TRIM(nama)) = 'mentai mix')
       OR (v_nama = 'mentai cheeze' AND LOWER(TRIM(nama)) = 'mentai cheese')
    LIMIT 1;

    IF FOUND THEN
        IF COALESCE(v_custom.habis, false) THEN
            RAISE EXCEPTION 'Menu "%" sedang habis', p_nama_item;
        END IF;
        -- PB-049: Validasi stok harian tersisa
        IF v_custom.stok_harian IS NOT NULL THEN
            IF v_custom.stok_harian <= 0 THEN
                RAISE EXCEPTION 'Menu "%" sedang habis', p_nama_item;
            END IF;
            IF COALESCE(p_qty, 1) > v_custom.stok_harian THEN
                RAISE EXCEPTION 'Stok menu "%" tersisa % porsi', v_custom.nama, v_custom.stok_harian;
            END IF;
        END IF;

        -- Khusus menu tipe Bakpao (baca harga paket dinamis dari ukuran DB)
        IF v_custom.tipe_menu = 'bakpao' OR v_nama = 'bakpao' THEN
            FOR v_uk IN SELECT * FROM jsonb_array_elements(COALESCE(v_custom.ukuran, '[]'::jsonb)) LOOP
                v_uk_name := LOWER(TRIM(COALESCE(v_uk->>'nama', '')));
                IF v_uk_name LIKE '6%' THEN v_p6_price := GREATEST(COALESCE((v_uk->>'harga')::NUMERIC, 36000), 1); END IF;
                IF v_uk_name LIKE '3%' THEN v_p3_price := GREATEST(COALESCE((v_uk->>'harga')::NUMERIC, 20000), 1); END IF;
                IF v_uk_name LIKE '1%' THEN v_p1_price := GREATEST(COALESCE((v_uk->>'harga')::NUMERIC, 7000), 1); END IF;
            END LOOP;

            SELECT COALESCE(SUM((m[1])::INT), 0)
            INTO v_bakpao_pcs
            FROM regexp_matches(v_var, '(\d+)\s*x\s*', 'gi') AS m;

            IF v_bakpao_pcs <= 0 THEN
                v_bakpao_pcs := COALESCE((substring(v_var FROM '^(\d+)\s*pcs'))::INT, 0);
            END IF;
            IF v_bakpao_pcs <= 0 OR v_bakpao_pcs > 200 THEN
                RAISE EXCEPTION 'Jumlah pcs Bakpao tidak valid';
            END IF;

            v_best := v_bakpao_pcs * v_p1_price;
            FOR v_pack6 IN 0..(v_bakpao_pcs / 6) LOOP
                v_rem := v_bakpao_pcs - (v_pack6 * 6);
                FOR v_pack3 IN 0..(v_rem / 3) LOOP
                    v_best := LEAST(v_best, (v_pack6 * v_p6_price) + (v_pack3 * v_p3_price) + ((v_rem - v_pack3 * 3) * v_p1_price));
                END LOOP;
            END LOOP;
            RETURN v_best;
        END IF;

        -- Menu reguler / custom
        IF jsonb_typeof(v_custom.ukuran) = 'array' AND jsonb_array_length(v_custom.ukuran) > 0 THEN
            FOR v_uk IN SELECT * FROM jsonb_array_elements(v_custom.ukuran) LOOP
                v_uk_name := LOWER(TRIM(COALESCE(v_uk->>'nama', '')));
                IF v_uk_name <> '' AND (
                    LOWER(v_var) LIKE v_uk_name || ' (%'
                    OR LOWER(v_var) = v_uk_name
                    OR LOWER(v_var) LIKE v_uk_name || ' +%'
                ) THEN
                    v_base_price := GREATEST(COALESCE((v_uk->>'harga')::NUMERIC, 0), 0);
                    EXIT;
                END IF;
            END LOOP;
            IF v_base_price IS NULL THEN
                IF jsonb_array_length(v_custom.ukuran) = 1 THEN
                    SELECT GREATEST(COALESCE((v_custom.ukuran->0->>'harga')::NUMERIC, 0), 0) INTO v_base_price;
                ELSE
                    RAISE EXCEPTION 'Ukuran "%" tidak valid untuk menu "%"', p_varian, p_nama_item;
                END IF;
            END IF;
        END IF;

        IF jsonb_typeof(v_custom.addon) = 'array' THEN
            FOR v_ad IN SELECT * FROM jsonb_array_elements(v_custom.addon) LOOP
                v_ad_name := LOWER(TRIM(COALESCE(v_ad->>'nama', v_ad->>'name', '')));
                IF v_ad_name <> '' AND POSITION(v_ad_name IN LOWER(v_var)) > 0 THEN
                    IF v_ad_name LIKE '%extra mentai%' AND v_var_upper ~ '^S(\s|\(|$)' THEN
                        RAISE EXCEPTION 'Extra Mentai tidak tersedia untuk ukuran S';
                    ELSIF v_ad_name LIKE '%extra mentai%' AND v_var_upper ~ '^XL(\s|\(|$)' THEN
                        v_addon_total := v_addon_total + 5000;
                    ELSE
                        v_addon_total := v_addon_total + GREATEST(COALESCE((v_ad->>'harga')::NUMERIC, 0), 0);
                    END IF;
                END IF;
            END LOOP;
        END IF;

        IF COALESCE(v_base_price, 0) <= 0 THEN
            RAISE EXCEPTION 'Harga menu "%" tidak valid', p_nama_item;
        END IF;
        RETURN v_base_price + v_addon_total;
    END IF;

    -- Fallback untuk add-on standalone dari Apriori cross-selling
    IF v_nama = 'extra mentai' THEN
        RETURN CASE WHEN v_var_upper ~ '^XL(\s|\(|$)' THEN 5000 ELSE 3000 END;
    ELSIF v_nama IN ('chilli oil extra', 'chilli oil tambahan') THEN
        RETURN 3000;
    END IF;

    -- Fallback menu standar bila seed bawaan belum ada
    IF v_var_upper ~ '^XL(\s|\(|$)' THEN v_ukuran_key := 'XL';
    ELSIF v_var_upper ~ '^M(\s|\(|$)' THEN v_ukuran_key := 'M';
    ELSIF v_var_upper ~ '^S(\s|\(|$)' THEN v_ukuran_key := 'S';
    ELSE v_ukuran_key := '';
    END IF;

    IF v_nama IN ('mentai ori', 'dimsum mentai ori') THEN
        v_base_price := CASE v_ukuran_key WHEN 'S' THEN 13000 WHEN 'M' THEN 23000 WHEN 'XL' THEN 60000 ELSE NULL END;
    ELSIF v_nama IN ('mentai cheese', 'mentai cheeze', 'dimsum mentai cheeze', 'dimsum mentai cheese') THEN
        v_base_price := CASE v_ukuran_key WHEN 'S' THEN 15000 WHEN 'M' THEN 26000 WHEN 'XL' THEN 67000 ELSE NULL END;
    ELSIF v_nama IN ('mentai tanuki', 'dimsum mentai tanuki') THEN
        v_base_price := CASE v_ukuran_key WHEN 'S' THEN 15000 WHEN 'M' THEN 26000 WHEN 'XL' THEN 67000 ELSE NULL END;
    ELSIF v_nama IN ('mentai mix', 'dimsum mix', 'dimsum mentai mix') THEN
        v_base_price := CASE v_ukuran_key WHEN 'M' THEN 26000 WHEN 'XL' THEN 67000 ELSE NULL END;
    ELSIF v_nama = 'dimsum aja' THEN
        v_base_price := CASE v_ukuran_key WHEN 'S' THEN 10000 WHEN 'M' THEN 18000 WHEN 'XL' THEN 47000 ELSE NULL END;
    END IF;

    IF v_base_price IS NULL THEN
        RAISE EXCEPTION 'Menu atau ukuran "% (%)" tidak valid', p_nama_item, p_varian;
    END IF;

    IF LOWER(v_var) LIKE '%extra mentai%' THEN
        IF v_nama = 'dimsum aja' THEN RAISE EXCEPTION 'Extra Mentai tidak tersedia untuk Dimsum aja';
        ELSIF v_ukuran_key = 'S' THEN RAISE EXCEPTION 'Extra Mentai tidak tersedia untuk ukuran S';
        ELSIF v_ukuran_key = 'XL' THEN v_addon_total := v_addon_total + 5000;
        ELSE v_addon_total := v_addon_total + 3000;
        END IF;
    END IF;
    IF LOWER(v_var) LIKE '%chilli oil%' OR LOWER(v_var) LIKE '%chili oil%' THEN
        v_addon_total := v_addon_total + 3000;
    END IF;

    RETURN v_base_price + v_addon_total;
END;
$$;

-- Helper kurangi / kembalikan stok harian menu (PB-049)
CREATE OR REPLACE FUNCTION public.sesuaikan_stok_order(p_id_order BIGINT, p_arah INT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_item RECORD;
    v_menu RECORD;
    v_next INT;
BEGIN
    FOR v_item IN
        SELECT nama_item, jumlah FROM order_items WHERE id_order = p_id_order
    LOOP
        SELECT id, stok_harian, habis INTO v_menu
        FROM menu_custom
        WHERE LOWER(TRIM(nama)) = LOWER(TRIM(COALESCE(v_item.nama_item, '')))
        LIMIT 1
        FOR UPDATE;

        IF FOUND AND v_menu.stok_harian IS NOT NULL THEN
            IF p_arah < 0 THEN
                -- Kurangi stok (saat lunas)
                v_next := GREATEST(v_menu.stok_harian - COALESCE(v_item.jumlah, 1), 0);
                UPDATE menu_custom
                SET stok_harian = v_next,
                    habis = CASE WHEN v_next = 0 THEN true ELSE habis END
                WHERE id = v_menu.id;
            ELSE
                -- Kembalikan stok (saat retur/batal)
                v_next := v_menu.stok_harian + COALESCE(v_item.jumlah, 1);
                UPDATE menu_custom
                SET stok_harian = v_next,
                    habis = CASE WHEN v_menu.stok_harian = 0 AND v_next > 0 THEN false ELSE habis END
                WHERE id = v_menu.id;
            END IF;
        END IF;
    END LOOP;
END;
$$;

-- Helper tambah poin loyalitas saat lunas (PB-074: 1 poin per Rp10.000)
CREATE OR REPLACE FUNCTION public.beri_poin_order(p_id_order BIGINT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order RECORD;
    v_poin  INT;
BEGIN
    SELECT id_order, no_hp, nama_pembeli, total_harga, poin_didapat
    INTO v_order
    FROM orders
    WHERE id_order = p_id_order
    FOR UPDATE;

    IF NOT FOUND OR COALESCE(v_order.no_hp, '') = '' OR COALESCE(v_order.poin_didapat, 0) > 0 THEN
        RETURN 0;
    END IF;

    v_poin := FLOOR(COALESCE(v_order.total_harga, 0) / 10000);
    IF v_poin <= 0 THEN RETURN 0; END IF;

    INSERT INTO loyalty_accounts (no_hp, nama, poin, total_transaksi, updated_at)
    VALUES (v_order.no_hp, LEFT(v_order.nama_pembeli, 60), v_poin, 1, NOW())
    ON CONFLICT (no_hp) DO UPDATE SET
        nama = EXCLUDED.nama,
        poin = loyalty_accounts.poin + v_poin,
        total_transaksi = loyalty_accounts.total_transaksi + 1,
        updated_at = NOW();

    INSERT INTO loyalty_transactions (no_hp, id_order, perubahan_poin, keterangan)
    VALUES (v_order.no_hp, p_id_order, v_poin, 'Belanja lunas pesanan #' || p_id_order);

    UPDATE orders SET poin_didapat = v_poin WHERE id_order = p_id_order;
    RETURN v_poin;
END;
$$;

-- Hapus overload lama buat_pesanan jika perlu agar hanya ada 1 signature dengan parameter opsional berdefault
DROP FUNCTION IF EXISTS public.buat_pesanan(TEXT, TEXT, JSONB, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.buat_pesanan(
    p_nama           TEXT,
    p_tipe           TEXT,
    p_items          JSONB,
    p_status_bayar   TEXT DEFAULT 'pending',
    p_status_pesanan TEXT DEFAULT 'menunggu',
    p_client_fp      TEXT DEFAULT NULL,
    p_kode_voucher   TEXT DEFAULT NULL,
    p_no_hp          TEXT DEFAULT NULL,
    p_tukar_poin     BOOLEAN DEFAULT false,
    p_bukti_qris     TEXT DEFAULT NULL,
    p_jadwal_ambil   TIMESTAMPTZ DEFAULT NULL,
    p_client_tx_id   TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_staff       BOOLEAN := public.is_pegawai();
    v_nama_clean  TEXT := TRIM(COALESCE(p_nama, ''));
    v_subtotal_all NUMERIC := 0;
    v_diskon_v    NUMERIC := 0;
    v_diskon_p    NUMERIC := 0;
    v_poin_used   INT := 0;
    v_total       NUMERIC := 0;
    v_id          BIGINT;
    v_nomor       INT;
    v_token       UUID;
    v_tipe        payment_type;
    v_bayar       payment_status;
    v_status      order_status;
    v_habis_raw   TEXT;
    v_habis_arr   JSONB := '[]'::jsonb;
    v_item        JSONB;
    v_qty         INT;
    v_harga_unit  NUMERIC;
    v_subtotal    NUMERIC;
    v_nama_item   TEXT;
    v_varian      TEXT;
    v_catatan     TEXT;
    v_recent_cnt  INT;
    v_fp_cnt      INT;
    v_fp_clean    TEXT := NULLIF(LEFT(TRIM(COALESCE(p_client_fp, '')), 64), '');
    v_hp_clean    TEXT := regexp_replace(COALESCE(p_no_hp, ''), '[^0-9]', '', 'g');
    v_voucher_res JSONB;
    v_voucher_code TEXT := NULL;
    v_acc_poin    INT := 0;
    v_bukti_safe  TEXT := NULL;
    v_pre_cfg     JSONB;
    v_slot_kuota  INT := 10;
    v_slot_used   INT := 0;
    v_existing    RECORD;
    v_buyer_uid   UUID := NULL;
BEGIN
    -- PB-076: Idempotensi sinkronisasi POS offline (jika client_tx_id sudah tersimpan, kembalikan langsung)
    IF p_client_tx_id IS NOT NULL AND TRIM(p_client_tx_id) <> '' THEN
        SELECT id_order, nomor_antrean, tracking_token, nama_pembeli, tipe_pembayaran, total_harga
        INTO v_existing
        FROM orders
        WHERE client_tx_id = LEFT(TRIM(p_client_tx_id), 80)
        LIMIT 1;
        IF FOUND THEN
            RETURN jsonb_build_object(
                'id_order',        v_existing.id_order,
                'nomor_antrean',   v_existing.nomor_antrean,
                'tracking_token',  v_existing.tracking_token,
                'nama_pembeli',    v_existing.nama_pembeli,
                'tipe_pembayaran', v_existing.tipe_pembayaran,
                'total_harga',     v_existing.total_harga,
                'deduplicated',    true
            );
        END IF;
    END IF;

    -- PB-028 & PB-038: Validasi nama pemesan
    IF v_nama_clean = '' THEN
        RAISE EXCEPTION 'Nama pemesan wajib diisi';
    END IF;
    IF NOT v_staff THEN
        IF char_length(v_nama_clean) < 2 OR v_nama_clean !~ '[A-Za-z]' THEN
            RAISE EXCEPTION 'Nama pemesan minimal 2 karakter dan harus mengandung huruf';
        END IF;
    END IF;

    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Keranjang kosong';
    END IF;
    IF jsonb_array_length(p_items) > 50 THEN
        RAISE EXCEPTION 'Terlalu banyak item dalam satu pesanan';
    END IF;

    -- Normalisasi nomor HP opsional (PB-074)
    IF v_hp_clean LIKE '62%' THEN v_hp_clean := '0' || SUBSTRING(v_hp_clean FROM 3); END IF;
    IF v_hp_clean = '' THEN v_hp_clean := NULL; END IF;

    -- Validasi bukti QRIS opsional (PB-069)
    IF p_bukti_qris IS NOT NULL AND TRIM(p_bukti_qris) <> '' THEN
        IF TRIM(p_bukti_qris) ~* '^data:image/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$'
           AND char_length(p_bukti_qris) <= 750000 THEN
            v_bukti_safe := TRIM(p_bukti_qris);
        END IF;
    END IF;

    -- Pembeli yang login opsional (PB-071)
    IF auth.role() = 'authenticated' AND NOT v_staff THEN
        v_buyer_uid := auth.uid();
    END IF;

    v_tipe := (CASE WHEN LOWER(p_tipe) IN ('cash', 'tunai') THEN 'cash' ELSE 'qris' END)::payment_type;

    IF v_staff THEN
        v_bayar  := (CASE WHEN p_status_bayar IN ('pending', 'lunas', 'batal', 'retur') THEN p_status_bayar ELSE 'pending' END)::payment_status;
        v_status := (CASE WHEN p_status_pesanan IN ('menunggu', 'disiapkan', 'siap', 'selesai') THEN p_status_pesanan ELSE 'menunggu' END)::order_status;
    ELSE
        -- PB-086: Anti-flood global
        SELECT COUNT(*) INTO v_recent_cnt
        FROM orders
        WHERE status_pembayaran::TEXT = 'pending'
          AND created_at >= NOW() - INTERVAL '1 minute';
        IF v_recent_cnt >= 15 THEN
            RAISE EXCEPTION 'Terlalu banyak pesanan masuk bersamaan. Coba lagi beberapa saat.';
        END IF;

        -- PB-035: Rate limit per perangkat (maks 3 pesanan per 5 menit per client_fp)
        IF v_fp_clean IS NOT NULL THEN
            SELECT COUNT(*) INTO v_fp_cnt
            FROM orders
            WHERE client_fp = v_fp_clean
              AND created_at >= NOW() - INTERVAL '5 minutes';
            IF v_fp_cnt >= 3 THEN
                RAISE EXCEPTION 'Terlalu banyak pesanan dari perangkat ini. Coba lagi beberapa menit lagi.';
            END IF;
        END IF;

        -- PB-064: Cek buka/tutup otomatis + manual override
        IF p_jadwal_ambil IS NULL AND NOT public.is_toko_buka_sekarang() THEN
            RAISE EXCEPTION 'Mohon maaf, toko sedang tutup';
        END IF;

        -- PB-075: Validasi kuota slot Pre-order
        IF p_jadwal_ambil IS NOT NULL THEN
            IF p_jadwal_ambil < NOW() + INTERVAL '15 minutes' THEN
                RAISE EXCEPTION 'Slot pre-order minimal 15 menit dari sekarang';
            END IF;
            BEGIN
                SELECT value::jsonb INTO v_pre_cfg FROM app_settings WHERE key = 'preorder_config';
                v_slot_kuota := GREATEST(COALESCE((v_pre_cfg->>'kuota_per_slot')::INT, 10), 1);
            EXCEPTION WHEN OTHERS THEN
                v_slot_kuota := 10;
            END;
            SELECT COUNT(*) INTO v_slot_used
            FROM orders
            WHERE is_preorder = true
              AND status_pembayaran::TEXT NOT IN ('batal', 'retur')
              AND date_trunc('minute', jadwal_ambil) = date_trunc('minute', p_jadwal_ambil);
            IF v_slot_used >= v_slot_kuota THEN
                RAISE EXCEPTION 'Slot pre-order pada jam tersebut sudah penuh';
            END IF;
        END IF;

        SELECT value INTO v_habis_raw FROM app_settings WHERE key = 'menu_habis';
        BEGIN
            v_habis_arr := COALESCE(v_habis_raw::jsonb, '[]'::jsonb);
        EXCEPTION WHEN OTHERS THEN
            v_habis_arr := '[]'::jsonb;
        END;

        v_bayar  := 'pending'::payment_status;
        v_status := 'menunggu'::order_status;
    END IF;

    -- Validasi & hitung subtotal item otoritatif di server
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_qty := COALESCE((v_item->>'jumlah')::INT, 0);
        IF v_qty < 1 OR v_qty > 99 THEN
            RAISE EXCEPTION 'Jumlah item harus antara 1 sampai 99';
        END IF;

        v_nama_item := LEFT(COALESCE(NULLIF(TRIM(v_item->>'nama_item'), ''), 'Menu'), 100);
        v_varian    := LEFT(COALESCE(v_item->>'varian', ''), 200);

        IF v_staff THEN
            v_harga_unit := GREATEST(COALESCE((v_item->>'harga_satuan')::NUMERIC, 0), 0);
            v_subtotal   := v_harga_unit * v_qty;
        ELSE
            v_harga_unit := public.hitung_harga_item_server(v_nama_item, v_varian, v_habis_arr, v_qty);
            v_subtotal   := v_harga_unit * v_qty;
        END IF;

        v_subtotal_all := v_subtotal_all + v_subtotal;
    END LOOP;

    IF v_subtotal_all <= 0 THEN
        RAISE EXCEPTION 'Total pesanan tidak valid';
    END IF;

    -- PB-066: Hitung & kunci kuota voucher di server
    IF p_kode_voucher IS NOT NULL AND TRIM(p_kode_voucher) <> '' THEN
        v_voucher_res := public.validasi_voucher(p_kode_voucher, v_subtotal_all);
        IF COALESCE((v_voucher_res->>'valid')::BOOLEAN, false) = false THEN
            RAISE EXCEPTION '%', COALESCE(v_voucher_res->>'pesan', 'Kode voucher tidak valid');
        END IF;
        v_diskon_v := COALESCE((v_voucher_res->>'diskon')::NUMERIC, 0);
        v_voucher_code := v_voucher_res->>'kode';
        UPDATE vouchers
        SET terpakai = terpakai + 1
        WHERE UPPER(TRIM(kode)) = v_voucher_code
          AND (kuota IS NULL OR terpakai < kuota);
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Kuota voucher sudah habis';
        END IF;
    END IF;

    -- PB-074: Tukar poin loyalitas (10 poin = potongan Rp5.000)
    IF COALESCE(p_tukar_poin, false) = true AND v_hp_clean IS NOT NULL THEN
        SELECT poin INTO v_acc_poin FROM loyalty_accounts WHERE no_hp = v_hp_clean FOR UPDATE;
        IF COALESCE(v_acc_poin, 0) < 10 THEN
            RAISE EXCEPTION 'Poin tidak mencukupi untuk ditukar (minimal 10 poin)';
        END IF;
        v_poin_used := 10;
        v_diskon_p := LEAST(5000, GREATEST(v_subtotal_all - v_diskon_v, 0));
        UPDATE loyalty_accounts SET poin = poin - v_poin_used, updated_at = NOW() WHERE no_hp = v_hp_clean;
    END IF;

    v_total := GREATEST(v_subtotal_all - v_diskon_v - v_diskon_p, 0);

    INSERT INTO orders (
        nomor_antrean, nama_pembeli, tipe_pembayaran, status_pembayaran, status_pesanan,
        total_harga, subtotal_kotor, kode_voucher, diskon_voucher,
        no_hp, poin_ditukar, diskon_poin, bukti_qris_url,
        is_preorder, jadwal_ambil, client_fp, client_tx_id, buyer_user_id
    )
    VALUES (
        0, LEFT(v_nama_clean, 50), v_tipe, v_bayar, v_status,
        v_total, v_subtotal_all, v_voucher_code, v_diskon_v,
        v_hp_clean, v_poin_used, v_diskon_p, v_bukti_safe,
        (p_jadwal_ambil IS NOT NULL), p_jadwal_ambil, v_fp_clean,
        NULLIF(LEFT(TRIM(COALESCE(p_client_tx_id, '')), 80), ''), v_buyer_uid
    )
    RETURNING orders.id_order, orders.nomor_antrean, orders.tracking_token INTO v_id, v_nomor, v_token;

    -- Catat penukaran poin bila ada
    IF v_poin_used > 0 AND v_hp_clean IS NOT NULL THEN
        INSERT INTO loyalty_transactions (no_hp, id_order, perubahan_poin, keterangan)
        VALUES (v_hp_clean, v_id, -v_poin_used, 'Tukar poin pada pesanan #' || v_id);
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_qty       := (v_item->>'jumlah')::INT;
        v_nama_item := LEFT(COALESCE(NULLIF(TRIM(v_item->>'nama_item'), ''), 'Menu'), 100);
        v_varian    := LEFT(COALESCE(v_item->>'varian', ''), 200);
        v_catatan   := LEFT(COALESCE(v_item->>'catatan', ''), 200);

        IF v_staff THEN
            v_harga_unit := GREATEST(COALESCE((v_item->>'harga_satuan')::NUMERIC, 0), 0);
        ELSE
            v_harga_unit := public.hitung_harga_item_server(v_nama_item, v_varian, v_habis_arr, v_qty);
        END IF;
        v_subtotal := v_harga_unit * v_qty;

        INSERT INTO order_items (id_order, id_menu, jumlah, nama_item, varian, catatan, harga_satuan, subtotal)
        VALUES (v_id, NULL, v_qty, v_nama_item, v_varian, v_catatan, v_harga_unit, v_subtotal);
    END LOOP;

    -- Jika POS manual langsung lunas, kurangi stok harian & berikan poin
    IF v_staff AND v_bayar::TEXT = 'lunas' THEN
        PERFORM public.sesuaikan_stok_order(v_id, -1);
        PERFORM public.beri_poin_order(v_id);
    END IF;

    RETURN jsonb_build_object(
        'id_order',        v_id,
        'nomor_antrean',   v_nomor,
        'tracking_token',  v_token,
        'nama_pembeli',    LEFT(v_nama_clean, 50),
        'tipe_pembayaran', v_tipe,
        'subtotal_kotor',  v_subtotal_all,
        'diskon_voucher',  v_diskon_v,
        'diskon_poin',     v_diskon_p,
        'total_harga',     v_total,
        'is_preorder',     (p_jadwal_ambil IS NOT NULL),
        'jadwal_ambil',    p_jadwal_ambil
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.buat_pesanan(TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TIMESTAMPTZ, TEXT) TO anon, authenticated;

-- ==========================================
-- 13. RPC OPERASIONAL KASIR & DAPUR (PB-041, PB-045, PB-046, PB-049, PB-074)
-- ==========================================

-- Verifikasi pembayaran oleh kasir/pemilik (otomatis kurangi stok & beri poin)
CREATE OR REPLACE FUNCTION public.verifikasi_pembayaran(p_id_order BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order RECORD;
    v_poin INT := 0;
BEGIN
    IF NOT public.is_pegawai() THEN
        RAISE EXCEPTION 'Anda tidak memiliki izin memverifikasi pembayaran';
    END IF;

    SELECT id_order, status_pembayaran::TEXT AS pay_st INTO v_order
    FROM orders WHERE id_order = p_id_order FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Pesanan tidak ditemukan'; END IF;
    IF v_order.pay_st <> 'pending' THEN
        RAISE EXCEPTION 'Pesanan ini sudah diproses sebelumnya';
    END IF;

    UPDATE orders
    SET status_pembayaran = 'lunas'::payment_status,
        status_pesanan = 'disiapkan'::order_status
    WHERE id_order = p_id_order;

    PERFORM public.sesuaikan_stok_order(p_id_order, -1);
    v_poin := public.beri_poin_order(p_id_order);

    RETURN jsonb_build_object('success', true, 'poin_didapat', v_poin);
END;
$$;

GRANT EXECUTE ON FUNCTION public.verifikasi_pembayaran(BIGINT) TO authenticated;

-- Dapur menandai pesanan siap diambil (PB-041 & PB-045: peran dapur boleh panggil ini)
CREATE OR REPLACE FUNCTION public.dapur_tandai_siap(p_id_order BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order RECORD;
BEGIN
    IF NOT public.is_staff() THEN
        RAISE EXCEPTION 'Akses ditolak';
    END IF;

    SELECT id_order, status_pembayaran::TEXT AS pay_st, status_pesanan::TEXT AS ord_st
    INTO v_order FROM orders WHERE id_order = p_id_order FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Pesanan tidak ditemukan'; END IF;
    IF v_order.pay_st <> 'lunas' THEN
        RAISE EXCEPTION 'Hanya pesanan lunas yang dapat disiapkan dapur';
    END IF;

    UPDATE orders
    SET status_pesanan = 'siap'::order_status,
        ready_at = NOW()
    WHERE id_order = p_id_order;

    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.dapur_tandai_siap(BIGINT) TO authenticated;

-- Kasir / staf menandai pesanan selesai diserahkan ke pembeli (PB-041)
CREATE OR REPLACE FUNCTION public.serahkan_pesanan(p_id_order BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.is_pegawai() THEN
        RAISE EXCEPTION 'Hanya kasir atau pemilik yang dapat menyerahkan pesanan';
    END IF;

    UPDATE orders
    SET status_pesanan = 'selesai'::order_status,
        completed_at = NOW()
    WHERE id_order = p_id_order AND status_pembayaran::TEXT = 'lunas';

    IF NOT FOUND THEN RAISE EXCEPTION 'Pesanan lunas tidak ditemukan'; END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.serahkan_pesanan(BIGINT) TO authenticated;

-- PB-046: Retur / batalkan pesanan setelah lunas (hanya kasir/pemilik; kembalikan stok)
CREATE OR REPLACE FUNCTION public.retur_pesanan(
    p_id_order BIGINT,
    p_alasan   TEXT,
    p_nominal  NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order RECORD;
    v_alasan TEXT := TRIM(COALESCE(p_alasan, ''));
    v_nom NUMERIC := COALESCE(p_nominal, 0);
BEGIN
    IF NOT public.is_pegawai() THEN
        RAISE EXCEPTION 'Hanya kasir atau pemilik yang berwenang melakukan retur';
    END IF;
    IF v_alasan = '' THEN
        RAISE EXCEPTION 'Alasan retur wajib diisi';
    END IF;

    SELECT id_order, total_harga, status_pembayaran::TEXT AS pay_st
    INTO v_order FROM orders WHERE id_order = p_id_order FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Pesanan tidak ditemukan'; END IF;
    IF v_order.pay_st <> 'lunas' THEN
        RAISE EXCEPTION 'Hanya pesanan berstatus lunas yang dapat diretur';
    END IF;
    IF v_nom <= 0 OR v_nom > v_order.total_harga THEN
        RAISE EXCEPTION 'Nominal retur harus antara Rp1 sampai total pesanan';
    END IF;

    UPDATE orders
    SET status_pembayaran = 'retur'::payment_status,
        status_pesanan = 'selesai'::order_status,
        alasan_retur = LEFT(v_alasan, 250),
        nominal_retur = v_nom,
        diretur_oleh = auth.uid(),
        diretur_pada = NOW()
    WHERE id_order = p_id_order;

    PERFORM public.sesuaikan_stok_order(p_id_order, 1);

    RETURN jsonb_build_object('success', true, 'nominal_retur', v_nom);
END;
$$;

GRANT EXECUTE ON FUNCTION public.retur_pesanan(BIGINT, TEXT, NUMERIC) TO authenticated;

-- PB-065: Pemilik mengelola peran & status aktif akun pegawai
CREATE OR REPLACE FUNCTION public.admin_update_staff_profile(
    p_user_id   UUID,
    p_role      TEXT,
    p_is_active BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.is_pemilik() THEN
        RAISE EXCEPTION 'Hanya pemilik yang dapat mengelola akun pegawai';
    END IF;
    IF p_user_id = auth.uid() AND p_is_active = false THEN
        RAISE EXCEPTION 'Anda tidak dapat menonaktifkan akun Anda sendiri';
    END IF;
    IF p_role NOT IN ('pegawai', 'pemilik', 'kasir', 'dapur') THEN
        RAISE EXCEPTION 'Peran pegawai tidak valid';
    END IF;

    UPDATE profiles
    SET role = p_role::user_role,
        is_active = COALESCE(p_is_active, true),
        updated_at = NOW()
    WHERE id = p_user_id;

    IF NOT FOUND THEN RAISE EXCEPTION 'Akun pegawai tidak ditemukan'; END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_staff_profile(UUID, TEXT, BOOLEAN) TO authenticated;

-- ==========================================
-- 14. RPC PUBLIK: ESTIMASI TUNGGU, PELACAKAN, LAYAR ANTREAN, PRE-ORDER, RIWAYAT PEMBELI
-- ==========================================

-- PB-050: Estimasi waktu tunggu berdasarkan jumlah antrean & rata-rata masak hari ini
CREATE OR REPLACE FUNCTION public.get_estimasi_tunggu()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_antrean INT := 0;
    v_avg_min NUMERIC := 5;
    v_est_min INT := 5;
BEGIN
    SELECT COUNT(*) INTO v_antrean
    FROM orders
    WHERE status_pembayaran::TEXT = 'lunas'
      AND status_pesanan::TEXT = 'disiapkan'
      AND (is_preorder = false OR jadwal_ambil <= NOW() + INTERVAL '30 minutes');

    SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (COALESCE(ready_at, completed_at) - created_at)) / 60.0), 5)
    INTO v_avg_min
    FROM orders
    WHERE DATE(created_at AT TIME ZONE 'Asia/Jakarta') = DATE(NOW() AT TIME ZONE 'Asia/Jakarta')
      AND COALESCE(ready_at, completed_at) IS NOT NULL
      AND EXTRACT(EPOCH FROM (COALESCE(ready_at, completed_at) - created_at)) BETWEEN 60 AND 3600;

    v_avg_min := LEAST(GREATEST(v_avg_min, 3), 15);
    v_est_min := LEAST(GREATEST(ROUND((v_antrean + 1) * v_avg_min)::INT, 3), 90);

    RETURN jsonb_build_object(
        'antrean_aktif', v_antrean,
        'rata_rata_menit', ROUND(v_avg_min, 1),
        'estimasi_menit', v_est_min
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_estimasi_tunggu() TO anon, authenticated;

-- PB-044: Lacak status pesanan pembeli (hanya mengembalikan 1 pesanan sesuai token)
CREATE OR REPLACE FUNCTION public.lacak_pesanan(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_o RECORD;
    v_items JSONB;
    v_est JSONB;
    v_rev RECORD;
BEGIN
    SELECT * INTO v_o FROM orders WHERE tracking_token = p_token LIMIT 1;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('found', false);
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'nama_item', oi.nama_item,
        'varian', oi.varian,
        'catatan', oi.catatan,
        'jumlah', oi.jumlah,
        'subtotal', oi.subtotal
    )), '[]'::jsonb)
    INTO v_items
    FROM order_items oi WHERE oi.id_order = v_o.id_order;

    v_est := public.get_estimasi_tunggu();

    SELECT rating, komentar, created_at INTO v_rev
    FROM order_reviews WHERE id_order = v_o.id_order LIMIT 1;

    RETURN jsonb_build_object(
        'found', true,
        'id_order', v_o.id_order,
        'nomor_antrean', v_o.nomor_antrean,
        'nama_pembeli', v_o.nama_pembeli,
        'tipe_pembayaran', v_o.tipe_pembayaran,
        'status_pembayaran', v_o.status_pembayaran,
        'status_pesanan', v_o.status_pesanan,
        'subtotal_kotor', COALESCE(v_o.subtotal_kotor, v_o.total_harga),
        'diskon_voucher', v_o.diskon_voucher,
        'diskon_poin', v_o.diskon_poin,
        'total_harga', v_o.total_harga,
        'poin_didapat', v_o.poin_didapat,
        'is_preorder', v_o.is_preorder,
        'jadwal_ambil', v_o.jadwal_ambil,
        'created_at', v_o.created_at,
        'ready_at', v_o.ready_at,
        'completed_at', v_o.completed_at,
        'items', v_items,
        'estimasi', v_est,
        'ulasan', CASE WHEN v_rev.rating IS NOT NULL THEN jsonb_build_object('rating', v_rev.rating, 'komentar', v_rev.komentar) ELSE NULL END
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.lacak_pesanan(UUID) TO anon, authenticated;

-- PB-051: Layar antrean publik (tanpa nama pelanggan!)
CREATE OR REPLACE FUNCTION public.get_layar_antrean()
RETURNS TABLE(nomor_antrean INT, status_pesanan TEXT, updated_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT o.nomor_antrean,
           o.status_pesanan::TEXT,
           COALESCE(o.ready_at, o.created_at) AS updated_at
    FROM orders o
    WHERE DATE(o.created_at AT TIME ZONE 'Asia/Jakarta') = DATE(NOW() AT TIME ZONE 'Asia/Jakarta')
      AND o.status_pembayaran::TEXT = 'lunas'
      AND o.status_pesanan::TEXT IN ('disiapkan', 'siap')
    ORDER BY o.nomor_antrean ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_layar_antrean() TO anon, authenticated;

-- PB-075: Daftar slot pre-order hari ini / tanggal pilihan beserta sisa kuota
CREATE OR REPLACE FUNCTION public.get_slot_preorder(p_tanggal DATE DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tgl DATE := COALESCE(p_tanggal, DATE(NOW() AT TIME ZONE 'Asia/Jakarta'));
    v_cfg JSONB := '{}'::jsonb;
    v_jadwal JSONB := '{}'::jsonb;
    v_kuota INT := 10;
    v_step INT := 30;
    v_lead INT := 30;
    v_dow TEXT := EXTRACT(DOW FROM v_tgl)::INT::TEXT;
    v_buka TEXT := '10:00';
    v_tutup TEXT := '21:00';
    v_start_ts TIMESTAMPTZ;
    v_end_ts TIMESTAMPTZ;
    v_cur TIMESTAMPTZ;
    v_used INT;
    v_slots JSONB := '[]'::jsonb;
BEGIN
    BEGIN
        SELECT value::jsonb INTO v_cfg FROM app_settings WHERE key = 'preorder_config';
    EXCEPTION WHEN OTHERS THEN v_cfg := '{}'::jsonb; END;
    IF COALESCE((v_cfg->>'aktif')::BOOLEAN, true) = false THEN
        RETURN jsonb_build_object('aktif', false, 'slots', '[]'::jsonb);
    END IF;
    v_kuota := GREATEST(COALESCE((v_cfg->>'kuota_per_slot')::INT, 10), 1);
    v_step  := GREATEST(COALESCE((v_cfg->>'slot_menit')::INT, 30), 15);
    v_lead  := GREATEST(COALESCE((v_cfg->>'lead_menit')::INT, 30), 15);

    BEGIN
        SELECT value::jsonb INTO v_jadwal FROM app_settings WHERE key = 'jadwal_operasional';
        IF v_jadwal->'days'->v_dow IS NOT NULL THEN
            v_buka  := COALESCE(v_jadwal->'days'->v_dow->>'buka', '10:00');
            v_tutup := COALESCE(v_jadwal->'days'->v_dow->>'tutup', '21:00');
        END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;

    v_start_ts := ((v_tgl::TEXT || ' ' || v_buka)::TIMESTAMP AT TIME ZONE 'Asia/Jakarta');
    v_end_ts   := ((v_tgl::TEXT || ' ' || v_tutup)::TIMESTAMP AT TIME ZONE 'Asia/Jakarta');
    v_cur := v_start_ts;

    WHILE v_cur <= v_end_ts LOOP
        IF v_cur >= NOW() + (v_lead || ' minutes')::INTERVAL THEN
            SELECT COUNT(*) INTO v_used
            FROM orders
            WHERE is_preorder = true
              AND status_pembayaran::TEXT NOT IN ('batal', 'retur')
              AND date_trunc('minute', jadwal_ambil) = date_trunc('minute', v_cur);

            v_slots := v_slots || jsonb_build_array(jsonb_build_object(
                'iso', v_cur,
                'label', to_char(v_cur AT TIME ZONE 'Asia/Jakarta', 'HH24:MI'),
                'terpakai', v_used,
                'kuota', v_kuota,
                'sisa', GREATEST(v_kuota - v_used, 0)
            ));
        END IF;
        v_cur := v_cur + (v_step || ' minutes')::INTERVAL;
    END LOOP;

    RETURN jsonb_build_object('aktif', true, 'tanggal', v_tgl, 'slots', v_slots);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_slot_preorder(DATE) TO anon, authenticated;

-- PB-071: Riwayat pesanan milik pembeli yang login (opsional)
CREATE OR REPLACE FUNCTION public.riwayat_pesanan_saya()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(jsonb_agg(row_data ORDER BY created_at DESC), '[]'::jsonb)
    FROM (
        SELECT
            o.created_at,
            jsonb_build_object(
                'id_order', o.id_order,
                'nomor_antrean', o.nomor_antrean,
                'tracking_token', o.tracking_token,
                'total_harga', o.total_harga,
                'status_pembayaran', o.status_pembayaran,
                'status_pesanan', o.status_pesanan,
                'created_at', o.created_at,
                'items', (
                    SELECT COALESCE(jsonb_agg(jsonb_build_object(
                        'nama', oi.nama_item,
                        'varian', oi.varian,
                        'catatan', oi.catatan,
                        'qty', oi.jumlah,
                        'harga', oi.subtotal
                    )), '[]'::jsonb)
                    FROM order_items oi WHERE oi.id_order = o.id_order
                )
            ) AS row_data
        FROM orders o
        WHERE o.buyer_user_id = auth.uid()
        ORDER BY o.created_at DESC
        LIMIT 30
    ) sub;
$$;

GRANT EXECUTE ON FUNCTION public.riwayat_pesanan_saya() TO authenticated;

-- ==========================================
-- 15. PENYELARASAN RLS ORDERS & ORDER_ITEMS UNTUK PERAN DAPUR (PB-045)
-- ==========================================
DROP POLICY IF EXISTS "Pegawai: Kelola Transaksi" ON orders;
CREATE POLICY "Kasir: Kelola Transaksi" ON orders
    FOR ALL TO authenticated
    USING (public.is_pegawai())
    WITH CHECK (public.is_pegawai());

DROP POLICY IF EXISTS "Dapur: Lihat Pesanan Lunas" ON orders;
CREATE POLICY "Dapur: Lihat Pesanan Lunas" ON orders
    FOR SELECT TO authenticated
    USING (
        public.get_staff_role() = 'dapur'
        AND status_pembayaran::TEXT = 'lunas'
        AND status_pesanan::TEXT IN ('disiapkan', 'siap')
    );

DROP POLICY IF EXISTS "Pegawai: Kelola Detail Transaksi" ON order_items;
CREATE POLICY "Kasir: Kelola Detail Transaksi" ON order_items
    FOR ALL TO authenticated
    USING (public.is_pegawai())
    WITH CHECK (public.is_pegawai());

DROP POLICY IF EXISTS "Dapur: Lihat Item Pesanan Lunas" ON order_items;
CREATE POLICY "Dapur: Lihat Item Pesanan Lunas" ON order_items
    FOR SELECT TO authenticated
    USING (
        public.get_staff_role() = 'dapur'
        AND EXISTS (
            SELECT 1 FROM orders o
            WHERE o.id_order = order_items.id_order
              AND o.status_pembayaran::TEXT = 'lunas'
              AND o.status_pesanan::TEXT IN ('disiapkan', 'siap')
        )
    );

-- Pastikan publikasi realtime mencakup orders, menu_custom, dan app_settings (PB-042)
DO $$
BEGIN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE orders; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE menu_custom; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE app_settings; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
