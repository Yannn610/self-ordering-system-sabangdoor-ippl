import { supabase } from '../config/supabaseClient.js';

export const OrderService = {
    /**
     * Membuat pesanan baru secara relasional (tabel 'orders' & 'order_items')
     * Menggunakan Stored Function: generate_daily_queue_number()
     */
    async createOrder(orderData, cartItems) {
        // A. Generate nomor antrean harian otomatis via fungsi database
        const { data: nomorAntrean, error: qError } = await supabase
            .rpc('generate_daily_queue_number');
        
        if (qError) throw new Error("Gagal generate nomor antrean: " + qError.message);

        const antreanFinal = nomorAntrean || 1;
        const idOrderFormatted = `ANT-${String(antreanFinal).padStart(2, '0')}`;

        // Konversi metode bayar ke format ENUM database ('cash' atau 'qris')
        const tipePembayaranDb = String(orderData.metodeBayar).toLowerCase().includes('tunai') || String(orderData.metodeBayar).toLowerCase().includes('cash') ? 'cash' : 'qris';

        // B. Insert data utama ke tabel 'orders'
        const { data: insertedOrder, error: orderError } = await supabase
            .from('orders')
            .insert([{
                nomor_antrean: antreanFinal,
                nama_pembeli: orderData.namaPelanggan,
                tipe_pembayaran: tipePembayaranDb,
                status_pembayaran: orderData.statusPembayaran || 'pending',
                status_pesanan: orderData.statusPesanan || 'disiapkan',
                total_harga: orderData.totalHarga
            }])
            .select()
            .single();

        if (orderError) throw new Error("Gagal menyimpan transaksi utama: " + orderError.message);

        const idOrder = insertedOrder.id_order;

        // C. Insert rincian item ke tabel 'order_items' (Relasi One-to-Many)
        const orderItemsPayload = cartItems.map(item => ({
            id_order: idOrder,
            id_menu: item.idMenu || null,
            jumlah: item.qty || 1,
            nama_item: item.namaItemDb || item.namaMenu,
            varian: item.varian || '',
            catatan: item.catatan || '',
            harga_satuan: Number(item.hargaSatuan) || 0,
            subtotal: Number(item.subtotal) || 0
        }));

        const { error: itemsError } = await supabase
            .from('order_items')
            .insert(orderItemsPayload);

        if (itemsError) throw new Error("Gagal menyimpan detail item pesanan: " + itemsError.message);

        return {
            success: true,
            dbIdOrder: idOrder,
            idOrder: idOrderFormatted,
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