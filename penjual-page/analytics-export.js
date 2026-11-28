/**
 * File: penjual-page/analytics-export.js
 * PB-055: Laporan penjualan harian / mingguan / bulanan / rentang tanggal + grafik tren.
 * PB-057: Ekspor laporan ke Excel (.xls SpreadsheetML) & PDF (layout cetak A4).
 * PB-058: Peringkat menu terlaris (qty & omzet) + grafik jam sibuk (00-23 WIB).
 */

function escXml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function escHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function rupiah(n) {
    return 'Rp' + Math.round(Number(n) || 0).toLocaleString('id-ID');
}

function pad2(n) { return String(n).padStart(2, '0'); }

function toDateKey(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function getDateRangeForPreset(preset, customStart, customEnd) {
    const now = new Date();
    const todayKey = toDateKey(now);
    if (preset === 'hari') {
        return { start: todayKey, end: todayKey, label: `Hari Ini (${todayKey})` };
    }
    if (preset === 'minggu') {
        const d = new Date(now);
        d.setDate(d.getDate() - 6);
        const start = toDateKey(d);
        return { start, end: todayKey, label: `7 Hari Terakhir (${start} s.d. ${todayKey})` };
    }
    if (preset === 'bulan') {
        const d = new Date(now);
        d.setDate(d.getDate() - 29);
        const start = toDateKey(d);
        return { start, end: todayKey, label: `30 Hari Terakhir (${start} s.d. ${todayKey})` };
    }
    const s = customStart || todayKey;
    const e = customEnd || todayKey;
    return { start: s <= e ? s : e, end: s <= e ? e : s, label: `Periode ${s} s.d. ${e}` };
}

/**
 * Menghitung KPI penjualan, tren harian, menu terlaris, dan jam sibuk dari daftar pesanan.
 * Hanya pesanan berstatus lunas (dikurangi retur) yang dihitung ke omzet.
 */
export function computeSalesAnalytics(allOrders, startKey, endKey) {
    const inRange = (Array.isArray(allOrders) ? allOrders : []).filter(o => {
        if (!o || !o.tanggalKey) return false;
        return o.tanggalKey >= startKey && o.tanggalKey <= endKey;
    });

    const paidOrders = inRange.filter(o => o.statusPembayaranDb === 'lunas');
    const returnedOrders = inRange.filter(o => o.statusPembayaranDb === 'retur');

    let omzetKotor = 0;
    let totalDiskon = 0;
    let omzetBersih = 0;
    let totalTunai = 0;
    let totalQris = 0;
    let totalRetur = 0;

    const trendMap = new Map();
    const menuMap = new Map();
    const hourCounts = new Array(24).fill(0);

    paidOrders.forEach(o => {
        const subKotor = Number(o.subtotalKotor || o.totalHarga || 0);
        const disc = Number(o.diskonVoucher || 0) + Number(o.diskonPoin || 0);
        const net = Number(o.totalHarga || 0);

        omzetKotor += subKotor;
        totalDiskon += disc;
        omzetBersih += net;

        if (o.metodeBayar === 'CASH' || o.metodeBayar === 'TUNAI') totalTunai += net;
        else totalQris += net;

        trendMap.set(o.tanggalKey, (trendMap.get(o.tanggalKey) || 0) + net);

        // Jam sibuk WIB
        const created = o.createdAt ? new Date(o.createdAt) : null;
        if (created && !Number.isNaN(created.getTime())) {
            const hourStr = created.toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', hour12: false });
            const h = parseInt(hourStr, 10);
            if (h >= 0 && h < 24) hourCounts[h]++;
        }

        // Menu terlaris
        (o.items || []).forEach(it => {
            const nama = String(it.nama || 'Menu').trim();
            const qty = Number(it.qty || 1);
            const rev = Number(it.totalHargaItem || (Number(it.hargaSatuan || 0) * qty));
            const cur = menuMap.get(nama) || { nama, qty: 0, omzet: 0 };
            cur.qty += qty;
            cur.omzet += rev;
            menuMap.set(nama, cur);
        });
    });

    returnedOrders.forEach(o => {
        totalRetur += Number(o.nominalRetur || o.totalHarga || 0);
    });

    const trendSeries = Array.from(trendMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([tanggal, omzet]) => ({ tanggal, omzet }));

    const topMenus = Array.from(menuMap.values()).sort((a, b) => b.qty - a.qty);
    const aov = paidOrders.length > 0 ? Math.round(omzetBersih / paidOrders.length) : 0;

    return {
        startKey,
        endKey,
        paidOrders,
        returnedOrders,
        jumlahPesanan: paidOrders.length,
        omzetKotor,
        totalDiskon,
        totalRetur,
        omzetBersih,
        totalTunai,
        totalQris,
        aov,
        trendSeries,
        topMenus,
        hourCounts
    };
}

/**
 * Render grafik batang SVG responsif untuk tren penjualan harian.
 */
export function renderTrendChartSvg(trendSeries) {
    if (!trendSeries || trendSeries.length === 0) {
        return '<p style="font-size:0.8125rem; color:var(--text-muted); text-align:center; padding:18px;">Belum ada transaksi lunas pada periode ini.</p>';
    }
    const maxVal = Math.max(...trendSeries.map(d => d.omzet), 1);
    const width = Math.max(360, trendSeries.length * 54);
    const height = 180;
    const padBottom = 34;
    const padTop = 22;
    const chartH = height - padBottom - padTop;
    const barW = Math.min(34, Math.max(16, Math.floor((width - 24) / trendSeries.length) - 10));

    const bars = trendSeries.map((d, i) => {
        const x = 14 + i * ((width - 28) / trendSeries.length);
        const h = Math.max(4, Math.round((d.omzet / maxVal) * chartH));
        const y = padTop + (chartH - h);
        const label = d.tanggal.slice(5); // MM-DD
        const kVal = d.omzet >= 1000 ? Math.round(d.omzet / 1000) + 'k' : String(d.omzet);
        return `
            <g>
                <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="5" fill="#E11D48"></rect>
                <text x="${x + barW / 2}" y="${y - 5}" text-anchor="middle" font-size="10" font-weight="700" fill="#1E293B">${escXml(kVal)}</text>
                <text x="${x + barW / 2}" y="${height - 10}" text-anchor="middle" font-size="10" fill="#475569">${escXml(label)}</text>
            </g>`;
    }).join('');

    return `
        <div style="overflow-x:auto; width:100%;">
            <svg viewBox="0 0 ${width} ${height}" style="width:100%; min-width:${Math.min(width, 420)}px; height:auto; display:block;" role="img" aria-label="Grafik tren penjualan harian">
                <line x1="10" y1="${padTop + chartH}" x2="${width - 10}" y2="${padTop + chartH}" stroke="#E2E8F0" stroke-width="1"></line>
                ${bars}
            </svg>
        </div>`;
}

/**
 * Render grafik batang SVG untuk jam sibuk (PB-058).
 */
export function renderPeakHoursSvg(hourCounts) {
    const maxCnt = Math.max(...(hourCounts || [0]), 1);
    const activeHours = [];
    for (let h = 8; h <= 22; h++) {
        activeHours.push({ hour: h, count: (hourCounts && hourCounts[h]) || 0 });
    }
    const width = 520;
    const height = 160;
    const padBottom = 28;
    const padTop = 20;
    const chartH = height - padBottom - padTop;
    const step = (width - 20) / activeHours.length;
    const barW = Math.max(14, step - 10);

    const bars = activeHours.map((item, idx) => {
        const x = 12 + idx * step;
        const h = item.count > 0 ? Math.max(6, Math.round((item.count / maxCnt) * chartH)) : 2;
        const y = padTop + (chartH - h);
        const fill = item.count === maxCnt && maxCnt > 0 ? '#E11D48' : '#2B1D19';
        return `
            <g>
                <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="4" fill="${fill}" opacity="${item.count > 0 ? '1' : '0.2'}"></rect>
                ${item.count > 0 ? `<text x="${x + barW / 2}" y="${y - 4}" text-anchor="middle" font-size="10" font-weight="700" fill="#1E293B">${item.count}</text>` : ''}
                <text x="${x + barW / 2}" y="${height - 8}" text-anchor="middle" font-size="10" fill="#475569">${pad2(item.hour)}</text>
            </g>`;
    }).join('');

    return `
        <div style="overflow-x:auto; width:100%;">
            <svg viewBox="0 0 ${width} ${height}" style="width:100%; min-width:420px; height:auto; display:block;" role="img" aria-label="Grafik jam sibuk pesanan per jam">
                <line x1="10" y1="${padTop + chartH}" x2="${width - 10}" y2="${padTop + chartH}" stroke="#E2E8F0" stroke-width="1"></line>
                ${bars}
            </svg>
        </div>`;
}

/**
 * PB-057: Ekspor laporan penjualan ke berkas Excel (.xls SpreadsheetML) lengkap dengan periode & waktu pembuatan.
 */
export function exportReportToExcel(stats, periodLabel) {
    const generatedAt = new Date().toLocaleString('id-ID');
    const row = (cells) => `<Row>${cells.map(c => {
        const isNum = typeof c === 'number' && Number.isFinite(c);
        return `<Cell><Data ss:Type="${isNum ? 'Number' : 'String'}">${escXml(c)}</Data></Cell>`;
    }).join('')}</Row>`;

    const summaryRows = [
        row(['LAPORAN PENJUALAN SABANGDOR']),
        row(['Periode', periodLabel]),
        row(['Waktu Pembuatan', generatedAt]),
        row([]),
        row(['Indikator', 'Nilai']),
        row(['Jumlah Pesanan Lunas', stats.jumlahPesanan]),
        row(['Omzet Kotor (Rp)', stats.omzetKotor]),
        row(['Total Diskon (Rp)', stats.totalDiskon]),
        row(['Total Retur (Rp)', stats.totalRetur]),
        row(['Omzet Bersih (Rp)', stats.omzetBersih]),
        row(['Pembayaran Tunai (Rp)', stats.totalTunai]),
        row(['Pembayaran QRIS (Rp)', stats.totalQris]),
        row(['Rata-rata Nilai Pesanan (Rp)', stats.aov]),
        row([]),
        row(['MENU TERLARIS', 'Qty Terjual', 'Kontribusi Omzet (Rp)']),
        ...stats.topMenus.map(m => row([m.nama, m.qty, m.omzet]))
    ].join('');

    const txRows = [
        row(['No Antrean', 'Tanggal', 'Waktu', 'Nama Pembeli', 'Metode', 'Subtotal Kotor', 'Diskon', 'Total Bersih', 'Status']),
        ...stats.paidOrders.map(o => row([
            o.idOrder,
            o.tanggal,
            o.waktu,
            o.namaPelanggan,
            o.metodeBayar,
            Number(o.subtotalKotor || o.totalHarga || 0),
            Number(o.diskonVoucher || 0) + Number(o.diskonPoin || 0),
            Number(o.totalHarga || 0),
            o.statusPembayaranDb
        ]))
    ].join('');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Ringkasan">
  <Table>${summaryRows}</Table>
 </Worksheet>
 <Worksheet ss:Name="Daftar Transaksi">
  <Table>${txRows}</Table>
 </Worksheet>
</Workbook>`;

    const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Laporan-Sabangdor-${stats.startKey}-sd-${stats.endKey}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * PB-057: Ekspor laporan penjualan ke PDF melalui jendela cetak A4 terstruktur.
 */
export function exportReportToPdf(stats, periodLabel) {
    const generatedAt = new Date().toLocaleString('id-ID');
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) {
        alert('Pop-up diblokir browser. Izinkan pop-up untuk menyimpan laporan PDF.');
        return;
    }

    const menuRows = stats.topMenus.map((m, i) => `
        <tr>
            <td>${i + 1}</td>
            <td>${escHtml(m.nama)}</td>
            <td style="text-align:right;">${m.qty}</td>
            <td style="text-align:right;">${rupiah(m.omzet)}</td>
        </tr>`).join('') || '<tr><td colspan="4">Tidak ada data</td></tr>';

    const txRows = stats.paidOrders.slice(0, 200).map(o => `
        <tr>
            <td>#${escHtml(o.idOrder)}</td>
            <td>${escHtml(o.tanggal)} ${escHtml(o.waktu)}</td>
            <td>${escHtml(o.namaPelanggan)}</td>
            <td>${escHtml(o.metodeBayar)}</td>
            <td style="text-align:right;">${rupiah(o.totalHarga)}</td>
        </tr>`).join('') || '<tr><td colspan="5">Tidak ada transaksi lunas</td></tr>';

    win.document.write(`<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<title>Laporan Penjualan SABANGDOR - ${escHtml(periodLabel)}</title>
<style>
  @page { size: A4; margin: 16mm; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1E293B; font-size: 12px; line-height: 1.5; }
  h1 { color: #2B1D19; margin: 0 0 4px; font-size: 20px; }
  .meta { color: #475569; margin-bottom: 16px; font-size: 11px; }
  .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 18px; }
  .kpi { border: 1px solid #CBD5E1; border-radius: 8px; padding: 10px; }
  .kpi small { color: #475569; display: block; font-size: 10px; }
  .kpi strong { font-size: 15px; color: #BE123C; }
  h2 { font-size: 14px; margin: 16px 0 8px; border-bottom: 1px solid #E2E8F0; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  th, td { border: 1px solid #CBD5E1; padding: 6px 8px; text-align: left; }
  th { background: #F1F5F9; font-weight: 700; }
</style>
</head>
<body>
  <h1>Laporan Penjualan SABANGDOR</h1>
  <div class="meta">Periode: <strong>${escHtml(periodLabel)}</strong> | Dibuat: ${escHtml(generatedAt)}</div>
  <div class="kpi-grid">
    <div class="kpi"><small>Omzet Bersih</small><strong>${rupiah(stats.omzetBersih)}</strong></div>
    <div class="kpi"><small>Omzet Kotor</small><strong>${rupiah(stats.omzetKotor)}</strong></div>
    <div class="kpi"><small>Total Diskon &amp; Retur</small><strong>${rupiah(stats.totalDiskon + stats.totalRetur)}</strong></div>
    <div class="kpi"><small>Pesanan Lunas</small><strong>${stats.jumlahPesanan}</strong></div>
    <div class="kpi"><small>Rata-rata Pesanan (AOV)</small><strong>${rupiah(stats.aov)}</strong></div>
    <div class="kpi"><small>Tunai / QRIS</small><strong>${rupiah(stats.totalTunai)} / ${rupiah(stats.totalQris)}</strong></div>
  </div>
  <h2>Peringkat Menu Terlaris</h2>
  <table>
    <thead><tr><th>#</th><th>Nama Menu</th><th style="text-align:right;">Terjual</th><th style="text-align:right;">Omzet</th></tr></thead>
    <tbody>${menuRows}</tbody>
  </table>
  <h2>Daftar Transaksi Lunas</h2>
  <table>
    <thead><tr><th>Antrean</th><th>Waktu</th><th>Pemesan</th><th>Metode</th><th style="text-align:right;">Total</th></tr></thead>
    <tbody>${txRows}</tbody>
  </table>
  <script>window.onload = function(){ window.print(); };</script>
</body>
</html>`);
    win.document.close();
}
