// ===== Konfigurasi =====
const BACK_URL = "index.html";
const OPEN_POPUP_ON_BACK = true;
const WHATSAPP_NUMBER = "";
const CART_KEY = "sabangdor_cart";
const POPUP_FLAG_KEY = "buka_popup_keranjang";
const MAX_QTY = 99;

// ===== State =====
let cart = loadCart();

function loadCart() {
    try {
        const data = JSON.parse(localStorage.getItem(CART_KEY));
        if (!Array.isArray(data)) return [];
        return data
            .filter((i) => i && Number(i.qty) > 0)
            .map((i) => ({ ...i, qty: Number(i.qty), harga: Number(i.harga) || 0 }));
    } catch (e) {
        return [];
    }
}

function saveCart() {
    try {
        if (cart.length > 0) {
            localStorage.setItem(CART_KEY, JSON.stringify(cart));
        } else {
            localStorage.removeItem(CART_KEY);
        }
    } catch (e) {
        // Abaikan jika storage tidak tersedia
    }
}

// ===== Elemen DOM =====
const $ = (id) => document.getElementById(id);
const cartList = $("cartList");
const toastEl = $("toast");

// ===== Helper =====
const formatRupiah = (n) => "Rp" + Math.round(n).toLocaleString("id-ID");
const totalQty = () => cart.reduce((sum, i) => sum + i.qty, 0);
const totalPrice = () => cart.reduce((sum, i) => sum + i.harga, 0);

const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    }[c]));

const ICON_MINUS = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2 6h8"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2 6h8M6 2v8"/></svg>';

function itemTemplate(item, index) {
    const img = item.imgSrc
        ? `<img src="${esc(item.imgSrc)}" alt="${esc(item.nama)}" style="width:56px;height:56px;flex:none;object-fit:cover;border-radius:12px;">`
        : "";
    const note = item.catatan
        ? `<p class="item-desc" style="color:#d72c2c;">Catatan: "${esc(item.catatan)}"</p>`
        : "";

    return `
    <li class="item" data-index="${index}">
      <div class="item-info" style="display:flex;align-items:center;gap:12px;">
        ${img}
        <div style="min-width:0;">
          <p class="item-name">${esc(item.nama)}</p>
          <p class="item-desc">${esc(item.varian)}</p>
          ${note}
          <p class="item-price">${formatRupiah(item.harga)}</p>
        </div>
      </div>
      <div class="stepper">
        <button class="step-btn" type="button" data-action="dec" aria-label="Kurangi ${esc(item.nama)}">${ICON_MINUS}</button>
        <span class="qty" aria-live="polite">${item.qty}</span>
        <button class="step-btn" type="button" data-action="inc" aria-label="Tambah ${esc(item.nama)}">${ICON_PLUS}</button>
      </div>
    </li>`;
}

// ===== Render =====
function render() {
    const isEmpty = cart.length === 0;
    const total = formatRupiah(totalPrice());

    cartList.innerHTML = cart.map(itemTemplate).join("");

    $("cartEmpty").hidden = !isEmpty;
    $("summary").hidden = isEmpty;
    $("clearBtn").hidden = isEmpty;

    $("cartCount").textContent = totalQty() + " porsi";
    $("cartSubtotal").textContent = total;
    $("cartTotal").textContent = total;
    $("checkoutBtn").disabled = isEmpty;

    const recCard = $("aiRecCard");
    if (recCard) {
        recCard.style.display = isEmpty ? "none" : "block";
    }

    if (!isEmpty) {
        renderAiCrossSelling();
    }

    saveCart();
}

// ===== Ubah Jumlah =====
function changeQty(index, delta) {
    const item = cart[index];
    if (!item) return;

    const next = item.qty + delta;
    if (next > MAX_QTY) return;

    if (next <= 0) {
        cart.splice(index, 1);
    } else {
        const unitPrice = item.harga / item.qty;
        item.qty = next;
        item.harga = Math.round(unitPrice * next);
        item.hargaFormatted = formatRupiah(item.harga);
    }
    render();
}

cartList.addEventListener("click", (e) => {
    const btn = e.target.closest(".step-btn");
    if (!btn) return;
    const index = Number(btn.closest(".item").dataset.index);
    changeQty(index, btn.dataset.action === "inc" ? 1 : -1);
});

// ===== Navigasi =====
function goBack() {
    try {
        if (OPEN_POPUP_ON_BACK && cart.length > 0) {
            localStorage.setItem(POPUP_FLAG_KEY, "true");
        }
    } catch (e) {}
    window.location.href = BACK_URL;
}

$("backBtn").addEventListener("click", goBack);
$("emptyBackBtn").addEventListener("click", goBack);

