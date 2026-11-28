/**
 * File: penjual-page/thermal-printer.js
 * PB-073: Cetak struk & tiket dapur otomatis ke printer thermal 58mm (ESC/POS via Web Bluetooth / Web Serial)
 * dengan fallback otomatis ke cetak thermal 58mm browser.
 */

const AUTOPRINT_KEY = 'sabangdor_autoprint_enabled';

let connectedType = null; // 'bluetooth' | 'serial' | null
let btCharacteristic = null;
let serialPort = null;
let printerName = '';

function isAutoPrintEnabled() {
    return localStorage.getItem(AUTOPRINT_KEY) === '1';
}

function setAutoPrintEnabled(enabled) {
    localStorage.setItem(AUTOPRINT_KEY, enabled ? '1' : '0');
}

function getPrinterStatus() {
    return {
        connected: Boolean(connectedType),
        type: connectedType,
        name: printerName || 'Belum terhubung (pakai dialog cetak browser)',
        autoPrint: isAutoPrintEnabled(),
        supportsBluetooth: typeof navigator !== 'undefined' && 'bluetooth' in navigator,
        supportsSerial: typeof navigator !== 'undefined' && 'serial' in navigator
    };
}

/**
 * Membangun payload byte ESC/POS 58mm (lebar 32 kolom) untuk struk pembeli atau tiket dapur.
 */
export function buildEscPosReceipt(order, mode = 'struk') {
    const ESC = 0x1B;
    const GS = 0x1D;
    const bytes = [];
    const encoder = new TextEncoder();

    const pushBytes = (...arr) => bytes.push(...arr);
    const pushText = (str) => {
        const clean = String(str || '').replace(/[^\x20-\x7E\n]/g, ' ');
        bytes.push(...encoder.encode(clean));
    };
    const line = (ch = '-') => pushText(ch.repeat(32) + '\n');
    const padRow = (left, right) => {
        const l = String(left || '').slice(0, 20);
        const r = String(right || '');
        const spaces = Math.max(1, 32 - l.length - r.length);
        pushText(l + ' '.repeat(spaces) + r + '\n');
    };

    // Init printer
    pushBytes(ESC, 0x40);
    // Align center + bold
    pushBytes(ESC, 0x61, 0x01, ESC, 0x45, 0x01);
    pushText(mode === 'dapur' ? 'TIKET DAPUR SABANGDOR\n' : 'SABANGDOR\n');
    pushBytes(ESC, 0x45, 0x00);
    if (mode !== 'dapur') pushText('Outlet Ambil Sendiri\n');

    // Align left
    pushBytes(ESC, 0x61, 0x00);
    line('-');
    pushText(`No   : #${order.idOrder}\n`);
    pushText(`Nama : ${order.namaPelanggan}\n`);
    pushText(`Waktu: ${order.tanggal || ''} ${order.waktu || ''} WIB\n`);
    if (mode !== 'dapur') pushText(`Bayar: ${order.metodeBayar}\n`);
    if (order.isPreorder && order.jadwalAmbilLabel) {
        pushText(`PRE-ORDER: ${order.jadwalAmbilLabel}\n`);
    }
    line('-');

    (order.items || []).forEach(i => {
        const sub = Number(i.totalHargaItem || (Number(i.hargaSatuan || 0) * Number(i.qty || 1)));
        if (mode === 'dapur') {
            pushBytes(ESC, 0x45, 0x01);
            pushText(`${i.qty || 1}x ${i.nama}\n`);
            pushBytes(ESC, 0x45, 0x00);
        } else {
            padRow(`${i.qty || 1}x ${i.nama}`, `Rp${sub.toLocaleString('id-ID')}`);
        }
        if (i.varian) pushText(`   ${i.varian}\n`);
        if (i.catatan) pushText(`   CAT: ${i.catatan}\n`);
    });

    line('-');
    if (mode !== 'dapur') {
        if (Number(order.diskonVoucher) > 0) {
            padRow('Diskon Voucher', `-Rp${Number(order.diskonVoucher).toLocaleString('id-ID')}`);
        }
        if (Number(order.diskonPoin) > 0) {
            padRow('Potongan Poin', `-Rp${Number(order.diskonPoin).toLocaleString('id-ID')}`);
        }
        pushBytes(ESC, 0x45, 0x01);
        padRow('TOTAL', order.totalHargaFormatted || `Rp${Number(order.totalHarga || 0).toLocaleString('id-ID')}`);
        pushBytes(ESC, 0x45, 0x00);
        if (order.statusPembayaranDb === 'retur') {
            line('-');
            pushText(`RETUR: -Rp${Number(order.nominalRetur || 0).toLocaleString('id-ID')}\n`);
            if (order.alasanRetur) pushText(`Alasan: ${order.alasanRetur}\n`);
        }
        line('-');
        pushBytes(ESC, 0x61, 0x01);
        pushText('Terima Kasih!\nSelamat Menikmati\n');
    }

    pushText('\n\n\n');
    // Partial cut
    pushBytes(GS, 0x56, 0x41, 0x03);
    return new Uint8Array(bytes);
}

