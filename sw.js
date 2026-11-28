/**
 * File: sw.js
 * PB-053: Service Worker PWA Sabangdor
 * - Menyimpan halaman utama, skrip, dan stylesheet di cache agar cepat dimuat pada jaringan lambat/offline.
 * - Tidak pernah meng-cache permintaan API Supabase agar data pesanan/stok selalu segar.
 */
const CACHE_NAME = 'sabangdor-pwa-v2';

const PRECACHE_URLS = [
    './',
    './index.html',
    './keranjang.html',
    './checkout.html',
    './detail-menu-custom.html',
    './status-pesanan.html',
    './riwayat-pembeli.html',
    './layar-antrean.html',
    './login-pegawai.html',
    './penjual-page/dashboard.html',
    './style-menu-utama.css',
    './style-detail-menu.css',
    './style-keranjang.css',
    './style-pembayaran-menu.css',
    './style-layar-antrean.css',
    './penjual-page/style-penjual.css',
    './config.js',
    './error-messages.js',
    './validation.js',
    './i18n.js',
    './telemetry.js',
    './settings-store.js',
    './menu-custom-store.js',
    './apriori_recommendation.js',
    './script-menu-utama.js',
    './script-detail-menu.js',
    './script-keranjang.js',
    './script-pembayaran.js',
    './script-status-pesanan.js',
    './script-riwayat-pembeli.js',
    './script-layar-antrean.js',
    './manifest.webmanifest',
    './assets/icon-192.svg',
    './assets/icon-512.svg'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    // Jangan cache API Supabase atau permintaan lintas domain API
    if (url.hostname.includes('supabase.co') || url.pathname.startsWith('/api/')) {
        return;
    }

    // Untuk navigasi HTML: Network-first, fallback ke cache saat jaringan lambat/offline
    if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    if (res && res.ok) {
                        const copy = res.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
                    }
                    return res;
                })
                .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
        );
        return;
    }

    // Untuk aset statis lokal (CSS/JS/SVG): Stale-While-Revalidate
    if (url.origin === self.location.origin) {
        event.respondWith(
            caches.match(req).then((cached) => {
                const networkPromise = fetch(req)
                    .then((res) => {
                        if (res && res.ok) {
                            const copy = res.clone();
                            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
                        }
                        return res;
                    })
                    .catch(() => cached);
                return cached || networkPromise;
            })
        );
    }
});
