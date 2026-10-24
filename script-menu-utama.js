/**
 - File: js/script-menu-utama.js
 */

let menuRekomendasiAI = (typeof window !== 'undefined' && window.MENU_REKOMENDASI_DEFAULT) ? window.MENU_REKOMENDASI_DEFAULT : [
    {
        nama: "Mentai Ori",
        variantInfo: "S / M / XL | 3 / 6 / 16 pcs",
        harga: 13000,
        hargaFormatted: "Mulai Rp13.000",
        linkDetail: "dimsum-mentai-ori.html",
        imgSrc: "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80"
    },
    {
        nama: "Bakpao",
        variantInfo: "5 Varian | 1 / 3 / 6 pcs",
        harga: 7000,
        hargaFormatted: "Mulai Rp7.000",
        linkDetail: "detail-menu-bakpao.html",
        imgSrc: "https://images.unsplash.com/photo-1563245372-f21724e3856d?auto=format&fit=crop&w=600&q=80"
    },
    {
        nama: "Extra Mentai",
        variantInfo: "Add-on Saus Mentai Gurih",
        harga: 3000,
        hargaFormatted: "Rp3.000",
        linkDetail: "index.html#section-mentai",
        imgSrc: "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80"
    },
    {
        nama: "Dimsum Aja",
        variantInfo: "S / M / XL | 3 / 6 / 16 pcs",
        harga: 10000,
        hargaFormatted: "Mulai Rp10.000",
        linkDetail: "dimsum-aja.html",
        imgSrc: "https://images.unsplash.com/photo-1496116218417-1a781b1c416c?auto=format&fit=crop&w=600&q=80"
    },
    {
        nama: "Mentai Cheese",
        variantInfo: "S / M / XL | 3 / 6 / 16 pcs",
        harga: 15000,
        hargaFormatted: "Mulai Rp15.000",
        linkDetail: "dimsum-mentai-cheese.html",
        imgSrc: "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80"
    }
];

// 1. Fungsi Switch Kategori Tab
function pilihKategori(event, targetId) {
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
}

// 2. Load saat halaman siap
window.addEventListener('DOMContentLoaded', () => {
    renderRekomendasiAI(); // Render rekomendasi AI langsung di tab Paling Rekomendasi
    sinkronkanRekomendasiAI(); // Cek update real-time dari server Python (jika aktif)
    renderMenuCustom();
    updateTampilanStokPembeli();
    renderPopupKeranjang();
    initStaffTrigger();
    initRuangPopupKeranjang();

    // Cek status operasional toko
    cekDanTerapkanStatusToko();
    setInterval(cekDanTerapkanStatusToko, 2000); // Cek otomatis secara berkala

    // Ambil menu custom terbaru dari Supabase, lalu cek ulang tiap 5 detik
    // supaya status HABIS dari kasir cepat muncul di HP pembeli.
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

// Popup keranjang menempel di bawah layar (position: fixed). Beri ruang kosong
// di bawah daftar menu sebesar tinggi popup, supaya menu paling bawah tidak tertutup.
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

// 3. FUNGSI RENDER REKOMENDASI (Dibiarkan kosong/aman jika section-nya masih ada di HTML)
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

/**
 * Mengambil rekomendasi menu terbaru secara dinamis dari API server Python (apriori_recommendation.py)
 * Jika server tidak dijalankan, web tetap berjalan normal menggunakan data rekomendasi bawaan.
 */
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
        // Mode offline/fallback aman aktif tanpa menampilkan error ke pembeli
    }
}

// 4. Load Popup Keranjang & Render Ulang Item saat Kembali dari Detail Menu
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

// 5. Fungsi Ubah Qty (+ / -) Langsung di Popup Keranjang
function ubahQtyPopup(index, delta) {
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
}

// 6. Sinkronisasi Status Stok Habis dari Dashboard Penjual
function updateTampilanStokPembeli() {
    let menuStatus = JSON.parse(localStorage.getItem('sabangdor_menu_status')) || [];

    document.querySelectorAll('.card-menu').forEach(card => {
        card.style.opacity = '1';
        card.style.filter = 'none';
        const btn = card.querySelector('.btn-pilih');
        if (btn && btn.innerText !== 'Habis') {
            btn.style.pointerEvents = 'auto';
        }
    });

    // Menu tambahan (custom) yang ditandai habis oleh kasir
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
function kosongkanKeranjang() {
    localStorage.removeItem('sabangdor_cart');
    const cartPopup = document.getElementById('cart-popup');
    if (cartPopup) {
        cartPopup.classList.remove('show-smooth');
        setTimeout(() => {
            cartPopup.classList.add('hidden');
        }, 300);
    }
}

// 8. Navigasi Tombol "Cek Keranjang"
function keHalamanKeranjang() {
    window.location.href = 'keranjang.html';
}

// 9. Trigger Rahasia Triple Click untuk Login Pegawai
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

window.addEventListener('storage', (e) => {
    if (e.key === 'sabangdor_menu_status') {
        updateTampilanStokPembeli();
    }
    if (e.key === CUSTOM_MENU_KEY) {
        renderMenuCustom();
        updateTampilanStokPembeli();
    }
});

// 10. Menu Tambahan dari Kasir: kartu menu & tab kategori dibuat otomatis
// Format sama seperti menu lain, contoh: "S / M / XL • 3 / 6 / 16 pcs"
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

// Listener real-time instan antar-tab browser (Dashboard Kasir <-> Index)
window.addEventListener('storage', (e) => {
    if (e.key === 'sabangdor_menu_status') {
        updateTampilanStokPembeli();
    }
    if (e.key === CUSTOM_MENU_KEY) {
        renderMenuCustom();
        updateTampilanStokPembeli();
    }
    // Deteksi real-time perubahan status buka/tutup toko
    if (e.key === 'sabangdor_status_toko') {
        cekDanTerapkanStatusToko();
    }
});

// Fungsi Pengecekan & Penguncian Toko Tutup
function cekDanTerapkanStatusToko() {
    const statusToko = localStorage.getItem('sabangdor_status_toko');
    const isTutup = statusToko === 'tutup';

    let bannerTutup = document.getElementById('banner-toko-tutup');

    if (isTutup) {
        // 1. Matikan semua tombol "+ Pilih menu"
        document.querySelectorAll('.btn-pilih').forEach(btn => {
            btn.innerText = 'Toko Tutup';
            btn.style.backgroundColor = '#94A3B8';
            btn.style.color = '#FFFFFF';
            btn.style.pointerEvents = 'none';
            btn.removeAttribute('href');
        });

        // 2. Sembunyikan & Kunci Popup Keranjang + Tombol "Cek Keranjang"
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

        // 3. Tampilkan Banner Toko Tutup
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
        // Jika Toko BUKA Kembali
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