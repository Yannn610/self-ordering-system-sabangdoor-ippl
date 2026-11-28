# Server Express Sabangdor (Opsional / Legacy)

> **Catatan Arsitektur (PB-032):** Aplikasi frontend utama Sabangdor (`index.html`, `checkout.html`, `penjual-page/dashboard.html`) terhubung **langsung ke Supabase** melalui satu sumber konfigurasi di `../config.js` menggunakan RPC atomik dan Row Level Security (RLS).

Direktori `server/` ini dipertahankan **hanya sebagai backend Express opsional** apabila tim memerlukan:
1. Endpoint admin pembuatan akun pegawai via `SUPABASE_SERVICE_ROLE_KEY` (`POST /api/staff/invite`).
2. Akses REST API tambahan dengan autentikasi JWT Supabase + pembatasan laju per-IP.

Berkas layanan warisan (`server/services/*` dan `config/supabaseClient.js`) telah dihapus agar tidak terjadi duplikasi kredensial maupun bypass RLS.

## Variabel Lingkungan (`.env`)
```env
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<opsional-untuk-invite-pegawai>
ALLOWED_ORIGINS=http://localhost:5500,http://127.0.0.1:5500
DB_HOST=localhost
DB_PORT=5432
DB_NAME=impal
DB_USER=postgres
DB_PASSWORD=<isi-password>
```
