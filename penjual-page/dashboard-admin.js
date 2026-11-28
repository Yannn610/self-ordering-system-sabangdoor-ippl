/**
 * File: penjual-page/dashboard-admin.js
 * Modul manajemen lanjutan untuk Dashboard Kasir & Pemilik:
 * - PB-048: Atur urutan dan nama kategori menu
 * - PB-052: Log audit perubahan
 * - PB-054, PB-060, PB-070: Pengaturan Apriori server-side & saran paket bundling otomatis
 * - PB-059: Pemantauan error & analitik penggunaan
 * - PB-062: Rekap kas & penutupan shift
 * - PB-064 & PB-075: Jadwal buka/tutup otomatis, libur, dan kuota pre-order
 * - PB-065 & PB-067: Kelola akun pegawai, kebijakan kata sandi (>=10 char), & 2FA TOTP
 * - PB-066 & PB-074: Voucher/diskon & pelanggan loyalitas poin
 * - PB-068: Ulasan & rating pesanan
 */

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function rupiah(n) {
    return 'Rp' + Math.round(Number(n) || 0).toLocaleString('id-ID');
}

function fmtErr(err, ctx) {
    return window.SabangdorErrors ? window.SabangdorErrors.formatError(err, ctx || 'general') : (err && err.message ? err.message : String(err));
}

const DAY_LABELS = [
    { key: '1', label: 'Senin' },
    { key: '2', label: 'Selasa' },
    { key: '3', label: 'Rabu' },
    { key: '4', label: 'Kamis' },
    { key: '5', label: 'Jumat' },
    { key: '6', label: 'Sabtu' },
    { key: '0', label: 'Minggu' }
];

// ==========================================
// 1. PB-048: MANAJEMEN URUTAN & NAMA KATEGORI
// ==========================================
export async function renderKategoriManager(container, supabase) {
    if (!container || !supabase) return;
    let cats = [];
    try {
        const { data, error } = await supabase.from('menu_categories').select('*').order('urutan', { ascending: true });
        if (!error && Array.isArray(data)) cats = data;
    } catch (e) {}

    if (cats.length === 0) {
        container.innerHTML = `<div class="empty-info">Jalankan <code>supabase/migration_v2_lengkap.sql</code> untuk mengaktifkan pengelolaan urutan kategori.</div>`;
        return;
    }

    container.innerHTML = `
        <div class="card">
            <div class="card-title">Urutan &amp; Nama Kategori Menu</div>
            <div class="card-sub">Atur urutan tab kategori di halaman pembeli. Kategori tanpa menu otomatis disembunyikan.</div>
            <div style="display:flex; flex-direction:column; gap:8px;">
                ${cats.map((c, idx) => `
                    <div class="admin-list-row">
                        <div style="flex:1; min-width:0;">
                            <input type="text" class="mt-input cat-edit-nama" data-id="${esc(c.id)}" value="${esc(c.nama)}" maxlength="40" aria-label="Nama kategori">
                            <input type="text" class="mt-input cat-edit-desc" data-id="${esc(c.id)}" value="${esc(c.deskripsi || '')}" maxlength="120" placeholder="Deskripsi singkat kategori" style="margin-top:6px;">
                        </div>
                        <div class="mt-actions" style="flex-direction:column;">
                            <div style="display:flex; gap:4px;">
                                <button type="button" class="mt-btn-small" ${idx === 0 ? 'disabled' : ''} data-cat-move="${esc(c.id)}" data-dir="-1" aria-label="Naikkan urutan">↑</button>
                                <button type="button" class="mt-btn-small" ${idx === cats.length - 1 ? 'disabled' : ''} data-cat-move="${esc(c.id)}" data-dir="1" aria-label="Turunkan urutan">↓</button>
                            </div>
                            <button type="button" class="mt-btn-small" data-cat-save="${esc(c.id)}">Simpan</button>
                        </div>
                    </div>
                `).join('')}
            </div>
            <div id="catManagerMsg" class="mt-msg"></div>
        </div>
    `;

    const msgEl = container.querySelector('#catManagerMsg');
    const showMsg = (t, type) => {
        if (!msgEl) return;
        msgEl.textContent = t;
        msgEl.className = 'mt-msg show ' + (type || 'ok');
    };

    container.querySelectorAll('[data-cat-move]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.catMove;
            const dir = Number(btn.dataset.dir);
            const idx = cats.findIndex(c => c.id === id);
            const targetIdx = idx + dir;
            if (idx < 0 || targetIdx < 0 || targetIdx >= cats.length) return;
            const a = cats[idx];
            const b = cats[targetIdx];
            try {
                await supabase.from('menu_categories').update({ urutan: b.urutan }).eq('id', a.id);
                await supabase.from('menu_categories').update({ urutan: a.urutan }).eq('id', b.id);
                await renderKategoriManager(container, supabase);
            } catch (err) {
                showMsg(fmtErr(err), 'error');
            }
        });
    });

    container.querySelectorAll('[data-cat-save]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.catSave;
            const namaEl = container.querySelector(`.cat-edit-nama[data-id="${CSS.escape(id)}"]`);
            const descEl = container.querySelector(`.cat-edit-desc[data-id="${CSS.escape(id)}"]`);
            const oldCat = cats.find(c => c.id === id);
            const namaBaru = (namaEl ? namaEl.value : '').trim();
            const descBaru = (descEl ? descEl.value : '').trim();
            if (!namaBaru) { showMsg('Nama kategori wajib diisi.', 'error'); return; }
            try {
                const { error } = await supabase.from('menu_categories').update({ nama: namaBaru, deskripsi: descBaru }).eq('id', id);
                if (error) throw error;
                if (oldCat && oldCat.nama !== namaBaru) {
                    await supabase.from('menu_custom').update({ kategori: namaBaru }).eq('kategori', oldCat.nama);
                }
                showMsg('Kategori berhasil diperbarui.', 'ok');
                await renderKategoriManager(container, supabase);
            } catch (err) {
                showMsg(fmtErr(err), 'error');
            }
        });
    });
}

