/**
 * File: script-menu-utama.js
 * Halaman menu utama pembeli Sabangdor:
 * - PB-047 & PB-048: Katalog dinamis terpadu (menu bawaan + custom) & urutan kategori otomatis menyembunyikan kategori kosong.
 * - PB-049: Indikator stok harian tersisa & status habis otomatis.
 * - PB-053: Registrasi Service Worker PWA & tombol pasang aplikasi.
 * - PB-054: Rekomendasi Apriori dari server dengan fallback lokal.
 * - PB-064: Banner toko tutup otomatis (manual / jadwal operasional / hari libur).
 * - PB-072: Dukungan dua bahasa ID/EN.
 */

window.DEFAULT_MENU_IMG = window.DEFAULT_MENU_IMG || 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80';
window.CUSTOM_MENU_KEY = window.CUSTOM_MENU_KEY || 'sabangdor_custom_menus';

var DEFAULT_IMG_FALLBACK = window.DEFAULT_MENU_IMG;
var CUSTOM_STORAGE_KEY = window.CUSTOM_MENU_KEY;

var menuRekomendasiAI = [];
var deferredPwaPrompt = null;

function tr(key, fallback) {
    return window.SabangdorI18n ? window.SabangdorI18n.t(key, fallback) : (fallback || key);
}

function escHtml(str) {
    if (typeof str !== 'string') return str || '';
    return str.replace(/[&<>"']/g, function (m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
}

function safeUrl(url, fallback) {
    var fb = fallback || 'index.html';
    if (!url || typeof url !== 'string') return fb;
    var trimmed = url.trim();
    if (/^(index|dimsum-[a-z-]+|detail-menu-[a-z-]+|keranjang|checkout|status-pesanan|riwayat-pembeli)\.html([?#].*)?$/i.test(trimmed)) {
        return trimmed;
    }
    if (/^#[a-z0-9_-]+$/i.test(trimmed)) return trimmed;
    return fb;
}

function safeImgSrc(src, fallback) {
    var fb = fallback || DEFAULT_IMG_FALLBACK;
    if (!src || typeof src !== 'string') return fb;
    var trimmed = src.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) return trimmed;
    return fb;
}

function slugKategori(str) {
    return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'lainnya';
}

function rupiah(num) {
    return 'Rp' + Number(num || 0).toLocaleString('id-ID');
}

function hargaMulai(menu) {
    if (!menu.ukuran || !menu.ukuran.length) return menu.harga || 0;
    var valid = menu.ukuran.map(function (u) { return Number(u.harga) || 0; }).filter(function (h) { return h > 0; });
    return valid.length ? Math.min.apply(null, valid) : 0;
}

window.pilihKategori = function (event, targetId) {
    if (event) event.preventDefault();

    var clickedButton = event ? event.currentTarget : null;
    if (clickedButton) {
        document.querySelectorAll('.tab-item').forEach(function (btn) { btn.classList.remove('active'); });
        clickedButton.classList.add('active');
    } else {
        document.querySelectorAll('.tab-item').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.target === targetId);
        });
    }

    document.querySelectorAll('.menu-section').forEach(function (sec) { sec.classList.remove('active'); });
    var targetSection = document.getElementById(targetId);
    if (targetSection) targetSection.classList.add('active');
};

// PB-053: Registrasi Service Worker PWA & tombol Install
function initPwa() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(function () {});
    }

    var installBtn = document.getElementById('btnInstallPwa');
    window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        deferredPwaPrompt = e;
        if (installBtn) installBtn.style.display = 'inline-flex';
    });

    if (installBtn) {
        installBtn.addEventListener('click', async function () {
            if (!deferredPwaPrompt) return;
            deferredPwaPrompt.prompt();
            try { await deferredPwaPrompt.userChoice; } catch (e) {}
            deferredPwaPrompt = null;
            installBtn.style.display = 'none';
        });
    }
}

