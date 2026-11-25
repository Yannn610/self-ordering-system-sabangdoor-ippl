/**
 * File: script-menu-utama.js
 * Deskripsi: Skrip halaman menu utama pembeli Sabangdor (Kategori, AI Apriori, Popup Keranjang, & Menu Custom)
 */

// 1. Inisialisasi fallback global ke window tanpa redeklarasi const/let
window.DEFAULT_MENU_IMG = window.DEFAULT_MENU_IMG || 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80';
window.CUSTOM_MENU_KEY = window.CUSTOM_MENU_KEY || 'sabangdor_custom_menus';

var DEFAULT_IMG_FALLBACK = window.DEFAULT_MENU_IMG;
var CUSTOM_STORAGE_KEY = window.CUSTOM_MENU_KEY;

// Mapping section bawaan Sabangdor
var MAP_SECTION_DEFAULT = {
    'Dimsum Mentai': 'section-mentai',
    'Dimsum aja': 'section-dimsum-aja',
    'Bakpao': 'section-bakpao'
};

var menuRekomendasiAI = [];

function escHtml(str) {
    if (typeof str !== 'string') return str || '';
    return str.replace(/[&<>"']/g, function(m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
}

function safeUrl(url, fallback) {
    var fb = fallback || 'index.html';
    if (!url || typeof url !== 'string') return fb;
    var trimmed = url.trim();
    if (/^(index|dimsum-[a-z-]+|detail-menu-[a-z-]+|keranjang|checkout)\.html([?#].*)?$/i.test(trimmed)) {
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
    return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function rupiah(num) {
    return 'Rp' + Number(num || 0).toLocaleString('id-ID');
}

function hargaMulai(menu) {
    if (!menu.ukuran || !menu.ukuran.length) return menu.harga || 0;
    return Math.min(...menu.ukuran.map(function(u) { return Number(u.harga) || 0; }));
}

function getCustomMenus() {
    try {
        return JSON.parse(localStorage.getItem(CUSTOM_STORAGE_KEY)) || [];
    } catch (e) {
        return [];
    }
}

// 2. Tab Switching (Dipasang langsung ke window)
window.pilihKategori = function(event, targetId) {
    if (event) event.preventDefault();

    var clickedButton = event ? event.currentTarget : null;

    if (clickedButton) {
        document.querySelectorAll('.tab-item').forEach(function(btn) {
            btn.classList.remove('active');
        });
        clickedButton.classList.add('active');
    }

    // Sembunyikan seluruh section menu, lalu munculkan target section
    document.querySelectorAll('.menu-section').forEach(function(sec) {
        sec.classList.remove('active');
    });
    var targetSection = document.getElementById(targetId);
    if (targetSection) {
        targetSection.classList.add('active');
    }
};

// 3. Lifecycle Initialization
window.addEventListener('DOMContentLoaded', function() {
    if (window.location.hash) {
        var targetHash = window.location.hash.slice(1);
        var matchingTab = Array.from(document.querySelectorAll('.tab-item')).find(function(t) {
            return (t.getAttribute('onclick') || '').indexOf(targetHash) !== -1;
        });
        if (document.getElementById(targetHash) && matchingTab) {
            window.pilihKategori({ currentTarget: matchingTab, preventDefault: function() {} }, targetHash);
        }
    }

    sinkronkanRekomendasiAI();
    renderMenuCustom();
    updateTampilanStokPembeli();
    renderPopupKeranjang();
    initStaffTrigger();
    initRuangPopupKeranjang();

    // Pantau status operasional buka/tutup toko (cache lokal, dicek cepat)
    cekDanTerapkanStatusToko();
    setInterval(cekDanTerapkanStatusToko, 2000);

    // Sinkronisasi pengaturan toko (buka/tutup, menu habis) & menu kustom dari Supabase
    sinkronkanPengaturan();
    segarkanMenuCustom(true);
    setInterval(function() {
        if (document.hidden) return;
        sinkronkanPengaturan();
        segarkanMenuCustom(false);
    }, 5000);
});

async function sinkronkanPengaturan() {
    if (!window.SabangdorSettings) return;
    var ok = await window.SabangdorSettings.muat();
    if (ok) {
        cekDanTerapkanStatusToko();
        updateTampilanStokPembeli();
    }
}

async function segarkanMenuCustom(paksa) {
    if (document.hidden && !paksa) return;
    if (typeof getCustomMenusFromSupabase !== 'function') return;

    var sebelum = localStorage.getItem(CUSTOM_STORAGE_KEY);
    await getCustomMenusFromSupabase();
    var sesudah = localStorage.getItem(CUSTOM_STORAGE_KEY);

    if (paksa || sebelum !== sesudah) {
        renderMenuCustom();
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

// 4. Rekomendasi Menu AI (Apriori ML Engine)
function renderRekomendasiAI() {
    var container = document.getElementById('rekomendasi-container') || document.querySelector('#section-rekomendasi .menu-container');
    if (!container) return;

    if (!menuRekomendasiAI || menuRekomendasiAI.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <strong>Belum ada data rekomendasi menu</strong>
                <p>Pilih kategori Dimsum Mentai, Dimsum aja, atau Bakpao di atas untuk melihat seluruh menu.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = menuRekomendasiAI.map(function(item) {
        var imgSrc = safeImgSrc(item.imgSrc, DEFAULT_IMG_FALLBACK);
        var hargaTxt = item.hargaFormatted || ('Mulai Rp' + Number(item.harga || 0).toLocaleString('id-ID'));
        var varianTxt = item.variantInfo || item.varian || 'S / M / XL • 3 / 6 / 16 pcs';
        var linkUrl = safeUrl(item.linkDetail, 'index.html');

        return `
            <div class="card-menu">
                <img src="${escHtml(imgSrc)}" alt="${escHtml(item.nama)}" width="76" height="76" class="card-img">
                <div class="card-content">
                    <h3 class="card-title">${escHtml(item.nama)}</h3>
                    <p class="variant">${escHtml(varianTxt)}</p>
                    <p class="price">${escHtml(hargaTxt)}</p>
                </div>
                <a href="${escHtml(linkUrl)}" class="btn-pilih">+ Pilih menu</a>
            </div>
        `;
    }).join('');

    updateTampilanStokPembeli();
}

async function sinkronkanRekomendasiAI() {
    var baskets = [];

    // Prioritas 1: Ambil transaksi langsung via Supabase Client
    if (typeof window !== 'undefined' && window.AprioriEngine && window.supabaseClient) {
        try {
            baskets = await window.AprioriEngine.getSupabaseTransactions(window.supabaseClient);
        } catch (e) {
            // Mode offline / fallback
        }
    }

    // Prioritas 2: Ambil dari transaksi lokal browser jika Supabase belum aktif
    if (!baskets || baskets.length === 0) {
        if (typeof window !== 'undefined' && window.AprioriEngine && typeof window.AprioriEngine.getRealTransactions === 'function') {
            baskets = window.AprioriEngine.getRealTransactions();
        }
    }

    // Prioritas 3: Hitung frekuensi kombinasi menu
    if (typeof window !== 'undefined' && window.AprioriEngine && typeof window.AprioriEngine.trainApriori === 'function') {
        try {
            var model = window.AprioriEngine.trainApriori(baskets);
            var topMenu = window.AprioriEngine.getPopularRecommendations(model.frequentItemsets, 5);
            menuRekomendasiAI = topMenu || [];
        } catch (err) {
            menuRekomendasiAI = [];
        }
    }

    renderRekomendasiAI();
}

function readSafeCart() {
    try {
        var raw = JSON.parse(localStorage.getItem('sabangdor_cart'));
        if (!Array.isArray(raw)) return [];
        return raw.filter(function(i) {
            return i && Number.isFinite(Number(i.qty)) && Number(i.qty) >= 1 && Number(i.harga) > 0;
        });
    } catch (e) {
        return [];
    }
}

// 5. Popup Keranjang Pesanan
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

            keranjang.forEach(function(item, index) {
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
                            <div class="cart-item-price">${escHtml(item.hargaFormatted || ('Rp' + Number(item.harga).toLocaleString('id-ID')))}</div>
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

            document.getElementById('cart-badge').innerText = `${keranjang.length} Menu`;
            document.getElementById('cart-total-price').innerText = 'Rp' + totalHargaSemua.toLocaleString('id-ID');
            document.getElementById('cart-subtotal-price').innerText = 'Rp' + totalHargaSemua.toLocaleString('id-ID');
            document.getElementById('cart-subtotal-text').innerText = `Subtotal (${totalPorsiSemua} porsi)`;

            setTimeout(function() {
                cartPopup.classList.remove('hidden');
                cartPopup.classList.add('show-smooth');
            }, 100);
        }
        localStorage.removeItem('buka_popup_keranjang');
    } else if (keranjang.length === 0 && cartPopup) {
        cartPopup.classList.remove('show-smooth');
        cartPopup.classList.add('hidden');
    }
}

window.ubahQtyPopup = function(index, delta) {
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
            keranjang[index].hargaFormatted = 'Rp' + keranjang[index].harga.toLocaleString('id-ID');
        }

        localStorage.setItem('sabangdor_cart', JSON.stringify(keranjang));

        if (keranjang.length === 0) {
            window.kosongkanKeranjang();
        } else {
            renderPopupKeranjang();
        }
    }
};

window.kosongkanKeranjang = function() {
    localStorage.removeItem('sabangdor_cart');
    var cartPopup = document.getElementById('cart-popup');
    if (cartPopup) {
        cartPopup.classList.remove('show-smooth');
        setTimeout(function() {
            cartPopup.classList.add('hidden');
        }, 300);
    }
};

window.keHalamanKeranjang = function() {
    window.location.href = 'keranjang.html';
};

// 6. Sinkronisasi Ketersediaan Stok
function updateTampilanStokPembeli() {
    var menuStatus = [];
    try {
        var parsedStatus = JSON.parse(localStorage.getItem('sabangdor_menu_status'));
        if (Array.isArray(parsedStatus)) menuStatus = parsedStatus;
    } catch (e) {}

    var tokoTutup = localStorage.getItem('sabangdor_status_toko') === 'tutup';

    document.querySelectorAll('.card-menu').forEach(function(card) {
        card.style.opacity = '1';
        card.style.filter = 'none';
        var btn = card.querySelector('.btn-pilih');
        if (!btn) return;
        if (!btn.dataset.origHref && btn.getAttribute('href')) {
            btn.dataset.origHref = btn.getAttribute('href');
        }
        if (!tokoTutup) {
            btn.innerText = '+ Pilih menu';
            btn.style.backgroundColor = '';
            btn.style.color = '';
            btn.style.borderColor = '';
            btn.style.pointerEvents = 'auto';
            btn.removeAttribute('aria-disabled');
            if (btn.dataset.origHref) btn.setAttribute('href', btn.dataset.origHref);
        }
    });

    if (tokoTutup) return;

    getCustomMenus().forEach(function(m) {
        if (!m.habis) return;
        document.querySelectorAll('.card-menu[data-menu-id]').forEach(function(card) {
            if (card.dataset.menuId === String(m.id)) tandaiKartuHabis(card);
        });
    });

    menuStatus.forEach(function(item) {
        if (item && item.status === 'habis') {
            document.querySelectorAll('.card-menu').forEach(function(card) {
                var titleEl = card.querySelector('.card-title');
                if (titleEl && titleEl.innerText.trim().toLowerCase() === String(item.nama || '').toLowerCase()) {
                    tandaiKartuHabis(card);
                }
            });
        }
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
        btn.innerText = 'Habis';
        btn.style.backgroundColor = '#475569';
        btn.style.borderColor = '#475569';
        btn.style.color = '#FFFFFF';
        btn.style.pointerEvents = 'none';
        btn.setAttribute('aria-disabled', 'true');
        btn.removeAttribute('href');
    }
}

// 7. Shortcut Triple Click Login Pegawai
function initStaffTrigger() {
    var staffTrigger = document.getElementById('staff-trigger');
    if (!staffTrigger) return;

    var clickCount = 0;
    var clickTimer = null;

    staffTrigger.addEventListener('click', function() {
        clickCount++;
        clearTimeout(clickTimer);

        if (clickCount === 3) {
            clickCount = 0;
            window.location.href = 'login-pegawai.html';
        } else {
            clickTimer = setTimeout(function() {
                clickCount = 0;
            }, 800);
        }
    });
}

// 8. Render Menu Custom Dinamis
function teksVarianCustom(menu) {
    var ukuran = menu.ukuran || [];
    var nama = ukuran.map(function(u) { return u.nama; }).join(' / ');
    var porsi = ukuran.map(function(u) { return String(u.porsi || u.ket || '').trim(); }).filter(Boolean);
    if (!porsi.length) return nama;
    var semuaAngka = porsi.every(function(p) { return /^\d+$/.test(p); });
    return `${nama} • ${porsi.join(' / ')}${semuaAngka ? ' pcs' : ''}`;
}

function kartuMenuCustom(menu) {
    var img = safeImgSrc(menu.img || menu.img_url, DEFAULT_IMG_FALLBACK);
    return `
        <div class="card-menu" data-custom="1" data-menu-id="${escHtml(menu.id)}">
            <img src="${escHtml(img)}" alt="${escHtml(menu.nama)}" width="76" height="76" class="card-img">
            <div class="card-content">
                <h3 class="card-title">${escHtml(menu.nama)}</h3>
                <p class="variant">${escHtml(teksVarianCustom(menu))}</p>
                <p class="price">Mulai ${rupiah(hargaMulai(menu))}</p>
            </div>
            <a href="detail-menu-custom.html?id=${encodeURIComponent(menu.id)}" class="btn-pilih">+ Pilih menu</a>
        </div>
    `;
}

function renderMenuCustom() {
    var navBar = document.querySelector('.nav-tab-bar');
    var cartPopup = document.getElementById('cart-popup');
    if (!navBar || !cartPopup) return;

    var activeSection = document.querySelector('.menu-section.active');
    var activeId = activeSection ? activeSection.id : null;
    document.querySelectorAll('[data-custom]').forEach(function(el) { el.remove(); });

    var perKategori = {};
    getCustomMenus().forEach(function(m) {
        (perKategori[m.kategori] = perKategori[m.kategori] || []).push(m);
    });

    Object.keys(perKategori).forEach(function(kategori) {
        var container = null;

        if (MAP_SECTION_DEFAULT[kategori]) {
            var sec = document.getElementById(MAP_SECTION_DEFAULT[kategori]);
            container = sec ? sec.querySelector('.menu-container') : null;
        } else {
            var secId = 'section-custom-' + slugKategori(kategori);

            var tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'tab-item';
            tab.dataset.custom = '1';
            tab.setAttribute('onclick', `pilihKategori(event, '${secId}')`);
            tab.innerHTML = `<span class="tab-label">${escHtml(kategori)}</span>`;
            if (secId === activeId) tab.classList.add('active');
            navBar.appendChild(tab);

            var secCustom = document.createElement('section');
            secCustom.id = secId;
            secCustom.className = 'menu-section' + (secId === activeId ? ' active' : '');
            secCustom.dataset.custom = '1';
            secCustom.innerHTML = `
                <h2 class="section-title">${escHtml(kategori)}</h2>
                <p class="section-desc">Menu pilihan tambahan outlet</p>
                <div class="menu-container"></div>
            `;
            var mainEl = document.querySelector('main');
            if (mainEl) mainEl.appendChild(secCustom);
            else cartPopup.parentNode.insertBefore(secCustom, cartPopup);
            container = secCustom.querySelector('.menu-container');
        }

        if (container) {
            perKategori[kategori].forEach(function(m) {
                container.insertAdjacentHTML('beforeend', kartuMenuCustom(m));
            });
        }
    });

    if (activeId && !document.getElementById(activeId)) {
        var firstTab = navBar.querySelector('.tab-item');
        var firstSec = document.querySelector('.menu-section');
        navBar.querySelectorAll('.tab-item').forEach(function(t) { t.classList.remove('active'); });
        if (firstTab) firstTab.classList.add('active');
        if (firstSec) firstSec.classList.add('active');
    }
}

// 9. Status Toko Buka / Tutup
var tokoSedangTutupDiHalaman = false;

function cekDanTerapkanStatusToko() {
    var statusToko = localStorage.getItem('sabangdor_status_toko');
    var isTutup = statusToko === 'tutup';

    // Toko baru dibuka kembali: muat ulang halaman agar tombol & link menu pulih
    if (!isTutup && tokoSedangTutupDiHalaman) {
        window.location.reload();
        return;
    }
    tokoSedangTutupDiHalaman = isTutup;
    var bannerTutup = document.getElementById('banner-toko-tutup');

    if (isTutup) {
        document.querySelectorAll('.btn-pilih').forEach(function(btn) {
            if (!btn.dataset.origHref && btn.getAttribute('href')) {
                btn.dataset.origHref = btn.getAttribute('href');
            }
            btn.innerText = 'Toko Tutup';
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
            btnCekKeranjang.innerText = 'Toko Tutup';
        }

        if (!bannerTutup) {
            var container = document.querySelector('.mobile-container');
            if (container) {
                bannerTutup = document.createElement('div');
                bannerTutup.id = 'banner-toko-tutup';
                bannerTutup.className = 'store-status-banner';
                bannerTutup.setAttribute('role', 'status');
                bannerTutup.innerText = 'Toko sedang tutup dan belum menerima pesanan saat ini.';
                
                var siteHeader = document.querySelector('.site-header');
                if (siteHeader && siteHeader.nextSibling) {
                    container.insertBefore(bannerTutup, siteHeader.nextSibling);
                } else {
                    container.insertBefore(bannerTutup, container.firstChild);
                }
            }
        }
    } else {
        if (bannerTutup) bannerTutup.remove();

        var btnAktif = document.querySelector('.btn-cek-keranjang');
        if (btnAktif) {
            btnAktif.disabled = false;
            btnAktif.style.pointerEvents = 'auto';
            btnAktif.style.backgroundColor = '';
            btnAktif.innerText = 'Cek Keranjang';
        }

        updateTampilanStokPembeli();
        renderPopupKeranjang();
    }
}

// 10. Multi-tab / Multi-window Storage Listener
window.addEventListener('storage', function(e) {
    if (e.key === 'sabangdor_menu_status') updateTampilanStokPembeli();
    if (e.key === CUSTOM_STORAGE_KEY) {
        renderMenuCustom();
        updateTampilanStokPembeli();
    }
    if (e.key === 'sabangdor_status_toko') cekDanTerapkanStatusToko();
});