// ==========================================
// MENU TAMBAHAN: isi halaman detail dibuat otomatis dari data kasir
// Hanya aktif di detail-menu-custom.html?id=... (butuh menu-custom-store.js).
// Harus di paling atas agar markup sudah ada sebelum logika harga di bawah berjalan.
// ==========================================
(function () {
    const body = document.getElementById('content-body');
    if (!body || typeof getCustomMenus !== 'function') return; // bukan halaman detail menu tambahan
    const id = new URLSearchParams(window.location.search).get('id');
    const menu = getCustomMenus().find(m => m.id === id);

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

    const ukuran = menu.ukuran || [];
    const addon = menu.addon || [];
    const aktif = ukuran[0];

    const ukuranHtml = ukuran.map((u, i) => `
        <div class="size-box${i === 0 ? ' active' : ''}">
            <span class="size-name">${escHtml(u.nama)}</span>
            <span class="size-pcs">${escHtml(u.ket || '1 porsi')}</span>
            <span class="size-price">${rupiah(u.harga)}</span>
        </div>`).join('');

    let tambahanHtml = '';
    if (addon.length || menu.gratis) {
        const badge = menu.gratis ? `<span class="badge-free">${escHtml(menu.gratis)}</span>` : '';
        const subtitle = menu.gratis
            ? `${escHtml(menu.gratis)} sudah termasuk dalam porsi.`
            : 'Pilih tambahan sesuai selera.';
        const addonHtml = addon.map(a => `
            <div class="addon-item">
                <div class="addon-label">
                    <span>${escHtml(a.nama)}</span>
                    <span class="addon-price">+${rupiah(a.harga)}</span>
                </div>
                <input type="checkbox" class="checkbox-custom">
            </div>`).join('');

        tambahanHtml = `
        <div class="section-card">
            <div class="optional-header">
                <h3>Tambahan opsional</h3>
                ${badge}
            </div>
            <p class="optional-subtitle">${subtitle}</p>
            ${addonHtml}
        </div>`;
    }

    const deskripsi = menu.deskripsi ? `<p>${escHtml(menu.deskripsi)}</p>` : '';

    body.innerHTML = `
        <div class="product-banner">
            <div class="yellow-circle"></div>
            <div class="image-wrapper">
                <img src="${menu.img || DEFAULT_MENU_IMG}" alt="${escHtml(menu.nama)}">
            </div>
        </div>

        <div class="product-info">
            <h2>${escHtml(menu.nama)}</h2>
            ${deskripsi}
        </div>

        <div class="section-card">
            <h3>Pilih ukuran porsi</h3>
            <div class="size-options">${ukuranHtml}</div>
        </div>

        ${tambahanHtml}

        <div class="section-card">
            <div class="qty-container">
                <div class="qty-label-group">
                    <h3>Jumlah porsi</h3>
                    <div class="qty-controls">
                        <button class="qty-btn minus"><i class="fa-solid fa-minus"></i></button>
                        <span class="qty-value">1 porsi</span>
                        <button class="qty-btn plus"><i class="fa-solid fa-plus"></i></button>
                    </div>
                </div>
                <span class="qty-pcs-info">${escHtml(aktif ? (aktif.ket || '1 porsi') : '')}/porsi</span>
            </div>
        </div>

        <div class="section-card">
            <h3>Catatan (opsional)</h3>
            <div class="note-input-box">
                <i class="fa-solid fa-pen"></i>
                <input type="text" placeholder="Tulis catatan untuk menu ini">
            </div>
        </div>

        <div class="section-card">
            <h3>Rincian harga</h3>
            <div class="price-row">
                <span>Harga porsi</span>
                <span>${rupiah(aktif ? aktif.harga : 0)}</span>
            </div>
            <div class="price-row total-sub">
                <span>Subtotal × 1 porsi</span>
                <span>${rupiah(aktif ? aktif.harga : 0)}</span>
            </div>
        </div>`;
})();

