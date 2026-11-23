# Backend Word ke PDF (LibreOffice Headless)
1. Server/VPS dengan Docker (atau Railway/Render/Fly.io/Cloud Run). Wajib HTTPS (Caddy/Nginx/Cloudflare).
2. `docker build -t bh-word2pdf backend/`
3. `docker run -d --restart=always -p 3000:3000 -e ALLOWED_ORIGINS=https://www.bunghuda.id --read-only --tmpfs /tmp:size=2g bh-word2pdf`
4. Tes: `curl -F file=@tes.docx https://API-ANDA/api/convert/word-to-pdf -o hasil.pdf -D -` (lihat header X-BH-Pages).
5. Pasang frontend: Blogger > Entri/Halaman baru > Tampilan HTML > tempel isi word-ke-pdf-blogger-v3.html, lalu ubah `API_URL`.
Env: PORT, MAX_MB, ALLOWED_ORIGINS (pisah koma), CONVERT_TIMEOUT_MS, MAX_PARALLEL, RATE_PER_MIN.
