import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://cdzoqbbywzdggawhkmik.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_pLzm_oODzl58pUStbO39fw_r_aox1aN';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY); 