// ==========================================
// HELPER GLOBAL (Mencegah ReferenceError)
// ==========================================
function escHtml(str) {
    if (typeof str !== 'string') return str || '';
    return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function rupiah(num) {
    return 'Rp' + Number(num || 0).toLocaleString('id-ID');
}

const DETAIL_DEFAULT_IMG = (typeof window.DEFAULT_MENU_IMG !== 'undefined' && window.DEFAULT_MENU_IMG)
    ? window.DEFAULT_MENU_IMG
    : 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80';

function safeImgSrc(src, fallback) {
    const fb = fallback || DETAIL_DEFAULT_IMG;
    if (!src || typeof src !== 'string') return fb;
    const trimmed = src.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) return trimmed;
    return fb;
}

const MAX_QTY = 99;

function tampilkanStatusTutupAtauHabis(alasanTeks, labelTombol) {
    const body = document.getElementById('content-body') || document.querySelector('.content-body');
    const cartBtn = document.querySelector('.cart-btn');
    if (cartBtn) {
        cartBtn.disabled = true;
        cartBtn.textContent = labelTombol;
    }
    if (body && !document.getElementById('detail-status-banner')) {
        const banner = document.createElement('div');
        banner.id = 'detail-status-banner';
        banner.setAttribute('role', 'status');
        banner.style.cssText = 'background:#FEF2F2;border:1px solid #BE123C;color:#BE123C;padding:12px 14px;border-radius:12px;font-size:13px;font-weight:700;text-align:center;';
        banner.textContent = alasanTeks;
        body.insertBefore(banner, body.firstChild);
    }
}

async function cekKetersediaanDetail() {
    if (window.SabangdorSettings) {
        try { await window.SabangdorSettings.muat(); } catch (e) { /* pakai cache lokal */ }
    }
    if (localStorage.getItem('sabangdor_status_toko') === 'tutup') {
        tampilkanStatusTutupAtauHabis('Toko sedang tutup dan belum menerima pesanan saat ini.', 'Toko Tutup');
        return false;
    }
    const titleEl = document.querySelector('.product-info h2');
    const namaMenu = titleEl ? titleEl.textContent.trim().toLowerCase() : '';
    if (namaMenu) {
        try {
            const list = JSON.parse(localStorage.getItem('sabangdor_menu_status')) || [];
            const habis = list.some(i => i && i.status === 'habis' && String(i.nama || '').trim().toLowerCase() === namaMenu);
            if (habis) {
                tampilkanStatusTutupAtauHabis('Maaf, menu ini sedang habis.', 'Stok Habis');
                return false;
            }
        } catch (e) {}
    }
    return true;
}

