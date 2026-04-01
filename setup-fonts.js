#!/usr/bin/env node
// Vercel 빌드 시 한글 폰트를 다운로드하는 스크립트
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const fontsDir = path.join(__dirname, 'fonts');
if (!fs.existsSync(fontsDir)) fs.mkdirSync(fontsDir, { recursive: true });

const fonts = [
  {
    name: 'NotoSansKR-Regular.ttf',
    url: 'https://github.com/google/fonts/raw/main/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf'
  }
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const makeRequest = (requestUrl) => {
      const mod = requestUrl.startsWith('https') ? https : http;
      mod.get(requestUrl, { headers: { 'User-Agent': 'pagecraft-pro' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // Follow redirect
          makeRequest(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${requestUrl}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', reject);
    };
    makeRequest(url);
  });
}

(async () => {
  for (const font of fonts) {
    const dest = path.join(fontsDir, font.name);
    if (fs.existsSync(dest)) {
      console.log(`✓ ${font.name} already exists`);
      continue;
    }
    console.log(`⬇ Downloading ${font.name}...`);
    try {
      await download(font.url, dest);
      const stats = fs.statSync(dest);
      if (stats.size < 10000) {
        fs.unlinkSync(dest);
        console.warn(`⚠ ${font.name} too small, skipped`);
      } else {
        console.log(`✓ ${font.name} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
      }
    } catch (e) {
      console.warn(`⚠ Failed to download ${font.name}: ${e.message}`);
    }
  }
  console.log('Font setup complete.');
})();