document.addEventListener('DOMContentLoaded', function () {
    // 1. Ambil semua elemen HTML yang dibutuhkan
    const sizeBoxes = document.querySelectorAll('.size-box');
    const minusBtn = document.querySelector('.qty-btn.minus');
    const plusBtn = document.querySelector('.qty-btn.plus');
    const qtyValueEl = document.querySelector('.qty-value');
    const priceRowSpans = document.querySelectorAll('.price-row span');
    const totalPriceEl = document.querySelector('.total-price');
    const footerMetaEl = document.querySelector('.footer-meta span');
    const qtyPcsInfoEl = document.querySelector('.qty-pcs-info');
    const checkboxes = document.querySelectorAll('.checkbox-custom');

    // Variable State
    let currentQty = 1;
    let basePrice = 0;
    let currentPcsText = '6 pcs';

    // Helper: Mengubah string Rupiah (contoh "Rp18.000") menjadi angka integer (18000)
    function parseRupiah(text) {
        if (!text) return 0;
        return parseInt(text.replace(/[^0-9]/g, ''), 10) || 0;
    }

    // Helper: Mengubah angka integer (18000) menjadi format Rupiah ("Rp18.000")
    function formatRupiah(number) {
        return 'Rp' + number.toLocaleString('id-ID');
    }

    // Fungsi Utama: Menghitung ulang seluruh total harga & tampilan teks
    function updateCalculations() {
        // A. Hitung total harga tambahan opsional (Checkbox)
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

        // B. Hitung harga per 1 porsi (Harga Dasar Porsi + Addon)
        const pricePerUnit = basePrice + addonTotal;

        // C. Hitung Total Keseluruhan (Harga per Porsi x Jumlah Porsi)
        const grandTotal = pricePerUnit * currentQty;

        // D. Update Teks Tampilan Jumlah Porsi
        if (qtyValueEl) {
            qtyValueEl.innerText = `${currentQty} porsi`;
        }

        // E. Update Tabel Rincian Harga
        if (priceRowSpans.length >= 4) {
            priceRowSpans[1].innerText = formatRupiah(pricePerUnit); // Harga porsi (+ addon jika ada)
            priceRowSpans[2].innerText = `Subtotal × ${currentQty} porsi`; // Teks Subtotal
            priceRowSpans[3].innerText = formatRupiah(grandTotal); // Total Subtotal
        }

        // F. Update Teks Sticky Footer
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

    // Fungsi untuk inisialisasi data dari porsi yang sedang aktif (.active)
    function initActiveSize() {
        if (sizeBoxes.length === 0) return; // Lewati jika tidak ada elemen size-box (seperti di halaman Bakpao)

        const activeBox = document.querySelector('.size-box.active') || sizeBoxes[0];
        if (activeBox) {
            const priceEl = activeBox.querySelector('.size-price');
            const pcsEl = activeBox.querySelector('.size-pcs');
            if (priceEl) basePrice = parseRupiah(priceEl.innerText);
            if (pcsEl) currentPcsText = pcsEl.innerText;
        }
    }

    // --- EVENT LISTENERS ---

    // 2. Event Listener: Klik Opsi Ukuran Porsi (S, M, XL)
    sizeBoxes.forEach(box => {
        box.addEventListener('click', function () {
            sizeBoxes.forEach(b => b.classList.remove('active'));
            this.classList.add('active');

            const priceEl = this.querySelector('.size-price');
            const pcsEl = this.querySelector('.size-pcs');
            if (priceEl) basePrice = parseRupiah(priceEl.innerText);
            if (pcsEl) currentPcsText = pcsEl.innerText;

            updateCalculations();
        });
    });

    // 3. Event Listener: Tombol Plus (Increment)
    if (plusBtn) {
        plusBtn.addEventListener('click', function () {
            currentQty++;
            updateCalculations();
        });
    }

    // 4. Event Listener: Tombol Minus (Decrement)
    if (minusBtn) {
        minusBtn.addEventListener('click', function () {
            if (currentQty > 1) { // Batas minimal 1 porsi
                currentQty--;
                updateCalculations();
            }
        });
    }

    // 5. Event Listener: Checkbox Tambahan Opsional
    checkboxes.forEach(cb => {
        cb.addEventListener('change', function () {
            updateCalculations();
        });
    });

    // Jalankan kalkulasi pertama kali saat halaman di-load
    initActiveSize();
    updateCalculations();

    const cartBtn = document.querySelector('.cart-btn');
    if (cartBtn) {
        cartBtn.addEventListener('click', function () {
<<<<<<< HEAD
            const namaProduk = document.querySelector('.product-info h2').innerText;
=======
            const productTitleEl = document.querySelector('.product-info h2');
            if (!productTitleEl) return;
            const namaProduk = productTitleEl.innerText;
>>>>>>> 37f1ff35d87754fc6f9f81685c5b529525d4dfdb

            // --- AMBIL LINK GAMBAR DARI HALAMAN DETAIL ---
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
                imgSrc: produkImgSrc // Menyimpan link gambar
            };

            let keranjang = JSON.parse(localStorage.getItem('sabangdor_cart')) || [];
            keranjang.push(itemBaru);

            localStorage.setItem('sabangdor_cart', JSON.stringify(keranjang));
            localStorage.setItem('buka_popup_keranjang', 'true');

            window.location.href = 'index.html';
        });
    }
});