// ==========================================
// 2. PB-062: REKAP KAS & PENUTUPAN SHIFT
// ==========================================
export async function renderShiftPanel(container, supabase, allOrders, currentUser) {
    if (!container || !supabase) return;

    let closures = [];
    try {
        const { data, error } = await supabase
            .from('shift_closures')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(20);
        if (!error && Array.isArray(data)) closures = data;
    } catch (e) {}

    const lastCloseTs = closures.length > 0
        ? new Date(closures[0].selesai_shift || closures[0].created_at)
        : new Date(new Date().setHours(0, 0, 0, 0));

    const shiftOrders = (allOrders || []).filter(o => {
        const t = o.createdAt ? new Date(o.createdAt) : null;
        return t && t >= lastCloseTs;
    });

    const paid = shiftOrders.filter(o => o.statusPembayaranDb === 'lunas');
    const returned = shiftOrders.filter(o => o.statusPembayaranDb === 'retur');

    const totalTunai = paid.filter(o => o.metodeBayar === 'CASH' || o.metodeBayar === 'TUNAI').reduce((s, o) => s + o.totalHarga, 0);
    const totalQris = paid.filter(o => o.metodeBayar !== 'CASH' && o.metodeBayar !== 'TUNAI').reduce((s, o) => s + o.totalHarga, 0);
    const totalRetur = returned.reduce((s, o) => s + Number(o.nominalRetur || o.totalHarga || 0), 0);

    container.innerHTML = `
        <div class="card">
            <div class="card-title">Rekap Shift Aktif</div>
            <div class="card-sub">Dihitung sejak ${esc(lastCloseTs.toLocaleString('id-ID'))}</div>

            <div class="kpi-grid">
                <div class="kpi-card"><small>Pesanan Lunas</small><strong>${paid.length}</strong></div>
                <div class="kpi-card"><small>Total Tunai</small><strong>${rupiah(totalTunai)}</strong></div>
                <div class="kpi-card"><small>Total QRIS</small><strong>${rupiah(totalQris)}</strong></div>
                <div class="kpi-card"><small>Total Retur</small><strong style="color:var(--primary-hover);">${rupiah(totalRetur)}</strong></div>
            </div>

            <div class="mt-field">
                <label for="shiftKasAwal">Modal Kas Awal (Rp)</label>
                <input type="number" id="shiftKasAwal" class="mt-input" min="0" step="1" value="0">
            </div>
            <div class="mt-field">
                <label for="shiftKasFisik">Uang Tunai Fisik di Laci (Rp)</label>
                <input type="number" id="shiftKasFisik" class="mt-input" min="0" step="1" placeholder="Hitung uang tunai di laci...">
            </div>
            <div id="shiftSelisihBox" style="margin-top:10px; padding:10px 12px; border-radius:10px; background:var(--surface-subtle); font-weight:800; font-size:0.875rem;">
                Kas seharusnya: ${rupiah(totalTunai)}
            </div>
            <div class="mt-field">
                <label for="shiftCatatan">Catatan Shift (opsional)</label>
                <input type="text" id="shiftCatatan" class="mt-input" maxlength="200" placeholder="Contoh: Shift pagi lancar">
            </div>
            <div id="shiftMsg" class="mt-msg"></div>
            <div class="btn-group" style="margin-top:12px;">
                <button type="button" id="btnTutupShift" class="btn-primary-merchant">Tutup Shift &amp; Simpan Rekap</button>
            </div>
        </div>

        <div class="card">
            <div class="card-title">Riwayat Penutupan Shift</div>
            ${closures.length === 0
                ? `<div class="empty-info">Belum ada riwayat penutupan shift.</div>`
                : `<div class="admin-table-wrap">
                    <table class="admin-table">
                        <thead><tr><th>Waktu Tutup</th><th>Kasir</th><th>Pesanan</th><th>Tunai</th><th>QRIS</th><th>Selisih</th></tr></thead>
                        <tbody>
                            ${closures.map(c => `
                                <tr>
                                    <td>${esc(new Date(c.selesai_shift || c.created_at).toLocaleString('id-ID'))}</td>
                                    <td>${esc(c.kasir_email || '-')}</td>
                                    <td>${Number(c.jumlah_pesanan || 0)}</td>
                                    <td>${rupiah(c.total_tunai)}</td>
                                    <td>${rupiah(c.total_qris)}</td>
                                    <td style="font-weight:800; color:${Number(c.selisih) < 0 ? 'var(--primary-hover)' : 'var(--green-text)'};">${rupiah(c.selisih)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>`}
        </div>
    `;

    const kasAwalEl = container.querySelector('#shiftKasAwal');
    const kasFisikEl = container.querySelector('#shiftKasFisik');
    const selisihBox = container.querySelector('#shiftSelisihBox');
    const msgEl = container.querySelector('#shiftMsg');

    const updateSelisih = () => {
        const awal = Math.max(0, Number(kasAwalEl.value) || 0);
        const fisik = Number(kasFisikEl.value);
        const expected = awal + totalTunai;
        if (!kasFisikEl.value) {
            selisihBox.textContent = `Kas seharusnya (Modal + Tunai): ${rupiah(expected)}`;
            selisihBox.style.color = 'var(--text-main)';
            return { expected, selisih: 0 };
        }
        const selisih = fisik - expected;
        selisihBox.textContent = `Kas seharusnya: ${rupiah(expected)} | Selisih: ${selisih >= 0 ? '+' : ''}${rupiah(selisih)}`;
        selisihBox.style.color = selisih < 0 ? 'var(--primary-hover)' : 'var(--green-text)';
        return { expected, selisih };
    };

    kasAwalEl.addEventListener('input', updateSelisih);
    kasFisikEl.addEventListener('input', updateSelisih);

    container.querySelector('#btnTutupShift').addEventListener('click', async () => {
        if (!kasFisikEl.value) {
            msgEl.textContent = 'Masukkan nominal kas fisik di laci terlebih dahulu.';
            msgEl.className = 'mt-msg show error';
            return;
        }
        const awal = Math.max(0, Number(kasAwalEl.value) || 0);
        const fisik = Math.max(0, Number(kasFisikEl.value) || 0);
        const selisih = fisik - (awal + totalTunai);
        const catatan = (container.querySelector('#shiftCatatan').value || '').trim();

        try {
            const { error } = await supabase.from('shift_closures').insert([{
                kasir_id: currentUser ? currentUser.id : null,
                kasir_email: currentUser ? currentUser.email : '',
                mulai_shift: lastCloseTs.toISOString(),
                selesai_shift: new Date().toISOString(),
                jumlah_pesanan: paid.length,
                total_tunai: totalTunai,
                total_qris: totalQris,
                total_retur: totalRetur,
                kas_awal: awal,
                kas_fisik: fisik,
                selisih: selisih,
                catatan: catatan
            }]);
            if (error) throw error;
            await renderShiftPanel(container, supabase, allOrders, currentUser);
        } catch (err) {
            msgEl.textContent = fmtErr(err);
            msgEl.className = 'mt-msg show error';
        }
    });
}

// ==========================================
// 3. PB-064 & PB-075: JADWAL OTOMATIS, LIBUR & PRE-ORDER
// ==========================================
export async function renderJadwalPreorderPanel(container, supabase, getSetting, setSetting) {
    if (!container || !supabase) return;

    let jadwal = { enabled: false, days: {} };
    let libur = [];
    let preCfg = { aktif: true, kuota_per_slot: 10, lead_menit: 30, slot_menit: 30 };

    try { jadwal = JSON.parse(await getSetting('jadwal_operasional', '{}')) || jadwal; } catch (e) {}
    try { libur = JSON.parse(await getSetting('tanggal_libur', '[]')) || []; } catch (e) {}
    try { preCfg = JSON.parse(await getSetting('preorder_config', '{}')) || preCfg; } catch (e) {}
    if (!jadwal.days) jadwal.days = {};

    container.innerHTML = `
        <div class="card">
            <div class="card-title">Jadwal Buka / Tutup Otomatis (WIB)</div>
            <div class="card-sub">Saat diaktifkan, status buka/tutup mengikuti jam operasional harian. Tombol buka/tutup manual di header tetap dapat menimpa jadwal hari ini.</div>

            <label style="display:flex; align-items:center; gap:8px; font-weight:700; margin-bottom:12px;">
                <input type="checkbox" id="chkJadwalEnabled" ${jadwal.enabled ? 'checked' : ''}>
                <span>Aktifkan Jadwal Operasional Otomatis</span>
            </label>

            <div style="display:flex; flex-direction:column; gap:8px;">
                ${DAY_LABELS.map(d => {
                    const cfg = jadwal.days[d.key] || { aktif: true, buka: '10:00', tutup: '21:00' };
                    return `
                        <div class="admin-list-row" style="align-items:center;">
                            <label style="display:flex; align-items:center; gap:8px; min-width:96px; font-weight:700; font-size:0.875rem;">
                                <input type="checkbox" class="jd-aktif" data-day="${d.key}" ${cfg.aktif ? 'checked' : ''}>
                                ${d.label}
                            </label>
                            <div style="display:flex; gap:6px; align-items:center; flex:1;">
                                <input type="time" class="mt-input jd-buka" data-day="${d.key}" value="${esc(cfg.buka || '10:00')}">
                                <span>s.d.</span>
                                <input type="time" class="mt-input jd-tutup" data-day="${d.key}" value="${esc(cfg.tutup || '21:00')}">
                            </div>
                        </div>`;
                }).join('')}
            </div>

            <div class="mt-field">
                <label for="inputTanggalLibur">Pengecualian Hari Libur</label>
                <div style="display:flex; gap:8px;">
                    <input type="date" id="inputTanggalLibur" class="mt-input" style="flex:1;">
                    <button type="button" id="btnTambahLibur" class="btn-outline-merchant">+ Tambah Libur</button>
                </div>
                <div id="listTanggalLibur" style="display:flex; flex-wrap:wrap; gap:6px; margin-top:8px;">
                    ${libur.map(tgl => `
                        <span class="chip-tag">${esc(tgl)} <button type="button" data-del-libur="${esc(tgl)}" aria-label="Hapus libur ${esc(tgl)}">✕</button></span>
                    `).join('') || '<span class="mt-hint">Belum ada tanggal libur terjadwal.</span>'}
                </div>
            </div>

            <div id="jadwalMsg" class="mt-msg"></div>
            <div class="btn-group" style="margin-top:12px;">
                <button type="button" id="btnSimpanJadwal" class="btn-primary-merchant">Simpan Jadwal Operasional</button>
                <button type="button" id="btnResetOverride" class="btn-outline-merchant">Hapus Timpaan Manual Hari Ini</button>
            </div>
        </div>

        <div class="card">
            <div class="card-title">Pengaturan Pre-order &amp; Slot Ambil</div>
            <div class="card-sub">Izinkan pembeli memilih jam pengambilan dengan kuota pesanan per slot waktu.</div>

            <label style="display:flex; align-items:center; gap:8px; font-weight:700; margin-bottom:10px;">
                <input type="checkbox" id="chkPreorderAktif" ${preCfg.aktif !== false ? 'checked' : ''}>
                <span>Aktifkan Fitur Pre-order</span>
            </label>
            <div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));">
                <div class="mt-field" style="margin-top:0;">
                    <label for="preKuota">Kuota Pesanan / Slot</label>
                    <input type="number" id="preKuota" class="mt-input" min="1" max="100" value="${Number(preCfg.kuota_per_slot || 10)}">
                </div>
                <div class="mt-field" style="margin-top:0;">
                    <label for="preSlotMenit">Interval Slot (Menit)</label>
                    <input type="number" id="preSlotMenit" class="mt-input" min="15" max="120" step="15" value="${Number(preCfg.slot_menit || 30)}">
                </div>
                <div class="mt-field" style="margin-top:0;">
                    <label for="preLeadMenit">Minimal Jeda Pesan (Menit)</label>
                    <input type="number" id="preLeadMenit" class="mt-input" min="15" max="180" step="15" value="${Number(preCfg.lead_menit || 30)}">
                </div>
            </div>
            <div id="preorderMsg" class="mt-msg"></div>
            <div class="btn-group" style="margin-top:12px;">
                <button type="button" id="btnSimpanPreorder" class="btn-primary-merchant">Simpan Pengaturan Pre-order</button>
            </div>
        </div>
    `;

    const jMsg = container.querySelector('#jadwalMsg');
    container.querySelector('#btnTambahLibur').addEventListener('click', async () => {
        const tgl = container.querySelector('#inputTanggalLibur').value;
        if (!tgl) return;
        if (!libur.includes(tgl)) libur.push(tgl);
        libur.sort();
        await setSetting('tanggal_libur', JSON.stringify(libur));
        await renderJadwalPreorderPanel(container, supabase, getSetting, setSetting);
    });

    container.querySelectorAll('[data-del-libur]').forEach(btn => {
        btn.addEventListener('click', async () => {
            libur = libur.filter(x => x !== btn.dataset.delLibur);
            await setSetting('tanggal_libur', JSON.stringify(libur));
            await renderJadwalPreorderPanel(container, supabase, getSetting, setSetting);
        });
    });

    container.querySelector('#btnSimpanJadwal').addEventListener('click', async () => {
        const nextDays = {};
        DAY_LABELS.forEach(d => {
            nextDays[d.key] = {
                aktif: container.querySelector(`.jd-aktif[data-day="${d.key}"]`).checked,
                buka: container.querySelector(`.jd-buka[data-day="${d.key}"]`).value || '10:00',
                tutup: container.querySelector(`.jd-tutup[data-day="${d.key}"]`).value || '21:00'
            };
        });
        const payload = {
            enabled: container.querySelector('#chkJadwalEnabled').checked,
            days: nextDays
        };
        try {
            await setSetting('jadwal_operasional', JSON.stringify(payload));
            jMsg.textContent = 'Jadwal operasional berhasil disimpan.';
            jMsg.className = 'mt-msg show ok';
        } catch (err) {
            jMsg.textContent = fmtErr(err);
            jMsg.className = 'mt-msg show error';
        }
    });

    container.querySelector('#btnResetOverride').addEventListener('click', async () => {
        try {
            await setSetting('status_toko_override', '');
            jMsg.textContent = 'Timpaan manual hari ini dihapus; toko kembali mengikuti jadwal otomatis.';
            jMsg.className = 'mt-msg show ok';
        } catch (err) {
            jMsg.textContent = fmtErr(err);
            jMsg.className = 'mt-msg show error';
        }
    });

    container.querySelector('#btnSimpanPreorder').addEventListener('click', async () => {
        const pMsg = container.querySelector('#preorderMsg');
        const nextCfg = {
            aktif: container.querySelector('#chkPreorderAktif').checked,
            kuota_per_slot: Math.max(1, Number(container.querySelector('#preKuota').value) || 10),
            slot_menit: Math.max(15, Number(container.querySelector('#preSlotMenit').value) || 30),
            lead_menit: Math.max(15, Number(container.querySelector('#preLeadMenit').value) || 30)
        };
        try {
            await setSetting('preorder_config', JSON.stringify(nextCfg));
            pMsg.textContent = 'Pengaturan pre-order berhasil disimpan.';
            pMsg.className = 'mt-msg show ok';
        } catch (err) {
            pMsg.textContent = fmtErr(err);
            pMsg.className = 'mt-msg show error';
        }
    });
}

// ==========================================
// 4. PB-066 & PB-074: VOUCHER & LOYALITAS POIN
// ==========================================
export async function renderVoucherLoyalPanel(container, supabase) {
    if (!container || !supabase) return;

    let vouchers = [];
    let loyals = [];
    try {
        const [vRes, lRes] = await Promise.all([
            supabase.from('vouchers').select('*').order('created_at', { ascending: false }),
            supabase.from('loyalty_accounts').select('*').order('poin', { ascending: false }).limit(50)
        ]);
        if (!vRes.error && Array.isArray(vRes.data)) vouchers = vRes.data;
        if (!lRes.error && Array.isArray(lRes.data)) loyals = lRes.data;
    } catch (e) {}

    container.innerHTML = `
        <div class="card">
            <div class="card-title">Buat Voucher &amp; Kode Promo</div>
            <div class="card-sub">Diskon dihitung otomatis dan aman di server saat pembeli checkout.</div>
            <form id="formVoucher">
                <div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));">
                    <div class="mt-field" style="margin-top:0;">
                        <label for="vKode">Kode Voucher</label>
                        <input type="text" id="vKode" class="mt-input" maxlength="32" placeholder="HEMAT10" style="text-transform:uppercase;" required>
                    </div>
                    <div class="mt-field" style="margin-top:0;">
                        <label for="vTipe">Tipe Diskon</label>
                        <select id="vTipe" class="mt-input">
                            <option value="persen">Persen (%)</option>
                            <option value="nominal">Nominal (Rp)</option>
                        </select>
                    </div>
                    <div class="mt-field" style="margin-top:0;">
                        <label for="vNilai">Nilai Diskon</label>
                        <input type="number" id="vNilai" class="mt-input" min="1" step="1" placeholder="10 atau 5000" required>
                    </div>
                    <div class="mt-field" style="margin-top:0;">
                        <label for="vMinBelanja">Min. Belanja (Rp)</label>
                        <input type="number" id="vMinBelanja" class="mt-input" min="0" step="1" value="0">
                    </div>
                    <div class="mt-field" style="margin-top:0;">
                        <label for="vMaksDiskon">Maks. Diskon (opsional)</label>
                        <input type="number" id="vMaksDiskon" class="mt-input" min="1" step="1" placeholder="Kosong = tanpa batas">
                    </div>
                    <div class="mt-field" style="margin-top:0;">
                        <label for="vKuota">Kuota (opsional)</label>
                        <input type="number" id="vKuota" class="mt-input" min="1" step="1" placeholder="Kosong = tak terbatas">
                    </div>
                    <div class="mt-field" style="margin-top:0;">
                        <label for="vSampai">Berlaku Sampai</label>
                        <input type="datetime-local" id="vSampai" class="mt-input">
                    </div>
                </div>
                <div id="voucherAdminMsg" class="mt-msg"></div>
                <div class="btn-group" style="margin-top:12px;">
                    <button type="submit" class="btn-primary-merchant">+ Tambah Voucher</button>
                </div>
            </form>
        </div>

        <div class="card">
            <div class="card-title">Daftar Voucher (${vouchers.length})</div>
            ${vouchers.length === 0 ? '<div class="empty-info">Belum ada voucher terdaftar.</div>' : `
                <div class="admin-table-wrap">
                    <table class="admin-table">
                        <thead><tr><th>Kode</th><th>Diskon</th><th>Min. Belanja</th><th>Terpakai</th><th>Status</th><th>Aksi</th></tr></thead>
                        <tbody>
                            ${vouchers.map(v => `
                                <tr>
                                    <td><strong>${esc(v.kode)}</strong></td>
                                    <td>${v.tipe === 'persen' ? `${v.nilai}%` : rupiah(v.nilai)}</td>
                                    <td>${rupiah(v.min_belanja)}</td>
                                    <td>${v.terpakai}${v.kuota ? ' / ' + v.kuota : ''}</td>
                                    <td><span class="role-pill ${v.aktif ? 'pill-green' : 'pill-red'}">${v.aktif ? 'Aktif' : 'Nonaktif'}</span></td>
                                    <td>
                                        <button type="button" class="mt-btn-small" data-v-toggle="${v.id}" data-aktif="${v.aktif}">${v.aktif ? 'Matikan' : 'Aktifkan'}</button>
                                        <button type="button" class="mt-btn-small danger" data-v-del="${v.id}">Hapus</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>`}
        </div>

        <div class="card">
            <div class="card-title">Pelanggan Program Loyalitas Poin (${loyals.length})</div>
            <div class="card-sub">Setiap Rp10.000 belanja lunas = 1 poin. 10 poin dapat ditukar potongan Rp5.000 di checkout.</div>
            ${loyals.length === 0 ? '<div class="empty-info">Belum ada pelanggan terdaftar di program poin.</div>' : `
                <div class="admin-table-wrap">
                    <table class="admin-table">
                        <thead><tr><th>No. HP</th><th>Nama Terakhir</th><th>Saldo Poin</th><th>Total Transaksi</th></tr></thead>
                        <tbody>
                            ${loyals.map(l => `
                                <tr>
                                    <td><strong>${esc(l.no_hp)}</strong></td>
                                    <td>${esc(l.nama || '-')}</td>
                                    <td><strong>${Number(l.poin || 0)} poin</strong></td>
                                    <td>${Number(l.total_transaksi || 0)}x</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>`}
        </div>
    `;

    container.querySelector('#formVoucher').addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = container.querySelector('#voucherAdminMsg');
        const kode = container.querySelector('#vKode').value.trim().toUpperCase();
        const tipe = container.querySelector('#vTipe').value;
        const nilai = Number(container.querySelector('#vNilai').value);
        const minBelanja = Math.max(0, Number(container.querySelector('#vMinBelanja').value) || 0);
        const maksRaw = container.querySelector('#vMaksDiskon').value;
        const kuotaRaw = container.querySelector('#vKuota').value;
        const sampaiRaw = container.querySelector('#vSampai').value;

        if (!kode || nilai <= 0 || (tipe === 'persen' && nilai > 100)) {
            msg.textContent = tipe === 'persen' ? 'Kode wajib diisi dan persentase harus 1-100.' : 'Kode dan nilai diskon wajib valid.';
            msg.className = 'mt-msg show error';
            return;
        }
        try {
            const { error } = await supabase.from('vouchers').insert([{
                kode,
                tipe,
                nilai,
                min_belanja: minBelanja,
                maks_diskon: maksRaw ? Number(maksRaw) : null,
                kuota: kuotaRaw ? Number(kuotaRaw) : null,
                berlaku_sampai: sampaiRaw ? new Date(sampaiRaw).toISOString() : null,
                aktif: true
            }]);
            if (error) throw error;
            await renderVoucherLoyalPanel(container, supabase);
        } catch (err) {
            msg.textContent = fmtErr(err);
            msg.className = 'mt-msg show error';
        }
    });

    container.querySelectorAll('[data-v-toggle]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = Number(btn.dataset.vToggle);
            const cur = btn.dataset.aktif === 'true';
            await supabase.from('vouchers').update({ aktif: !cur }).eq('id', id);
            await renderVoucherLoyalPanel(container, supabase);
        });
    });

    container.querySelectorAll('[data-v-del]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Hapus voucher ini?')) return;
            await supabase.from('vouchers').delete().eq('id', Number(btn.dataset.vDel));
            await renderVoucherLoyalPanel(container, supabase);
        });
    });
}

// ==========================================
// 5. PB-054, PB-060, PB-070: APRIORI SERVER & PAKET BUNDLING OTOMATIS
// ==========================================
export async function renderAprioriBundlingPanel(container, supabase, getSetting, setSetting, allCatalogMenus) {
    if (!container || !supabase) return;

    let cfg = { min_support: 0.05, min_confidence: 0.10 };
    try { cfg = JSON.parse(await getSetting('apriori_config', '{}')) || cfg; } catch (e) {}

    let rules = [];
    try {
        const { data, error } = await supabase.from('apriori_rules').select('*').order('lift', { ascending: false }).limit(50);
        if (!error && Array.isArray(data)) rules = data;
    } catch (e) {}

    // PB-070: Hasilkan saran paket hemat dari pasangan unik terkuat
    const seenPairs = new Set();
    const bundleSuggestions = [];
    const priceOf = (nama) => {
        const lower = String(nama || '').toLowerCase();
        const found = (allCatalogMenus || []).find(m => String(m.nama || '').toLowerCase() === lower);
        if (found && Array.isArray(found.ukuran) && found.ukuran.length) {
            return Math.min(...found.ukuran.map(u => Number(u.harga) || 0).filter(h => h > 0)) || 13000;
        }
        return 13000;
    };

    rules.filter(r => r.aktif).forEach(r => {
        if (/extra|chilli/i.test(r.antecedent) || /extra|chilli/i.test(r.consequent)) return;
        const pairKey = [r.antecedent, r.consequent].sort().join(' + ');
        if (seenPairs.has(pairKey)) return;
        seenPairs.add(pairKey);
        const normal = priceOf(r.antecedent) + priceOf(r.consequent);
        const saranHarga = Math.max(1000, Math.round((normal * 0.9) / 1000) * 1000);
        bundleSuggestions.push({
            nama: `Paket ${r.antecedent} + ${r.consequent}`.slice(0, 60),
            deskripsi: `Paket hemat kombinasi favorit: ${r.antecedent} dan ${r.consequent}.`,
            hargaNormal: normal,
            hargaPaket: saranHarga,
            confidence: r.confidence,
            lift: r.lift
        });
    });

    container.innerHTML = `
        <div class="card">
            <div class="card-title">Pengaturan &amp; Evaluasi Apriori Server-Side</div>
            <div class="card-sub">Aturan rekomendasi dihitung langsung di server database sehingga browser pembeli tidak mengunduh data transaksi.</div>
            <div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));">
                <div class="mt-field" style="margin-top:0;">
                    <label for="apMinSup">Minimum Support (0.01 - 1.0)</label>
                    <input type="number" id="apMinSup" class="mt-input" step="0.01" min="0.01" max="1" value="${Number(cfg.min_support || 0.05)}">
                </div>
                <div class="mt-field" style="margin-top:0;">
                    <label for="apMinConf">Minimum Confidence (0.01 - 1.0)</label>
                    <input type="number" id="apMinConf" class="mt-input" step="0.01" min="0.01" max="1" value="${Number(cfg.min_confidence || 0.10)}">
                </div>
            </div>
            <div id="aprioriMsg" class="mt-msg"></div>
            <div class="btn-group" style="margin-top:12px;">
                <button type="button" id="btnHitungApriori" class="btn-primary-merchant">Simpan &amp; Hitung Ulang di Server</button>
            </div>
        </div>

        <div class="card">
            <div class="card-title">Saran Paket Hemat Otomatis (Bundling)</div>
            <div class="card-sub">Dihasilkan otomatis dari pasangan menu yang paling sering dibeli bersama. Ubah harga lalu terbitkan sebagai menu.</div>
            ${bundleSuggestions.length === 0
                ? '<div class="empty-info">Klik "Simpan &amp; Hitung Ulang di Server" untuk memunculkan saran paket bundling.</div>'
                : bundleSuggestions.slice(0, 4).map((b, idx) => `
                    <div class="admin-list-row" style="margin-bottom:8px;">
                        <div style="flex:1; min-width:0;">
                            <input type="text" class="mt-input bundle-nama" data-bidx="${idx}" value="${esc(b.nama)}" maxlength="60">
                            <div class="mt-hint">Harga normal ~${rupiah(b.hargaNormal)} • Conf ${(b.confidence * 100).toFixed(0)}% • Lift ${Number(b.lift).toFixed(2)}</div>
                        </div>
                        <input type="number" class="mt-input bundle-harga" data-bidx="${idx}" min="1000" max="1000000" step="1000" value="${b.hargaPaket}" style="width:120px;">
                        <button type="button" class="btn-primary-merchant" style="flex:none;" data-publish-bundle="${idx}">Terbitkan Menu</button>
                    </div>
                `).join('')}
            <div id="bundleMsg" class="mt-msg"></div>
        </div>

        <div class="card">
            <div class="card-title">Daftar Aturan Asosiasi (${rules.length})</div>
            ${rules.length === 0 ? '<div class="empty-info">Belum ada aturan tersimpan di server.</div>' : `
                <div class="admin-table-wrap">
                    <table class="admin-table">
                        <thead><tr><th>Jika Beli</th><th>Sarankan</th><th>Support</th><th>Confidence</th><th>Lift</th><th>Status</th></tr></thead>
                        <tbody>
                            ${rules.map(r => `
                                <tr>
                                    <td>${esc(r.antecedent)}</td>
                                    <td><strong>${esc(r.consequent)}</strong></td>
                                    <td>${(Number(r.support) * 100).toFixed(1)}%</td>
                                    <td>${(Number(r.confidence) * 100).toFixed(1)}%</td>
                                    <td>${Number(r.lift).toFixed(2)}</td>
                                    <td>
                                        <button type="button" class="mt-btn-small ${r.aktif ? '' : 'danger'}" data-rule-toggle="${r.id}" data-aktif="${r.aktif}">
                                            ${r.aktif ? 'Aktif' : 'Nonaktif'}
                                        </button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>`}
        </div>
    `;

    const msgEl = container.querySelector('#aprioriMsg');
    container.querySelector('#btnHitungApriori').addEventListener('click', async () => {
        const minSup = Math.max(0.01, Math.min(1, Number(container.querySelector('#apMinSup').value) || 0.05));
        const minConf = Math.max(0.01, Math.min(1, Number(container.querySelector('#apMinConf').value) || 0.10));
        try {
            await setSetting('apriori_config', JSON.stringify({ min_support: minSup, min_confidence: minConf }));
            const { data, error } = await supabase.rpc('hitung_apriori_server', {
                p_min_support: minSup,
                p_min_confidence: minConf
            });
            if (error) throw error;
            msgEl.textContent = `Selesai! ${data.total_transaksi} transaksi dianalisis -> ${data.jumlah_populer} menu populer & ${data.jumlah_aturan} aturan tersimpan.`;
            msgEl.className = 'mt-msg show ok';
            await renderAprioriBundlingPanel(container, supabase, getSetting, setSetting, allCatalogMenus);
        } catch (err) {
            msgEl.textContent = fmtErr(err);
            msgEl.className = 'mt-msg show error';
        }
    });

    container.querySelectorAll('[data-rule-toggle]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = Number(btn.dataset.ruleToggle);
            const cur = btn.dataset.aktif === 'true';
            await supabase.from('apriori_rules').update({ aktif: !cur }).eq('id', id);
            await renderAprioriBundlingPanel(container, supabase, getSetting, setSetting, allCatalogMenus);
        });
    });

    container.querySelectorAll('[data-publish-bundle]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const idx = Number(btn.dataset.publishBundle);
            const b = bundleSuggestions[idx];
            const bMsg = container.querySelector('#bundleMsg');
            const nama = container.querySelector(`.bundle-nama[data-bidx="${idx}"]`).value.trim();
            const harga = Math.round(Number(container.querySelector(`.bundle-harga[data-bidx="${idx}"]`).value) || 0);
            if (!nama || harga <= 0 || harga > 1000000) {
                bMsg.textContent = 'Nama paket dan harga (Rp1 - Rp1.000.000) wajib valid.';
                bMsg.className = 'mt-msg show error';
                return;
            }
            try {
                await supabase.from('menu_categories').upsert([{
                    id: 'cat-paket-hemat',
                    nama: 'Paket Hemat',
                    deskripsi: 'Kombinasi menu favorit lebih hemat',
                    urutan: 4
                }]);
                const { error } = await supabase.from('menu_custom').insert([{
                    id: 'bundle-' + Date.now(),
                    nama,
                    kategori: 'Paket Hemat',
                    deskripsi: b.deskripsi,
                    img_url: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80',
                    gratis: 'Free Chilli Oil',
                    ukuran: [{ nama: 'Paket', porsi: '1 paket', harga }],
                    addon: [],
                    habis: false
                }]);
                if (error) throw error;
                bMsg.textContent = `Paket "${nama}" berhasil diterbitkan di kategori Paket Hemat!`;
                bMsg.className = 'mt-msg show ok';
            } catch (err) {
                bMsg.textContent = fmtErr(err, 'menu');
                bMsg.className = 'mt-msg show error';
            }
        });
    });
}

