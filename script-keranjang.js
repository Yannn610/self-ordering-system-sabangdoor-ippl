// ===== Konfigurasi =====
const BACK_URL = "index.html";
const OPEN_POPUP_ON_BACK = true;
const WHATSAPP_NUMBER = "";
const CART_KEY = "sabangdor_cart";
const POPUP_FLAG_KEY = "buka_popup_keranjang";
const MAX_QTY = 99;

// ===== State =====
let cart = loadCart();

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
                qty: Math.min(MAX_QTY, Math.max(1, Math.round(Number(i.qty)))),
                harga: Math.round(Number(i.harga))
            }));
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
    const safeImg = safeImgSrc(item.imgSrc);
    const img = safeImg
        ? `<img src="${esc(safeImg)}" alt="${esc(item.nama)}" width="56" height="56" class="item-thumb">`
        : "";
    const note = item.catatan
        ? `<p class="item-note">Catatan: "${esc(item.catatan)}"</p>`
        : "";

    return `
    <li class="item" data-index="${index}">
      <div class="item-info">
        ${img}
        <div class="item-text-wrap">
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

// Render tampilan keranjang
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
    if (recCard && isEmpty) {
        recCard.hidden = true;
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
$("checkoutBtn").addEventListener("click", async () => {
    if (cart.length === 0) {
        showToast("Keranjang masih kosong.");
        return;
    }

    if (window.SabangdorSettings) {
        try { await window.SabangdorSettings.muat(); } catch (e) {}
    }
    if (localStorage.getItem("sabangdor_status_toko") === "tutup") {
        showToast("Mohon maaf, toko sedang tutup.");
        return;
    }

    try {
        const menuStatus = JSON.parse(localStorage.getItem("sabangdor_menu_status")) || [];
        const habisSet = new Set(menuStatus.filter(m => m && m.status === "habis").map(m => String(m.nama || "").trim().toLowerCase()));
        const itemHabis = cart.find(i => habisSet.has(String(i.nama || "").trim().toLowerCase()));
        if (itemHabis) {
            showToast(`"${itemHabis.nama}" sedang habis. Hapus item untuk melanjutkan.`);
            return;
        }
    } catch (e) {}

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
(async function cekTokoTutup() {
    if (window.SabangdorSettings) await window.SabangdorSettings.muat();
    if (localStorage.getItem('sabangdor_status_toko') === 'tutup') {
        alert("Mohon maaf, toko saat ini sedang TUTUP. Anda akan diarahkan kembali ke halaman utama.");
        window.location.href = 'index.html';
    }
})();

// ===== AI Cross-Selling Apriori =====
// ===== AI Cross-Selling Apriori (Real Data Only) =====
async function renderAiCrossSelling() {
    const listEl = $("aiRecList");
    const recCard = $("aiRecCard");
    if (!listEl) return;

    const cartNames = cart.map(i => i.nama || "");
    let recommendations = [];

    // Analisis Apriori di browser dari riwayat transaksi nyata (Supabase / lokal).
    // Model dihitung sekali lalu di-cache agar tidak query ulang setiap jumlah berubah.
    if (window.AprioriEngine) {
        try {
            if (!window._aprioriRulesCache) {
                let baskets = [];
                if (window.supabaseClient) {
                    baskets = await window.AprioriEngine.getSupabaseTransactions(window.supabaseClient);
                }
                if (!baskets || baskets.length === 0) {
                    baskets = window.AprioriEngine.getRealTransactions();
                }
                window._aprioriRulesCache = window.AprioriEngine.trainApriori(baskets).rules;
            }
            recommendations = window.AprioriEngine.recommend(window._aprioriRulesCache, cartNames, 2);
        } catch (err) {
            console.warn('Gagal menghitung cross-selling:', err);
        }
    }

    // Saring menu yang sedang habis agar tidak ditawarkan ke pembeli
    let habisSet = new Set();
    try {
        const menuStatus = JSON.parse(localStorage.getItem("sabangdor_menu_status")) || [];
        habisSet = new Set(menuStatus.filter(m => m && m.status === "habis").map(m => String(m.nama || "").trim().toLowerCase()));
    } catch (e) {}
    recommendations = recommendations.filter(r => r && !habisSet.has(String(r.nama || "").trim().toLowerCase()));

    if (recommendations.length === 0) {
        if (recCard) recCard.hidden = true;
        return;
    }

    if (recCard) recCard.hidden = false;

    const topRecs = recommendations.slice(0, 2);
    listEl.innerHTML = topRecs.map((item, idx) => {
        const recImg = safeImgSrc(item.imgSrc);
        return `
        <div class="ai-rec-row">
            <div class="ai-rec-left">
                ${recImg ? `<img src="${esc(recImg)}" alt="${esc(item.nama)}" width="48" height="48" class="ai-rec-img">` : ''}
                <div class="item-text-wrap">
                    <p class="ai-rec-name">${esc(item.nama)}</p>
                    <p class="ai-rec-price">${formatRupiah(item.harga || 3000)}</p>
                </div>
            </div>
            <button type="button" class="btn-outline ai-rec-btn" onclick="tambahItemRekomendasi(${idx})">
                + Tambah
            </button>
        </div>
    `;
    }).join("");

    window._currentAiRecs = topRecs;
}

function tambahItemRekomendasi(index) {
    const item = (window._currentAiRecs || [])[index];
    if (!item) return;

    const varianValid = item.defaultVarian || item.variantInfo || "S (3 pcs)";
    const existingIdx = cart.findIndex(c =>
        (c.nama || "").toLowerCase() === item.nama.toLowerCase()
        && (c.varian || "").toLowerCase() === varianValid.toLowerCase()
        && !(c.catatan || "")
    );
    if (existingIdx >= 0) {
        if (cart[existingIdx].qty >= MAX_QTY) {
            showToast(`Maksimal ${MAX_QTY} porsi per item.`);
            return;
        }
        const unitPrice = Math.round(cart[existingIdx].harga / cart[existingIdx].qty);
        cart[existingIdx].qty += 1;
        cart[existingIdx].harga = Math.round(unitPrice * cart[existingIdx].qty);
        cart[existingIdx].hargaFormatted = formatRupiah(cart[existingIdx].harga);
    } else {
        const hargaBaru = Number(item.harga) || 3000;
        cart.push({
            nama: item.nama,
            varian: varianValid,
            harga: hargaBaru,
            hargaFormatted: formatRupiah(hargaBaru),
            qty: 1,
            imgSrc: safeImgSrc(item.imgSrc)
        });
    }

    render();
    showToast(`"${item.nama}" ditambahkan ke keranjang!`);
}

// ===== Inisialisasi Awal =====
render();