// LOGIKA PAKET BAKPAO
document.addEventListener('DOMContentLoaded', function () {
    const variantItems = document.querySelectorAll('.variant-item');
    if (variantItems.length === 0) return; // Jika bukan halaman bakpao, lewati

    // Harga paket (sesuai menu): pcs -> harga
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

    if (!cartBtn) return; // Jika bukan halaman bakpao, abaikan

    const qty = {};
    variantItems.forEach(item => { qty[item.dataset.name] = 0; });

    function formatRupiah(n) {
        return 'Rp' + n.toLocaleString('id-ID');
    }

    // Hitung kombinasi paket termurah untuk n pcs (DP)
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
                html += `<div class="price-row"><span>Paket ${p.pcs} pcs × ${used[p.pcs]}</span><span>${formatRupiah(p.price * used[p.pcs])}</span></div>`;
            }
        });
        if (breakdownEl) breakdownEl.innerHTML = html;

        if (subtotalEl) subtotalEl.innerText = formatRupiah(total);
        if (totalPriceEl) totalPriceEl.innerText = formatRupiah(total);
        if (footerMetaEl) footerMetaEl.innerText = `${totalPcs} pcs bakpao`;
        if (cartBtn) cartBtn.disabled = false;
    }

    variantItems.forEach(item => {
        const name = item.dataset.name;
        const plusBtn = item.querySelector('.plus');
        const minusBtn = item.querySelector('.minus');

        if (plusBtn) {
            plusBtn.addEventListener('click', () => {
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
            const picked = Object.keys(qty).filter(n => qty[n] > 0);
            if (picked.length === 0) return;

            const totalPcs = picked.reduce((s, n) => s + qty[n], 0);
            const varian = picked.map(n => `${qty[n]}x ${n}`).join(', ');
            const totalText = totalPriceEl ? totalPriceEl.innerText : 'Rp0';
            const imgEl = document.querySelector('.product-banner img');
            const noteInput = document.querySelector('.note-input-box input');
            const catatan = noteInput ? noteInput.value.trim() : '';

            const itemBaru = {
                nama: 'Bakpao',
                varian: `${totalPcs} pcs: ${varian}`,
                catatan: catatan,
                qty: 1,
                harga: parseInt(totalText.replace(/[^0-9]/g, ''), 10) || 0,
                hargaFormatted: totalText,
                imgSrc: imgEl ? imgEl.src : ''
            };

            const keranjang = JSON.parse(localStorage.getItem('sabangdor_cart')) || [];
            keranjang.push(itemBaru);
            localStorage.setItem('sabangdor_cart', JSON.stringify(keranjang));
            localStorage.setItem('buka_popup_keranjang', 'true');

            window.location.href = 'index.html';
        });
    }

    render();
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
});//zero