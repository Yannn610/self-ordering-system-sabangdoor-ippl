/**
 * File: script-pembayaran.js
 * Alur checkout, integrasi Supabase atomik buat_pesanan(), serta:
 * - PB-028 & PB-038: Validasi nama pemesan (2-50 char, wajib mengandung huruf)
 * - PB-030: Pesan galat bahasa Indonesia/Inggris yang jelas
 * - PB-035: Rate limiter per perangkat + tantangan anti-bot lokal
 * - PB-044 & PB-050: Tautan lacak status pesanan + estimasi waktu tunggu
 * - PB-066: Voucher & diskon (preview + otoritatif di server)
 * - PB-069: Unggah tangkapan layar bukti bayar QRIS (opsional, validasi 5 MB)
 * - PB-071: Simpan riwayat pesanan di perangkat pembeli
 * - PB-072: Dukungan dua bahasa ID/EN
 * - PB-074: Program loyalitas poin (nomor HP opsional, cek saldo, tukar 10 poin = Rp5.000)
 * - PB-075: Pre-order & jadwal ambil dengan kuota per slot
 */

const CART_KEY = "sabangdor_cart";
const QRIS_STORAGE_KEY = "sabangdor_custom_qris";
const LAST_ORDER_KEY = "sabangdor_last_order";
const BUYER_HISTORY_KEY = "sabangdor_buyer_history";

const formatRupiah = (n) => "Rp" + Math.round(Number(n) || 0).toLocaleString("id-ID");
const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
const tr = (k, fb) => (window.SabangdorI18n ? window.SabangdorI18n.t(k, fb) : (fb || k));

let currentStep = "checkout"; // 'checkout' | 'qris' | 'sukses'
let cartData = [];
let namaPembeli = "";
let selectedPayment = "cash"; // 'cash' | 'qris'
let createdOrderData = null;
let estimatedWait = null;

// PB-066 Voucher state
let voucherInput = "";
let appliedVoucher = null; // { kode, diskon, pesan }

// PB-074 Loyalty state
let phoneInput = "";
let loyaltyInfo = null; // { no_hp, poin, dapat_tukar }
let tukarPoinChecked = false;

// PB-075 Pre-order state
let pickupMode = "now"; // 'now' | 'preorder'
let preorderSlots = [];
let selectedPreorderIso = "";

// PB-069 Bukti QRIS state
let buktiQrisDataUrl = "";

// PB-035 Anti-bot challenge state
let currentChallenge = null;
let challengeAnswerInput = "";

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

function getPricingBreakdown() {
    const subtotal = cartData.reduce((sum, i) => sum + (Number(i.harga) || 0), 0);
    const diskonVoucher = appliedVoucher ? Math.min(subtotal, Math.max(0, Number(appliedVoucher.diskon) || 0)) : 0;
    const diskonPoin = (tukarPoinChecked && loyaltyInfo && loyaltyInfo.dapat_tukar)
        ? Math.min(5000, Math.max(0, subtotal - diskonVoucher))
        : 0;
    const total = Math.max(0, subtotal - diskonVoucher - diskonPoin);
    return { subtotal, diskonVoucher, diskonPoin, total };
}

function captureCurrentInputs() {
    const namaEl = document.getElementById("inputNamaPembeli");
    if (namaEl) namaPembeli = namaEl.value;
    const hpEl = document.getElementById("inputNoHp");
    if (hpEl) phoneInput = hpEl.value;
    const vEl = document.getElementById("inputVoucherCode");
    if (vEl) voucherInput = vEl.value;
    const cEl = document.getElementById("inputChallengeAnswer");
    if (cEl) challengeAnswerInput = cEl.value;
}

async function muatSlotPreorder() {
    const client = window.supabaseClient;
    if (!client || typeof client.rpc !== "function") return;
    try {
        const { data, error } = await client.rpc("get_slot_preorder");
        if (!error && data && data.aktif && Array.isArray(data.slots)) {
            preorderSlots = data.slots;
            if (!selectedPreorderIso) {
                const avail = preorderSlots.find(s => Number(s.sisa) > 0);
                if (avail) selectedPreorderIso = avail.iso;
            }
        }
    } catch (e) {}
}

async function muatEstimasiTunggu() {
    const client = window.supabaseClient;
    if (!client || typeof client.rpc !== "function") return;
    try {
        const { data, error } = await client.rpc("get_estimasi_tunggu");
        if (!error && data && data.estimasi_menit) estimatedWait = data;
    } catch (e) {}
}

