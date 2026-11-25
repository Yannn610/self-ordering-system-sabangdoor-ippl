/**
 * File: script-pembayaran.js
 * Deskripsi: Alur checkout, integrasi Supabase (orders & order_items), dan status pesanan Sabangdor
 */

const CART_KEY = "sabangdor_cart";
const QRIS_STORAGE_KEY = "sabangdor_custom_qris";
const DEFAULT_QRIS = "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?auto=format&fit=crop&w=600&q=80";

// Helper Utility
const formatRupiah = (n) => "Rp" + Math.round(Number(n) || 0).toLocaleString("id-ID");
const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    }[c]));

// State Halaman
let currentStep = "checkout"; // 'checkout' | 'qris' | 'sukses'
let cartData = [];
let namaPembeli = "";
let selectedPayment = "cash"; // 'cash' | 'qris'
let createdOrderData = null;

function loadCart() {
    try {
        const data = JSON.parse(localStorage.getItem(CART_KEY));
        if (!Array.isArray(data)) return [];
        // Tolak item jika qty <= 0 atau harga <= 0
        return data.filter((i) => i && Number(i.qty) > 0 && Number(i.harga) > 0);
    } catch (e) {
        return [];
    }
}

const LAST_ORDER_KEY = "sabangdor_last_order";

// Inisialisasi Lifecycle
document.addEventListener("DOMContentLoaded", async () => {
    cartData = loadCart();

    // Muat pengaturan bersama (status toko & gambar QRIS) dari Supabase
    if (window.SabangdorSettings) await window.SabangdorSettings.muat();

    if (cartData.length === 0) {
        // Refresh setelah pesanan sukses: tampilkan lagi nomor antreannya
        try {
            const last = JSON.parse(sessionStorage.getItem(LAST_ORDER_KEY));
            if (last && last.nomor_antrean) {
                createdOrderData = last;
                currentStep = "sukses";
                renderStep();
                return;
            }
        } catch (e) {}

        alert("Keranjang belanja kosong! Mengalihkan ke menu utama.");
        window.location.href = "index.html";
        return;
    }

    if (localStorage.getItem("sabangdor_status_toko") === "tutup") {
        alert("Mohon maaf, toko saat ini sedang TUTUP. Anda akan diarahkan kembali ke halaman utama.");
        window.location.href = "index.html";
        return;
    }

    renderStep();
});

