import { supabase } from '../config/supabaseClient.js';

export const MenuService = {
    /**
     * Mengambil daftar menu utama dari tabel 'menus'
     */
    async getMenus() {
        const { data, error } = await supabase
            .from('menus')
            .select('*')
            .order('id_menu', { ascending: true });
        
        if (error) throw new Error("Gagal memuat menu utama: " + error.message);
        
        return data.map(m => ({
            id: m.id_menu,
            nama: m.nama_dimsum,
            harga: Number(m.harga),
            stok: m.stok,
            status: m.stok > 0 ? 'tersedia' : 'habis',
            img: m.foto_url || 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80'
        }));
    },

    /**
     * Mengambil daftar menu custom dari tabel 'menu_custom'
     */
    async getCustomMenus() {
        const { data, error } = await supabase
            .from('menu_custom')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) throw new Error("Gagal memuat menu custom: " + error.message);
        return data;
    },

    /**
     * Menyimpan atau memperbarui menu custom ke tabel 'menu_custom'
     */
    async saveCustomMenu(menuData) {
        const { data, error } = await supabase
            .from('menu_custom')
            .upsert([{
                id: menuData.id,
                nama: menuData.nama,
                kategori: menuData.kategori,
                deskripsi: menuData.deskripsi,
                img_url: menuData.img,
                gratis: menuData.gratis,
                ukuran: menuData.ukuran,
                addon: menuData.addon,
                habis: menuData.habis || false
            }])
            .select();

        if (error) throw new Error("Gagal menyimpan menu custom: " + error.message);
        return data[0];
    },

    /**
     * Menghapus menu custom berdasarkan ID
     */
    async deleteCustomMenu(menuId) {
        const { error } = await supabase
            .from('menu_custom')
            .delete()
            .eq('id', menuId);

        if (error) throw new Error("Gagal menghapus menu custom: " + error.message);
        return true;
    },

    /**
     * Memperbarui status ketersediaan (habis/tersedia) menu custom
     */
    async toggleCustomMenuHabis(menuId, currentHabis) {
        const { error } = await supabase
            .from('menu_custom')
            .update({ habis: !currentHabis })
            .eq('id', menuId);

        if (error) throw new Error("Gagal mengubah status stok: " + error.message);
        return true;
    }
};