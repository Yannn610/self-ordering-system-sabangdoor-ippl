class Profile {
    id;
    username;
    role;
    aktif;
    created_at;

    constructor(id, username, role, aktif) {
        this.id = id;
        this.username = username;
        this.role = role;
        this.aktif = aktif;
        this.created_at = new Date();
    }

    handle_new_user() {
        // TODO: Implementasi penanganan user baru dari auth
    }

    is_staff() {
        // TODO: Implementasi pengecekan role pegawai aktif
        return this.aktif && this.role === 'pegawai';
    }
}

class Menu {
    id_menu;
    stok;
    foto_url;
    created_at;
    nama_dimsum;
    harga;

    constructor(id_menu, nama_dimsum, harga, stok, foto_url) {
        this.id_menu = id_menu;
        this.nama_dimsum = nama_dimsum;
        this.harga = harga;
        this.stok = stok;
        this.foto_url = foto_url;
        this.created_at = new Date();
    }
}

class MenuCustom {
    id;
    nama;
    kategori;
    deskripsi;
    img_url;
    gratis;
    ukuran;
    addon;
    habis;
    created_at;

    constructor(id, nama, kategori, ukuran, addon) {
        this.id = id;
        this.nama = nama;
        this.kategori = kategori;
        this.ukuran = ukuran;
        this.addon = addon;
        this.habis = false;
        this.created_at = new Date();
    }
}

class Order {
    id_order;
    nomor_antrean;
    nama_pembeli;
    tipe_pembayaran;
    status_pembayaran;
    status_pesanan;
    total_harga;
    created_at;

    constructor(nama_pembeli, tipe_pembayaran, total_harga) {
        this.nama_pembeli = nama_pembeli;
        this.tipe_pembayaran = tipe_pembayaran;
        this.total_harga = total_harga;
        this.status_pembayaran = 'pending';
        this.status_pesanan = 'menunggu';
        this.created_at = new Date();
    }

    static generate_daily_queue_number() {
        // TODO: Implementasi generate nomor antrean harian otomatis
        return 1;
    }

    cek_status_pesanan(p_id) {
        // TODO: Implementasi pengecekan status pesanan berdasarkan ID
        return this.status_pesanan;
    }
}

class OrderItem {
    id_detail;
    id_order;
    id_menu;
    jumlah;
    nama_item;
    varian;
    catatan;
    subtotal;
    harga_satuan;

    constructor(id_order, id_menu, jumlah, nama_item, harga_satuan, varian, catatan) {
        this.id_order = id_order;
        this.id_menu = id_menu;
        this.jumlah = jumlah;
        this.nama_item = nama_item;
        this.harga_satuan = harga_satuan;
        this.varian = varian;
        this.catatan = catatan;
        this.subtotal = jumlah * harga_satuan;
    }
}
