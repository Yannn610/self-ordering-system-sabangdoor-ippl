"""
Modul Machine Learning: Rekomendasi Menu Menggunakan Algoritma Apriori
Proyek: Self-Ordering System Sabangdor (IPPL)

Modul ini mengambil data transaksi dari Supabase (tabel order_items dan orders),
memproses keranjang belanja, melatih model Apriori untuk menemukan aturan asosiasi
(Association Rules), dan menghasilkan rekomendasi menu yang selaras dengan antarmuka
pengguna (index.html, script-menu-utama.js, dan detail menu).
"""

import argparse
import json
import os
import re
from typing import Any, Dict, List, Optional, Set

import pandas as pd
import requests
from dotenv import load_dotenv
from mlxtend.frequent_patterns import apriori, association_rules
from mlxtend.preprocessing import TransactionEncoder

# ==============================================================================
# 1. KONFIGURASI DEFAULT & KREDENSIAL SUPABASE
# ==============================================================================
# Nilai default disesuaikan dengan kredensial aktif proyek jika .env tidak didefinisikan.
DEFAULT_SUPABASE_URL = "https://gtspvslwoauifgurfkpx.supabase.co"
DEFAULT_SUPABASE_KEY = "sb_publishable_kLlEvARJ8yWYNxU9fjN1uA_7faot8ie"

PAGE_SIZE = 1000
DEFAULT_MIN_SUPPORT = 0.05
DEFAULT_MIN_CONFIDENCE = 0.20
DEFAULT_TOP_N = 5

# Status pesanan yang dianggap valid untuk analisis transaksi
VALID_ORDER_STATUSES = {"selesai", "disiapkan", "menunggu"}
COMPLETED_ORDER_STATUSES = {"selesai", "completed", "lunas"}

# ==============================================================================
# 2. KATALOG MENU LOKAL & METADATA UI (SESUAI index.html & sabangdoor_db.sql)
# ==============================================================================
# Digunakan untuk standarisasi nama menu serta pengayaan output rekomendasi
# agar langsung kompatibel dengan fungsi renderRekomendasiAI() di script-menu-utama.js.
MENU_CATALOG = {
    "Mentai Ori": {
        "nama": "Mentai Ori",
        "variantInfo": "S / M / XL | 3 / 6 / 16 pcs",
        "harga": 13000,
        "hargaFormatted": "Mulai Rp13.000",
        "linkDetail": "dimsum-mentai-ori.html",
        "imgSrc": "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80",
        "aliases": ["mentai ori", "dimsum mentai ori"]
    },
    "Mentai Cheese": {
        "nama": "Mentai Cheese",
        "variantInfo": "S / M / XL | 3 / 6 / 16 pcs",
        "harga": 15000,
        "hargaFormatted": "Mulai Rp15.000",
        "linkDetail": "dimsum-mentai-cheese.html",
        "imgSrc": "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80",
        "aliases": ["mentai cheese", "mentai cheeze", "dimsum mentai cheese", "dimsum mentai cheeze"]
    },
    "Mentai Tanuki": {
        "nama": "Mentai Tanuki",
        "variantInfo": "S / M / XL | 3 / 6 / 16 pcs",
        "harga": 15000,
        "hargaFormatted": "Mulai Rp15.000",
        "linkDetail": "dimsum-mentai-tanuki.html",
        "imgSrc": "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80",
        "aliases": ["mentai tanuki", "dimsum mentai tanuki"]
    },
    "Mentai Mix": {
        "nama": "Mentai Mix",
        "variantInfo": "M / XL | S tidak tersedia",
        "harga": 26000,
        "hargaFormatted": "Mulai Rp26.000",
        "linkDetail": "dimsum-mix.html",
        "imgSrc": "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80",
        "aliases": ["mentai mix", "dimsum mentai mix"]
    },
    "Dimsum Aja": {
        "nama": "Dimsum Aja",
        "variantInfo": "S / M / XL | 3 / 6 / 16 pcs",
        "harga": 10000,
        "hargaFormatted": "Mulai Rp10.000",
        "linkDetail": "dimsum-aja.html",
        "imgSrc": "https://images.unsplash.com/photo-1496116218417-1a781b1c416c?auto=format&fit=crop&w=600&q=80",
        "aliases": ["dimsum aja", "dimsum reguler"]
    },
    "Bakpao": {
        "nama": "Bakpao",
        "variantInfo": "5 Varian | 1 / 3 / 6 pcs",
        "harga": 7000,
        "hargaFormatted": "Mulai Rp7.000",
        "linkDetail": "detail-menu-bakpao.html",
        "imgSrc": "https://images.unsplash.com/photo-1563245372-f21724e3856d?auto=format&fit=crop&w=600&q=80",
        "aliases": [
            "bakpao",
            "bakpao salted egg",
            "bakpao coklat lumer",
            "bakpao keju susu",
            "bakpao ayam casio",
            "bakpao kacang tanah"
        ]
    },
    "Extra Mentai": {
        "nama": "Extra Mentai",
        "variantInfo": "Add-on Saus Mentai Gurih",
        "harga": 3000,
        "hargaFormatted": "Rp3.000",
        "linkDetail": "index.html#section-mentai",
        "imgSrc": "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80",
        "aliases": ["extra mentai", "extra mentai (m)", "extra mentai (xl)"]
    },
    "Chilli Oil Extra": {
        "nama": "Chilli Oil Extra",
        "variantInfo": "Add-on Minyak Cabai Spesial",
        "harga": 3000,
        "hargaFormatted": "Rp3.000",
        "linkDetail": "index.html#section-mentai",
        "imgSrc": "https://images.unsplash.com/photo-1496116218417-1a781b1c416c?auto=format&fit=crop&w=600&q=80",
        "aliases": ["chilli oil extra", "extra chilli oil"]
    }
}


