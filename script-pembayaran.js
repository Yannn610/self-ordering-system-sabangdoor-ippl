/**
 * File: script-pembayaran.js
 * Deskripsi: Alur checkout, integrasi Supabase (orders & order_items), dan status pesanan Sabangdor
 */

const CART_KEY = "sabangdor_cart";
const QRIS_STORAGE_KEY = "sabangdor_custom_qris";

const formatRupiah = (n) => "Rp" + Math.round(Number(n) || 0).toLocaleString("id-ID");
const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    }[c]));

let currentStep = "checkout"; // 'checkout' | 'qris' | 'sukses'
let cartData = [];
let namaPembeli = "";
let selectedPayment = "cash"; // 'cash' | 'qris'
let createdOrderData = null;

function safeImgSrc(src) {
    if (!src || typeof src !== "string") return "";
    const trimmed = src.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) return trimmed;
    return "";
}

function loadCart() {
    try {
        const data = JSON.parse(localStorage.getItem(CART_KEY));
        if (!Array.isArray(data)) return [];
        return data
            .filter((i) => i && Number.isFinite(Number(i.qty)) && Number(i.qty) >= 1 && Number(i.harga) > 0)
            .map((i) => ({
                ...i,
                qty: Math.min(99, Math.max(1, Math.round(Number(i.qty)))),
                harga: Math.round(Number(i.harga))
            }));
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
            <div class="card-pembayaran">
                <h2 class="pay-card-title">Data Pemesan</h2>
                <label for="inputNamaPembeli" class="field-head">Nama Lengkap / Panggilan</label>
                <input type="text" id="inputNamaPembeli" class="input-nama" maxlength="50" autocomplete="name" placeholder="Masukkan nama pemesan" value="${esc(namaPembeli)}">
                <p id="checkoutErrorMsg" class="inline-error" role="alert"></p>
            </div>

            <div class="card-pembayaran">
                <h2 class="pay-card-title">Rincian Pesanan</h2>
                <ul class="order-summary-list">
                    ${cartData.map(item => `
                        <li class="order-item-row">
                            <div>
                                <b>${item.qty}x</b> ${esc(item.nama)}
                                <div class="order-item-variant">${esc(item.varian || "")}</div>
                                ${item.catatan ? `<div class="order-item-note">Catatan: "${esc(item.catatan)}"</div>` : ""}
                            </div>
                            <b>${formatRupiah(item.harga)}</b>
                        </li>
                    `).join('')}
                </ul>
            </div>

            <div class="card-pembayaran">
                <h2 class="pay-card-title">Metode Pembayaran</h2>
                <div class="payment-options">
                    <label class="pay-option-label ${selectedPayment === 'cash' ? 'selected' : ''}">
                        <span class="pay-option-text">
                            <b>Bayar Tunai</b>
                            <small>Bayar langsung di kasir saat ambil pesanan</small>
                        </span>
                        <input type="radio" name="paymentMethod" value="cash" ${selectedPayment === 'cash' ? 'checked' : ''} onchange="pilihMetode('cash')">
                    </label>
                    <label class="pay-option-label ${selectedPayment === 'qris' ? 'selected' : ''}">
                        <span class="pay-option-text">
                            <b>QRIS (E-Wallet / M-Banking)</b>
                            <small>Scan kode QRIS outlet setelah konfirmasi</small>
                        </span>
                        <input type="radio" name="paymentMethod" value="qris" ${selectedPayment === 'qris' ? 'checked' : ''} onchange="pilihMetode('qris')">
                    </label>
                </div>
            </div>
        `;

        footerArea.innerHTML = `
            <div class="footer-total">
                <span>Total Tagihan</span>
                <b>${formatRupiah(subtotal)}</b>
            </div>
            <button type="button" class="btn btn--primary" id="btnSubmitOrder" onclick="handleLanjutPembayaran()">
                ${selectedPayment === 'qris' ? 'Lanjut ke Pembayaran QRIS' : 'Konfirmasi & Kirim Pesanan'}
            </button>
        `;
    } else if (currentStep === "qris") {
        pageTitle.textContent = "Pembayaran QRIS";
        backBtn.href = "#checkout";
        backBtn.onclick = (e) => {
            e.preventDefault();
            currentStep = "checkout";
            renderStep();
        };

        const qrisImg = safeImgSrc(localStorage.getItem(QRIS_STORAGE_KEY));
        const qrisVisualHtml = qrisImg
            ? `<div class="qris-frame"><img src="${esc(qrisImg)}" alt="QRIS Outlet Sabangdor" width="220" height="220" class="qris-img-display"></div>`
            : `<div class="qris-empty-box" role="status">Gambar QRIS outlet belum diunggah oleh kasir. Silakan scan QRIS fisik di meja kasir saat mengambil pesanan, atau kembali untuk memilih Bayar Tunai.</div>`;

        mainContent.innerHTML = `
            <div class="card-pembayaran qris-card">
                <h2 class="qris-title">Scan QRIS Sabangdor</h2>
                <p class="qris-desc">Buka aplikasi e-wallet atau mobile banking Anda lalu bayar sesuai total tagihan.</p>
                ${qrisVisualHtml}
                <div class="qris-amount-box">
                    <span>Total yang harus dibayar</span>
                    <strong>${formatRupiah(subtotal)}</strong>
                </div>
                <p id="checkoutErrorMsg" class="inline-error" role="alert"></p>
            </div>
        `;

        footerArea.innerHTML = `
            <button type="button" id="btnKonfirmasiQris" class="btn btn--success" onclick="eksekusiSimpanPesanan()">
                Saya Sudah Bayar
            </button>
        `;
    } else if (currentStep === "sukses") {
        pageTitle.textContent = "Pesanan Dikirim";
        backBtn.onclick = null;
        backBtn.href = "index.html";

        const nomorAntreanFormatted = `ANT-${String(createdOrderData?.nomor_antrean || 1).padStart(2, '0')}`;

        mainContent.innerHTML = `
            <div class="success-wrap">
                <div class="success-icon" aria-hidden="true">✓</div>
                <h2 class="success-title">Pesanan Berhasil Dibuat</h2>
                <p class="success-desc">Pesanan atas nama <b>${esc(createdOrderData?.nama_pembeli)}</b> telah diteruskan ke dapur SABANGDOR.</p>

                <div class="card-pembayaran success-receipt">
                    <div class="receipt-row">
                        <span>Nomor Antrean</span>
                        <strong class="receipt-queue">#${nomorAntreanFormatted}</strong>
                    </div>
                    <div class="receipt-row">
                        <span>Metode Bayar</span>
                        <strong>${esc((createdOrderData?.tipe_pembayaran || '').toUpperCase())}</strong>
                    </div>
                    <div class="receipt-row">
                        <span>Total Tagihan</span>
                        <strong>${formatRupiah(createdOrderData?.total_harga || subtotal)}</strong>
                    </div>
                    <div class="receipt-row">
                        <span>Status Bayar</span>
                        <span class="badge badge--amber">Menunggu Verifikasi Kasir</span>
                    </div>
                </div>
            </div>
        `;

        footerArea.innerHTML = `
            <a href="index.html" class="btn btn--primary">
                Pesan Menu Lain
            </a>
        `;
    }
}

function tampilkanErrorCheckout(pesan) {
    const errEl = document.getElementById("checkoutErrorMsg");
    if (errEl) {
        errEl.textContent = pesan;
        errEl.classList.add("show");
    } else {
        alert(pesan);
    }
}

window.pilihMetode = function(tipe) {
    // Simpan input nama sebelum render ulang agar ketikan pembeli tidak hilang
    const namaInp = document.getElementById("inputNamaPembeli");
    if (namaInp) namaPembeli = namaInp.value;
    selectedPayment = tipe;
    renderStep();
};

function handleLanjutPembayaran() {
    const namaInp = document.getElementById("inputNamaPembeli");
    namaPembeli = (namaInp ? namaInp.value : "").trim();

    if (!namaPembeli) {
        tampilkanErrorCheckout("Silakan masukkan nama pemesan terlebih dahulu.");
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
            const qty = Math.min(99, Math.max(1, Math.round(Number(item.qty) || 0)));
            const subtotal = Math.round(Number(item.harga) || 0);
            if (qty <= 0 || subtotal <= 0) {
                throw new Error("Data keranjang tidak valid (harga/jumlah harus lebih dari 0).");
            }
            return {
                nama_item: String(item.nama || "Menu").trim().slice(0, 100),
                varian: String(item.varian || "").trim().slice(0, 200),
                catatan: String(item.catatan || "").trim().slice(0, 200),
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
        tampilkanErrorCheckout("Gagal memproses pesanan: " + pesan);
        if (btnSubmit) {
            btnSubmit.disabled = false;
            btnSubmit.innerText = "Coba Lagi";
        }
    }
}