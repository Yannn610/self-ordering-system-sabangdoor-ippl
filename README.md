# SABANGDOR — Self-Ordering System & Outlet POS

Sistem pemesanan mandiri (*take away*) dan dashboard operasional kasir, dapur, serta pemilik untuk **SABANGDOR** (Dimsum Mentai & Bakpao), terintegrasi langsung dengan **Supabase** (PostgreSQL, Auth, Realtime, RPC atomik, dan Row Level Security).

## Arsitektur & Konfigurasi Tunggal (PB-032)

- **Satu sumber konfigurasi:** Seluruh halaman frontend hanya memakai [`config.js`](./config.js) untuk `SUPABASE_URL` dan `SUPABASE_ANON_KEY`. Berkas warisan (`config/supabaseClient.js` dan `server/services/*`) telah dihapus.
- **Keamanan berlapis:**
  - Pesanan publik selalu dibuat lewat RPC atomik `buat_pesanan()` yang menghitung ulang harga dari katalog server (`hitung_harga_item_server()`), menerapkan batas laju global & per-perangkat, serta memvalidasi voucher, poin loyalitas, stok harian, jadwal operasional, dan slot pre-order.
  - Akses tabel `orders` dan `order_items` dibatasi ketat oleh Row Level Security (RLS) sesuai peran (`pemilik`, `kasir`, `dapur`, dan `pegawai`).
  - Pembeli melacak pesanan hanya lewat token unik (`lacak_pesanan(p_token)`) dan layar antrean publik memakai `get_layar_antrean()` tanpa nama pelanggan.
- **Server Express (`server/`):** Bersifat **opsional/legacy** (lihat [`server/README.md`](./server/README.md)). Aplikasi web berjalan penuh secara statis tanpa server Node.

## Langkah Setup Database Supabase

Jalankan skrip SQL di **Supabase > SQL Editor** secara berurutan (semua migrasi bersifat *idempotent*):

1. [`supabase/sabangdoor_db.sql`](./supabase/sabangdoor_db.sql) — skema awal tabel & data seed.
2. [`supabase/migration_perbaikan.sql`](./supabase/migration_perbaikan.sql) — perbaikan keamanan RLS, `app_settings`, dan RPC dasar.
3. [`supabase/migration_v2_lengkap.sql`](./supabase/migration_v2_lengkap.sql) — seluruh skema, trigger, RLS peran terpisah, dan RPC untuk Rilis 2–5:
   - Validasi harga/nama menu & indeks unik case-insensitive (`menu_custom`)
   - Katalog menu bawaan dinamis & urutan kategori (`menu_categories`)
   - Stok harian otomatis, status `siap` diambil, retur pesanan lunas (`retur_pesanan`)
   - Pelacakan token (`lacak_pesanan`), estimasi waktu tunggu (`get_estimasi_tunggu`), layar antrean publik (`get_layar_antrean`)
   - Log audit otomatis (`audit_logs`), Apriori server-side (`hitung_apriori_server`), rekap shift (`shift_closures`), telemetri non-PII (`app_telemetry`)
   - Jadwal buka/tutup otomatis (`is_toko_buka_sekarang`), voucher (`vouchers`), loyalitas poin (`loyalty_accounts`), ulasan (`order_reviews`), pre-order (`get_slot_preorder`), riwayat pembeli (`riwayat_pesanan_saya`), dan idempotensi POS offline (`client_tx_id`).

### Menambahkan Akun Pegawai Pertama
Matikan **Public Signups** di Supabase Authentication Settings, buat akun pegawai lewat Supabase Dashboard > Authentication, lalu masukkan ke `profiles` melalui SQL Editor:

```sql
INSERT INTO public.profiles (id, username, email, role, is_active)
VALUES ('<USER-UUID>', 'Pemilik', 'pemilik@sabangdor.com', 'pemilik', true)
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, is_active = true;
```

Peran yang tersedia:
- `pemilik` / `pegawai`: Akses penuh (Stok, Bayar, Dapur, Menu, Riwayat & Laporan, Shift, Jadwal, Voucher, Apriori, Ulasan, Pegawai & 2FA, Audit & Error).
- `kasir`: Stok, Verifikasi Bayar, Dapur (termasuk Serahkan), Menu, Riwayat & Retur, Shift & Kas, POS Manual.
- `dapur`: Hanya tab Display Kitchen (melihat pesanan lunas, menandai `Siap Diambil`, cetak tiket dapur; tidak melihat omzet).

## Halaman Utama Aplikasi

| Halaman | Fungsi |
|---|---|
| `index.html` | Katalog pembeli dinamis, rekomendasi Apriori, keranjang popup, bahasa ID/EN, PWA |
| `detail-menu-custom.html?id=...` | Halaman detail dinamis untuk seluruh menu bawaan & tambahan (termasuk Bakpao) |
| `keranjang.html` | Keranjang belanja & cross-selling Apriori |
| `checkout.html` | Checkout, validasi nama, anti-bot, voucher, poin loyalitas, pre-order, bukti QRIS |
| `status-pesanan.html?token=...` | Lacak status real-time pembeli, notifikasi siap, form ulasan |
| `riwayat-pembeli.html` | Riwayat pesanan lokal & login opsional Email OTP + tombol Pesan Lagi |
| `layar-antrean.html` | Layar antrean TV publik tanpa nama pelanggan |
| `login-pegawai.html` | Login staf + verifikasi 2FA TOTP |
| `penjual-page/dashboard.html` | Dashboard operasional POS, dapur, laporan, ekspor Excel/PDF, audit, offline mode |

## Menjalankan Secara Lokal & Pengujian Otomatis (PB-033)

Buka folder proyek menggunakan server statis lokal (misalnya VS Code Live Server atau `npx serve .`).

Jalankan seluruh **60 kasus uji regresi otomatis** (48 kasus uji data error + 12 uji fitur Rilis 3–5) dan buat laporan `tests/report.json`:

```bash
npm test
```

Workflow CI otomatis tersedia di [`.github/workflows/ci.yml`](./.github/workflows/ci.yml).