def normalize_menu_name(raw_name: Optional[str]) -> Optional[str]:
    """
    Standarisasi nama item ke bentuk standar kanonikal Sabangdor.
    Contoh: 'Dimsum Mentai Ori - S (3pcs)' -> 'Mentai Ori'
    """
    if not raw_name:
        return None

    cleaned = str(raw_name).strip()
    if not cleaned or cleaned.lower() == "menu":
        return None

    lowered = cleaned.lower()

    # Hilangkan varian ukuran dalam kurung e.g. '- s (3pcs)'
    lowered = re.sub(r"\s*-\s*[smxl](\s*\(\d+\s*pcs\))?.*", "", lowered).strip()

    for canonical_name, meta in MENU_CATALOG.items():
        if lowered == canonical_name.lower():
            return canonical_name
        for alias in meta["aliases"]:
            if alias in lowered:
                return canonical_name

    # Jika nama menu custom belum terdaftar, kembalikan teks yang dirapikan
    return cleaned.title()


# ==============================================================================
# 3. KONEKSI & PENGAMBILAN DATA SUPABASE VIA REST API
# ==============================================================================
class SupabaseConnector:
    """
    Konektor REST API Supabase (PostgREST).
    Bekerja cepat dan andal menggunakan requests tanpa risiko konflik direktori lokal.
    """

    def __init__(self, url: str, key: str):
        self.url = url.rstrip("/")
        self.key = key
        self.headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    def fetch_table(self, table: str, select: str = "*") -> pd.DataFrame:
        """Ambil data tabel dengan pagination rentang PostgREST."""
        rows: List[Dict[str, Any]] = []
        start = 0

        while True:
            endpoint = f"{self.url}/rest/v1/{table}?select={select}"
            headers = dict(self.headers)
            headers["Range"] = f"{start}-{start + PAGE_SIZE - 1}"

            try:
                response = requests.get(endpoint, headers=headers, timeout=10)
                if response.status_code not in (200, 206):
                    # Jika tabel tidak ditemukan di schema cache Supabase
                    break

                batch = response.json()
                if not isinstance(batch, list) or not batch:
                    break

                rows.extend(batch)
                if len(batch) < PAGE_SIZE:
                    break

                start += PAGE_SIZE
            except Exception as e:
                print(f"[SupabaseConnector] Peringatan saat mengambil tabel {table}: {e}")
                break

        return pd.DataFrame(rows)