// ===== Kosongkan Keranjang =====
$("clearBtn").addEventListener("click", () => {
    cart = [];
    render();
    showToast("Keranjang dikosongkan");
});

// ===== Checkout =====
$("checkoutBtn").addEventListener("click", () => {
    if (cart.length === 0) {
        showToast("Keranjang masih kosong.");
        return;
    }

    saveCart();
    try {
        sessionStorage.setItem("sabangdor_checkout_from_cart", "true");
    } catch (e) {}

    window.location.href = "checkout.html";
});

// ===== Toast Notification =====
let toastTimer;
function showToast(text) {
    toastEl.textContent = text;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
}

// Tambahkan di awal skrip halaman keranjang.html
if (localStorage.getItem('sabangdor_status_toko') === 'tutup') {
    alert("Mohon maaf, toko saat ini sedang TUTUP. Anda akan diarahkan kembali ke halaman utama.");
    window.location.href = 'index.html';
}

// ===== AI Cross-Selling Apriori =====
const CATALOG_REKOMENDASI = (typeof window !== 'undefined' && window.MENU_REKOMENDASI_DEFAULT) ? window.MENU_REKOMENDASI_DEFAULT : [
    { nama: "Bakpao", varian: "5 Varian | 1 pcs", harga: 7000, imgSrc: "https://images.unsplash.com/photo-1563245372-f21724e3856d?auto=format&fit=crop&w=600&q=80" },
    { nama: "Extra Mentai", varian: "Add-on Saus Mentai Gurih", harga: 3000, imgSrc: "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80" },
    { nama: "Dimsum Aja", varian: "S | 3 pcs", harga: 10000, imgSrc: "https://images.unsplash.com/photo-1496116218417-1a781b1c416c?auto=format&fit=crop&w=600&q=80" }
];

async function renderAiCrossSelling() {
    const listEl = $("aiRecList");
    if (!listEl) return;

    const cartNames = cart.map(i => (i.nama || "").toLowerCase());
    let recommendations = [];

    // 1. Coba ambil dari Python API Server (jika aktif)
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1000);
        const queryCart = cart.map(i => i.nama).join(",");
        const res = await fetch(`http://127.0.0.1:5000/api/recommend?cart=${encodeURIComponent(queryCart)}`, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
                recommendations = data;
            }
        }
    } catch (e) {
        // Fallback offline jika server python belum dijalankan
    }

    // 2. Jika server belum aktif, gunakan aturan asosiasi bawaan
    if (recommendations.length === 0) {
        recommendations = CATALOG_REKOMENDASI.filter(item => {
            return !cartNames.some(cn => cn.includes(item.nama.toLowerCase()));
        });
    }

    if (recommendations.length === 0) {
        const recCard = $("aiRecCard");
        if (recCard) recCard.style.display = "none";
        return;
    }

    // Render rekomendasi pelengkap terbaik
    listEl.innerHTML = recommendations.slice(0, 2).map((item, idx) => `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 12px; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px;">
            <div style="display:flex; align-items:center; gap:10px;">
                <img src="${esc(item.imgSrc)}" alt="${esc(item.nama)}" style="width:44px; height:44px; object-fit:cover; border-radius:8px;">
                <div>
                    <p style="font-size:13px; font-weight:700; color:#1E293B; margin:0;">${esc(item.nama)}</p>
                    <p style="font-size:11px; color:#E11D48; font-weight:600; margin:2px 0 0 0;">${formatRupiah(item.harga || 7000)}</p>
                </div>
            </div>
            <button type="button" class="btn-outline" style="padding:6px 12px; font-size:12px; border-radius:8px; cursor:pointer;" onclick="tambahItemRekomendasi(${idx})">
                + Tambah
            </button>
        </div>
    `).join("");

    window._currentAiRecs = recommendations.slice(0, 2);
}

function tambahItemRekomendasi(index) {
    const item = (window._currentAiRecs || [])[index];
    if (!item) return;

    const existingIdx = cart.findIndex(c => (c.nama || "").toLowerCase() === item.nama.toLowerCase());
    if (existingIdx >= 0) {
        cart[existingIdx].qty += 1;
        const unitPrice = cart[existingIdx].harga / (cart[existingIdx].qty - 1);
        cart[existingIdx].harga = Math.round(unitPrice * cart[existingIdx].qty);
    } else {
        cart.push({
            nama: item.nama,
            varian: item.variantInfo || "Porsi Pilihan",
            harga: item.harga || 7000,
            hargaFormatted: formatRupiah(item.harga || 7000),
            qty: 1,
            imgSrc: item.imgSrc || ""
        });
    }

    render();
    showToast(`"${item.nama}" ditambahkan ke keranjang!`);
}

// ===== Inisialisasi Awal =====
render();//zero