export async function connectBluetoothPrinter() {
    if (!navigator.bluetooth) {
        throw new Error('Browser ini tidak mendukung Web Bluetooth. Gunakan Chrome/Edge atau cetak via dialog browser.');
    }
    const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2']
    });
    const server = await device.gatt.connect();
    const services = await server.getPrimaryServices();
    let writableChar = null;
    for (const svc of services) {
        const chars = await svc.getCharacteristics();
        for (const ch of chars) {
            if (ch.properties.write || ch.properties.writeWithoutResponse) {
                writableChar = ch;
                break;
            }
        }
        if (writableChar) break;
    }
    if (!writableChar) throw new Error('Karakteristik tulis printer thermal Bluetooth tidak ditemukan.');

    btCharacteristic = writableChar;
    connectedType = 'bluetooth';
    printerName = device.name || 'Printer Thermal Bluetooth';
    return getPrinterStatus();
}

export async function connectSerialPrinter() {
    if (!navigator.serial) {
        throw new Error('Browser ini tidak mendukung Web Serial (USB). Gunakan Chrome/Edge desktop.');
    }
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
    serialPort = port;
    connectedType = 'serial';
    printerName = 'Printer Thermal USB (Serial)';
    return getPrinterStatus();
}

export async function disconnectPrinter() {
    try {
        if (serialPort && serialPort.close) await serialPort.close();
    } catch (e) {}
    btCharacteristic = null;
    serialPort = null;
    connectedType = null;
    printerName = '';
    return getPrinterStatus();
}

async function sendRawBytes(data) {
    if (connectedType === 'bluetooth' && btCharacteristic) {
        const chunkSize = 180;
        for (let i = 0; i < data.length; i += chunkSize) {
            const slice = data.slice(i, i + chunkSize);
            if (btCharacteristic.properties.writeWithoutResponse) {
                await btCharacteristic.writeValueWithoutResponse(slice);
            } else {
                await btCharacteristic.writeValue(slice);
            }
        }
        return true;
    }
    if (connectedType === 'serial' && serialPort && serialPort.writable) {
        const writer = serialPort.writable.getWriter();
        try {
            await writer.write(data);
        } finally {
            writer.releaseLock();
        }
        return true;
    }
    return false;
}

export async function printThermalOrFallback(order, mode = 'struk', htmlFallbackFn = null) {
    if (connectedType) {
        try {
            const payload = buildEscPosReceipt(order, mode);
            const sent = await sendRawBytes(payload);
            if (sent) return { method: connectedType, success: true };
        } catch (err) {
            console.warn('Cetak printer thermal langsung gagal, fallback ke dialog browser:', err);
        }
    }
    if (typeof htmlFallbackFn === 'function') {
        htmlFallbackFn(order, mode);
        return { method: 'browser', success: true };
    }
    return { method: 'none', success: false };
}

export { isAutoPrintEnabled, setAutoPrintEnabled, getPrinterStatus };