// Render Tampilan Berdasarkan Step
function renderStep() {
    document.body.setAttribute("data-step", currentStep);
    const mainContent = document.getElementById("mainContent");
    const footerArea = document.getElementById("footerArea");
    const pageTitle = document.getElementById("pageTitle");
    const backBtn = document.getElementById("backBtn");
    const metaEl = document.getElementById("orderInfoMeta");

    const subtotal = cartData.reduce((sum, i) => sum + (Number(i.harga) || 0), 0);
    const totalQty = cartData.reduce((sum, i) => sum + (Number(i.qty) || 0), 0);

    if (metaEl) metaEl.textContent = `${totalQty} Item • Total ${formatRupiah(subtotal)}`;

    if (currentStep === "checkout") {
        pageTitle.textContent = "Checkout";
        backBtn.onclick = null;
        backBtn.href = "keranjang.html";

        mainContent.innerHTML = `
            <div class="card-pembayaran" style="background:#fff; border-radius:16px; padding:16px; border:1px solid #E2E8F0; margin-bottom:14px;">
                <h3 style="margin:0 0 10px 0; font-size:14px; font-weight:700;">Data Pemesan</h3>
                <label style="font-size:12px; color:#64748B; display:block; margin-bottom:6px;">Nama Lengkap / Panggilan:</label>
                <input type="text" id="inputNamaPembeli" class="input-nama" maxlength="50" placeholder="Contoh: Budi Santoso" value="${esc(namaPembeli)}" 
                    style="width:100%; box-sizing:border-box; padding:10px 12px; border-radius:10px; border:1px solid #CBD5E1; font-family:inherit; font-size:14px;">
            </div>

            <div class="card-pembayaran" style="background:#fff; border-radius:16px; padding:16px; border:1px solid #E2E8F0; margin-bottom:14px;">
                <h3 style="margin:0 0 10px 0; font-size:14px; font-weight:700;">Rincian Pesanan</h3>
                <ul style="list-style:none; padding:0; margin:0;">
                    ${cartData.map(item => `
                        <li style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px dashed #E2E8F0; font-size:13px;">
                            <div>
                                <b>${item.qty}x</b> ${esc(item.nama)}
                                <div style="font-size:11px; color:#64748B;">${esc(item.varian || "")}</div>
                            </div>
                            <b>${formatRupiah(item.harga)}</b>
                        </li>
                    `).join('')}
                </ul>
            </div>

            <div class="card-pembayaran" style="background:#fff; border-radius:16px; padding:16px; border:1px solid #E2E8F0;">
                <h3 style="margin:0 0 12px 0; font-size:14px; font-weight:700;">Metode Pembayaran</h3>
                <div style="display:flex; flex-direction:column; gap:10px;">
                    <label style="display:flex; align-items:center; gap:10px; padding:10px; border-radius:10px; border:1px solid ${selectedPayment === 'cash' ? '#E11D48' : '#CBD5E1'}; background:${selectedPayment === 'cash' ? '#FFF1F2' : '#FFF'}; cursor:pointer;">
                        <input type="radio" name="paymentMethod" value="cash" ${selectedPayment === 'cash' ? 'checked' : ''} onchange="pilihMetode('cash')">
                        <span style="font-size:13px; font-weight:600;">💵 Bayar Tunai (Di Kasir Outlet)</span>
                    </label>
                    <label style="display:flex; align-items:center; gap:10px; padding:10px; border-radius:10px; border:1px solid ${selectedPayment === 'qris' ? '#E11D48' : '#CBD5E1'}; background:${selectedPayment === 'qris' ? '#FFF1F2' : '#FFF'}; cursor:pointer;">
                        <input type="radio" name="paymentMethod" value="qris" ${selectedPayment === 'qris' ? 'checked' : ''} onchange="pilihMetode('qris')">
                        <span style="font-size:13px; font-weight:600;">📱 QRIS (E-Wallet / M-Banking)</span>
                    </label>
                </div>
            </div>
        `;

        footerArea.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <span style="font-size:13px; color:#64748B;">Total Tagihan</span>
                <span style="font-size:18px; font-weight:800; color:#E11D48;">${formatRupiah(subtotal)}</span>
            </div>
            <button type="button" class="btn-checkout" id="btnSubmitOrder" onclick="handleLanjutPembayaran()" 
                style="width:100%; padding:14px; border-radius:12px; background:#E11D48; color:#fff; border:none; font-weight:700; font-size:15px; cursor:pointer;">
                ${selectedPayment === 'qris' ? 'Lanjut ke Pembayaran QRIS' : 'Konfirmasi & Kirim Pesanan'}
            </button>
        `;
    } else if (currentStep === "qris") {
        pageTitle.textContent = "Pembayaran QRIS";
        backBtn.removeAttribute("href");
        backBtn.onclick = () => { currentStep = "checkout"; renderStep(); };

        const qrisImg = localStorage.getItem(QRIS_STORAGE_KEY) || DEFAULT_QRIS;

        mainContent.innerHTML = `
            <div style="text-align:center; background:#fff; border-radius:16px; padding:20px; border:1px solid #E2E8F0;">
                <h3 style="margin:0 0 6px 0; font-size:16px; font-weight:800;">Scan QRIS Sabangdor</h3>
                <p style="font-size:12px; color:#64748B; margin:0 0 16px 0;">Buka aplikasi e-wallet / mobile banking Anda dan lakukan pembayaran sesuai nominal.</p>
                <div style="display:inline-block; padding:10px; border:1px solid #CBD5E1; border-radius:12px; background:#fff;">
                    <img src="${esc(qrisImg)}" alt="QRIS Outlet" style="width:200px; height:200px; object-fit:contain; display:block;">
                </div>
                <div style="margin-top:16px; padding:10px; background:#FFF1F2; border-radius:10px; border:1px solid #FECDD3;">
                    <span style="font-size:12px; color:#64748B;">Total yang harus dibayar:</span>
                    <div style="font-size:18px; font-weight:800; color:#E11D48;">${formatRupiah(subtotal)}</div>
                </div>
            </div>
        `;

        footerArea.innerHTML = `
            <button type="button" id="btnKonfirmasiQris" onclick="eksekusiSimpanPesanan()" 
                style="width:100%; padding:14px; border-radius:12px; background:#10B981; color:#fff; border:none; font-weight:700; font-size:15px; cursor:pointer;">
                ✓ Saya Sudah Bayar
            </button>
        `;
    } else if (currentStep === "sukses") {
        pageTitle.textContent = "Pesanan Dikirim";
        backBtn.onclick = null;
        backBtn.href = "index.html";

        const nomorAntreanFormatted = `ANT-${String(createdOrderData?.nomor_antrean || 1).padStart(2, '0')}`;

        mainContent.innerHTML = `
            <div style="text-align:center; padding:24px 16px;">
                <div style="width:64px; height:64px; background:#DCFCE7; color:#16A34A; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 16px; font-size:32px;">✓</div>
                <h2 style="font-size:18px; font-weight:800; margin:0 0 6px 0;">Pesanan Berhasil Dibuat!</h2>
                <p style="font-size:12px; color:#64748B; margin:0 0 20px 0;">Pesanan atas nama <b>${esc(createdOrderData?.nama_pembeli)}</b> telah diteruskan ke dapur SABANGDOR.</p>

                <div style="background:#fff; border-radius:16px; border:1px solid #E2E8F0; padding:16px; text-align:left;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:13px;">
                        <span style="color:#64748B;">Nomor Antrean</span>
                        <strong style="color:#E11D48; font-size:15px;">#${nomorAntreanFormatted}</strong>
                    </div>
                    <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:13px;">
                        <span style="color:#64748B;">Metode Bayar</span>
                        <strong>${(createdOrderData?.tipe_pembayaran || '').toUpperCase()}</strong>
                    </div>
                    <div style="display:flex; justify-content:space-between; font-size:13px;">
                        <span style="color:#64748B;">Status Bayar</span>
                        <span style="color:#D97706; font-weight:700;">Menunggu Verifikasi Kasir</span>
                    </div>
                </div>
            </div>
        `;

        footerArea.innerHTML = `
            <a href="index.html" style="display:block; text-align:center; width:100%; box-sizing:border-box; padding:14px; border-radius:12px; background:#E11D48; color:#fff; text-decoration:none; font-weight:700; font-size:15px;">
                Pesan Menu Lain
            </a>
        `;
    }
}

window.pilihMetode = function(tipe) {
    selectedPayment = tipe;
    renderStep();
};

function handleLanjutPembayaran() {
    const namaInp = document.getElementById("inputNamaPembeli");
    namaPembeli = (namaInp ? namaInp.value : "").trim();

    if (!namaPembeli) {
        alert("Silakan masukkan nama pemesan terlebih dahulu!");
        if (namaInp) namaInp.focus();
        return;
    }

    if (selectedPayment === "qris") {
        currentStep = "qris";
        renderStep();
    } else {
        eksekusiSimpanPesanan();
    }
}

// Simpan pesanan ke Supabase lewat fungsi atomik buat_pesanan()
// (order + semua item tersimpan dalam 1 transaksi; status pembeli selalu 'pending')
async function eksekusiSimpanPesanan() {
    const client = window.supabaseClient;
    if (!client) {
        alert("Koneksi Supabase belum siap. Periksa kembali config.js!");
        return;
    }

    // Baca ulang localStorage tepat sebelum submit untuk mencegah manipulasi mid-session
    const freshCart = loadCart();
    if (freshCart.length === 0) {
        localStorage.removeItem(CART_KEY);
        alert("Data keranjang tidak valid atau kosong! Mengalihkan ke menu utama.");
        window.location.href = "index.html";
        return;
    }

    const btnSubmit = document.getElementById("btnSubmitOrder") || document.getElementById("btnKonfirmasiQris");
    if (btnSubmit) {
        if (btnSubmit.disabled) return; // cegah klik ganda
        btnSubmit.disabled = true;
        btnSubmit.innerText = "Mengirim ke Dapur...";
    }

    const tipePembayaranValid = selectedPayment === "qris" ? "qris" : "cash";

    try {
        const itemsPayload = freshCart.map(item => {
            const qty = Number(item.qty) || 0;
            const subtotal = Number(item.harga) || 0;
            if (qty <= 0 || subtotal <= 0) {
                throw new Error("Data keranjang tidak valid (harga/jumlah harus lebih dari 0).");
            }
            return {
                nama_item: item.nama || "Menu",
                varian: item.varian || "",
                catatan: item.catatan || "",
                jumlah: qty,
                harga_satuan: Math.round(subtotal / qty),
                subtotal: subtotal
            };
        });

        const { data, error } = await client.rpc("buat_pesanan", {
            p_nama: namaPembeli,
            p_tipe: tipePembayaranValid,
            p_items: itemsPayload
        });

        if (error) throw error;
        if (!data || !data.nomor_antrean) throw new Error("Respon server tidak valid.");

        localStorage.removeItem(CART_KEY);
        createdOrderData = data;
        try { sessionStorage.setItem(LAST_ORDER_KEY, JSON.stringify(data)); } catch (e) {}
        currentStep = "sukses";
        renderStep();

    } catch (err) {
        console.error("Gagal memproses pesanan ke Supabase:", err);
        let pesan = err.message || String(err);
        if (/buat_pesanan/i.test(pesan) && /(function|schema cache|not find)/i.test(pesan)) {
            pesan = "Database belum diperbarui. Jalankan supabase/migration_perbaikan.sql di Supabase SQL Editor.";
        }
        alert("Gagal memproses pesanan: " + pesan);
        if (btnSubmit) {
            btnSubmit.disabled = false;
            btnSubmit.innerText = "Coba Lagi";
        }
    }
}