document.addEventListener("DOMContentLoaded", async () => {
    if (window.SabangdorI18n) window.SabangdorI18n.renderSwitcher("#langHost");
    cartData = loadCart();

    if (window.SabangdorSettings) await window.SabangdorSettings.muat();

    if (cartData.length === 0) {
        try {
            const last = JSON.parse(sessionStorage.getItem(LAST_ORDER_KEY));
            if (last && last.nomor_antrean) {
                createdOrderData = last;
                await muatEstimasiTunggu();
                currentStep = "sukses";
                renderStep();
                return;
            }
        } catch (e) {}

        alert("Keranjang belanja kosong! Mengalihkan ke menu utama.");
        window.location.href = "index.html";
        return;
    }

    const tokoTutup = localStorage.getItem("sabangdor_status_toko") === "tutup";
    const preCfg = window.SabangdorSettings ? window.SabangdorSettings.getPreorderConfig() : { aktif: true };
    if (preCfg && preCfg.aktif) {
        await muatSlotPreorder();
    }

    if (tokoTutup) {
        // Jika toko tutup tapi ada slot pre-order tersedia, arahkan otomatis ke mode Pre-order
        if (preorderSlots.some(s => Number(s.sisa) > 0)) {
            pickupMode = "preorder";
        } else {
            alert("Mohon maaf, toko saat ini sedang TUTUP. Anda akan diarahkan kembali ke halaman utama.");
            window.location.href = "index.html";
            return;
        }
    }

    // PB-035: Siapkan tantangan verifikasi manusia bila perangkat sudah memesan baru-baru ini
    if (window.SabangdorValidation) {
        const rate = window.SabangdorValidation.checkDeviceRateLimit();
        if (rate.needChallenge) {
            currentChallenge = window.SabangdorValidation.generateHumanChallenge();
        }
    }

    renderStep();
    window.addEventListener("sabangdor:langchange", () => {
        captureCurrentInputs();
        renderStep();
    });
});

