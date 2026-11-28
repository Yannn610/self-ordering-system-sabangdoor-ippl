/**
 * File: penjual-page/offline-pos.js
 * PB-076: Mode offline untuk kasir — menyimpan pesanan manual POS lokal saat internet putus
 * dan menyinkronkannya otomatis saat kembali online tanpa duplikasi (memakai client_tx_id unik).
 */

const OFFLINE_QUEUE_KEY = 'sabangdor_offline_pos_queue';

function generateTxId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return 'pos-' + crypto.randomUUID();
    }
    return 'pos-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function getOfflineQueue() {
    try {
        const raw = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
        return Array.isArray(raw) ? raw : [];
    } catch (e) {
        return [];
    }
}

function saveOfflineQueue(list) {
    try {
        localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(list));
    } catch (e) {}
}

export function enqueueOfflinePosOrder(payload) {
    const queue = getOfflineQueue();
    const txId = payload.client_tx_id || generateTxId();
    const entry = {
        ...payload,
        client_tx_id: txId,
        queued_at: new Date().toISOString(),
        local_queue_num: queue.length + 1
    };
    queue.push(entry);
    saveOfflineQueue(queue);
    return entry;
}

export async function syncOfflineQueue(supabaseClient) {
    const queue = getOfflineQueue();
    if (!queue.length || !supabaseClient) return { synced: 0, remaining: queue.length };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return { synced: 0, remaining: queue.length };
    }

    let synced = 0;
    const remaining = [];

    for (const item of queue) {
        try {
            let res = await supabaseClient.rpc('buat_pesanan', {
                p_nama: item.p_nama,
                p_tipe: item.p_tipe,
                p_items: item.p_items,
                p_status_bayar: item.p_status_bayar || 'lunas',
                p_status_pesanan: item.p_status_pesanan || 'disiapkan',
                p_client_tx_id: item.client_tx_id
            });
            if (res.error && (res.error.code === 'PGRST202' || /could not find the function/i.test(res.error.message || ''))) {
                res = await supabaseClient.rpc('buat_pesanan', {
                    p_nama: item.p_nama,
                    p_tipe: item.p_tipe,
                    p_items: item.p_items,
                    p_status_bayar: item.p_status_bayar || 'lunas',
                    p_status_pesanan: item.p_status_pesanan || 'disiapkan'
                });
            }
            if (res.error) throw res.error;
            synced++;
        } catch (err) {
            console.warn('Gagal sinkron pesanan offline:', item.client_tx_id, err.message || err);
            remaining.push(item);
        }
    }

    saveOfflineQueue(remaining);
    return { synced, remaining: remaining.length };
}

export function isOnline() {
    return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}