// ==========================================
// MENU TAMBAHAN: isi halaman detail dibuat otomatis dari data kasir
// Hanya aktif di detail-menu-custom.html?id=... (butuh menu-custom-store.js).
// ==========================================
window.__detailReady = (async function () {
    const body = document.getElementById('content-body');
    if (!body || typeof getCustomMenus !== 'function') return;

    // Ambil data terbaru dari Supabase (agar link langsung / HP lain tetap bisa membuka menu)
    if (typeof window.getCustomMenusFromSupabase === 'function') {
        try { await window.getCustomMenusFromSupabase(); } catch (e) { /* pakai cache */ }
    }
    if (window.SabangdorSettings) {
        try { await window.SabangdorSettings.muat(); } catch (e) { /* abaikan */ }
    }

    const id = new URLSearchParams(window.location.search).get('id');
    const menu = getCustomMenus().find(m => String(m.id) === String(id));

    if (!menu) {
        document.title = 'Menu tidak ditemukan';
        body.innerHTML = `
            <div class="section-card">
                <h3>Menu tidak ditemukan</h3>
                <p class="optional-subtitle">Menu ini mungkin sudah dihapus oleh kasir.</p>
            </div>`;
        const btn = document.querySelector('.cart-btn');
        if (btn) btn.disabled = true;
        return;
    }

    document.title = 'Detail Menu - ' + menu.nama;

    if (menu.habis) {
        body.innerHTML = `
            <div class="section-card">
                <h3>${escHtml(menu.nama)} sedang habis</h3>
                <p class="optional-subtitle">Mohon maaf, menu ini sedang tidak tersedia.</p>
            </div>`;
        const btnHabis = document.querySelector('.cart-btn');
        if (btnHabis) btnHabis.disabled = true;
        return;
    }

    const ukuran = menu.ukuran || [];
    const addon = menu.addon || [];
    const aktif = ukuran[0];

    const ukuranHtml = ukuran.map((u, i) => `
        <button type="button" class="size-box${i === 0 ? ' active' : ''}" aria-pressed="${i === 0 ? 'true' : 'false'}">
            <span class="size-name">${escHtml(u.nama)}</span>
            <span class="size-pcs">${escHtml(u.porsi || u.ket || '1 porsi')}</span>
            <span class="size-price">${rupiah(u.harga)}</span>
        </button>`).join('');

    let tambahanHtml = '';
    if (addon.length || menu.gratis) {
        const badge = menu.gratis ? `<span class="badge-free">${escHtml(menu.gratis)}</span>` : '';
        const subtitle = menu.gratis
            ? `${escHtml(menu.gratis)} sudah termasuk dalam porsi.`
            : 'Pilih tambahan sesuai selera.';
        const addonHtml = addon.map(a => `
            <label class="addon-item">
                <span class="addon-label">
                    <span>${escHtml(a.nama)}</span>
                    <span class="addon-price">+${rupiah(a.harga)}</span>
                </span>
                <input type="checkbox" class="checkbox-custom">
            </label>`).join('');

        tambahanHtml = `
        <section class="section-card">
            <div class="optional-header">
                <h3>Tambahan opsional</h3>
                ${badge}
            </div>
            <p class="optional-subtitle">${subtitle}</p>
            ${addonHtml}
        </section>`;
    }

    const deskripsi = menu.deskripsi ? `<p>${escHtml(menu.deskripsi)}</p>` : '';

    body.innerHTML = `
        <div class="product-banner">
            <div class="image-wrapper">
                <img src="${escHtml(safeImgSrc(menu.img, DETAIL_DEFAULT_IMG))}" alt="${escHtml(menu.nama)}" width="600" height="360" fetchpriority="high">
            </div>
        </div>

        <div class="product-info">
            <h2>${escHtml(menu.nama)}</h2>
            ${deskripsi}
        </div>

        <section class="section-card">
            <h3>Pilih ukuran porsi</h3>
            <div class="size-options">${ukuranHtml}</div>
        </section>

        ${tambahanHtml}

        <section class="section-card">
            <div class="qty-container">
                <div class="qty-label-group">
                    <h3>Jumlah porsi</h3>
                    <div class="qty-controls">
                        <button type="button" class="qty-btn minus" aria-label="Kurangi jumlah porsi"><i class="fa-solid fa-minus" aria-hidden="true"></i></button>
                        <span class="qty-value">1 porsi</span>
                        <button type="button" class="qty-btn plus" aria-label="Tambah jumlah porsi"><i class="fa-solid fa-plus" aria-hidden="true"></i></button>
                    </div>
                </div>
                <span class="qty-pcs-info">${escHtml(aktif ? (aktif.porsi || aktif.ket || '1 porsi') : '')}/porsi</span>
            </div>
        </section>

        <section class="section-card">
            <h3><label for="detailNoteInput">Catatan (opsional)</label></h3>
            <div class="note-input-box">
                <i class="fa-solid fa-pen" aria-hidden="true"></i>
                <input type="text" id="detailNoteInput" maxlength="200" placeholder="Tulis catatan untuk menu ini">
            </div>
        </section>

        <section class="section-card">
            <h3>Rincian harga</h3>
            <div class="price-row">
                <span>Harga porsi</span>
                <span>${rupiah(aktif ? aktif.harga : 0)}</span>
            </div>
            <div class="price-row total-sub">
                <span>Subtotal × 1 porsi</span>
                <span>${rupiah(aktif ? aktif.harga : 0)}</span>
            </div>
        </section>`;
})();

