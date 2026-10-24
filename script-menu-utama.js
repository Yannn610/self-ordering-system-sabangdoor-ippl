/**
 * File: js/script-menu-utama.js
 */

let menuRekomendasiAI = [];


// Helper fallback jika tidak terdefinisi di config.js
const DEFAULT_MENU_IMG = typeof window.DEFAULT_MENU_IMG !== 'undefined' ? window.DEFAULT_MENU_IMG : 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80';
const CUSTOM_MENU_KEY = typeof window.CUSTOM_MENU_KEY !== 'undefined' ? window.CUSTOM_MENU_KEY : 'sabangdor_custom_menus';
const KATEGORI_BAWAAN = typeof window.KATEGORI_BAWAAN !== 'undefined' ? window.KATEGORI_BAWAAN : {
    'Dimsum Mentai': 'section-mentai',
    'Dimsum aja': 'section-dimsum-aja',
    'Bakpao': 'section-bakpao'
};

function escHtml(str) {
    if (typeof str !== 'string') return str || '';
    return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function slugKategori(str) {
    return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function rupiah(num) {
    return 'Rp' + Number(num || 0).toLocaleString('id-ID');
}

function hargaMulai(menu) {
    if (!menu.ukuran || !menu.ukuran.length) return menu.harga || 0;
    return Math.min(...menu.ukuran.map(u => Number(u.harga) || 0));
}

function getCustomMenus() {
    try {
        return JSON.parse(localStorage.getItem(CUSTOM_MENU_KEY)) || [];
    } catch (e) {
        return [];
    }
}

// 1. Fungsi Switch Kategori Tab (diekspos ke window agar terbaca dari inline onclick)
window.pilihKategori = function(event, targetId) {
    if (event) event.preventDefault();

    const clickedButton = event ? event.currentTarget : null;

    if (clickedButton) {
        document.querySelectorAll('.tab-item').forEach(btn => btn.classList.remove('active'));
        clickedButton.classList.add('active');
    }

    // Sembunyikan seluruh section menu, lalu tampilkan HANYA section yang dipilih
    document.querySelectorAll('.menu-section').forEach(sec => sec.classList.remove('active'));
    const targetSection = document.getElementById(targetId);
    if (targetSection) {
        targetSection.classList.add('active');
    }
};

// 2. Load saat halaman siap
window.addEventListener('DOMContentLoaded', () => {
    renderRekomendasiAI();
    sinkronkanRekomendasiAI();
    renderMenuCustom();
    updateTampilanStokPembeli();
    renderPopupKeranjang();
    initStaffTrigger();
    initRuangPopupKeranjang();

    // Cek status operasional toko
    cekDanTerapkanStatusToko();
    setInterval(cekDanTerapkanStatusToko, 2000);

    segarkanMenuCustom(true);
    setInterval(() => segarkanMenuCustom(false), 5000);
});

async function segarkanMenuCustom(paksa) {
    if (document.hidden && !paksa) return;
    if (typeof getCustomMenusFromSupabase !== 'function') return;

    const sebelum = localStorage.getItem(CUSTOM_MENU_KEY);
    await getCustomMenusFromSupabase();
    const sesudah = localStorage.getItem(CUSTOM_MENU_KEY);

    if (paksa || sebelum !== sesudah) {
        renderMenuCustom();
        updateTampilanStokPembeli();
    }
}

function sesuaikanRuangPopup() {
    const popup = document.getElementById('cart-popup');
    const wrap = document.querySelector('.mobile-container');
    if (!popup || !wrap) return;
    const tinggi = popup.classList.contains('hidden') ? 0 : popup.offsetHeight;
    wrap.style.paddingBottom = tinggi ? (tinggi + 24) + 'px' : '';
}

function initRuangPopupKeranjang() {
    const popup = document.getElementById('cart-popup');
    if (!popup) return;
    if (window.ResizeObserver) new ResizeObserver(sesuaikanRuangPopup).observe(popup);
    new MutationObserver(sesuaikanRuangPopup).observe(popup, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', sesuaikanRuangPopup);
    sesuaikanRuangPopup();
}

// 3. FUNGSI RENDER REKOMENDASI
function renderRekomendasiAI() {
    const container = document.getElementById('rekomendasi-container');
    if (!container) return;

    if (menuRekomendasiAI.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding: 24px 12px; background: #fff; border-radius: 12px; border: 1px solid var(--border-line);">
                <p style="font-size: 13px; font-weight: 700; color: var(--text-muted); margin: 0;">Belum ada rekomendasi menu saat ini.</p>
            </div>
        `;
        return;
    }

    let html = '';
    menuRekomendasiAI.forEach(item => {
        html += `
            <div class="card-menu">
                <img src="${escHtml(item.imgSrc || DEFAULT_MENU_IMG)}" alt="${escHtml(item.nama)}" class="card-img">
                <div class="card-content">
                    <h3 class="card-title">${escHtml(item.nama)}</h3>
                    <p class="variant">${escHtml(item.variantInfo || 'S / M / XL • 3 / 6 / 16 pcs')}</p>
                    <p class="price">${escHtml(item.hargaFormatted || ('Mulai Rp' + Number(item.harga || 0).toLocaleString('id-ID')))}</p>
                </div>
                <a href="${escHtml(item.linkDetail || 'detail-menu.html')}" class="btn-pilih">+ Pilih menu</a>
            </div>
        `;
    });
    container.innerHTML = html;
    updateTampilanStokPembeli();
}

async function sinkronkanRekomendasiAI() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1200);
        const res = await fetch('http://127.0.0.1:5000/api/recommendations', { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
                menuRekomendasiAI = data;
                renderRekomendasiAI();
                console.log('[AI Apriori] Berhasil memperbarui rekomendasi menu secara real-time dari Python API Server.');
            }
        }
    } catch (err) {
        // Mode offline/fallback aman
    }
}

// 4. Load Popup Keranjang
function renderPopupKeranjang() {
    const harusBukaPopup = localStorage.getItem('buka_popup_keranjang');
    const cartPopup = document.getElementById('cart-popup');

    let keranjang = JSON.parse(localStorage.getItem('sabangdor_cart')) || [];

    if (keranjang.length > 0 && (harusBukaPopup === 'true' || (cartPopup && !cartPopup.classList.contains('hidden')))) {
        if (cartPopup) {
            const containerItems = document.getElementById('cart-items-container');
            containerItems.innerHTML = '';

            let totalPorsiSemua = 0;
            let totalHargaSemua = 0;

            keranjang.forEach((item, index) => {
                totalPorsiSemua += item.qty;
                totalHargaSemua += item.harga;

                let catatanHtml = item.catatan
                    ? `<div class="item-catatan">Catatan: "${item.catatan}"</div>`
                    : '';

                let imageHtml = item.imgSrc
                    ? `<img src="${item.imgSrc}" alt="${item.nama}" class="cart-item-img">`
                    : `<div class="cart-item-placeholder">Menu</div>`;

                const itemDiv = document.createElement('div');
                itemDiv.className = 'cart-item';
                itemDiv.innerHTML = `
                    <div class="cart-item-left">
                        ${imageHtml}
                        <div class="cart-item-detail">
                            <h4 class="cart-item-title">${item.nama}</h4>
                            <div class="cart-item-variant">${item.varian}</div>
                            ${catatanHtml}
                            <div class="cart-item-price">${item.hargaFormatted || ('Rp' + item.harga.toLocaleString('id-ID'))}</div>
                        </div>
                    </div>
                    <div class="cart-item-counter">
                        <button class="cnt-btn" onclick="ubahQtyPopup(${index}, -1)">-</button>
                        <span class="cnt-num">${item.qty}</span>
                        <button class="cnt-btn plus" onclick="ubahQtyPopup(${index}, 1)">+</button>
                    </div>
                `;
                containerItems.appendChild(itemDiv);
            });

            document.getElementById('cart-badge').innerText = `${keranjang.length} Menu`;
            document.getElementById('cart-total-price').innerText = 'Rp' + totalHargaSemua.toLocaleString('id-ID');
            document.getElementById('cart-subtotal-price').innerText = 'Rp' + totalHargaSemua.toLocaleString('id-ID');
            document.getElementById('cart-subtotal-text').innerText = `Subtotal (${totalPorsiSemua} porsi)`;

            setTimeout(() => {
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

// 5. Fungsi Ubah Qty
window.ubahQtyPopup = function(index, delta) {
    let keranjang = JSON.parse(localStorage.getItem('sabangdor_cart')) || [];

    if (keranjang[index]) {
        let hargaSatuan = keranjang[index].harga / keranjang[index].qty;
        keranjang[index].qty += delta;

        if (keranjang[index].qty <= 0) {
            keranjang.splice(index, 1);
        } else {
            keranjang[index].harga = hargaSatuan * keranjang[index].qty;
            keranjang[index].hargaFormatted = 'Rp' + keranjang[index].harga.toLocaleString('id-ID');
        }

        localStorage.setItem('sabangdor_cart', JSON.stringify(keranjang));

        if (keranjang.length === 0) {
            kosongkanKeranjang();
        } else {
            renderPopupKeranjang();
        }
    }
};

// 6. Sinkronisasi Status Stok Habis
function updateTampilanStokPembeli() {
    let menuStatus = JSON.parse(localStorage.getItem('sabangdor_menu_status')) || [];

    document.querySelectorAll('.card-menu').forEach(card => {
        card.style.opacity = '1';
        card.style.filter = 'none';
        const btn = card.querySelector('.btn-pilih');
        if (btn && btn.innerText !== 'Habis' && btn.innerText !== 'Toko Tutup') {
            btn.style.pointerEvents = 'auto';
        }
    });

    getCustomMenus().forEach(m => {
        if (!m.habis) return;
        document.querySelectorAll('.card-menu[data-menu-id]').forEach(card => {
            if (card.dataset.menuId === String(m.id)) tandaiKartuHabis(card);
        });
    });

    menuStatus.forEach(item => {
        if (item.status === 'habis') {
            const cards = document.querySelectorAll('.card-menu');
            cards.forEach(card => {
                const titleEl = card.querySelector('.card-title');
                if (titleEl && titleEl.innerText.trim().toLowerCase() === item.nama.toLowerCase()) {
                    tandaiKartuHabis(card);
                }
            });
        }
    });
}

function tandaiKartuHabis(card) {
    card.style.opacity = '0.5';
    card.style.filter = 'grayscale(100%)';
    const btn = card.querySelector('.btn-pilih');
    if (btn) {
        btn.innerText = 'Habis';
        btn.style.backgroundColor = '#94A3B8';
        btn.style.color = '#FFFFFF';
        btn.style.pointerEvents = 'none';
        btn.removeAttribute('href');
    }
}

// 7. Kosongkan Keranjang
window.kosongkanKeranjang = function() {
    localStorage.removeItem('sabangdor_cart');
    const cartPopup = document.getElementById('cart-popup');
    if (cartPopup) {
        cartPopup.classList.remove('show-smooth');
        setTimeout(() => {
            cartPopup.classList.add('hidden');
        }, 300);
    }
};

// 8. Navigasi Tombol "Cek Keranjang"
window.keHalamanKeranjang = function() {
    window.location.href = 'keranjang.html';
};

// 9. Trigger Rahasia Triple Click
function initStaffTrigger() {
    const staffTrigger = document.getElementById('staff-trigger');
    if (!staffTrigger) return;

    let clickCount = 0;
    let clickTimer = null;

    staffTrigger.addEventListener('click', () => {
        clickCount++;
        clearTimeout(clickTimer);

        if (clickCount === 3) {
            clickCount = 0;
            window.location.href = 'login-pegawai.html';
        } else {
            clickTimer = setTimeout(() => {
                clickCount = 0;
            }, 800);
        }
    });
}

// 10. Menu Tambahan dari Kasir
function teksVarianCustom(menu) {
    const ukuran = menu.ukuran || [];
    const nama = ukuran.map(u => u.nama).join(' / ');
    const porsi = ukuran.map(u => String(u.porsi || u.ket || '').trim()).filter(Boolean);
    if (!porsi.length) return nama;
    const semuaAngka = porsi.every(p => /^\d+$/.test(p));
    return `${nama} • ${porsi.join(' / ')}${semuaAngka ? ' pcs' : ''}`;
}

function kartuMenuCustom(menu) {
    return `
        <div class="card-menu" data-custom="1" data-menu-id="${escHtml(menu.id)}">
            <img src="${menu.img || DEFAULT_MENU_IMG}" alt="${escHtml(menu.nama)}" class="card-img">
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
    const navBar = document.querySelector('.nav-tab-bar');
    const cartPopup = document.getElementById('cart-popup');
    if (!navBar || !cartPopup) return;

    const activeSection = document.querySelector('.menu-section.active');
    const activeId = activeSection ? activeSection.id : null;
    document.querySelectorAll('[data-custom]').forEach(el => el.remove());

    const perKategori = {};
    getCustomMenus().forEach(m => {
        (perKategori[m.kategori] = perKategori[m.kategori] || []).push(m);
    });

    Object.keys(perKategori).forEach(kategori => {
        let container = null;

        if (KATEGORI_BAWAAN[kategori]) {
            const sec = document.getElementById(KATEGORI_BAWAAN[kategori]);
            container = sec ? sec.querySelector('.menu-container') : null;
        } else {
            const secId = 'section-custom-' + slugKategori(kategori);

            const tab = document.createElement('button');
            tab.className = 'tab-item';
            tab.dataset.custom = '1';
            tab.setAttribute('onclick', `pilihKategori(event, '${secId}')`);
            tab.innerHTML = `<span class="tab-label">${escHtml(kategori)}</span>`;
            if (secId === activeId) tab.classList.add('active');
            navBar.appendChild(tab);

            const sec = document.createElement('div');
            sec.id = secId;
            sec.className = 'menu-section' + (secId === activeId ? ' active' : '');
            sec.dataset.custom = '1';
            sec.innerHTML = `
                <h2 class="section-title">${escHtml(kategori)}</h2>
                <p class="section-desc"></p>
                <div class="menu-container"></div>
            `;
            cartPopup.parentNode.insertBefore(sec, cartPopup);
            container = sec.querySelector('.menu-container');
        }

        if (container) {
            perKategori[kategori].forEach(m => container.insertAdjacentHTML('beforeend', kartuMenuCustom(m)));
        }
    });

    if (activeId && !document.getElementById(activeId)) {
        const firstTab = navBar.querySelector('.tab-item');
        const firstSec = document.querySelector('.menu-section');
        navBar.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
        if (firstTab) firstTab.classList.add('active');
        if (firstSec) firstSec.classList.add('active');
    }
}

// 11. Listener Storage
window.addEventListener('storage', (e) => {
    if (e.key === 'sabangdor_menu_status') {
        updateTampilanStokPembeli();
    }
    if (e.key === CUSTOM_MENU_KEY) {
        renderMenuCustom();
        updateTampilanStokPembeli();
    }
    if (e.key === 'sabangdor_status_toko') {
        cekDanTerapkanStatusToko();
    }
});

// ==========================================
// 11. REKOMENDASI AI (APRIORI ML ENGINE)
// ==========================================
function renderRekomendasiAI() {
    const container = document.getElementById('rekomendasi-container') || document.querySelector('#section-rekomendasi .menu-container');
    if (!container) return;

    if (!menuRekomendasiAI || menuRekomendasiAI.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = menuRekomendasiAI.map(item => `
        <div class="card-menu">
            <img src="${item.imgSrc || 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80'}" alt="${item.nama}" class="card-img">
            <div class="card-content">
                <h3 class="card-title">${item.nama}</h3>
                <p class="variant">${item.variantInfo || item.varian || ''}</p>
                <p class="price">${item.hargaFormatted || ('Rp' + (item.harga || 0).toLocaleString('id-ID'))}</p>
            </div>
            <a href="${item.linkDetail || 'index.html'}" class="btn-pilih">+ Pilih menu</a>
        </div>
    `).join('');

    updateTampilanStokPembeli();
}

async function sinkronkanRekomendasiAI() {
    let baskets = [];

    // 1. Coba ambil riwayat transaksi langsung dari Supabase
    if (typeof window !== 'undefined' && window.AprioriEngine && window.supabaseClient) {
        try {
            baskets = await window.AprioriEngine.getSupabaseTransactions(window.supabaseClient);
        } catch (e) {
            // Supabase offline / belum terkoneksi
        }
    }

    // 2. Jika Supabase kosong/belum aktif, ambil dari riwayat pesanan lokal (localStorage)
    if (!baskets || baskets.length === 0) {
        if (typeof window !== 'undefined' && window.AprioriEngine) {
            baskets = window.AprioriEngine.getRealTransactions();
        }
    }

    // 3. Jalankan algoritma Apriori dengan data transaksi riil
    if (typeof window !== 'undefined' && window.AprioriEngine && typeof window.AprioriEngine.trainApriori === 'function') {
        try {
            const { frequentItemsets } = window.AprioriEngine.trainApriori(baskets);
            const topMenu = window.AprioriEngine.getPopularRecommendations(frequentItemsets, 5);
            menuRekomendasiAI = topMenu || [];
        } catch (err) {
            menuRekomendasiAI = [];
        }
    }

    renderRekomendasiAI();
}

// 12. Pengecekan & Penguncian Toko Tutup
function cekDanTerapkanStatusToko() {
    const statusToko = localStorage.getItem('sabangdor_status_toko');
    const isTutup = statusToko === 'tutup';

    let bannerTutup = document.getElementById('banner-toko-tutup');

    if (isTutup) {
        document.querySelectorAll('.btn-pilih').forEach(btn => {
            btn.innerText = 'Toko Tutup';
            btn.style.backgroundColor = '#94A3B8';
            btn.style.color = '#FFFFFF';
            btn.style.pointerEvents = 'none';
            btn.removeAttribute('href');
        });

        const cartPopup = document.getElementById('cart-popup');
        const btnCekKeranjang = document.querySelector('.btn-cek-keranjang');
        
        if (cartPopup) {
            cartPopup.classList.remove('show-smooth');
            cartPopup.classList.add('hidden');
        }
        if (btnCekKeranjang) {
            btnCekKeranjang.disabled = true;
            btnCekKeranjang.style.pointerEvents = 'none';
            btnCekKeranjang.style.backgroundColor = '#94A3B8';
            btnCekKeranjang.innerText = 'Toko Tutup';
        }

        if (!bannerTutup) {
            const container = document.querySelector('.mobile-container');
            if (container) {
                bannerTutup = document.createElement('div');
                bannerTutup.id = 'banner-toko-tutup';
                bannerTutup.style.cssText = 'background: #FEF2F2; border: 1px solid #E11D48; color: #E11D48; padding: 12px; border-radius: 12px; text-align: center; font-weight: 700; margin-bottom: 16px; font-size: 13px;';
                bannerTutup.innerText = '🔴 Mohon Maaf, Toko Saat Ini Sedang Tutup & Belum Menerima Pesanan.';
                
                const headerTitle = document.getElementById('staff-trigger');
                if (headerTitle && headerTitle.nextSibling) {
                    container.insertBefore(bannerTutup, headerTitle.nextSibling);
                } else {
                    container.insertBefore(bannerTutup, container.firstChild);
                }
            }
        }
    } else {
        if (bannerTutup) {
            bannerTutup.remove();
        }

        const btnCekKeranjang = document.querySelector('.btn-cek-keranjang');
        if (btnCekKeranjang) {
            btnCekKeranjang.disabled = false;
            btnCekKeranjang.style.pointerEvents = 'auto';
            btnCekKeranjang.style.backgroundColor = '';
            btnCekKeranjang.innerText = 'Cek Keranjang';
        }

        updateTampilanStokPembeli();
        renderPopupKeranjang();
    }
}