// ==========================================
// 6. PB-068: ULASAN & RATING PELANGGAN
// ==========================================
export async function renderUlasanPanel(container, supabase) {
    if (!container || !supabase) return;
    let reviews = [];
    try {
        const { data, error } = await supabase.from('order_reviews').select('*').order('created_at', { ascending: false }).limit(100);
        if (!error && Array.isArray(data)) reviews = data;
    } catch (e) {}

    const avg = reviews.length ? (reviews.reduce((s, r) => s + Number(r.rating || 0), 0) / reviews.length) : 0;

    container.innerHTML = `
        <div class="card">
            <div class="card-title">Ringkasan Ulasan Pelanggan</div>
            <div class="kpi-grid" style="grid-template-columns:repeat(2,1fr);">
                <div class="kpi-card"><small>Rata-rata Rating</small><strong style="color:#B45309;">${avg ? avg.toFixed(1) + ' / 5 ★' : '-'}</strong></div>
                <div class="kpi-card"><small>Total Ulasan</small><strong>${reviews.length}</strong></div>
            </div>
        </div>
        <div class="card">
            <div class="card-title">Komentar Terbaru</div>
            ${reviews.length === 0 ? '<div class="empty-info">Belum ada ulasan dari pembeli.</div>' : reviews.map(r => `
                <div style="border-bottom:1px dashed var(--border-line); padding:10px 0;">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                        <strong>${esc(r.nama_pembeli)}</strong>
                        <span style="color:#B45309; font-weight:800;">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>
                    </div>
                    <p style="font-size:0.875rem; margin-top:4px; color:var(--text-main);">${esc(r.komentar)}</p>
                    <small style="color:var(--text-muted);">${esc(new Date(r.created_at).toLocaleString('id-ID'))}</small>
                </div>
            `).join('')}
        </div>
    `;
}