document.addEventListener('DOMContentLoaded', async function () {
    // Halaman Bakpao ditangani oleh listener khusus paket Bakpao agar tombol keranjang tidak terpicu ganda
    if (document.querySelectorAll('.variant-item').length > 0) return;

    if (window.__detailReady) {
        try { await window.__detailReady; } catch (e) { console.error(e); }
    }

    const sizeBoxes = document.querySelectorAll('.size-box');
    const minusBtn = document.querySelector('.qty-btn.minus');
    const plusBtn = document.querySelector('.qty-btn.plus');
    const qtyValueEl = document.querySelector('.qty-value');
    const priceRowSpans = document.querySelectorAll('.price-row span');
    const totalPriceEl = document.querySelector('.total-price');
    const footerMetaEl = document.querySelector('.footer-meta span');
    const qtyPcsInfoEl = document.querySelector('.qty-pcs-info');
    const checkboxes = document.querySelectorAll('.checkbox-custom');

    let currentQty = 1;
    let basePrice = 0;
    let currentPcsText = '6 pcs';

    function parseRupiah(text) {
        if (!text) return 0;
        return parseInt(text.replace(/[^0-9]/g, ''), 10) || 0;
    }

    function formatRupiah(number) {
        return 'Rp' + number.toLocaleString('id-ID');
    }

    // Extra Mentai: M = Rp3.000, XL = Rp5.000, tidak tersedia untuk ukuran S
    function sesuaikanAddonMentai() {
        const activeBox = document.querySelector('.size-box.active .size-name');
        const ukuran = activeBox ? activeBox.innerText.trim().toUpperCase() : '';
        checkboxes.forEach(cb => {
            const item = cb.closest('.addon-item');
            if (!item) return;
            const nama = (item.querySelector('.addon-label span') || {}).innerText || '';
            if (!/extra mentai/i.test(nama)) return;

            const priceEl = item.querySelector('.addon-price');
            if (priceEl) priceEl.innerText = ukuran === 'XL' ? '+Rp5.000' : '+Rp3.000';

            const tidakTersedia = ukuran === 'S';
            if (tidakTersedia) cb.checked = false;
            cb.disabled = tidakTersedia;
            item.style.opacity = tidakTersedia ? '0.45' : '';
        });
    }

    function updateCalculations() {
        sesuaikanAddonMentai();
        let addonTotal = 0;
        checkboxes.forEach(cb => {
            if (cb.checked) {
                const addonItem = cb.closest('.addon-item');
                if (addonItem) {
                    const priceText = addonItem.querySelector('.addon-price').innerText;
                    addonTotal += parseRupiah(priceText);
                }
            }
        });

        const pricePerUnit = basePrice + addonTotal;
        const grandTotal = pricePerUnit * currentQty;

        if (qtyValueEl) {
            qtyValueEl.innerText = `${currentQty} porsi`;
        }

        if (priceRowSpans.length >= 4) {
            priceRowSpans[1].innerText = formatRupiah(pricePerUnit);
            priceRowSpans[2].innerText = `Subtotal × ${currentQty} porsi`;
            priceRowSpans[3].innerText = formatRupiah(grandTotal);
        }

        if (totalPriceEl) {
            totalPriceEl.innerText = formatRupiah(grandTotal);
        }
        if (footerMetaEl) {
            footerMetaEl.innerText = `${currentQty} porsi • ${currentPcsText}`;
        }
        if (qtyPcsInfoEl) {
            qtyPcsInfoEl.innerText = `${currentPcsText}/porsi`;
        }
    }

    function initActiveSize() {
        if (sizeBoxes.length === 0) return;

        const activeBox = document.querySelector('.size-box.active') || sizeBoxes[0];
        if (activeBox) {
            const priceEl = activeBox.querySelector('.size-price');
            const pcsEl = activeBox.querySelector('.size-pcs');
            if (priceEl) basePrice = parseRupiah(priceEl.innerText);
            if (pcsEl) currentPcsText = pcsEl.innerText;
        }
    }

    sizeBoxes.forEach(box => {
        if (!box.classList.contains('info-only')) {
            if (box.tagName !== 'BUTTON') {
                box.setAttribute('role', 'button');
                box.setAttribute('tabindex', '0');
            }
            box.setAttribute('aria-pressed', box.classList.contains('active') ? 'true' : 'false');
        }
        const selectSize = function () {
            sizeBoxes.forEach(b => {
                b.classList.remove('active');
                if (!b.classList.contains('info-only')) b.setAttribute('aria-pressed', 'false');
            });
            box.classList.add('active');
            box.setAttribute('aria-pressed', 'true');

            const priceEl = box.querySelector('.size-price');
            const pcsEl = box.querySelector('.size-pcs');
            if (priceEl) basePrice = parseRupiah(priceEl.innerText);
            if (pcsEl) currentPcsText = pcsEl.innerText;

            updateCalculations();
        };
        box.addEventListener('click', selectSize);
        if (box.tagName !== 'BUTTON' && !box.classList.contains('info-only')) {
            box.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    selectSize();
                }
            });
        }
    });

    if (plusBtn) {
        plusBtn.addEventListener('click', function () {
            if (currentQty < MAX_QTY) {
                currentQty++;
                updateCalculations();
            }
        });
    }

    if (minusBtn) {
        minusBtn.addEventListener('click', function () {
            if (currentQty > 1) {
                currentQty--;
                updateCalculations();
            }
        });
    }

    checkboxes.forEach(cb => {
        cb.addEventListener('change', function () {
            updateCalculations();
        });
    });

    initActiveSize();
    updateCalculations();
    const tersedia = await cekKetersediaanDetail();

    const cartBtn = document.querySelector('.cart-btn');
    if (cartBtn) {
        cartBtn.addEventListener('click', function () {
            if (cartBtn.disabled) return;
            const productTitleEl = document.querySelector('.product-info h2');
            if (!productTitleEl) return;
            const namaProduk = productTitleEl.innerText;

            const productImageEl = document.querySelector('.product-banner img');
            const produkImgSrc = productImageEl ? productImageEl.src : '';

            const activeSizeBox = document.querySelector('.size-box.active');
            const ukuranPorsi = activeSizeBox ? activeSizeBox.querySelector('.size-name').innerText : 'M';
            const pcsInfo = activeSizeBox ? activeSizeBox.querySelector('.size-pcs').innerText : '6 pcs';

            let daftarAddon = [];
            checkboxes.forEach(cb => {
                if (cb.checked) {
                    const addonItem = cb.closest('.addon-item');
                    if (addonItem) {
                        const addonName = addonItem.querySelector('.addon-label span').innerText;
                        daftarAddon.push(addonName);
                    }
                }
            });

            const inputCatatan = document.querySelector('.note-input-box input');
            const catatanTeks = inputCatatan ? inputCatatan.value.trim() : '';

            const totalHargaText = totalPriceEl ? totalPriceEl.innerText : 'Rp26.000';
            const hargaAngka = parseRupiah(totalHargaText);
            const jumlahPorsi = currentQty || 1;

            let detailVarianText = `${ukuranPorsi} (${pcsInfo})`;
            if (daftarAddon.length > 0) {
                detailVarianText += ` + ${daftarAddon.join(', ')}`;
            }

            const itemBaru = {
                nama: namaProduk,
                varian: detailVarianText,
                catatan: catatanTeks,
                qty: jumlahPorsi,
                harga: hargaAngka,
                hargaFormatted: totalHargaText,
                imgSrc: produkImgSrc
            };

            let keranjang = [];
            try {
                const parsed = JSON.parse(localStorage.getItem('sabangdor_cart'));
                if (Array.isArray(parsed)) keranjang = parsed;
            } catch (e) {}
            keranjang.push(itemBaru);

            localStorage.setItem('sabangdor_cart', JSON.stringify(keranjang));
            localStorage.setItem('buka_popup_keranjang', 'true');

            window.location.href = 'index.html';
        });
    }
});

