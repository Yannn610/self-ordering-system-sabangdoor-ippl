/**
 * File: js/script-pembayaran.js
 * Deskripsi: Mengelola alur checkout, konfirmasi pembayaran, dan menyimpan data transaksi secara lokal (offline mode).
 */

var CART_KEY = window.CART_KEY || "sabangdor_cart";
var ORDER_KEY = window.ORDER_KEY || "sabangdor_active_order";
var DASHBOARD_KEY = window.DASHBOARD_KEY || "sabangdor_semua_pesanan";
var QRIS_STORAGE_KEY = window.QRIS_STORAGE_KEY || "sabangdor_custom_qris";

function getOrderState() {
    let saved = null;
    try {
        saved = JSON.parse(sessionStorage.getItem(ORDER_KEY));
    } catch {}

    const cartItems = loadCartItems();

    const newState = {
        step: (saved && saved.step) ? saved.step : "checkout",
        nama: (saved && saved.nama) ? saved.nama : "",
        metode: (saved && saved.metode) ? saved.metode : "qris",
        orderId: (saved && saved.orderId) ? saved.orderId : ("SB-" + Math.floor(1000 + Math.random() * 9000)),
        items: cartItems
    };

    saveOrderState(newState);
    return newState;
}

function saveOrderState(state) {
    sessionStorage.setItem(ORDER_KEY, JSON.stringify(state));
}

function loadCartItems() {
    try {
        const raw = JSON.parse(localStorage.getItem(CART_KEY));
        if (!Array.isArray(raw)) return [];
        return raw.filter(i => i && Number(i.qty) > 0).map(i => {
            const qty = Number(i.qty) || 1;
            const rawHarga = Number(i.harga) || Number(i.hargaSatuan) || Number(i.totalHargaItem) || 0;

            const unitHarga = (i.unitHarga && Number(i.unitHarga) > 0)
                ? Number(i.unitHarga)
                : (rawHarga > 0 && rawHarga % qty === 0 ? rawHarga / qty : rawHarga);

            const totalItemPrice = (i.totalHargaItem && Number(i.totalHargaItem) > 0)
                ? Number(i.totalHargaItem)
                : (unitHarga * qty);

            return {
                id_menu: i.id_menu || null,
                tipe: i.tipe || (i.nama && i.nama.toLowerCase().includes('bakpao') ? 'bakpao' : 'dimsum'),
                produk: i.produk || i.slug || '',
                ukuran: i.ukuran || i.size || 'S',
                rincian: i.rincian || {},
                addon: i.addon || [],
                nama: i.nama || "Menu",
                varian: i.varian || i.ket || i.size || "",
                catatan: i.catatan || i.note || "",
                qty: qty,
                hargaSatuan: unitHarga,
                totalHargaItem: totalItemPrice
            };
        });
    } catch {
        return [];
    }
}

const formatRupiah = (n) => "Rp" + Math.round(n).toLocaleString("id-ID");
const calcTotal = (items) => items.reduce((sum, i) => sum + i.totalHargaItem, 0);
const calcCount = (items) => items.reduce((sum, i) => sum + i.qty, 0);

