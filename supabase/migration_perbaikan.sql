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

-- Helper verifikasi pegawai aktif (mencegah sembarang user Supabase Auth menjadi admin)
CREATE OR REPLACE FUNCTION public.is_pegawai()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT auth.role() = 'authenticated'
       AND EXISTS (
           SELECT 1 FROM public.profiles
           WHERE id = auth.uid() AND role = 'pegawai'
       );
$$;

-- KRITIS: Hapus trigger auto-pegawai dari sabangdoor_db.sql agar pendaftaran publik (signUp)
-- lewat anon key di client tidak otomatis menjadi admin/pegawai.
-- Pegawai baru wajib didaftarkan manual oleh admin lewat Supabase SQL Editor.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM anon, authenticated;

DROP POLICY IF EXISTS "Publik: Lihat Pengaturan" ON app_settings;
CREATE POLICY "Publik: Lihat Pengaturan" ON app_settings
    FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Pegawai: Kelola Pengaturan" ON app_settings;
CREATE POLICY "Pegawai: Kelola Pengaturan" ON app_settings
    FOR ALL TO authenticated USING (public.is_pegawai()) WITH CHECK (public.is_pegawai());

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

-- 4. Helper otoritatif perhitungan harga server-side (anti-tampering harga client)
CREATE OR REPLACE FUNCTION public.hitung_harga_item_server(
    p_nama_item TEXT,
    p_varian    TEXT,
    p_habis_arr JSONB DEFAULT '[]'::jsonb
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
    v_custom      RECORD;
    v_uk          JSONB;
    v_ad          JSONB;
    v_uk_name     TEXT;
    v_ad_name     TEXT;
    v_habis_elem  TEXT;
BEGIN
    -- Cek apakah menu bawaan sedang ditandai habis di app_settings
    FOR v_habis_elem IN SELECT LOWER(jsonb_array_elements_text(COALESCE(p_habis_arr, '[]'::jsonb))) LOOP
        IF v_habis_elem = v_nama
           OR (v_habis_elem = 'mentai mix' AND v_nama = 'dimsum mix')
           OR (v_habis_elem = 'mentai cheese' AND v_nama = 'mentai cheeze') THEN
            RAISE EXCEPTION 'Menu "%" sedang habis', p_nama_item;
        END IF;
    END LOOP;

    -- Cek apakah ada di menu_custom (menu tambahan dari kasir)
    SELECT * INTO v_custom
    FROM menu_custom
    WHERE LOWER(TRIM(nama)) = v_nama
    LIMIT 1;

    IF FOUND THEN
        IF COALESCE(v_custom.habis, false) THEN
            RAISE EXCEPTION 'Menu "%" sedang habis', p_nama_item;
        END IF;

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
                    IF v_ad_name LIKE '%extra mentai%' AND v_var_upper LIKE 'S (%' THEN
                        RAISE EXCEPTION 'Extra Mentai tidak tersedia untuk ukuran S';
                    ELSIF v_ad_name LIKE '%extra mentai%' AND v_var_upper LIKE 'XL (%' THEN
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

    -- Menu standar Bakpao: hitung total pcs dari rincian varian "Nx Varian, ..."
    IF v_nama = 'bakpao' THEN
        SELECT COALESCE(SUM((m[1])::INT), 0)
        INTO v_bakpao_pcs
        FROM regexp_matches(v_var, '(\d+)\s*x\s*', 'gi') AS m;

        IF v_bakpao_pcs <= 0 THEN
            v_bakpao_pcs := COALESCE((substring(v_var FROM '^(\d+)\s*pcs'))::INT, 0);
        END IF;
        IF v_bakpao_pcs <= 0 OR v_bakpao_pcs > 200 THEN
            RAISE EXCEPTION 'Jumlah pcs Bakpao tidak valid';
        END IF;

        -- Hitung paket optimal (6 pcs = 36.000, 3 pcs = 20.000, 1 pcs = 7.000)
        v_best := v_bakpao_pcs * 7000;
        FOR v_pack6 IN 0..(v_bakpao_pcs / 6) LOOP
            v_rem := v_bakpao_pcs - (v_pack6 * 6);
            FOR v_pack3 IN 0..(v_rem / 3) LOOP
                v_best := LEAST(v_best, (v_pack6 * 36000) + (v_pack3 * 20000) + ((v_rem - v_pack3 * 3) * 7000));
            END LOOP;
        END LOOP;
        RETURN v_best;
    END IF;

    -- Ekstrak ukuran standar S / M / XL
    IF v_var_upper ~ '^XL(\s|\(|$)' THEN
        v_ukuran_key := 'XL';
    ELSIF v_var_upper ~ '^M(\s|\(|$)' THEN
        v_ukuran_key := 'M';
    ELSIF v_var_upper ~ '^S(\s|\(|$)' THEN
        v_ukuran_key := 'S';
    ELSE
        v_ukuran_key := '';
    END IF;

    IF v_nama IN ('mentai ori', 'dimsum mentai ori') THEN
        v_base_price := CASE v_ukuran_key WHEN 'S' THEN 13000 WHEN 'M' THEN 23000 WHEN 'XL' THEN 60000 ELSE NULL END;
    ELSIF v_nama IN ('mentai cheese', 'mentai cheeze', 'dimsum mentai cheeze', 'dimsum mentai cheese') THEN
        v_base_price := CASE v_ukuran_key WHEN 'S' THEN 15000 WHEN 'M' THEN 26000 WHEN 'XL' THEN 67000 ELSE NULL END;
    ELSIF v_nama IN ('mentai tanuki', 'dimsum mentai tanuki') THEN
        v_base_price := CASE v_ukuran_key WHEN 'S' THEN 15000 WHEN 'M' THEN 26000 WHEN 'XL' THEN 67000 ELSE NULL END;
    ELSIF v_nama IN ('mentai mix', 'dimsum mix', 'dimsum mentai mix') THEN
        v_base_price := CASE v_ukuran_key WHEN 'M' THEN 26000 WHEN 'XL' THEN 67000 ELSE NULL END;
    ELSIF v_nama IN ('dimsum aja') THEN
        v_base_price := CASE v_ukuran_key WHEN 'S' THEN 10000 WHEN 'M' THEN 18000 WHEN 'XL' THEN 47000 ELSE NULL END;
    ELSIF v_nama = 'extra mentai' THEN
        v_base_price := CASE WHEN v_ukuran_key = 'XL' THEN 5000 ELSE 3000 END;
    ELSIF v_nama IN ('chilli oil extra', 'chilli oil tambahan') THEN
        v_base_price := 3000;
    END IF;

    IF v_base_price IS NULL THEN
        RAISE EXCEPTION 'Menu atau ukuran "% (%)" tidak valid', p_nama_item, p_varian;
    END IF;

    -- Validasi Add-on pada varian menu standar
    IF LOWER(v_var) LIKE '%extra mentai%' AND v_nama <> 'extra mentai' THEN
        IF v_nama = 'dimsum aja' THEN
            RAISE EXCEPTION 'Extra Mentai tidak tersedia untuk Dimsum aja';
        ELSIF v_ukuran_key = 'S' THEN
            RAISE EXCEPTION 'Extra Mentai tidak tersedia untuk ukuran S';
        ELSIF v_ukuran_key = 'XL' THEN
            v_addon_total := v_addon_total + 5000;
        ELSE
            v_addon_total := v_addon_total + 3000;
        END IF;
    END IF;

    IF (LOWER(v_var) LIKE '%chilli oil%' OR LOWER(v_var) LIKE '%chili oil%') AND v_nama NOT IN ('chilli oil extra', 'chilli oil tambahan') THEN
        v_addon_total := v_addon_total + 3000;
    END IF;

    RETURN v_base_price + v_addon_total;
END;
$$;

-- 5. Fungsi atomik pembuatan pesanan (order + semua item dalam 1 transaksi).
--    - Pembeli (anon) selalu masuk sebagai 'pending' / 'menunggu' dan harga dihitung ulang di server.
--    - Ditolak jika toko sedang tutup atau item sedang habis.
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
    v_staff       BOOLEAN := public.is_pegawai();
    v_total       NUMERIC := 0;
    v_id          BIGINT;
    v_nomor       INT;
    v_tipe        payment_type;
    v_bayar       payment_status;
    v_status      order_status;
    v_toko        TEXT;
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
BEGIN
    IF COALESCE(TRIM(p_nama), '') = '' THEN
        RAISE EXCEPTION 'Nama pemesan wajib diisi';
    END IF;
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Keranjang kosong';
    END IF;
    IF jsonb_array_length(p_items) > 50 THEN
        RAISE EXCEPTION 'Terlalu banyak item dalam satu pesanan';
    END IF;

    v_tipe := (CASE WHEN LOWER(p_tipe) IN ('cash', 'tunai') THEN 'cash' ELSE 'qris' END)::payment_type;

    IF v_staff THEN
        v_bayar  := (CASE WHEN p_status_bayar IN ('pending', 'lunas', 'batal') THEN p_status_bayar ELSE 'pending' END)::payment_status;
        v_status := (CASE WHEN p_status_pesanan IN ('menunggu', 'disiapkan', 'selesai') THEN p_status_pesanan ELSE 'menunggu' END)::order_status;
    ELSE
        -- Batasi spam pesanan publik dari sisi client (anti-flood antrean)
        SELECT COUNT(*) INTO v_recent_cnt
        FROM orders
        WHERE status_pembayaran = 'pending'
          AND created_at >= NOW() - INTERVAL '1 minute';
        IF v_recent_cnt >= 15 THEN
            RAISE EXCEPTION 'Terlalu banyak pesanan masuk bersamaan. Coba lagi beberapa saat.';
        END IF;

        SELECT value INTO v_toko FROM app_settings WHERE key = 'status_toko';
        IF v_toko = 'tutup' THEN
            RAISE EXCEPTION 'Mohon maaf, toko sedang tutup';
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

    -- Validasi & hitung total di server sebelum insert
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
            v_harga_unit := public.hitung_harga_item_server(v_nama_item, v_varian, v_habis_arr);
            v_subtotal   := v_harga_unit * v_qty;
        END IF;

        v_total := v_total + v_subtotal;
    END LOOP;

    IF v_total <= 0 THEN
        RAISE EXCEPTION 'Total pesanan tidak valid';
    END IF;

    INSERT INTO orders (nomor_antrean, nama_pembeli, tipe_pembayaran, status_pembayaran, status_pesanan, total_harga)
    VALUES (0, LEFT(TRIM(p_nama), 50), v_tipe, v_bayar, v_status, v_total)
    RETURNING orders.id_order, orders.nomor_antrean INTO v_id, v_nomor;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_qty       := (v_item->>'jumlah')::INT;
        v_nama_item := LEFT(COALESCE(NULLIF(TRIM(v_item->>'nama_item'), ''), 'Menu'), 100);
        v_varian    := LEFT(COALESCE(v_item->>'varian', ''), 200);
        v_catatan   := LEFT(COALESCE(v_item->>'catatan', ''), 200);

        IF v_staff THEN
            v_harga_unit := GREATEST(COALESCE((v_item->>'harga_satuan')::NUMERIC, 0), 0);
        ELSE
            v_harga_unit := public.hitung_harga_item_server(v_nama_item, v_varian, v_habis_arr);
        END IF;
        v_subtotal := v_harga_unit * v_qty;

        INSERT INTO order_items (id_order, id_menu, jumlah, nama_item, varian, catatan, harga_satuan, subtotal)
        VALUES (v_id, NULL, v_qty, v_nama_item, v_varian, v_catatan, v_harga_unit, v_subtotal);
    END LOOP;

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

-- 6. Fungsi anonim untuk Apriori ML (hanya mengembalikan basket nama menu tanpa PII/omzet)
CREATE OR REPLACE FUNCTION public.get_apriori_baskets(p_limit INT DEFAULT 500)
RETURNS TABLE(id_order BIGINT, nama_item TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT oi.id_order,
           COALESCE(oi.nama_item, m.nama_dimsum) AS nama_item
    FROM order_items oi
    JOIN orders o ON o.id_order = oi.id_order
    LEFT JOIN menus m ON m.id_menu = oi.id_menu
    WHERE o.status_pembayaran <> 'batal'
    ORDER BY oi.id_order DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 2000);
$$;

GRANT EXECUTE ON FUNCTION public.get_apriori_baskets(INT) TO anon, authenticated;

-- 7. Keamanan RLS:
--    - Pembeli (anon) TIDAK boleh INSERT langsung ke orders/order_items (cegah manipulasi status 'lunas').
--    - Pembeli (anon) TIDAK boleh SELECT seluruh isi orders/order_items (cegah kebocoran data pembeli & omzet).
--    - Pegawai diverifikasi lewat public.is_pegawai().
DROP POLICY IF EXISTS "Pembeli: Buat Transaksi" ON orders;
DROP POLICY IF EXISTS "Pembeli: Buat Detail Pesanan" ON order_items;
DROP POLICY IF EXISTS "Pembeli: Lihat Nota Transaksi" ON orders;
DROP POLICY IF EXISTS "Pembeli: Lihat Item Nota" ON order_items;

DROP POLICY IF EXISTS "Pegawai: Kelola Transaksi" ON orders;
CREATE POLICY "Pegawai: Kelola Transaksi" ON orders
    FOR ALL TO authenticated USING (public.is_pegawai()) WITH CHECK (public.is_pegawai());

DROP POLICY IF EXISTS "Pegawai: Kelola Detail Transaksi" ON order_items;
CREATE POLICY "Pegawai: Kelola Detail Transaksi" ON order_items
    FOR ALL TO authenticated USING (public.is_pegawai()) WITH CHECK (public.is_pegawai());

DROP POLICY IF EXISTS "Pegawai: Kelola Menu" ON menus;
CREATE POLICY "Pegawai: Kelola Menu" ON menus
    FOR ALL TO authenticated USING (public.is_pegawai()) WITH CHECK (public.is_pegawai());

DROP POLICY IF EXISTS "Pegawai: Kelola Menu Custom" ON menu_custom;
CREATE POLICY "Pegawai: Kelola Menu Custom" ON menu_custom
    FOR ALL TO authenticated USING (public.is_pegawai()) WITH CHECK (public.is_pegawai());

DROP POLICY IF EXISTS "Pegawai: Lihat Profile" ON profiles;
CREATE POLICY "Pegawai: Lihat Profile" ON profiles
    FOR SELECT TO authenticated USING (id = auth.uid() AND role = 'pegawai');
