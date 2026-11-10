// Konfigurasi Supabase Sabangdor
const SUPABASE_URL = 'https://cdzoqbbywzdggawhkmik.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_pLzm_oODzl58pUStbO39fw_r_aox1aN';
// Inisialisasi Supabase Client Global
if (typeof window !== 'undefined' && typeof window.supabase !== 'undefined' && window.supabase.createClient) {
    try {
        window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } catch (e) {
        console.warn('Gagal inisialisasi Supabase client:', e);
    }
}