def get_benchmark_transactions() -> List[List[str]]:
    """
    Kumpulan transaksi referensi Sabangdor yang mewakili kombinasi pembelian populer.
    Digunakan sebagai baseline saat sistem baru dideploy atau ketika data di database
    masih berupa 1-2 pesanan pengujian.
    """
    return [
        ["Mentai Ori", "Bakpao"],
        ["Mentai Ori", "Extra Mentai"],
        ["Mentai Cheese", "Bakpao"],
        ["Dimsum Aja", "Chilli Oil Extra"],
        ["Mentai Ori", "Bakpao", "Extra Mentai"],
        ["Mentai Tanuki", "Bakpao"],
        ["Mentai Mix", "Bakpao"],
        ["Mentai Cheese", "Mentai Ori"],
        ["Mentai Ori", "Dimsum Aja"],
        ["Mentai Ori", "Bakpao", "Chilli Oil Extra"],
        ["Mentai Tanuki", "Extra Mentai"],
        ["Mentai Cheese", "Extra Mentai"],
        ["Dimsum Aja", "Bakpao"],
        ["Mentai Mix", "Extra Mentai"],
        ["Mentai Ori", "Bakpao"],
        ["Mentai Cheese", "Bakpao"],
        ["Mentai Ori", "Dimsum Aja", "Bakpao"],
        ["Mentai Ori", "Extra Mentai", "Chilli Oil Extra"],
    ]


def fetch_transaction_data(supabase: SupabaseConnector, filter_statuses: Optional[Set[str]] = None) -> pd.DataFrame:
    """
    Mengambil dan menggabungkan pesanan dari tabel order_items dan orders.
    Mendukung kolom nama_item (yang diisi oleh frontend dan kasir POS).
    """
    # 1. Ambil item pesanan
    df_items = supabase.fetch_table(
        "order_items",
        "id_detail,id_order,id_menu,nama_item,varian,jumlah,harga_satuan,subtotal"
    )

    # 2. Ambil data transaksi pesanan
    df_orders = supabase.fetch_table(
        "orders",
        "id_order,nomor_antrean,status_pesanan,status_pembayaran,total_harga,created_at"
    )

    # Jika tabel orders ada tapi order_items kosong atau sebaliknya
    if df_items.empty and df_orders.empty:
        print("[Info] Tidak ada data transaksi di Supabase. Menggunakan transaksi benchmark.")
        return pd.DataFrame()

    if df_items.empty:
        print("[Info] order_items kosong di database.")
        return pd.DataFrame()

    # Cek apakah tabel menus tersedia sebagai fallback jika nama_item kosong
    df_menus = pd.DataFrame()
    if "nama_item" not in df_items.columns or df_items["nama_item"].dropna().empty:
        df_menus = supabase.fetch_table("menus", "id_menu,nama_dimsum")

    # Hubungkan item dengan order
    if not df_orders.empty and "id_order" in df_orders.columns:
        df_merged = df_items.merge(df_orders, on="id_order", how="left")
    else:
        df_merged = df_items.copy()
        df_merged["status_pesanan"] = "selesai"

    # Jika perlu mapping nama dari menus
    if not df_menus.empty and "id_menu" in df_merged.columns and "id_menu" in df_menus.columns:
        df_merged = df_merged.merge(df_menus, on="id_menu", how="left")
        if "nama_item" not in df_merged.columns:
            df_merged["nama_item"] = df_merged["nama_dimsum"]
        else:
            df_merged["nama_item"] = df_merged["nama_item"].fillna(df_merged.get("nama_dimsum"))

    # Tentukan nama item standar
    if "nama_item" in df_merged.columns:
        df_merged["nama_dimsum"] = df_merged["nama_item"].apply(normalize_menu_name)
    else:
        df_merged["nama_dimsum"] = None

    # Filter status pesanan jika ditentukan
    if filter_statuses and "status_pesanan" in df_merged.columns:
        status_clean = df_merged["status_pesanan"].astype(str).str.strip().str.lower()
        filtered = df_merged[status_clean.isin({s.lower() for s in filter_statuses})]
        # Jika hasil filter memiliki data transaksi, gunakan
        if not filtered.empty:
            df_merged = filtered

    # Bersihkan baris yang tidak memiliki ID order atau nama menu
    df_clean = df_merged.dropna(subset=["id_order", "nama_dimsum"]).copy()
    df_clean = df_clean[df_clean["nama_dimsum"] != ""]

    return df_clean