function render() {
    const state = getOrderState();
    const main = document.getElementById("mainContent");
    const footer = document.getElementById("footerArea");
    const title = document.getElementById("pageTitle");
    const outletSub = document.getElementById("outletSub");
    const meta = document.getElementById("orderInfoMeta");

    if (!main || !footer) return;

    document.body.dataset.step = state.step;
    const total = calcTotal(state.items);
    const count = calcCount(state.items);

    if (meta) {
        meta.textContent = `${state.orderId} • Ambil di outlet`;
    }

    // 1. TAHAP CHECKOUT
    if (state.step === "checkout") {
        if (title) title.textContent = "Checkout";
        if (outletSub) outletSub.textContent = "Keranjang & Pembayaran";

        main.innerHTML = `
            <section class="card">
                <h2>Nama Pelanggan</h2>
                <div class="field-head">Wajib diisi untuk pemanggilan pesanan</div>
                <div class="field">
                    <input type="text" id="inputNama" placeholder="Ketik nama lengkap kamu..." value="${state.nama}" autocomplete="off">
                </div>
            </section>

            <section class="card">
                <h2>Metode Pembayaran</h2>
                
                <label class="pay-option-label ${state.metode === 'qris' ? 'selected' : ''}" for="radioQris">
                    <div class="pay-option-text">
                        <b>QRIS (E-Wallet / Bank)</b>
                        <small>Pindai kode QRIS outlet Sabangdor</small>
                    </div>
                    <input type="radio" id="radioQris" name="metode" value="qris" ${state.metode === 'qris' ? 'checked' : ''}>
                </label>

                <label class="pay-option-label ${state.metode === 'tunai' ? 'selected' : ''}" for="radioTunai">
                    <div class="pay-option-text">
                        <b>TUNAI (Kasir Outlet)</b>
                        <small>Bayar langsung dengan uang tunai di kasir</small>
                    </div>
                    <input type="radio" id="radioTunai" name="metode" value="tunai" ${state.metode === 'tunai' ? 'checked' : ''}>
                </label>
            </section>

            <section class="card">
                <h2>Rincian Pesanan (${count} porsi)</h2>
                ${state.items.length === 0 ? '<p style="color:#E11D48; font-size:12px; font-weight:600;">Keranjang kamu masih kosong!</p>' : ''}
                ${state.items.map(i => `
                    <div class="order-item-row" style="padding:10px 0; border-bottom:1px dashed #E2E8F0;">
                        <div style="display:flex; flex-direction:column; gap:2px;">
                            <span><b>${i.nama}</b>${i.varian ? `(${i.varian})` : ''} &times; ${i.qty}</span>${i.catatan ? `<small style="color:#E11D48; font-weight:600; font-size:11px;">Catatan: "${i.catatan}"</small>` : ''}
                        </div>
                        <b>${formatRupiah(i.totalHargaItem)}</b>
                    </div>
                `).join('')}
            </section>
            <p id="errorMsg" style="color:#E11D48; font-size:11px; font-weight:700; display:none; margin-top:6px;"></p>
        `;

        footer.innerHTML = `
            <div class="footer-total"><span>Total Tagihan</span><b>${formatRupiah(total)}</b></div>
            <button class="btn btn--primary" id="btnSubmitCheckout">Lanjut ke Pembayaran</button>
        `;

        const inputNama = document.getElementById("inputNama");
        if (inputNama) {
            inputNama.addEventListener("input", (e) => {
                state.nama = e.target.value;
                saveOrderState(state);
            });
        }

        document.querySelectorAll('input[name="metode"]').forEach(radio => {
            radio.addEventListener("change", (e) => {
                state.metode = e.target.value;
                saveOrderState(state);
                render();
            });
        });

        document.getElementById("btnSubmitCheckout").addEventListener("click", () => {
            const namaVal = document.getElementById("inputNama").value.trim();
            const errEl = document.getElementById("errorMsg");

            if (state.items.length === 0) {
                errEl.style.display = "block";
                errEl.textContent = "Keranjang kamu masih kosong!";
                return;
            }
            if (!namaVal) {
                errEl.style.display = "block";
                errEl.textContent = "Mohon ketik nama kamu terlebih dahulu.";
                document.getElementById("inputNama").focus();
                return;
            }

            state.nama = namaVal;
            state.step = state.metode === "qris" ? "qris" : "tunai";
            saveOrderState(state);
            render();
        });
    }

    // 2. TAHAP PEMBAYARAN QRIS
    else if (state.step === "qris") {
        if (title) title.textContent = "Pembayaran QRIS";
        if (outletSub) outletSub.textContent = "Pindai untuk membayar";

        const customQrisImg = localStorage.getItem(QRIS_STORAGE_KEY);
        const qrisDisplayHtml = customQrisImg
            ? `<img src="${customQrisImg}" alt="QRIS Toko" class="qris-img-display">`
            : `<div style="width:160px; height:160px; margin:12px auto; background: repeating-conic-gradient(#111 0 25%, #fff 0 50%) 0 0/12px 12px; border: 4px solid #111; border-radius:12px;"></div>`;

        main.innerHTML = `
            <section class="card" style="text-align:center;">
                <span class="badge badge--amber">Menunggu Pembayaran QRIS</span>
                <h2 style="margin-top:8px;">Pindai QR Kode Di Bawah</h2>
                <p style="color:var(--primary-red); font-size:22px; font-weight:800; margin-top:4px;">${formatRupiah(total)}</p>
                
                ${qrisDisplayHtml}

                <p class="sub">Gunakan e-Wallet atau m-Banking pilihan Anda.</p>
            </section>

            <section class="card">
                <h2>Rincian Transaksi</h2>
                <div class="order-item-row"><span>Nomor Pesanan</span><b>${state.orderId}</b></div>
                <div class="order-item-row"><span>Atas Nama</span><b>${state.nama}</b></div>
                <div class="order-item-row"><span>Metode</span><b>QRIS</b></div>
            </section>
        `;

        footer.innerHTML = `
            <div class="footer-total"><span>Total</span><b>${formatRupiah(total)}</b></div>
            <button class="btn btn--primary" id="btnSelesaiQris">Saya Sudah Membayar (Kirim ke Kasir)</button>
            <button class="btn btn--secondary" id="btnBackCheckout">Kembali ke Checkout</button>
        `;

        document.getElementById("btnSelesaiQris").addEventListener("click", () => {
            const btn = document.getElementById("btnSelesaiQris");
            btn.disabled = true;
            btn.innerText = "Mengirim Pesanan...";

            kirimKeDashboardPenjual(state, total, "Diproses (Lunas QRIS)");
            state.step = "sukses";
            saveOrderState(state);
            render();
        });

        document.getElementById("btnBackCheckout").addEventListener("click", () => {
            state.step = "checkout";
            saveOrderState(state);
            render();
        });
    }

    // 3. TAHAP PEMBAYARAN TUNAI
    else if (state.step === "tunai") {
        if (title) title.textContent = "Pembayaran Tunai";
        if (outletSub) outletSub.textContent = "Bayar langsung di kasir";

        main.innerHTML = `
            <section class="card" style="text-align:center; padding:20px 16px;">
                <span class="badge badge--amber">Pembayaran Tunai</span>
                <h2 style="margin-top:8px;">Bayar di Kasir Outlet</h2>
                <p class="sub" style="font-size:12px;">Tunjukkan nomor pesanan ini ke kasir outlet SABANGDOR.</p>
            </section>

            <section class="card">
                <h2>Rincian Pesanan</h2>
                <div class="order-item-row"><span>Nomor Pesanan</span><b>${state.orderId}</b></div>
                <div class="order-item-row"><span>Atas Nama</span><b>${state.nama}</b></div>
                <div class="order-item-row"><span>Total Tagihan</span><b style="color:var(--primary-red); font-size:15px;">${formatRupiah(total)}</b></div>
            </section>
        `;

        footer.innerHTML = `
            <div class="footer-total"><span>Total</span><b>${formatRupiah(total)}</b></div>
            <button class="btn btn--primary" id="btnKonfirmasiTunai">Konfirmasi Pesanan Tunai</button>
            <button class="btn btn--secondary" id="btnBackTunai">Kembali ke Checkout</button>
        `;

        document.getElementById("btnKonfirmasiTunai").addEventListener("click", () => {
            const btn = document.getElementById("btnKonfirmasiTunai");
            btn.disabled = true;
            btn.innerText = "Mengirim Pesanan...";

            kirimKeDashboardPenjual(state, total, "Menunggu Tunai");
            state.step = "sukses";
            saveOrderState(state);
            render();
        });

        document.getElementById("btnBackTunai").addEventListener("click", () => {
            state.step = "checkout";
            saveOrderState(state);
            render();
        });
    }

    // 4. TAHAP SUKSES
    else if (state.step === "sukses") {
        if (title) title.textContent = "Pesanan Dikirim";
        if (outletSub) outletSub.textContent = "Terima Kasih!";

        main.innerHTML = `
            <section class="card" style="text-align:center; padding:24px 16px;">
                <div style="width:48px; height:48px; background:#DCFCE7; color:#15803D; border-radius:50%; display:grid; place-items:center; margin:0 auto 10px; font-weight:800; font-size:22px;">✓</div>
                <h2>Pesanan Berhasil Dibuat!</h2>
                <p class="sub" style="font-size:12px; margin-top:4px;">Pesanan atas nama <b>${state.nama}</b> telah diteruskan ke dapur SABANGDOR.</p>
            </section>

            <section class="card">
                <h2>Informasi Pesanan</h2>
                <div class="order-item-row"><span>Nomor Order</span><b style="color:var(--primary-red); font-size:16px;">${state.orderId}</b></div>
                <div class="order-item-row"><span>Metode Bayar</span><b>${state.metode.toUpperCase()}</b></div>
            </section>
        `;

        footer.innerHTML = `
            <a class="btn btn--primary" href="index.html" id="btnSelesaiPesanan">Pesan Menu Lain</a>
        `;

        document.getElementById("btnSelesaiPesanan").addEventListener("click", () => {
            sessionStorage.removeItem(ORDER_KEY);
            localStorage.removeItem(CART_KEY);
        });
    }
}

// 5. HELPER LOKAL (SABANGDOR LOCALSTORAGE BACKUP)
function kirimKeDashboardPenjual(state, totalHarga, statusAwal) {
    try {
        let semuaPesanan = JSON.parse(localStorage.getItem(DASHBOARD_KEY)) || [];
        const pesananBaru = {
            idOrder: state.orderId,
            waktu: new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }),
            tanggal: new Date().toLocaleDateString("id-ID"),
            items: state.items,
            namaPelanggan: state.nama,
            metodeBayar: state.metode.toUpperCase(),
            totalHarga: totalHarga,
            totalHargaFormatted: formatRupiah(totalHarga),
            status: statusAwal
        };
        semuaPesanan.push(pesananBaru);
        localStorage.setItem(DASHBOARD_KEY, JSON.stringify(semuaPesanan));
    } catch (e) {
        console.error("Gagal mengirim ke local dashboard:", e);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    render();
<<<<<<< HEAD
});//zero
=======
});
>>>>>>> 37f1ff35d87754fc6f9f81685c5b529525d4dfdb
