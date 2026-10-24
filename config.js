// Konfigurasi Endpoint Backend Lokal Express.js
const API_BASE_URL = 'http://localhost:5000/api';

// Konfigurasi Supabase Sabangdor
const SUPABASE_URL = "URL SUPABASE";
const SUPABASE_ANON_KEY = "PUBLISHED KEY";

// Inisialisasi Supabase Client Global jika SDK tersedia di browser
if (typeof window !== 'undefined' && typeof window.supabase !== 'undefined' && window.supabase.createClient) {
    try {
        window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } catch (e) {
        console.warn('Gagal inisialisasi Supabase client:', e);
    }
}