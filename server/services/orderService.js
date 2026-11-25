import { supabase } from '../config/supabaseClient.js';

export const OrderService = {
    /**
     * Membuat pesanan baru secara atomik lewat RPC buat_pesanan()
     */
    async createOrder(orderData, cartItems) {
        const tipePembayaranDb = String(orderData.metodeBayar).toLowerCase().includes('tunai') || String(orderData.metodeBayar).toLowerCase().includes('cash') ? 'cash' : 'qris';

        const itemsPayload = (cartItems || []).map(item => ({
            nama_item: item.namaItemDb || item.namaMenu || 'Menu',
            varian: item.varian || '',
            catatan: item.catatan || '',
            jumlah: Math.min(99, Math.max(1, Number(item.qty) || 1)),
            harga_satuan: Number(item.hargaSatuan) || 0,
            subtotal: Number(item.subtotal) || 0
        }));

        const { data, error } = await supabase.rpc('buat_pesanan', {
            p_nama: orderData.namaPelanggan,
            p_tipe: tipePembayaranDb,
            p_items: itemsPayload,
            p_status_bayar: orderData.statusPembayaran || 'pending',
            p_status_pesanan: orderData.statusPesanan || 'menunggu'
        });

        if (error) throw new Error("Gagal membuat pesanan: " + error.message);

        const antreanFinal = data.nomor_antrean || 1;
        return {
            success: true,
            dbIdOrder: data.id_order,
            idOrder: `ANT-${String(antreanFinal).padStart(2, '0')}`,
            nomorAntrean: antreanFinal
        };
    },

    /**
     * Mengambil seluruh daftar pesanan beserta rincian itemnya untuk Dashboard & Kitchen Display
     */
    async getAllOrders() {
        const { data: orders, error: oError } = await supabase
            .from('orders')
            .select(`
                *,
                order_items (*)
            `)
            .order('created_at', { ascending: false });

        if (oError) throw new Error("Gagal memuat daftar pesanan: " + oError.message);

        return orders.map(o => ({
            db_id_order: o.id_order,
            idOrder: `ANT-${String(o.nomor_antrean).padStart(2, '0')}`,
            nomorAntrean: o.nomor_antrean,
            namaPelanggan: o.nama_pembeli,
            metodeBayar: o.tipe_pembayaran.toUpperCase(),
            totalHarga: Number(o.total_harga),
            totalHargaFormatted: `Rp${Number(o.total_harga).toLocaleString('id-ID')}`,
            statusPembayaranDb: o.status_pembayaran, // 'pending' | 'lunas' | 'batal'
            statusPesananDb: o.status_pesanan,       // 'menunggu' | 'disiapkan' | 'selesai'
            waktu: new Date(o.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
            tanggal: new Date(o.created_at).toLocaleDateString('id-ID'),
            items: o.order_items.map(i => ({
                nama: i.nama_item,
                varian: i.varian,
                catatan: i.catatan,
                qty: i.jumlah,
                hargaSatuan: Number(i.harga_satuan),
                totalHargaItem: Number(i.subtotal)
            }))
        }));
    },

    /**
     * Memperbarui status pembayaran ('pending' atau 'lunas')
     */
    async updatePaymentStatus(dbIdOrder, isLunas) {
        const statusDb = isLunas ? 'lunas' : 'pending';
        const { error } = await supabase
            .from('orders')
            .update({ status_pembayaran: statusDb })
            .eq('id_order', dbIdOrder);

        if (error) throw new Error("Gagal memperbarui status pembayaran: " + error.message);
        return true;
    },

    /**
     * Memperbarui status pesanan dapur ('menunggu', 'disiapkan', atau 'selesai')
     */
    async updateOrderStatus(dbIdOrder, statusPesanan) {
        const { error } = await supabase
            .from('orders')
            .update({ status_pesanan: statusPesanan })
            .eq('id_order', dbIdOrder);

        if (error) throw new Error("Gagal memperbarui status dapur: " + error.message);
        return true;
    }
};