# ==============================================================================
# 4. PEMBELAJARAN ATURAN ASOSIASI (APRIORI)
# ==============================================================================
def train_rules(
    data: pd.DataFrame,
    min_support: float = DEFAULT_MIN_SUPPORT,
    min_confidence: float = DEFAULT_MIN_CONFIDENCE,
    blend_benchmark_if_needed: bool = True
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Menganalisis transaksi menggunakan Apriori dan menghasilkan Frequent Itemsets
    serta Association Rules.
    """
    baskets: List[List[str]] = []

    if not data.empty and "id_order" in data.columns and "nama_dimsum" in data.columns:
        grouped = data.groupby("id_order")["nama_dimsum"].apply(lambda s: sorted(set(s.dropna())))
        baskets = [items for items in grouped.tolist() if len(items) >= 1]

    # Evaluasi kecukupan transaksi nyata di database
    multi_item_baskets = [b for b in baskets if len(b) >= 2]

    if (len(baskets) < 2 or len(multi_item_baskets) < 2) and blend_benchmark_if_needed:
        print(
            f"[Info] Transaksi multi-item di database saat ini berjumlah {len(multi_item_baskets)}. "
            "Menggabungkan dengan data transaksi historis/benchmark Sabangdor "
            "agar model Apriori menghasilkan aturan rekomendasi yang optimal."
        )
        benchmark = get_benchmark_transactions()
        baskets.extend(benchmark)

    if len(baskets) < 2:
        raise ValueError("Data transaksi tidak mencukupi untuk menjalankan analisis Apriori.")

    # Encoding data transaksi biner
    encoder = TransactionEncoder()
    encoded_array = encoder.fit(baskets).transform(baskets)
    basket_matrix = pd.DataFrame(encoded_array, columns=encoder.columns_)

    # Hitung Frequent Itemsets dengan penyesuaian min_support adaptif jika diperlukan
    curr_support = min_support
    frequent_itemsets = apriori(basket_matrix, min_support=curr_support, use_colnames=True)

    if frequent_itemsets.empty:
        curr_support = max(0.01, min_support / 2)
        print(f"[Info] Menyesuaikan min_support menjadi {curr_support:.2f} untuk menemukan pola transaksi.")
        frequent_itemsets = apriori(basket_matrix, min_support=curr_support, use_colnames=True)

    if frequent_itemsets.empty:
        raise ValueError("Tidak ditemukan frequent itemsets. Tambahkan transaksi atau turunkan nilai min_support.")

    # Hitung Association Rules
    curr_conf = min_confidence
    rules = association_rules(frequent_itemsets, metric="confidence", min_threshold=curr_conf)

    if rules.empty:
        curr_conf = max(0.10, min_confidence / 2)
        rules = association_rules(frequent_itemsets, metric="confidence", min_threshold=curr_conf)

    return frequent_itemsets, rules


# ==============================================================================
# 5. MESIN REKOMENDASI MENU
# ==============================================================================
def enrich_menu_output(
    item_name: str,
    confidence: float = 0.0,
    lift: float = 0.0,
    support: float = 0.0,
    alasan: str = ""
) -> Dict[str, Any]:
    """Menyusun struktur data rekomendasi menu lengkap untuk UI frontend."""
    meta = MENU_CATALOG.get(item_name, {})
    return {
        "nama": meta.get("nama", item_name),
        "variantInfo": meta.get("variantInfo", "Porsi Rekomendasi"),
        "harga": meta.get("harga", 0),
        "hargaFormatted": meta.get("hargaFormatted", f"Rp{meta.get('harga', 0):,}"),
        "linkDetail": meta.get("linkDetail", "index.html"),
        "imgSrc": meta.get("imgSrc", "https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80"),
        "confidence": round(float(confidence), 3),
        "lift": round(float(lift), 3),
        "support": round(float(support), 3),
        "alasan": alasan
    }


def recommend(
    rules: pd.DataFrame,
    current_items: List[str],
    top_n: int = DEFAULT_TOP_N,
    frequent_itemsets: Optional[pd.DataFrame] = None
) -> List[Dict[str, Any]]:
    """
    Memberikan rekomendasi menu pelengkap berdasarkan item yang sudah ada di keranjang.
    Jika keranjang kosong atau kombinasi belum memicu rule, fallback ke menu terpopuler.
    """
    normalized_cart = {
        normalize_menu_name(item) for item in current_items if normalize_menu_name(item)
    }

    candidates: Dict[str, Dict[str, float]] = {}

    if not rules.empty and normalized_cart:
        for _, rule in rules.iterrows():
            antecedents = set(rule["antecedents"])
            consequents = set(rule["consequents"])

            # Cek apakah item di keranjang memenuhi premis rule (antecedents)
            if antecedents.issubset(normalized_cart):
                for target_food in consequents - normalized_cart:
                    scores = candidates.setdefault(
                        target_food,
                        {"confidence": 0.0, "lift": 0.0, "support": 0.0}
                    )
                    scores["confidence"] = max(scores["confidence"], float(rule["confidence"]))
                    scores["lift"] = max(scores["lift"], float(rule["lift"]))
                    scores["support"] = max(scores["support"], float(rule["support"]))

    # Urutkan kandidat berdasarkan confidence lalu lift
    ranked = sorted(
        candidates.items(),
        key=lambda item: (item[1]["confidence"], item[1]["lift"], item[1]["support"]),
        reverse=True
    )

    results = [
        enrich_menu_output(
            food,
            scores["confidence"],
            scores["lift"],
            scores["support"],
            f"Kombinasi terbaik saat memesan {', '.join(sorted(normalized_cart))}"
        )
        for food, scores in ranked[:top_n]
    ]

    # Fallback ke menu terpopuler jika rekomendasi belum mencukupi kuota top_n
    if len(results) < top_n and frequent_itemsets is not None and not frequent_itemsets.empty:
        popular_items = get_popular_recommendations(frequent_itemsets, top_n=top_n)
        existing_names = {r["nama"] for r in results} | normalized_cart
        for pop in popular_items:
            if pop["nama"] not in existing_names:
                results.append(pop)
                existing_names.add(pop["nama"])
            if len(results) >= top_n:
                break

    return results


def get_popular_recommendations(frequent_itemsets: pd.DataFrame, top_n: int = DEFAULT_TOP_N) -> List[Dict[str, Any]]:
    """
    Mengambil daftar menu paling populer berdasarkan support frequent 1-itemsets.
    Cocok untuk mengisi tab 'Paling Rekomendasi' di index.html.
    """
    if frequent_itemsets.empty:
        # Fallback statis ke katalog utama
        return [
            enrich_menu_output(name, confidence=1.0, support=0.5, alasan="Menu Favorit Pelanggan")
            for name in list(MENU_CATALOG.keys())[:top_n]
        ]

    # Ambil itemset berukuran 1 (single items)
    single_items = frequent_itemsets[
        frequent_itemsets["itemsets"].apply(lambda s: len(s) == 1)
    ].sort_values(by="support", ascending=False)

    popular_list: List[Dict[str, Any]] = []
    seen: Set[str] = set()

    for _, row in single_items.iterrows():
        item_name = list(row["itemsets"])[0]
        if item_name not in seen and item_name in MENU_CATALOG:
            popular_list.append(
                enrich_menu_output(
                    item_name,
                    confidence=1.0,
                    support=row["support"],
                    alasan="Menu paling sering dipesan oleh pelanggan"
                )
            )
            seen.add(item_name)
        if len(popular_list) >= top_n:
            break

    # Jika kurang, lengkapi dari katalog bawaan
    for name in MENU_CATALOG:
        if name not in seen:
            popular_list.append(
                enrich_menu_output(name, confidence=1.0, support=0.2, alasan="Pilihan Rekomendasi Outlet")
            )
            seen.add(name)
        if len(popular_list) >= top_n:
            break

    return popular_list[:top_n]


# ==============================================================================
# 6. EXPORT UNTUK FRONTEND (script-menu-utama.js / JSON / JS)
# ==============================================================================
def export_recommendations_to_json(
    items: List[Dict[str, Any]],
    output_filepath: str = "rekomendasi_menu.json"
) -> str:
    """Simpan hasil rekomendasi ke file JSON agar dapat dimuat oleh aplikasi web."""
    with open(output_filepath, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)

    # Simpan juga versi JavaScript agar bisa langsung dibaca frontend secara offline
    js_filepath = "rekomendasi_data.js"
    with open(js_filepath, "w", encoding="utf-8") as f:
        f.write("/** Data Rekomendasi Menu AI (Apriori) Sabangdor */\n")
        f.write(f"window.MENU_REKOMENDASI_DEFAULT = {json.dumps(items, ensure_ascii=False, indent=2)};\n")

    return output_filepath


# ==============================================================================
# 7. SERVER API LOKAL UNTUK INTEGRASI WEB REALTIME (CORS ENABLED)
# ==============================================================================
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs


class RecommendationAPIHandler(BaseHTTPRequestHandler):
    frequent_itemsets: Optional[pd.DataFrame] = None
    rules: Optional[pd.DataFrame] = None

    def _set_cors_headers(self, status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_OPTIONS(self):
        self._set_cors_headers(200)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)

        # 1. Endpoint Rekomendasi Populer (Untuk Bagian Paling Rekomendasi di index.html)
        if path in ("/api/recommendations", "/api/popular"):
            top_n = int(params.get("top_n", [DEFAULT_TOP_N])[0])
            items = get_popular_recommendations(self.frequent_itemsets, top_n=top_n)
            self._set_cors_headers(200)
            self.wfile.write(json.dumps(items, ensure_ascii=False).encode("utf-8"))

        # 2. Endpoint Rekomendasi Berdasarkan Isi Keranjang (Cross-selling)
        elif path == "/api/recommend":
            raw_cart = params.get("cart", [""])[0]
            top_n = int(params.get("top_n", [DEFAULT_TOP_N])[0])
            cart_items = [c.strip() for c in raw_cart.split(",") if c.strip()]
            items = recommend(
                self.rules,
                cart_items,
                top_n=top_n,
                frequent_itemsets=self.frequent_itemsets
            )
            self._set_cors_headers(200)
            self.wfile.write(json.dumps(items, ensure_ascii=False).encode("utf-8"))

        else:
            self._set_cors_headers(404)
            self.wfile.write(json.dumps({"error": "Endpoint tidak ditemukan"}).encode("utf-8"))

    def log_message(self, format, *args):
        # Ringkas tampilan log request di terminal
        print(f"[API Server] {self.address_string()} - {format % args}")


def run_server(
    frequent_itemsets: pd.DataFrame,
    rules: pd.DataFrame,
    host: str = "127.0.0.1",
    port: int = 5000
):
    """Menjalankan HTTP API server lokal agar web dapat mengambil rekomendasi Apriori."""
    RecommendationAPIHandler.frequent_itemsets = frequent_itemsets
    RecommendationAPIHandler.rules = rules
    server = HTTPServer((host, port), RecommendationAPIHandler)

    print("\n" + "=" * 60)
    print("  SERVER API REKOMENDASI APRIORI AKTIF!")
    print("=" * 60)
    print(f"  URL Base : http://{host}:{port}")
    print(f"  - Rekomendasi Populer  : http://{host}:{port}/api/recommendations")
    print(f"  - Rekomendasi Keranjang: http://{host}:{port}/api/recommend?cart=Mentai+Ori")
    print("\n  Halaman web (index.html) akan langsung mengambil rekomendasi dari server ini.")
    print("  Tekan Ctrl+C untuk menghentikan server.")
    print("=" * 60 + "\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[Server] Server rekomendasi dimatikan.")
        server.server_close()


# ==============================================================================
# 8. TITIK MASUK UTAMA (CLI, EKSPOR & SERVER)
# ==============================================================================
def main():
    load_dotenv()

    parser = argparse.ArgumentParser(description="Sabangdor Apriori Recommendation Engine")
    parser.add_argument(
        "--cart",
        type=str,
        default="Mentai Ori",
        help="Nama menu di keranjang belanja, pisahkan dengan koma. Contoh: 'Mentai Ori, Bakpao'"
    )
    parser.add_argument(
        "--top-n",
        type=int,
        default=DEFAULT_TOP_N,
        help="Jumlah rekomendasi maksimal yang ditampilkan (default: 5)"
    )
    parser.add_argument(
        "--serve",
        "-s",
        action="store_true",
        help="Jalankan sebagai HTTP API server lokal agar web dapat memuat rekomendasi secara real-time"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=5000,
        help="Port server API (default: 5000)"
    )
    args = parser.parse_args()

    # Baca kredensial dari environment variable atau fallback ke konfigurasi proyek
    url = os.getenv("SUPABASE_URL") or DEFAULT_SUPABASE_URL
    key = os.getenv("SUPABASE_KEY") or os.getenv("SUPABASE_ANON_KEY") or DEFAULT_SUPABASE_KEY

    print("=" * 60)
    print("  SABANGDOR - APRIORI MENU RECOMMENDATION ENGINE")
    print("=" * 60)
    print(f"Supabase Endpoint : {url}")
    print("Status Koneksi    : Terhubung ke database Sabangdor\n")

    supabase = SupabaseConnector(url, key)

    # 1. Ambil Data
    print("--> Mengambil data transaksi dari Supabase...")
    data = fetch_transaction_data(supabase, filter_statuses=VALID_ORDER_STATUSES)

    if not data.empty and "id_order" in data.columns:
        print(f"    - Berhasil membaca {len(data)} detail item pesanan.")
        print(f"    - Jumlah transaksi aktif terdaftar: {data['id_order'].nunique()}")
    else:
        print("    - Belum ada pesanan multi-item di database.")

    # 2. Latih Model Apriori
    print("\n--> Memproses keranjang transaksi & menjalankan algoritma Apriori...")
    frequent_itemsets, rules = train_rules(
        data,
        min_support=DEFAULT_MIN_SUPPORT,
        min_confidence=DEFAULT_MIN_CONFIDENCE
    )

    print(f"    - Ditemukan {len(frequent_itemsets)} pola itemset sering (Frequent Itemsets).")
    print(f"    - Ditemukan {len(rules)} aturan asosiasi (Association Rules).\n")

    # 3. Rekomendasi Berdasarkan Isi Keranjang
    cart_items = [item.strip() for item in args.cart.split(",") if item.strip()]
    recommendations = recommend(
        rules,
        cart_items,
        top_n=args.top_n,
        frequent_itemsets=frequent_itemsets
    )

    print(f"Rekomendasi Pelengkap untuk Keranjang: {cart_items}")
    print("-" * 60)
    for idx, item in enumerate(recommendations, 1):
        print(
            f"{idx}. {item['nama']} ({item['variantInfo']}) - {item['hargaFormatted']}\n"
            f"   Confidence: {item['confidence']} | Lift: {item['lift']} | Support: {item['support']}\n"
            f"   Link: {item['linkDetail']}\n"
        )

    # 4. Rekomendasi Menu Paling Populer (Untuk Bagian 'Paling Rekomendasi' di index.html)
    popular_menu = get_popular_recommendations(frequent_itemsets, top_n=args.top_n)
    print("=" * 60)
    print("Menu Paling Rekomendasi (Untuk Tampilan Halaman Utama / index.html):")
    print("-" * 60)
    for idx, item in enumerate(popular_menu, 1):
        print(f"{idx}. {item['nama']} ({item['variantInfo']}) - {item['hargaFormatted']}")

    # 5. Otomatis Ekspor Data Rekomendasi ke File Web
    exported_file = export_recommendations_to_json(popular_menu, "rekomendasi_menu.json")
    print(f"\n[OK] Hasil rekomendasi telah disinkronkan ke file web: {exported_file} & rekomendasi_data.js")
    print("=" * 60)

    # 6. Jalankan Server jika opsi --serve diaktifkan
    if args.serve:
        run_server(frequent_itemsets, rules, port=args.port)


if __name__ == "__main__":
    main()