// ==========================================
// 7. PB-065 & PB-067: KELOLA AKUN PEGAWAI, PASSWORD POLICY & 2FA TOTP
// ==========================================
export async function renderPegawai2faPanel(container, supabase, currentUser) {
    if (!container || !supabase) return;

    let staffList = [];
    try {
        const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: true });
        if (!error && Array.isArray(data)) staffList = data;
    } catch (e) {}

    let mfaFactors = [];
    try {
        if (supabase.auth.mfa && typeof supabase.auth.mfa.listFactors === 'function') {
            const { data } = await supabase.auth.mfa.listFactors();
            mfaFactors = (data && data.totp) || [];
        }
    } catch (e) {}

    const activeTotp = mfaFactors.find(f => f.status === 'verified');

    container.innerHTML = `
        <div class="card">
            <div class="card-title">Kelola Akun &amp; Peran Pegawai</div>
            <div class="card-sub">Ubah peran (Pemilik / Kasir / Dapur), nonaktifkan akun, atau kirim tautan reset kata sandi via email.</div>
            ${staffList.length === 0 ? '<div class="empty-info">Tidak ada data akun pegawai.</div>' : `
                <div class="admin-table-wrap">
                    <table class="admin-table">
                        <thead><tr><th>Username / Email</th><th>Peran</th><th>Status</th><th>Aksi</th></tr></thead>
                        <tbody>
                            ${staffList.map(st => {
                                const isSelf = currentUser && st.id === currentUser.id;
                                const active = st.is_active !== false;
                                return `
                                    <tr>
                                        <td><strong>${esc(st.username || st.email || st.id)}</strong>${isSelf ? ' <span class="role-pill">Anda</span>' : ''}</td>
                                        <td>
                                            <select class="mt-input staff-role-sel" data-uid="${esc(st.id)}" style="min-height:36px; padding:4px 8px;" ${isSelf ? 'disabled' : ''}>
                                                ${['pemilik', 'kasir', 'dapur', 'pegawai'].map(r => `<option value="${r}" ${st.role === r ? 'selected' : ''}>${r.toUpperCase()}</option>`).join('')}
                                            </select>
                                        </td>
                                        <td><span class="role-pill ${active ? 'pill-green' : 'pill-red'}">${active ? 'Aktif' : 'Nonaktif'}</span></td>
                                        <td style="display:flex; gap:6px; flex-wrap:wrap;">
                                            ${!isSelf ? `<button type="button" class="mt-btn-small" data-staff-save="${esc(st.id)}" data-active="${active}">Simpan Peran</button>` : ''}
                                            ${!isSelf ? `<button type="button" class="mt-btn-small ${active ? 'danger' : ''}" data-staff-toggle="${esc(st.id)}" data-active="${active}">${active ? 'Nonaktifkan' : 'Aktifkan'}</button>` : ''}
                                            ${(st.email || (st.username && st.username.includes('@'))) ? `<button type="button" class="mt-btn-small" data-staff-reset="${esc(st.email || st.username)}">Reset Sandi</button>` : ''}
                                        </td>
                                    </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>`}
            <div id="staffAdminMsg" class="mt-msg"></div>
        </div>

        <div class="card">
            <div class="card-title">Kebijakan Kata Sandi &amp; Autentikasi Dua Langkah (2FA TOTP)</div>
            <div class="card-sub">Kata sandi wajib minimal 10 karakter dengan kombinasi huruf dan angka.</div>

            <form id="formUbahPassword" style="margin-bottom:16px;">
                <div class="mt-field" style="margin-top:0;">
                    <label for="newPassInput">Kata Sandi Baru (min. 10 karakter, huruf &amp; angka)</label>
                    <input type="password" id="newPassInput" class="mt-input" minlength="10" autocomplete="new-password" placeholder="Minimal 10 karakter">
                </div>
                <div id="passMsg" class="mt-msg"></div>
                <div class="btn-group" style="margin-top:10px;">
                    <button type="submit" class="btn-outline-merchant">Perbarui Kata Sandi</button>
                </div>
            </form>

            <div style="border-top:1px dashed var(--border-line); padding-top:14px;">
                <div style="font-weight:800; font-size:0.9375rem; margin-bottom:6px;">
                    Status 2FA (Google Authenticator / Authy):
                    <span class="role-pill ${activeTotp ? 'pill-green' : ''}">${activeTotp ? 'AKTIF' : 'BELUM AKTIF'}</span>
                </div>
                ${activeTotp
                    ? `<button type="button" id="btnDisable2fa" class="mt-btn-small danger">Nonaktifkan 2FA</button>`
                    : `<button type="button" id="btnStart2fa" class="btn-primary-merchant" style="flex:none;">Aktifkan 2FA TOTP</button>`}
                <div id="mfaEnrollBox" style="display:none; margin-top:12px;"></div>
                <div id="mfaMsg" class="mt-msg"></div>
            </div>
        </div>
    `;

    const sMsg = container.querySelector('#staffAdminMsg');
    container.querySelectorAll('[data-staff-save]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const uid = btn.dataset.staffSave;
            const role = container.querySelector(`.staff-role-sel[data-uid="${CSS.escape(uid)}"]`).value;
            const active = btn.dataset.active === 'true';
            try {
                const { error } = await supabase.rpc('admin_update_staff_profile', {
                    p_user_id: uid, p_role: role, p_is_active: active
                });
                if (error) throw error;
                sMsg.textContent = 'Peran pegawai berhasil diperbarui.';
                sMsg.className = 'mt-msg show ok';
                await renderPegawai2faPanel(container, supabase, currentUser);
            } catch (err) {
                sMsg.textContent = fmtErr(err);
                sMsg.className = 'mt-msg show error';
            }
        });
    });

    container.querySelectorAll('[data-staff-toggle]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const uid = btn.dataset.staffToggle;
            const role = container.querySelector(`.staff-role-sel[data-uid="${CSS.escape(uid)}"]`).value;
            const nextActive = btn.dataset.active !== 'true';
            try {
                const { error } = await supabase.rpc('admin_update_staff_profile', {
                    p_user_id: uid, p_role: role, p_is_active: nextActive
                });
                if (error) throw error;
                await renderPegawai2faPanel(container, supabase, currentUser);
            } catch (err) {
                sMsg.textContent = fmtErr(err);
                sMsg.className = 'mt-msg show error';
            }
        });
    });

    container.querySelectorAll('[data-staff-reset]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const email = btn.dataset.staffReset;
            try {
                const { error } = await supabase.auth.resetPasswordForEmail(email);
                if (error) throw error;
                sMsg.textContent = `Tautan reset kata sandi telah dikirim ke ${email}.`;
                sMsg.className = 'mt-msg show ok';
            } catch (err) {
                sMsg.textContent = fmtErr(err);
                sMsg.className = 'mt-msg show error';
            }
        });
    });

    container.querySelector('#formUbahPassword').addEventListener('submit', async (e) => {
        e.preventDefault();
        const pw = container.querySelector('#newPassInput').value;
        const pMsg = container.querySelector('#passMsg');
        if (window.SabangdorValidation) {
            const check = window.SabangdorValidation.validatePasswordPolicy(pw);
            if (!check.valid) {
                pMsg.textContent = check.message;
                pMsg.className = 'mt-msg show error';
                return;
            }
        }
        try {
            const { error } = await supabase.auth.updateUser({ password: pw });
            if (error) throw error;
            container.querySelector('#newPassInput').value = '';
            pMsg.textContent = 'Kata sandi berhasil diperbarui.';
            pMsg.className = 'mt-msg show ok';
        } catch (err) {
            pMsg.textContent = fmtErr(err);
            pMsg.className = 'mt-msg show error';
        }
    });

    const btnStart2fa = container.querySelector('#btnStart2fa');
    const mfaMsg = container.querySelector('#mfaMsg');
    if (btnStart2fa) {
        btnStart2fa.addEventListener('click', async () => {
            try {
                const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'SABANGDOR Authenticator' });
                if (error) throw error;
                const box = container.querySelector('#mfaEnrollBox');
                box.style.display = 'block';
                box.innerHTML = `
                    <p class="mt-hint" style="margin-bottom:8px;">Pindai QR ini di aplikasi Authenticator Anda, lalu masukkan kode 6 digit untuk mengonfirmasi:</p>
                    <div style="background:#FFF; display:inline-block; padding:8px; border:1px solid var(--border-line); border-radius:10px;">
                        <img src="${esc(data.totp.qr_code)}" alt="QR Code 2FA TOTP" width="160" height="160">
                    </div>
                    <div style="display:flex; gap:8px; margin-top:10px;">
                        <input type="text" id="mfaVerifyCode" class="mt-input" maxlength="6" inputmode="numeric" placeholder="Kode 6 digit" style="max-width:160px;">
                        <button type="button" id="btnConfirm2fa" class="btn-primary-merchant" style="flex:none;">Konfirmasi 2FA</button>
                    </div>
                `;
                box.querySelector('#btnConfirm2fa').addEventListener('click', async () => {
                    const code = box.querySelector('#mfaVerifyCode').value.replace(/\D/g, '');
                    if (code.length !== 6) {
                        mfaMsg.textContent = 'Masukkan 6 digit kode Authenticator.';
                        mfaMsg.className = 'mt-msg show error';
                        return;
                    }
                    try {
                        const { data: chal, error: cErr } = await supabase.auth.mfa.challenge({ factorId: data.id });
                        if (cErr) throw cErr;
                        const { error: vErr } = await supabase.auth.mfa.verify({ factorId: data.id, challengeId: chal.id, code });
                        if (vErr) throw vErr;
                        await renderPegawai2faPanel(container, supabase, currentUser);
                    } catch (e2) {
                        mfaMsg.textContent = 'Kode 2FA tidak cocok. Coba lagi.';
                        mfaMsg.className = 'mt-msg show error';
                    }
                });
            } catch (err) {
                mfaMsg.textContent = fmtErr(err);
                mfaMsg.className = 'mt-msg show error';
            }
        });
    }

    const btnDisable2fa = container.querySelector('#btnDisable2fa');
    if (btnDisable2fa && activeTotp) {
        btnDisable2fa.addEventListener('click', async () => {
            if (!confirm('Nonaktifkan autentikasi dua langkah (2FA)?')) return;
            try {
                const { error } = await supabase.auth.mfa.unenroll({ factorId: activeTotp.id });
                if (error) throw error;
                await renderPegawai2faPanel(container, supabase, currentUser);
            } catch (err) {
                mfaMsg.textContent = fmtErr(err);
                mfaMsg.className = 'mt-msg show error';
            }
        });
    }
}

// ==========================================
// 8. PB-052 & PB-059: LOG AUDIT PERUBAHAN & MONITORING TELEMETRI ERROR
// ==========================================
export async function renderAuditTelemetryPanel(container, supabase) {
    if (!container || !supabase) return;

    let logs = [];
    let telemetry = [];
    try {
        const [aRes, tRes] = await Promise.all([
            supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(80),
            supabase.from('app_telemetry').select('*').order('created_at', { ascending: false }).limit(100)
        ]);
        if (!aRes.error && Array.isArray(aRes.data)) logs = aRes.data;
        if (!tRes.error && Array.isArray(tRes.data)) telemetry = tRes.data;
    } catch (e) {}

    const oneHourAgo = Date.now() - 3600 * 1000;
    const errors = telemetry.filter(t => t.tipe === 'error' || t.tipe === 'rpc_error');
    const errorsLastHour = errors.filter(t => new Date(t.created_at).getTime() >= oneHourAgo).length;
    const pageViews = telemetry.filter(t => t.sumber === 'page_view').length;
    const checkouts = telemetry.filter(t => t.sumber === 'checkout_submit').length;

    container.innerHTML = `
        <div class="card">
            <div class="card-title">Pemantauan Error &amp; Analitik Penggunaan (Tanpa PII)</div>
            ${errorsLastHour >= 5 ? `
                <div class="low-stock-alert" role="alert" style="margin:8px 0;">
                    Peringatan: Laju error melewati ambang batas (${errorsLastHour} error dalam 1 jam terakhir)!
                </div>` : ''}
            <div class="kpi-grid">
                <div class="kpi-card"><small>Error (1 Jam)</small><strong style="color:${errorsLastHour >= 5 ? 'var(--primary-hover)' : 'var(--text-main)'};">${errorsLastHour}</strong></div>
                <div class="kpi-card"><small>Total Error Tercatat</small><strong>${errors.length}</strong></div>
                <div class="kpi-card"><small>Kunjungan Halaman</small><strong>${pageViews}</strong></div>
                <div class="kpi-card"><small>Checkout Terkirim</small><strong>${checkouts}</strong></div>
            </div>
            ${errors.length > 0 ? `
                <div class="admin-table-wrap" style="margin-top:10px;">
                    <table class="admin-table">
                        <thead><tr><th>Waktu</th><th>Tipe</th><th>Sumber</th><th>Halaman</th><th>Pesan</th></tr></thead>
                        <tbody>
                            ${errors.slice(0, 15).map(e => `
                                <tr>
                                    <td>${esc(new Date(e.created_at).toLocaleString('id-ID'))}</td>
                                    <td><span class="role-pill pill-red">${esc(e.tipe)}</span></td>
                                    <td>${esc(e.sumber)}</td>
                                    <td>${esc(e.halaman)}</td>
                                    <td>${esc(e.pesan)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>` : '<p class="mt-hint" style="margin-top:8px;">Tidak ada error JavaScript atau RPC yang tercatat.</p>'}
        </div>

        <div class="card">
            <div class="card-title">Log Audit Perubahan (${logs.length} terbaru)</div>
            <div class="card-sub">Mencatat siapa mengubah status pesanan, menu, stok, dan pengaturan beserta data sebelum &amp; sesudah.</div>
            ${logs.length === 0 ? '<div class="empty-info">Belum ada catatan audit.</div>' : `
                <div class="admin-table-wrap">
                    <table class="admin-table">
                        <thead><tr><th>Waktu</th><th>Pelaku</th><th>Aksi</th><th>Entitas</th><th>Ringkasan Perubahan</th></tr></thead>
                        <tbody>
                            ${logs.map(l => `
                                <tr>
                                    <td>${esc(new Date(l.created_at).toLocaleString('id-ID'))}</td>
                                    <td>${esc(l.actor_email || '-')} <small>(${esc(l.actor_role || '-')})</small></td>
                                    <td><strong>${esc(l.aksi)}</strong></td>
                                    <td>${esc(l.entitas)} #${esc(l.entitas_id || '')}</td>
                                    <td style="font-size:0.75rem; max-width:260px; overflow-wrap:anywhere;">
                                        ${l.data_sebelum ? `<div><b>Sebelum:</b> ${esc(JSON.stringify(l.data_sebelum).slice(0, 120))}</div>` : ''}
                                        ${l.data_sesudah ? `<div><b>Sesudah:</b> ${esc(JSON.stringify(l.data_sesudah).slice(0, 120))}</div>` : ''}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>`}
        </div>
    `;
}