// Logika paket hemat Bakpao
document.addEventListener('DOMContentLoaded', async function () {
    const variantItems = document.querySelectorAll('.variant-item');
    if (variantItems.length === 0) return;

    const PACKS = [
        { pcs: 6, price: 36000 },
        { pcs: 3, price: 20000 },
        { pcs: 1, price: 7000 }
    ];

    const breakdownEl = document.getElementById('price-breakdown');
    const subtotalEl = document.getElementById('subtotal-text');
    const totalPriceEl = document.querySelector('.total-price');
    const footerMetaEl = document.getElementById('footer-meta-text');
    const cartBtn = document.querySelector('.cart-btn');

    if (!cartBtn) return;

    let bakpaoTersedia = true;
    const qty = {};
    variantItems.forEach(item => { qty[item.dataset.name] = 0; });

    function formatRupiah(n) {
        return 'Rp' + n.toLocaleString('id-ID');
    }

    function bestPrice(n) {
        const cost = [0];
        const choice = [null];
        for (let i = 1; i <= n; i++) {
            cost[i] = Infinity;
            PACKS.forEach(p => {
                if (i >= p.pcs && cost[i - p.pcs] + p.price < cost[i]) {
                    cost[i] = cost[i - p.pcs] + p.price;
                    choice[i] = p;
                }
            });
        }
        const used = {};
        let i = n;
        while (i > 0) {
            const p = choice[i];
            if (p) {
                used[p.pcs] = (used[p.pcs] || 0) + 1;
                i -= p.pcs;
            } else {
                break;
            }
        }
        return { total: cost[n], used };
    }

    function render() {
        let totalPcs = 0;
        variantItems.forEach(item => {
            const q = qty[item.dataset.name] || 0;
            totalPcs += q;
            const qtyValEl = item.querySelector('.qty-value');
            if (qtyValEl) qtyValEl.innerText = q;
            const minusBtn = item.querySelector('.minus');
            if (minusBtn) minusBtn.disabled = q === 0;
            item.classList.toggle('selected', q > 0);
        });

        if (totalPcs === 0) {
            if (breakdownEl) breakdownEl.innerHTML = '<p class="addon-note">Belum ada bakpao dipilih.</p>';
            if (subtotalEl) subtotalEl.innerText = formatRupiah(0);
            if (totalPriceEl) totalPriceEl.innerText = formatRupiah(0);
            if (footerMetaEl) footerMetaEl.innerText = 'Belum ada bakpao dipilih';
            if (cartBtn) cartBtn.disabled = true;
            return;
        }

        const { total, used } = bestPrice(totalPcs);

        let html = '';
        PACKS.forEach(p => {
            if (used[p.pcs]) {
                const totalPackPrice = p.price * used[p.pcs];
                html += `<div class="price-row"><span>Paket ${p.pcs} pcs × ${used[p.pcs]}</span><span>${formatRupiah(totalPackPrice)}</span></div>`;
            }
        });
        if (breakdownEl) breakdownEl.innerHTML = html;

        if (subtotalEl) subtotalEl.innerText = formatRupiah(total);
        if (totalPriceEl) totalPriceEl.innerText = formatRupiah(total);
        if (footerMetaEl) footerMetaEl.innerText = `${totalPcs} pcs bakpao`;
        if (cartBtn) cartBtn.disabled = !bakpaoTersedia;
    }

    variantItems.forEach(item => {
        const name = item.dataset.name;
        const plusBtn = item.querySelector('.plus');
        const minusBtn = item.querySelector('.minus');

        if (plusBtn) {
            plusBtn.addEventListener('click', () => {
                const totalSaatIni = Object.values(qty).reduce((s, v) => s + v, 0);
                if (totalSaatIni >= MAX_QTY) return;
                qty[name] = (qty[name] || 0) + 1;
                render();
            });
        }
        if (minusBtn) {
            minusBtn.addEventListener('click', () => {
                if (qty[name] > 0) {
                    qty[name]--;
                    render();
                }
            });
        }
    });

    if (cartBtn) {
        cartBtn.addEventListener('click', function () {
            if (cartBtn.disabled || !bakpaoTersedia) return;
            const picked = Object.keys(qty).filter(n => qty[n] > 0);
            if (picked.length === 0) return;

            const totalPcs = picked.reduce((s, n) => s + qty[n], 0);
            const varian = picked.map(n => `${qty[n]}x ${n}`).join(', ');
            const totalText = totalPriceEl ? totalPriceEl.innerText : 'Rp0';
            const imgEl = document.querySelector('.product-banner img');
            const noteInput = document.querySelector('.note-input-box input');
            const catatan = noteInput ? noteInput.value.trim().slice(0, 200) : '';

            const itemBaru = {
                nama: 'Bakpao',
                varian: `${totalPcs} pcs: ${varian}`,
                catatan: catatan,
                qty: 1,
                harga: parseInt(totalText.replace(/[^0-9]/g, ''), 10) || 0,
                hargaFormatted: totalText,
                imgSrc: imgEl ? imgEl.src : ''
            };

            let keranjang = [];
            try {
                const parsed = JSON.parse(localStorage.getItem('sabangdor_cart'));
                if (Array.isArray(parsed)) keranjang = parsed;
            } catch (e) {}
            keranjang.push(itemBaru);
            localStorage.setItem('sabangdor_cart', JSON.stringify(keranjang));
            localStorage.setItem('buka_popup_keranjang', 'true');

            window.location.href = 'index.html';
        });
    }

    render();
    bakpaoTersedia = await cekKetersediaanDetail();
    if (!bakpaoTersedia && cartBtn) cartBtn.disabled = true;
});

// EVENT LISTENER TOMBOL KEMBALI
document.addEventListener('DOMContentLoaded', function () {
    const backBtn = document.querySelector('.back-btn');
    if (!backBtn) return;

    backBtn.addEventListener('click', function () {
        const cameFromSameSite = document.referrer &&
            new URL(document.referrer).origin === window.location.origin;

        if (window.history.length > 1 && cameFromSameSite) {
            window.history.back();
        } else {
            window.location.href = 'index.html';
        }
    });
}); 