function initLastOrderShortcut() {
    var link = document.getElementById('btnTrackLastOrder');
    if (!link) return;
    try {
        var lastRaw = localStorage.getItem('sabangdor_last_order_token') || sessionStorage.getItem('sabangdor_last_order');
        if (!lastRaw) return;
        var token = lastRaw;
        var nomor = '';
        if (lastRaw.startsWith('{')) {
            var obj = JSON.parse(lastRaw);
            token = obj && obj.tracking_token;
            nomor = obj && obj.nomor_antrean ? ' #ANT-' + String(obj.nomor_antrean).padStart(2, '0') : '';
        }
        if (token) {
            link.href = 'status-pesanan.html?token=' + encodeURIComponent(token);
            link.textContent = tr('link_track_order', 'Lacak Pesanan') + nomor;
            link.style.display = 'inline-flex';
        }
    } catch (e) {}
}

window.addEventListener('DOMContentLoaded', function () {
    initPwa();
    if (window.SabangdorI18n) window.SabangdorI18n.renderSwitcher('#langHost');
    initLastOrderShortcut();

    renderKatalogDinamis();
    sinkronkanRekomendasiAI();
    updateTampilanStokPembeli();
    renderPopupKeranjang();
    initStaffTrigger();
    initRuangPopupKeranjang();

    if (window.location.hash) {
        var targetHash = window.location.hash.slice(1);
        if (document.getElementById(targetHash)) {
            window.pilihKategori(null, targetHash);
        }
    }

    cekDanTerapkanStatusToko();
    setInterval(cekDanTerapkanStatusToko, 2500);

    sinkronkanPengaturan();
    segarkanKatalog(true);
    setInterval(function () {
        if (document.hidden) return;
        sinkronkanPengaturan();
        segarkanKatalog(false);
    }, 6000);

    window.addEventListener('sabangdor:langchange', function () {
        renderKatalogDinamis();
        renderRekomendasiAI();
        renderPopupKeranjang();
        cekDanTerapkanStatusToko();
        initLastOrderShortcut();
    });
});

async function sinkronkanPengaturan() {
    if (!window.SabangdorSettings) return;
    var ok = await window.SabangdorSettings.muat();
    if (ok) {
        cekDanTerapkanStatusToko();
        updateTampilanStokPembeli();
    }
}

async function segarkanKatalog(paksa) {
    if (document.hidden && !paksa) return;
    var sebelumMenu = localStorage.getItem(CUSTOM_STORAGE_KEY);
    var sebelumKat = localStorage.getItem(window.CATEGORIES_KEY || 'sabangdor_menu_categories');

    if (typeof window.getCategoriesFromSupabase === 'function') {
        await window.getCategoriesFromSupabase();
    }
    if (typeof window.getCustomMenusFromSupabase === 'function') {
        await window.getCustomMenusFromSupabase();
    }

    var sesudahMenu = localStorage.getItem(CUSTOM_STORAGE_KEY);
    var sesudahKat = localStorage.getItem(window.CATEGORIES_KEY || 'sabangdor_menu_categories');

    if (paksa || sebelumMenu !== sesudahMenu || sebelumKat !== sesudahKat) {
        renderKatalogDinamis();
        updateTampilanStokPembeli();
    }
}

function sesuaikanRuangPopup() {
    var popup = document.getElementById('cart-popup');
    var wrap = document.querySelector('.mobile-container');
    if (!popup || !wrap) return;
    var tinggi = popup.classList.contains('hidden') ? 0 : popup.offsetHeight;
    wrap.style.paddingBottom = tinggi ? (tinggi + 24) + 'px' : '';
}