function renderStep() {
    document.body.setAttribute("data-step", currentStep);
    const mainContent = document.getElementById("mainContent");
    const footerArea = document.getElementById("footerArea");
    const pageTitle = document.getElementById("pageTitle");
    const backBtn = document.getElementById("backBtn");
    const metaEl = document.getElementById("orderInfoMeta");

    const { subtotal, diskonVoucher, diskonPoin, total } = getPricingBreakdown();
    const totalQty = cartData.reduce((sum, i) => sum + (Number(i.qty) || 0), 0);

    if (metaEl) metaEl.textContent = `${totalQty} Item • Total ${formatRupiah(total)}`;

    if (currentStep === "checkout") {
        pageTitle.textContent = tr("checkout_title", "Checkout");
        backBtn.onclick = null;
        backBtn.href = "keranjang.html";

        const tokoTutup = localStorage.getItem("sabangdor_status_toko") === "tutup";
        const availSlots = preorderSlots.filter(s => Number(s.sisa) > 0);
        const showPreorderCard = preorderSlots.length > 0;

        const preorderHtml = showPreorderCard ? `
            <div class="card-pembayaran">
                <h2 class="pay-card-title">${esc(tr("pickup_mode_title", "Waktu Pengambilan"))}</h2>
                <div class="payment-options">
                    ${!tokoTutup ? `
                    <label class="pay-option-label ${pickupMode === 'now' ? 'selected' : ''}">
                        <span class="pay-option-text">
                            <b>${esc(tr("pickup_now", "Ambil Sekarang"))}</b>
                            <small>${esc(tr("pickup_now_desc", "Pesanan langsung diproses setelah verifikasi kasir"))}</small>
                        </span>
                        <input type="radio" name="pickupMode" value="now" ${pickupMode === 'now' ? 'checked' : ''} onchange="pilihPickupMode('now')">
                    </label>` : ''}
                    <label class="pay-option-label ${pickupMode === 'preorder' ? 'selected' : ''}">
                        <span class="pay-option-text">
                            <b>${esc(tr("pickup_preorder", "Pre-order (Jadwal Ambil)"))}</b>
                            <small>${esc(tr("pickup_preorder_desc", "Pilih jam pengambilan sesuai jadwal operasional"))}</small>
                        </span>
                        <input type="radio" name="pickupMode" value="preorder" ${pickupMode === 'preorder' ? 'checked' : ''} onchange="pilihPickupMode('preorder')">
                    </label>
                </div>
                ${pickupMode === 'preorder' ? `
                    <div style="margin-top:12px;">
                        <label for="selectPreorderSlot" class="field-head">${esc(tr("select_slot", "Pilih Jam Ambil"))}</label>
                        ${availSlots.length > 0 ? `
                            <select id="selectPreorderSlot" class="input-nama" onchange="pilihSlotPreorder(this.value)">
                                ${preorderSlots.map(s => `
                                    <option value="${esc(s.iso)}" ${s.iso === selectedPreorderIso ? 'selected' : ''} ${Number(s.sisa) <= 0 ? 'disabled' : ''}>
                                        ${esc(s.label)} WIB (${Number(s.sisa) > 0 ? `sisa kuota ${s.sisa}` : 'Penuh'})
                                    </option>
                                `).join('')}
                            </select>
                        ` : `<p class="inline-error show">Tidak ada slot pre-order tersisa untuk hari ini.</p>`}
                    </div>
                ` : ''}
            </div>
        ` : '';

        const loyaltyStatusHtml = loyaltyInfo ? `
            <div style="margin-top:8px; padding:10px 12px; background:#ECFDF5; border:1px solid #A7F3D0; border-radius:10px; font-size:0.8125rem; color:#047857;">
                <div>Saldo poin (${esc(loyaltyInfo.no_hp)}): <strong>${loyaltyInfo.poin} poin</strong></div>
                ${loyaltyInfo.dapat_tukar ? `
                    <label style="display:flex; align-items:center; gap:8px; margin-top:6px; font-weight:700; cursor:pointer;">
                        <input type="checkbox" id="chkTukarPoin" ${tukarPoinChecked ? 'checked' : ''} onchange="toggleTukarPoin(this.checked)">
                        <span>${esc(tr("redeem_points_label", "Tukar 10 poin untuk potongan Rp5.000"))}</span>
                    </label>
                ` : `<div style="margin-top:4px; color:var(--text-muted);">Kumpulkan 10 poin untuk potongan Rp5.000 (1 poin per Rp10.000).</div>`}
            </div>
        ` : '';

        const voucherStatusHtml = appliedVoucher ? `
            <div style="margin-top:8px; padding:10px 12px; background:#ECFDF5; border:1px solid #A7F3D0; border-radius:10px; font-size:0.8125rem; color:#047857; display:flex; justify-content:space-between; align-items:center; gap:8px;">
                <span>Voucher <strong>${esc(appliedVoucher.kode)}</strong> aktif (-${formatRupiah(appliedVoucher.diskon)})</span>
                <button type="button" class="btn btn--secondary" style="width:auto; min-height:36px; padding:4px 10px; font-size:0.75rem;" onclick="hapusVoucher()">${esc(tr("remove_voucher", "Hapus"))}</button>
            </div>
        ` : '';

        const challengeHtml = currentChallenge ? `
            <div class="card-pembayaran">
                <h2 class="pay-card-title">${esc(tr("security_check_title", "Verifikasi Keamanan"))}</h2>
                <label for="inputChallengeAnswer" class="field-head">
                    ${esc(window.SabangdorI18n && window.SabangdorI18n.getLang() === 'en' ? currentChallenge.questionEn : currentChallenge.question)}
                </label>
                <input type="number" id="inputChallengeAnswer" class="input-nama" inputmode="numeric" placeholder="Tulis jawaban angka" value="${esc(challengeAnswerInput)}">
            </div>
        ` : '';

        mainContent.innerHTML = `
            <div class="card-pembayaran">
                <h2 class="pay-card-title">${esc(tr("customer_info", "Data Pemesan"))}</h2>
                <label for="inputNamaPembeli" class="field-head">${esc(tr("customer_name_label", "Nama Lengkap / Panggilan"))}</label>
                <input type="text" id="inputNamaPembeli" class="input-nama" maxlength="50" autocomplete="name" placeholder="${esc(tr("customer_name_placeholder", "Masukkan nama pemesan"))}" value="${esc(namaPembeli)}">

                <!-- Honeypot anti-bot tersembunyi (PB-035) -->
                <div style="position:absolute; left:-9999px;" aria-hidden="true">
                    <label for="hpWebsite">Website</label>
                    <input type="text" id="hpWebsite" tabindex="-1" autocomplete="off">
                </div>

                <!-- PB-074: Nomor HP opsional untuk poin loyalitas -->
                <div style="margin-top:14px;">
                    <label for="inputNoHp" class="field-head">${esc(tr("phone_loyalty_label", "Nomor HP (Opsional - Kumpulkan/Tukar Poin)"))}</label>
                    <div style="display:flex; gap:8px;">
                        <input type="tel" id="inputNoHp" class="input-nama" maxlength="16" placeholder="${esc(tr("phone_loyalty_placeholder", "Contoh: 081234567890"))}" value="${esc(phoneInput)}" style="flex:1;">
                        <button type="button" class="btn btn--secondary" style="width:auto; padding:0 14px;" onclick="cekPoinPembeli()">${esc(tr("check_points", "Cek Poin"))}</button>
                    </div>
                    ${loyaltyStatusHtml}
                </div>

                <p id="checkoutErrorMsg" class="inline-error" role="alert"></p>
            </div>

            ${preorderHtml}

            <div class="card-pembayaran">
                <h2 class="pay-card-title">${esc(tr("order_details", "Rincian Pesanan"))}</h2>
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

                <!-- PB-066: Kode Voucher / Promo -->
                <div style="margin-top:14px; padding-top:12px; border-top:1px dashed var(--border-line);">
                    <label for="inputVoucherCode" class="field-head">${esc(tr("voucher_label", "Kode Promo / Voucher (Opsional)"))}</label>
                    <div style="display:flex; gap:8px;">
                        <input type="text" id="inputVoucherCode" class="input-nama" maxlength="32" style="flex:1; text-transform:uppercase;" placeholder="${esc(tr("voucher_placeholder", "Masukkan kode promo"))}" value="${esc(voucherInput)}">
                        <button type="button" id="btnApplyVoucher" class="btn btn--secondary" style="width:auto; padding:0 16px;" onclick="terapkanVoucher()">${esc(tr("apply_voucher", "Pakai"))}</button>
                    </div>
                    <p id="voucherMsg" class="inline-error" role="status"></p>
                    ${voucherStatusHtml}
                </div>
            </div>

            <div class="card-pembayaran">
                <h2 class="pay-card-title">${esc(tr("payment_method", "Metode Pembayaran"))}</h2>
                <div class="payment-options">
                    <label class="pay-option-label ${selectedPayment === 'cash' ? 'selected' : ''}">
                        <span class="pay-option-text">
                            <b>${esc(tr("pay_cash", "Bayar Tunai"))}</b>
                            <small>${esc(tr("pay_cash_desc", "Bayar langsung di kasir saat ambil pesanan"))}</small>
                        </span>
                        <input type="radio" name="paymentMethod" value="cash" ${selectedPayment === 'cash' ? 'checked' : ''} onchange="pilihMetode('cash')">
                    </label>
                    <label class="pay-option-label ${selectedPayment === 'qris' ? 'selected' : ''}">
                        <span class="pay-option-text">
                            <b>${esc(tr("pay_qris", "QRIS (E-Wallet / M-Banking)"))}</b>
                            <small>${esc(tr("pay_qris_desc", "Scan kode QRIS outlet setelah konfirmasi"))}</small>
                        </span>
                        <input type="radio" name="paymentMethod" value="qris" ${selectedPayment === 'qris' ? 'checked' : ''} onchange="pilihMetode('qris')">
                    </label>
                </div>
            </div>

            ${challengeHtml}
        `;

        footerArea.innerHTML = `
            ${diskonVoucher > 0 ? `<div class="footer-total" style="font-size:0.8125rem; color:#047857;"><span>${esc(tr("discount_voucher", "Diskon Voucher"))}</span><span>-${formatRupiah(diskonVoucher)}</span></div>` : ''}
            ${diskonPoin > 0 ? `<div class="footer-total" style="font-size:0.8125rem; color:#047857;"><span>${esc(tr("discount_points", "Potongan Poin"))}</span><span>-${formatRupiah(diskonPoin)}</span></div>` : ''}
            <div class="footer-total">
                <span>${esc(tr("total_bill", "Total Tagihan"))}</span>
                <b>${formatRupiah(total)}</b>
            </div>
            <button type="button" class="btn btn--primary" id="btnSubmitOrder" onclick="handleLanjutPembayaran()">
                ${esc(selectedPayment === 'qris' ? tr("btn_continue_qris", "Lanjut ke Pembayaran QRIS") : tr("btn_confirm_order", "Konfirmasi & Kirim Pesanan"))}
            </button>
        `;
    } else if (currentStep === "qris") {
        pageTitle.textContent = tr("qris_title", "Pembayaran QRIS");
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
                <h2 class="qris-title">${esc(tr("qris_scan_title", "Scan QRIS Sabangdor"))}</h2>
                <p class="qris-desc">${esc(tr("qris_scan_desc", "Buka aplikasi e-wallet atau mobile banking Anda lalu bayar sesuai total tagihan."))}</p>
                ${qrisVisualHtml}
                <div class="qris-amount-box">
                    <span>${esc(tr("qris_amount_label", "Total yang harus dibayar"))}</span>
                    <strong>${formatRupiah(total)}</strong>
                </div>

                <!-- PB-069: Unggah bukti pembayaran QRIS (opsional) -->
                <div style="margin-top:16px; text-align:left; border-top:1px dashed var(--border-line); padding-top:14px;">
                    <label for="inputBuktiQris" class="field-head">${esc(tr("qris_upload_proof", "Unggah Bukti Pembayaran QRIS (Opsional)"))}</label>
                    <p style="font-size:0.75rem; color:var(--text-muted); margin-bottom:8px;">${esc(tr("qris_upload_hint", "Tangkapan layar membantu kasir memverifikasi lebih cepat (PNG/JPG, maks 5 MB)."))}</p>
                    <input type="file" id="inputBuktiQris" accept="image/png,image/jpeg,image/webp" onchange="pilihBuktiQris(this)" style="width:100%; font-size:0.875rem;">
                    ${buktiQrisDataUrl ? `
                        <div style="margin-top:10px; text-align:center;">
                            <img src="${esc(buktiQrisDataUrl)}" alt="Pratinjau bukti bayar QRIS" style="max-width:180px; border-radius:10px; border:1px solid var(--border-line);">
                            <div style="margin-top:6px;">
                                <button type="button" class="btn btn--secondary" style="width:auto; min-height:36px; padding:4px 12px; font-size:0.75rem;" onclick="hapusBuktiQris()">Hapus Bukti</button>
                            </div>
                        </div>
                    ` : ''}
                </div>

                <p id="checkoutErrorMsg" class="inline-error" role="alert"></p>
            </div>
        `;

        footerArea.innerHTML = `
            <button type="button" id="btnKonfirmasiQris" class="btn btn--success" onclick="eksekusiSimpanPesanan()">
                ${esc(tr("btn_already_paid", "Saya Sudah Bayar"))}
            </button>
        `;
    } else if (currentStep === "sukses") {
        pageTitle.textContent = tr("order_sent_title", "Pesanan Dikirim");
        backBtn.onclick = null;
        backBtn.href = "index.html";

        const nomorAntreanFormatted = `ANT-${String(createdOrderData?.nomor_antrean || 1).padStart(2, '0')}`;
        const trackUrl = createdOrderData && createdOrderData.tracking_token
            ? `status-pesanan.html?token=${encodeURIComponent(createdOrderData.tracking_token)}`
            : 'status-pesanan.html';

        mainContent.innerHTML = `
            <div class="success-wrap">
                <div class="success-icon" aria-hidden="true">✓</div>
                <h2 class="success-title">${esc(tr("success_title", "Pesanan Berhasil Dibuat"))}</h2>
                <p class="success-desc">Pesanan atas nama <b>${esc(createdOrderData?.nama_pembeli)}</b> telah diteruskan ke kasir &amp; dapur SABANGDOR.</p>

                <div class="card-pembayaran success-receipt">
                    <div class="receipt-row">
                        <span>${esc(tr("queue_number", "Nomor Antrean"))}</span>
                        <strong class="receipt-queue">#${nomorAntreanFormatted}</strong>
                    </div>
                    <div class="receipt-row">
                        <span>${esc(tr("payment_method", "Metode Bayar"))}</span>
                        <strong>${esc((createdOrderData?.tipe_pembayaran || '').toUpperCase())}</strong>
                    </div>
                    ${Number(createdOrderData?.diskon_voucher) > 0 ? `
                    <div class="receipt-row">
                        <span>${esc(tr("discount_voucher", "Diskon Voucher"))}</span>
                        <strong style="color:#047857;">-${formatRupiah(createdOrderData.diskon_voucher)}</strong>
                    </div>` : ''}
                    ${Number(createdOrderData?.diskon_poin) > 0 ? `
                    <div class="receipt-row">
                        <span>${esc(tr("discount_points", "Potongan Poin"))}</span>
                        <strong style="color:#047857;">-${formatRupiah(createdOrderData.diskon_poin)}</strong>
                    </div>` : ''}
                    <div class="receipt-row">
                        <span>${esc(tr("total_bill", "Total Tagihan"))}</span>
                        <strong>${formatRupiah(createdOrderData?.total_harga ?? total)}</strong>
                    </div>
                    ${createdOrderData?.is_preorder && createdOrderData?.jadwal_ambil ? `
                    <div class="receipt-row">
                        <span>Jadwal Ambil Pre-order</span>
                        <strong>${esc(new Date(createdOrderData.jadwal_ambil).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }))} WIB</strong>
                    </div>` : ''}
                    ${estimatedWait && estimatedWait.estimasi_menit ? `
                    <div class="receipt-row">
                        <span>${esc(tr("est_wait_time", "Estimasi Waktu Tunggu"))}</span>
                        <strong>~${estimatedWait.estimasi_menit} menit</strong>
                    </div>` : ''}
                    <div class="receipt-row">
                        <span>${esc(tr("status_pay", "Status Bayar"))}</span>
                        <span class="badge badge--amber">${esc(tr("status_waiting_verify", "Menunggu Verifikasi Kasir"))}</span>
                    </div>
                </div>
            </div>
        `;

        footerArea.innerHTML = `
            <a href="${esc(trackUrl)}" class="btn btn--success">
                ${esc(tr("btn_track_live", "Lacak Status Pesanan"))}
            </a>
            <a href="index.html" class="btn btn--secondary">
                ${esc(tr("btn_order_more", "Pesan Menu Lain"))}
            </a>
        `;
    }
}

function tampilkanErrorCheckout(pesan) {
    const errEl = document.getElementById("checkoutErrorMsg");
    if (errEl) {
        errEl.textContent = pesan;
        errEl.classList.add("show");
        errEl.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
        alert(pesan);
    }
}

window.pilihMetode = function (tipe) {
    captureCurrentInputs();
    selectedPayment = tipe;
    renderStep();
};

window.pilihPickupMode = function (mode) {
    captureCurrentInputs();
    pickupMode = mode;
    renderStep();
};

window.pilihSlotPreorder = function (iso) {
    selectedPreorderIso = iso;
};

window.toggleTukarPoin = function (checked) {
    captureCurrentInputs();
    tukarPoinChecked = Boolean(checked);
    renderStep();
};

window.cekPoinPembeli = async function () {
    captureCurrentInputs();
    const resCheck = window.SabangdorValidation
        ? window.SabangdorValidation.validatePhoneOptional(phoneInput)
        : { valid: true, value: phoneInput.trim() };

    if (!resCheck.valid || !resCheck.value) {
        tampilkanErrorCheckout(resCheck.valid ? "Masukkan nomor HP terlebih dahulu untuk cek poin." : resCheck.message);
        return;
    }

    try {
        const { data, error } = await window.supabaseClient.rpc("cek_poin_loyalitas", { p_no_hp: resCheck.value });
        if (error) throw error;
        loyaltyInfo = {
            no_hp: (data && data.no_hp) || resCheck.value,
            poin: Number(data && data.poin) || 0,
            dapat_tukar: Boolean(data && data.dapat_tukar)
        };
        if (!loyaltyInfo.dapat_tukar) tukarPoinChecked = false;
        renderStep();
    } catch (err) {
        tampilkanErrorCheckout(window.SabangdorErrors ? window.SabangdorErrors.formatError(err, 'general') : "Gagal mengecek poin.");
    }
};

window.terapkanVoucher = async function () {
    captureCurrentInputs();
    const kode = String(voucherInput || "").trim().toUpperCase();
    const msgEl = document.getElementById("voucherMsg");
    if (!kode) {
        if (msgEl) { msgEl.textContent = "Masukkan kode voucher terlebih dahulu."; msgEl.classList.add("show"); }
        return;
    }
    const { subtotal } = getPricingBreakdown();
    try {
        const { data, error } = await window.supabaseClient.rpc("validasi_voucher", {
            p_kode: kode,
            p_subtotal: subtotal
        });
        if (error) throw error;
        if (!data || !data.valid) {
            appliedVoucher = null;
            if (msgEl) { msgEl.textContent = (data && data.pesan) || "Kode voucher tidak valid."; msgEl.classList.add("show"); }
            return;
        }
        appliedVoucher = { kode: data.kode, diskon: Number(data.diskon) || 0, pesan: data.pesan };
        voucherInput = data.kode;
        renderStep();
    } catch (err) {
        if (msgEl) {
            msgEl.textContent = window.SabangdorErrors ? window.SabangdorErrors.formatError(err, 'general') : "Gagal memeriksa voucher.";
            msgEl.classList.add("show");
        }
    }
};

window.hapusVoucher = function () {
    captureCurrentInputs();
    appliedVoucher = null;
    voucherInput = "";
    renderStep();
};

// PB-069: Validasi & kompresi bukti pembayaran QRIS (maks 5 MB, PNG/JPG/WebP)
window.pilihBuktiQris = function (input) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) {
        tampilkanErrorCheckout("File bukti bayar harus berupa gambar PNG, JPG, atau WebP.");
        input.value = "";
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        tampilkanErrorCheckout("Ukuran file bukti bayar maksimal 5 MB.");
        input.value = "";
        return;
    }

    const reader = new FileReader();
    reader.onload = function (evt) {
        const img = new Image();
        img.onload = function () {
            const maxSide = 800;
            const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = "#FFFFFF";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            buktiQrisDataUrl = canvas.toDataURL("image/jpeg", 0.72);
            renderStep();
        };
        img.onerror = function () { tampilkanErrorCheckout("File gambar bukti bayar tidak dapat dibaca."); };
        img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
};

window.hapusBuktiQris = function () {
    buktiQrisDataUrl = "";
    renderStep();
};

function handleLanjutPembayaran() {
    captureCurrentInputs();
    const namaInp = document.getElementById("inputNamaPembeli");

    // PB-028 & PB-038: Validasi nama pemesan (2-50 karakter & harus memuat huruf)
    if (window.SabangdorValidation) {
        const nameCheck = window.SabangdorValidation.validateCustomerName(namaPembeli);
        if (!nameCheck.valid) {
            tampilkanErrorCheckout(nameCheck.message);
            if (namaInp) namaInp.focus();
            return;
        }
        namaPembeli = nameCheck.value;

        // PB-074: Validasi nomor HP opsional
        const hpCheck = window.SabangdorValidation.validatePhoneOptional(phoneInput);
        if (!hpCheck.valid) {
            tampilkanErrorCheckout(hpCheck.message);
            return;
        }
        phoneInput = hpCheck.value;

        // PB-035: Cek batas laju per perangkat & verifikasi manusia
        const rate = window.SabangdorValidation.checkDeviceRateLimit();
        if (!rate.allowed) {
            tampilkanErrorCheckout(rate.message);
            return;
        }
        const honeypotVal = (document.getElementById("hpWebsite") || {}).value || "";
        if (currentChallenge) {
            const chalCheck = window.SabangdorValidation.verifyHumanChallenge(currentChallenge, challengeAnswerInput, honeypotVal);
            if (!chalCheck.valid) {
                tampilkanErrorCheckout(chalCheck.message);
                return;
            }
        } else if (honeypotVal) {
            tampilkanErrorCheckout("Verifikasi keamanan gagal.");
            return;
        }
    } else {
        namaPembeli = namaPembeli.trim();
        if (!namaPembeli) {
            tampilkanErrorCheckout("Silakan masukkan nama pemesan terlebih dahulu.");
            if (namaInp) namaInp.focus();
            return;
        }
    }

    if (pickupMode === "preorder" && !selectedPreorderIso) {
        tampilkanErrorCheckout("Silakan pilih jam pengambilan pre-order terlebih dahulu.");
        return;
    }

    if (selectedPayment === "qris") {
        currentStep = "qris";
        renderStep();
    } else {
        eksekusiSimpanPesanan();
    }
}

function simpanRiwayatLokal(orderRes, freshCart) {
    try {
        const list = JSON.parse(localStorage.getItem(BUYER_HISTORY_KEY) || "[]");
        const arr = Array.isArray(list) ? list : [];
        arr.unshift({
            id_order: orderRes.id_order,
            nomor_antrean: orderRes.nomor_antrean,
            tracking_token: orderRes.tracking_token,
            total_harga: orderRes.total_harga,
            created_at: new Date().toISOString(),
            items: freshCart
        });
        localStorage.setItem(BUYER_HISTORY_KEY, JSON.stringify(arr.slice(0, 20)));
        if (orderRes.tracking_token) {
            localStorage.setItem("sabangdor_last_order_token", JSON.stringify({
                tracking_token: orderRes.tracking_token,
                nomor_antrean: orderRes.nomor_antrean
            }));
        }
    } catch (e) {}
}

async function eksekusiSimpanPesanan() {
    const client = window.supabaseClient;
    if (!client) {
        tampilkanErrorCheckout("Tidak dapat terhubung, coba lagi.");
        return;
    }

    const freshCart = loadCart();
    if (freshCart.length === 0) {
        localStorage.removeItem(CART_KEY);
        alert("Data keranjang tidak valid atau kosong! Mengalihkan ke menu utama.");
        window.location.href = "index.html";
        return;
    }

    const btnSubmit = document.getElementById("btnSubmitOrder") || document.getElementById("btnKonfirmasiQris");
    if (btnSubmit) {
        if (btnSubmit.disabled) return;
        btnSubmit.disabled = true;
        btnSubmit.innerText = tr("sending_order", "Mengirim ke Dapur...");
    }

    const tipePembayaranValid = selectedPayment === "qris" ? "qris" : "cash";
    const clientFp = window.SabangdorValidation ? window.SabangdorValidation.getDeviceFingerprint() : null;

    try {
        const itemsPayload = freshCart.map(item => {
            const qty = Math.min(99, Math.max(1, Math.round(Number(item.qty) || 0)));
            const subtotal = Math.round(Number(item.harga) || 0);
            if (qty <= 0 || subtotal <= 0) {
                throw new Error("Data keranjang tidak valid.");
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

        // Panggil buat_pesanan v2; jika DB masih memakai signature v1, fallback aman
        let rpcParams = {
            p_nama: namaPembeli,
            p_tipe: tipePembayaranValid,
            p_items: itemsPayload,
            p_client_fp: clientFp,
            p_kode_voucher: appliedVoucher ? appliedVoucher.kode : null,
            p_no_hp: phoneInput || null,
            p_tukar_poin: Boolean(tukarPoinChecked && phoneInput),
            p_bukti_qris: (tipePembayaranValid === "qris" && buktiQrisDataUrl) ? buktiQrisDataUrl : null,
            p_jadwal_ambil: (pickupMode === "preorder" && selectedPreorderIso) ? selectedPreorderIso : null
        };

        let res = await client.rpc("buat_pesanan", rpcParams);
        if (res.error && (res.error.code === "PGRST202" || /could not find the function/i.test(res.error.message || ""))) {
            res = await client.rpc("buat_pesanan", {
                p_nama: namaPembeli,
                p_tipe: tipePembayaranValid,
                p_items: itemsPayload
            });
        }

        if (res.error) throw res.error;
        const data = res.data;
        if (!data || !data.nomor_antrean) throw new Error("Respon server tidak valid.");

        if (window.SabangdorValidation) window.SabangdorValidation.recordDeviceOrderTimestamp();
        if (window.SabangdorTelemetry) window.SabangdorTelemetry.trackEvent("checkout_submit", { metode: tipePembayaranValid });

        localStorage.removeItem(CART_KEY);
        createdOrderData = data;
        simpanRiwayatLokal(data, freshCart);
        try { sessionStorage.setItem(LAST_ORDER_KEY, JSON.stringify(data)); } catch (e) {}

        await muatEstimasiTunggu();
        currentStep = "sukses";
        renderStep();
    } catch (err) {
        console.error("Gagal memproses pesanan ke Supabase:", err);
        if (window.SabangdorTelemetry) window.SabangdorTelemetry.trackRpcError("buat_pesanan", err);
        const pesan = window.SabangdorErrors
            ? window.SabangdorErrors.formatError(err, "order")
            : "Terjadi kendala saat memproses pesanan. Silakan coba lagi.";
        tampilkanErrorCheckout(pesan);
        if (btnSubmit) {
            btnSubmit.disabled = false;
            btnSubmit.innerText = "Coba Lagi";
        }
    }
}

window.handleLanjutPembayaran = handleLanjutPembayaran;
window.eksekusiSimpanPesanan = eksekusiSimpanPesanan;
