# Sistem Hasil Penjualan UD Fikri — Web + Supabase

Versi web berbasis HTML, CSS, JavaScript, dan Supabase. Semua halaman berada dalam satu dashboard responsif yang dapat dipasang di Vercel, Netlify, Cloudflare Pages, atau hosting statis lain.

## Fitur

- Login email dan password melalui Supabase Auth
- Import Excel Produk Terlaris Griyo Pos
- Perhitungan penjualan, modal, laba kotor, dan jumlah item
- Gaji pokok dan bonus harian
- Pengambilan gaji dan saldo hak gaji setiap karyawan
- Pencarian serta pengurutan riwayat gaji berdasarkan nama
- Pengeluaran operasional dan pengeluaran yang ditandai nama karyawan
- Pengeluaran karyawan tetap mengurangi laba dan tidak mengurangi saldo gaji
- Aturan pembagian laba berupa nominal tetap atau persentase
- Riwayat tutup buku harian
- Tampilan responsif untuk HP, tablet, laptop, dan PC

## Struktur folder

```text
dist/
├── index.html
├── assets/logo-ud-fikri.png
├── css/style.css
└── js/
    ├── config.js
    ├── supabase.js
    └── app.js
supabase/
└── schema.sql
```

## Pemasangan Supabase

1. Buat project baru di Supabase.
2. Buka **SQL Editor**, salin seluruh isi `supabase/schema.sql`, kemudian jalankan.
3. Buka **Authentication → Users → Add user** dan buat akun admin menggunakan email serta password.
4. Buka **Project Settings → API**.
5. Salin **Project URL** dan **anon/public key** ke `dist/js/config.js`:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://project-id.supabase.co",
  SUPABASE_ANON_KEY: "anon-key-anda"
};
```

Jangan menggunakan `service_role key` di file JavaScript. Key tersebut bersifat rahasia dan tidak boleh dipasang pada browser.

## Menjalankan di komputer

Jalankan folder `dist` menggunakan ekstensi Live Server di Visual Studio Code atau server lokal lain. Hindari membuka `index.html` langsung dengan alamat `file://`.

## Deploy ke Vercel

1. Upload project ke GitHub.
2. Impor repository di Vercel.
3. Pilih **Framework Preset: Other**.
4. Kosongkan Build Command.
5. Isi Output Directory dengan `dist`.
6. Klik Deploy.

## Rumus sistem

```text
Modal = Penjualan Produk - Laba Kotor

Laba untuk Dibagi =
Laba Kotor
- Gaji dan Bonus
- Semua Pengeluaran
- Alokasi Nominal Tetap
```

Pengambilan gaji tidak mengurangi laba untuk kedua kalinya. Laba sudah dikurangi ketika hak gaji harian dicatat. Pengambilan hanya mengurangi saldo hak gaji karyawan.

## Data awal

- Nama toko: UD Fikri
- Karyawan: Heri dan Alfi
- Gaji harian awal: Rp60.000
- Aturan pembagian contoh otomatis dibuat oleh `schema.sql`