function initRuangPopupKeranjang() {
    var popup = document.getElementById('cart-popup');
    if (!popup) return;
    if (window.ResizeObserver) new ResizeObserver(sesuaikanRuangPopup).observe(popup);
    new MutationObserver(sesuaikanRuangPopup).observe(popup, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', sesuaikanRuangPopup);
    sesuaikanRuangPopup();
}

// ==========================================
// KATALOG DINAMIS + URUTAN KATEGORI (PB-047 & PB-048)
// ==========================================
function teksVarianMenu(menu) {
    if (menu.tipe_menu === 'bakpao' || String(menu.nama || '').toLowerCase() === 'bakpao') {
        var vCount = Array.isArray(menu.varian_bakpao) && menu.varian_bakpao.length ? menu.varian_bakpao.length : 5;
        return vCount + ' Varian • 1 / 3 / 6 pcs';
    }
    var ukuran = menu.ukuran || [];
    var nama = ukuran.map(function (u) { return u.nama; }).join(' / ');
    var porsi = ukuran.map(function (u) { return String(u.porsi || u.ket || '').trim(); }).filter(Boolean);
    if (!porsi.length) return nama;
    var semuaAngka = porsi.every(function (p) { return /^\d+$/.test(p); });
    return nama + ' • ' + porsi.join(' / ') + (semuaAngka ? ' pcs' : '');
}

function kartuMenuHtml(menu, isFirst) {
    var img = safeImgSrc(menu.img || menu.img_url, DEFAULT_IMG_FALLBACK);
    var detailHref = 'detail-menu-custom.html?id=' + encodeURIComponent(menu.id);
    var stokBadge = '';
    if (menu.stok_harian !== null && menu.stok_harian !== undefined) {
        var stokNum = Number(menu.stok_harian);
        var ambang = Number(menu.ambang_stok != null ? menu.ambang_stok : 5);
        if (stokNum > 0 && stokNum <= ambang) {
            stokBadge = '<span class="stock-low-pill">Sisa ' + stokNum + '</span>';
        }
    }
    return `
        <div class="card-menu" data-dyn-menu="1" data-menu-id="${escHtml(menu.id)}" data-menu-name="${escHtml(menu.nama)}">
            <img src="${escHtml(img)}" alt="${escHtml(menu.nama)}" width="76" height="76"${isFirst ? ' fetchpriority="high"' : ''} class="card-img">
            <div class="card-content">
                <h3 class="card-title">${escHtml(menu.nama)} ${stokBadge}</h3>
                <p class="variant">${escHtml(teksVarianMenu(menu))}</p>
                <p class="price">${escHtml(tr('price_from', 'Mulai'))} ${rupiah(hargaMulai(menu))}</p>
            </div>
            <a href="${escHtml(detailHref)}" class="btn-pilih">${escHtml(tr('btn_choose_menu', '+ Pilih menu'))}</a>
        </div>
    `;
}

function renderKatalogDinamis() {
    if (typeof window.getAllCatalogMenus !== 'function') return;
    var navBar = document.getElementById('navTabBar') || document.querySelector('.nav-tab-bar');
    var mainEl = document.getElementById('catalogMain') || document.querySelector('main');
    if (!navBar || !mainEl) return;

    var activeSection = document.querySelector('.menu-section.active');
    var activeId = activeSection ? activeSection.id : 'section-rekomendasi';

    // Hapus tab & section kategori lama (kecuali Paling Rekomendasi)
    navBar.querySelectorAll('[data-static-cat], [data-dyn-cat]').forEach(function (el) { el.remove(); });
    mainEl.querySelectorAll('[data-static-cat], [data-dyn-cat]').forEach(function (el) { el.remove(); });

    var allMenus = window.getAllCatalogMenus();
    var categories = typeof window.getCategories === 'function' ? window.getCategories().slice() : [];

    // Kelompokkan menu per kategori
    var perKategori = new Map();
    allMenus.forEach(function (m) {
        var catName = String(m.kategori || 'Lainnya').trim();
        var key = catName.toLowerCase();
        if (!perKategori.has(key)) perKategori.set(key, { nama: catName, items: [] });
        perKategori.get(key).items.push(m);
    });

    // Susun urutan kategori sesuai PB-048 (menu_categories.urutan) + kategori baru dari menu custom
    var orderedCats = [];
    var seenKeys = new Set();

    categories
        .sort(function (a, b) { return (Number(a.urutan) || 100) - (Number(b.urutan) || 100); })
        .forEach(function (cat) {
            var key = String(cat.nama || '').trim().toLowerCase();
            var group = perKategori.get(key);
            // PB-048: Kategori kosong disembunyikan otomatis
            if (group && group.items.length > 0) {
                orderedCats.push({
                    nama: cat.nama,
                    deskripsi: cat.deskripsi || '',
                    items: group.items
                });
                seenKeys.add(key);
            }
        });

    perKategori.forEach(function (group, key) {
        if (!seenKeys.has(key) && group.items.length > 0) {
            orderedCats.push({
                nama: group.nama,
                deskripsi: 'Menu pilihan outlet',
                items: group.items
            });
        }
    });

    // Mapping id section bawaan agar hash URL lama (#section-mentai dll.) tetap jalan
    var legacyIds = {
        'dimsum mentai': 'section-mentai',
        'dimsum aja': 'section-dimsum-aja',
        'bakpao': 'section-bakpao'
    };

    orderedCats.forEach(function (cat, catIdx) {
        var secId = legacyIds[cat.nama.toLowerCase()] || ('section-cat-' + slugKategori(cat.nama));

        var tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'tab-item' + (secId === activeId ? ' active' : '');
        tab.dataset.dynCat = '1';
        tab.dataset.target = secId;
        tab.setAttribute('onclick', `pilihKategori(event, '${secId}')`);
        tab.innerHTML = `<span class="tab-label">${escHtml(cat.nama)}</span>`;
        navBar.appendChild(tab);

        var sec = document.createElement('section');
        sec.id = secId;
        sec.className = 'menu-section' + (secId === activeId ? ' active' : '');
        sec.dataset.dynCat = '1';
        sec.innerHTML = `
            <h2 class="section-title">${escHtml(cat.nama)}</h2>
            <p class="section-desc">${escHtml(cat.deskripsi || '')}</p>
            <div class="menu-container">
                ${cat.items.map(function (m, idx) { return kartuMenuHtml(m, catIdx === 0 && idx === 0); }).join('')}
            </div>
        `;
        mainEl.appendChild(sec);
    });

    if (activeId && !document.getElementById(activeId)) {
        window.pilihKategori(null, 'section-rekomendasi');
    }
}

// ==========================================
// REKOMENDASI AI (PB-054: SERVER-FIRST + FALLBACK)
// ==========================================
function renderRekomendasiAI() {
    var container = document.getElementById('rekomendasi-container');
    if (!container) return;

    if (!menuRekomendasiAI || menuRekomendasiAI.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <strong>${escHtml(tr('empty_rec_title', 'Belum ada data rekomendasi menu'))}</strong>
                <p>${escHtml(tr('empty_rec_desc', 'Pilih kategori di atas untuk melihat seluruh menu.'))}</p>
            </div>
        `;
        return;
    }

    container.innerHTML = menuRekomendasiAI.map(function (item) {
        var imgSrc = safeImgSrc(item.imgSrc, DEFAULT_IMG_FALLBACK);
        var hargaTxt = tr('price_from', 'Mulai') + ' ' + rupiah(item.harga || 0);
        var varianTxt = item.variantInfo || item.varian || 'S / M / XL';
        var linkUrl = safeUrl(item.linkDetail, 'index.html');

        return `
            <div class="card-menu" data-menu-name="${escHtml(item.nama)}">
                <img src="${escHtml(imgSrc)}" alt="${escHtml(item.nama)}" width="76" height="76" class="card-img">
                <div class="card-content">
                    <h3 class="card-title">${escHtml(item.nama)}</h3>
                    <p class="variant">${escHtml(varianTxt)}</p>
                    <p class="price">${escHtml(hargaTxt)}</p>
                </div>
                <a href="${escHtml(linkUrl)}" class="btn-pilih">${escHtml(tr('btn_choose_menu', '+ Pilih menu'))}</a>
            </div>
        `;
    }).join('');

    updateTampilanStokPembeli();
}

async function sinkronkanRekomendasiAI() {
    if (typeof window === 'undefined' || !window.AprioriEngine) return;

    // PB-054 Prioritas 1: Baca hasil Apriori yang sudah dihitung dan disimpan di server
    if (window.supabaseClient && typeof window.AprioriEngine.getServerRecommendations === 'function') {
        var serverRes = await window.AprioriEngine.getServerRecommendations(window.supabaseClient);
        if (serverRes && serverRes.frequentItemsets && Object.keys(serverRes.frequentItemsets).length > 0) {
            menuRekomendasiAI = window.AprioriEngine.getPopularRecommendations(serverRes.frequentItemsets, 5);
            renderRekomendasiAI();
            return;
        }
    }

    // Prioritas 2: Hitung dari RPC anonim get_apriori_baskets()
    var baskets = [];
    if (window.supabaseClient) {
        try { baskets = await window.AprioriEngine.getSupabaseTransactions(window.supabaseClient); } catch (e) {}
    }
    if (!baskets || baskets.length === 0) {
        baskets = window.AprioriEngine.getRealTransactions();
    }

    try {
        var model = window.AprioriEngine.trainApriori(baskets);
        menuRekomendasiAI = window.AprioriEngine.getPopularRecommendations(model.frequentItemsets, 5) || [];
    } catch (err) {
        menuRekomendasiAI = [];
    }

    renderRekomendasiAI();
}

// ==========================================
// POPUP KERANJANG
// ==========================================
function readSafeCart() {
    try {
        var raw = JSON.parse(localStorage.getItem('sabangdor_cart'));
        if (!Array.isArray(raw)) return [];
        return raw.filter(function (i) {
            return i && Number.isFinite(Number(i.qty)) && Number(i.qty) >= 1 && Number(i.harga) > 0;
        });
    } catch (e) {
        return [];
    }
}

function renderPopupKeranjang() {
    var harusBukaPopup = localStorage.getItem('buka_popup_keranjang');
    var cartPopup = document.getElementById('cart-popup');
    var keranjang = readSafeCart();

    if (keranjang.length > 0 && (harusBukaPopup === 'true' || (cartPopup && !cartPopup.classList.contains('hidden')))) {
        if (cartPopup) {
            var containerItems = document.getElementById('cart-items-container');
            containerItems.innerHTML = '';

            var totalPorsiSemua = 0;
            var totalHargaSemua = 0;

            keranjang.forEach(function (item, index) {
                totalPorsiSemua += item.qty;
                totalHargaSemua += item.harga;

                var catatanHtml = item.catatan
                    ? `<div class="item-catatan">Catatan: "${escHtml(item.catatan)}"</div>`
                    : '';

                var safeImg = item.imgSrc ? safeImgSrc(item.imgSrc, '') : '';
                var imageHtml = safeImg
                    ? `<img src="${escHtml(safeImg)}" alt="${escHtml(item.nama)}" width="48" height="48" class="cart-item-img">`
                    : `<div class="cart-item-placeholder">Menu</div>`;

                var itemDiv = document.createElement('div');
                itemDiv.className = 'cart-item';
                itemDiv.innerHTML = `
                    <div class="cart-item-left">
                        ${imageHtml}
                        <div class="cart-item-detail">
                            <h4 class="cart-item-title">${escHtml(item.nama)}</h4>
                            <div class="cart-item-variant">${escHtml(item.varian)}</div>
                            ${catatanHtml}
                            <div class="cart-item-price">${escHtml(item.hargaFormatted || rupiah(item.harga))}</div>
                        </div>
                    </div>
                    <div class="cart-item-counter">
                        <button type="button" class="cnt-btn" aria-label="Kurangi ${escHtml(item.nama)}" onclick="ubahQtyPopup(${index}, -1)">-</button>
                        <span class="cnt-num">${item.qty}</span>
                        <button type="button" class="cnt-btn plus" aria-label="Tambah ${escHtml(item.nama)}" onclick="ubahQtyPopup(${index}, 1)">+</button>
                    </div>
                `;
                containerItems.appendChild(itemDiv);
            });

            document.getElementById('cart-badge').innerText = `${keranjang.length} ${tr('menu_unit', 'Menu')}`;
            document.getElementById('cart-total-price').innerText = rupiah(totalHargaSemua);
            document.getElementById('cart-subtotal-price').innerText = rupiah(totalHargaSemua);
            document.getElementById('cart-subtotal-text').innerText = `Subtotal (${totalPorsiSemua} ${tr('portion_unit', 'porsi')})`;

            setTimeout(function () {
                cartPopup.classList.remove('hidden');
                cartPopup.classList.add('show-smooth');
            }, 80);
        }
        localStorage.removeItem('buka_popup_keranjang');
    } else if (keranjang.length === 0 && cartPopup) {
        cartPopup.classList.remove('show-smooth');
        cartPopup.classList.add('hidden');
    }
}

window.ubahQtyPopup = function (index, delta) {
    var keranjang = readSafeCart();
    if (keranjang[index]) {
        var qtySekarang = Math.max(1, parseInt(keranjang[index].qty, 10) || 1);
        var hargaSatuan = Math.round((Number(keranjang[index].harga) || 0) / qtySekarang);
        var nextQty = qtySekarang + delta;
        if (nextQty > 99) return;

        if (nextQty <= 0) {
            keranjang.splice(index, 1);
        } else {
            keranjang[index].qty = nextQty;
            keranjang[index].harga = hargaSatuan * nextQty;
            keranjang[index].hargaFormatted = rupiah(keranjang[index].harga);
        }
        localStorage.setItem('sabangdor_cart', JSON.stringify(keranjang));
        if (keranjang.length === 0) window.kosongkanKeranjang();
        else renderPopupKeranjang();
    }
};

window.kosongkanKeranjang = function () {
    localStorage.removeItem('sabangdor_cart');
    var cartPopup = document.getElementById('cart-popup');
    if (cartPopup) {
        cartPopup.classList.remove('show-smooth');
        setTimeout(function () { cartPopup.classList.add('hidden'); }, 250);
    }
};

window.keHalamanKeranjang = function () {
    window.location.href = 'keranjang.html';
};

// ==========================================
// SINKRONISASI STOK HABIS & BUKA/TUTUP TOKO
// ==========================================
function updateTampilanStokPembeli() {
    var menuStatus = [];
    try {
        var parsedStatus = JSON.parse(localStorage.getItem('sabangdor_menu_status'));
        if (Array.isArray(parsedStatus)) menuStatus = parsedStatus;
    } catch (e) {}

    var tokoTutup = localStorage.getItem('sabangdor_status_toko') === 'tutup';

    document.querySelectorAll('.card-menu').forEach(function (card) {
        card.style.opacity = '1';
        card.style.filter = 'none';
        var btn = card.querySelector('.btn-pilih');
        if (!btn) return;
        if (!btn.dataset.origHref && btn.getAttribute('href')) {
            btn.dataset.origHref = btn.getAttribute('href');
        }
        if (!tokoTutup) {
            btn.innerText = tr('btn_choose_menu', '+ Pilih menu');
            btn.style.backgroundColor = '';
            btn.style.color = '';
            btn.style.borderColor = '';
            btn.style.pointerEvents = 'auto';
            btn.removeAttribute('aria-disabled');
            if (btn.dataset.origHref) btn.setAttribute('href', btn.dataset.origHref);
        }
    });

    if (tokoTutup) return;

    var habisNames = new Set(
        menuStatus
            .filter(function (i) { return i && i.status === 'habis'; })
            .map(function (i) { return String(i.nama || '').trim().toLowerCase(); })
    );

    if (typeof window.getAllCatalogMenus === 'function') {
        window.getAllCatalogMenus().forEach(function (m) {
            if (m.habis || (m.stok_harian !== null && m.stok_harian !== undefined && Number(m.stok_harian) <= 0)) {
                habisNames.add(String(m.nama || '').trim().toLowerCase());
            }
        });
    }

    document.querySelectorAll('.card-menu').forEach(function (card) {
        var namaAttr = card.dataset.menuName;
        var titleEl = card.querySelector('.card-title');
        var nama = String(namaAttr || (titleEl ? titleEl.textContent : '')).trim().toLowerCase();
        if (habisNames.has(nama)) tandaiKartuHabis(card);
    });
}

function tandaiKartuHabis(card) {
    card.style.opacity = '0.65';
    card.style.filter = 'grayscale(100%)';
    var btn = card.querySelector('.btn-pilih');
    if (btn) {
        if (!btn.dataset.origHref && btn.getAttribute('href')) {
            btn.dataset.origHref = btn.getAttribute('href');
        }
        btn.innerText = tr('btn_sold_out', 'Habis');
        btn.style.backgroundColor = '#475569';
        btn.style.borderColor = '#475569';
        btn.style.color = '#FFFFFF';
        btn.style.pointerEvents = 'none';
        btn.setAttribute('aria-disabled', 'true');
        btn.removeAttribute('href');
    }
}

function initStaffTrigger() {
    var staffTrigger = document.getElementById('staff-trigger');
    if (!staffTrigger) return;
    var clickCount = 0;
    var clickTimer = null;
    staffTrigger.addEventListener('click', function () {
        clickCount++;
        clearTimeout(clickTimer);
        if (clickCount === 3) {
            clickCount = 0;
            window.location.href = 'login-pegawai.html';
        } else {
            clickTimer = setTimeout(function () { clickCount = 0; }, 800);
        }
    });
}

var tokoSedangTutupDiHalaman = false;

function cekDanTerapkanStatusToko() {
    var statusToko = localStorage.getItem('sabangdor_status_toko');
    var reason = localStorage.getItem('sabangdor_status_toko_reason') || 'manual';
    var isTutup = statusToko === 'tutup';

    if (!isTutup && tokoSedangTutupDiHalaman) {
        window.location.reload();
        return;
    }
    tokoSedangTutupDiHalaman = isTutup;
    var bannerTutup = document.getElementById('banner-toko-tutup');

    if (isTutup) {
        document.querySelectorAll('.btn-pilih').forEach(function (btn) {
            if (!btn.dataset.origHref && btn.getAttribute('href')) {
                btn.dataset.origHref = btn.getAttribute('href');
            }
            btn.innerText = tr('btn_store_closed', 'Toko Tutup');
            btn.style.backgroundColor = '#475569';
            btn.style.borderColor = '#475569';
            btn.style.color = '#FFFFFF';
            btn.style.pointerEvents = 'none';
            btn.setAttribute('aria-disabled', 'true');
            btn.removeAttribute('href');
        });

        var cartPopup = document.getElementById('cart-popup');
        var btnCekKeranjang = document.querySelector('.btn-cek-keranjang');
        if (cartPopup) {
            cartPopup.classList.remove('show-smooth');
            cartPopup.classList.add('hidden');
        }
        if (btnCekKeranjang) {
            btnCekKeranjang.disabled = true;
            btnCekKeranjang.style.pointerEvents = 'none';
            btnCekKeranjang.innerText = tr('btn_store_closed', 'Toko Tutup');
        }

        var bannerText = reason === 'schedule' || reason === 'holiday'
            ? tr('banner_store_closed_schedule', 'Toko sedang di luar jam operasional dan belum menerima pesanan saat ini.')
            : tr('banner_store_closed', 'Toko sedang tutup dan belum menerima pesanan saat ini.');

        if (!bannerTutup) {
            var container = document.querySelector('.mobile-container');
            if (container) {
                bannerTutup = document.createElement('div');
                bannerTutup.id = 'banner-toko-tutup';
                bannerTutup.className = 'store-status-banner';
                bannerTutup.setAttribute('role', 'status');
                var siteHeader = document.querySelector('.site-header');
                if (siteHeader && siteHeader.nextSibling) {
                    container.insertBefore(bannerTutup, siteHeader.nextSibling);
                } else {
                    container.insertBefore(bannerTutup, container.firstChild);
                }
            }
        }
        if (bannerTutup) bannerTutup.innerText = bannerText;
    } else {
        if (bannerTutup) bannerTutup.remove();
        var btnAktif = document.querySelector('.btn-cek-keranjang');
        if (btnAktif) {
            btnAktif.disabled = false;
            btnAktif.style.pointerEvents = 'auto';
            btnAktif.style.backgroundColor = '';
            btnAktif.innerText = tr('btn_check_cart', 'Cek Keranjang');
        }
        updateTampilanStokPembeli();
        renderPopupKeranjang();
    }
}

window.addEventListener('storage', function (e) {
    if (e.key === 'sabangdor_menu_status') updateTampilanStokPembeli();
    if (e.key === CUSTOM_STORAGE_KEY || e.key === (window.CATEGORIES_KEY || 'sabangdor_menu_categories')) {
        renderKatalogDinamis();
        updateTampilanStokPembeli();
    }
    if (e.key === 'sabangdor_status_toko') cekDanTerapkanStatusToko();
});
