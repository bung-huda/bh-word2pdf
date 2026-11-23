FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer libreoffice-java-common default-jre-headless \
    fonts-crosextra-carlito fonts-crosextra-caladea fonts-liberation fonts-dejavu fonts-noto-core \
    poppler-utils unzip fontconfig && rm -rf /var/lib/apt/lists/*
# Opsional: letakkan font Anda (mis. Calibri/Times legal) di ./fonts lalu hapus tanda # di bawah
# COPY fonts/ /usr/local/share/fonts/custom/
RUN fc-cache -f
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
RUN useradd -m app && chown -R app /app
USER app
ENV PORT=3000 ALLOWED_ORIGINS=https://www.bunghuda.id MAX_MB=50
EXPOSE 3000
CMD ["node","server.js"]
