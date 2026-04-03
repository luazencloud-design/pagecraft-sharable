import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ── 한글 폰트 로딩 (Vercel 서버리스 환경 대응) ──
let fontsLoaded = false;

async function ensureFonts() {
  if (fontsLoaded) return;

  // 1순위: 프로젝트에 번들된 폰트
  const projectDir = process.cwd();
  const bundledPaths = [
    join(projectDir, 'fonts', 'NotoSansKR-Regular.ttf'),
    join(projectDir, 'fonts', 'NotoSansKR-Medium.ttf'),
    join(projectDir, 'public', 'fonts', 'NotoSansKR-Regular.ttf'),
  ];

  for (const p of bundledPaths) {
    if (existsSync(p)) {
      GlobalFonts.registerFromPath(p, 'NotoSansKR');
      fontsLoaded = true;
      console.log('Font loaded from bundled path:', p);

      // Bold 버전도 시도
      const boldPath = p.replace('Regular', 'Bold').replace('Medium', 'Bold');
      if (existsSync(boldPath)) {
        GlobalFonts.registerFromPath(boldPath, 'NotoSansKRBold');
      }
      return;
    }
  }

  // 2순위: /tmp에 캐시된 폰트
  const tmpDir = '/tmp/pagecraft-fonts';
  const cachedFont = join(tmpDir, 'NotoSansKR.otf');

  if (existsSync(cachedFont)) {
    GlobalFonts.registerFromPath(cachedFont, 'NotoSansKR');
    fontsLoaded = true;
    console.log('Font loaded from /tmp cache');
    return;
  }

  // 3순위: CDN에서 다운로드 → /tmp에 캐시
  const fontUrls = [
    'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/public/static/Pretendard-Regular.otf',
    'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/SubsetOTF/KR/NotoSansKR-Regular.otf',
    'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-kr@5.0.19/files/noto-sans-kr-all-400-normal.woff',
  ];

  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  for (const url of fontUrls) {
    try {
      console.log('Downloading font from:', url);
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 10000) continue; // 너무 작으면 실패
      writeFileSync(cachedFont, buf);
      GlobalFonts.registerFromPath(cachedFont, 'NotoSansKR');
      fontsLoaded = true;
      console.log('Font downloaded and registered from:', url);
      return;
    } catch (e) {
      console.warn('Font download failed for', url, e.message);
    }
  }

  console.error('⚠️ 한글 폰트를 로드할 수 없습니다. fonts/ 디렉토리에 NotoSansKR-Regular.ttf를 넣어주세요.');
}

// ── 메인 핸들러 ──
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // 폰트 로드 (cold start 시에만 실행)
    await ensureFonts();

    const { data: d, price, images } = req.body;
    const W = 800;

    // 색상
    const BG     = '#ffffff';
    const BLACK  = '#0f0f0f';
    const GRAY   = '#646464';
    const LGRAY  = '#d2d2d2';
    const IVORY  = '#f8f7f4';
    const LINE   = '#e1e1e1';
    const DARK   = '#161616';
    const GOLD   = '#c8a050';
    const YELLOW = '#ffc800';

    // 폰트 패밀리 (등록된 폰트 사용, 없으면 fallback)
    const fontFamily = fontsLoaded ? 'NotoSansKR' : 'sans-serif';
    const fontR = fontFamily;

    // 섹션 높이
    const heroH   = 110;
    const copyH   = 190;
    const ptH     = 270;
    const descH   = 180;  // 문단 하나 높이 (2문단 분리)
    const specH   = 320;
    const kwH     = 120;
    const cautH   = 200;
    const footH   = 90;

    // 사진 높이 계산
    const MAIN_PHOTO_H = 800;     // 메인 사진 (이미지 1)
    const DIVIDER_PHOTO_H = 600;  // 구분 이미지 (이미지 4~10)
    const COLOR_PHOTO_H = 500;    // 컬러 사진 (이미지 2,3)

    // 이미지 로드 (최대 10장)
    let loadedImgs = [];
    const maxImgs = Math.min(images.length, 10);
    for (let i = 0; i < maxImgs; i++) {
      try {
        const buf = Buffer.from(images[i].split(',')[1], 'base64');
        const img = await loadImage(buf);
        loadedImgs.push({ img, w: img.width, h: img.height });
      } catch(e) {
        loadedImgs.push(null);
      }
    }

    // 편의 함수: 해당 인덱스 이미지가 존재하는지
    const hasImg = (idx) => idx < loadedImgs.length && loadedImgs[idx] !== null;

    // 메인/컬러 높이 계산
    const mainH   = hasImg(0) ? MAIN_PHOTO_H : 0;
    const hasColorImgs = hasImg(1) || hasImg(2);
    const colorH  = hasColorImgs ? COLOR_PHOTO_H : 0;
    const lbl2H   = hasColorImgs ? 40 : 0;

    // 구분 이미지 높이 계산 (각각 존재하면 추가)
    const divH = (idx) => hasImg(idx) ? DIVIDER_PHOTO_H : 0;

    // 상세 설명 문단 분리
    const paras = (d.description||'').split('\n').filter(Boolean);
    const para1 = paras.length > 0 ? paras[0] : '';
    const para2 = paras.length > 1 ? paras.slice(1).join('\n') : '';
    const descH1 = para1 ? descH : 0;
    const descH2 = para2 ? descH : 0;

    // ── 전체 높이 계산 ──
    // 레이아웃 순서:
    // 1. 헤더 (heroH)
    // 2. 이미지1 - 메인 (mainH)
    // 3. 메인 카피 (copyH)
    // 4. 이미지4 (divH(3))
    // 5. 이미지8 (divH(7))
    // 6. 판매 포인트 (ptH)
    // 7. 이미지5 (divH(4))
    // 8. 이미지9 (divH(8))
    // 9. 상세 설명 1문단 (descH1)
    // 10. 이미지6 (divH(5))
    // 11. 상세 설명 2문단 (descH2)
    // 12. 이미지7 (divH(6))
    // 13. 이미지10 (divH(9))
    // 14. 컬러 선택 (lbl2H + colorH)
    // 15. 스펙 표 (specH)
    // 16. 키워드 (kwH)
    // 17. 주의사항 (cautH)
    // 18. 푸터 (footH)

    const total = heroH + mainH + copyH
      + divH(3) + divH(7) + ptH
      + divH(4) + divH(8)
      + descH1 + divH(5) + descH2
      + divH(6) + divH(9)
      + (hasColorImgs ? lbl2H + colorH : 0)
      + specH + kwH + cautH + footH;

    const canvas = createCanvas(W, total);
    const ctx = canvas.getContext('2d');

    // ── center-crop 그리기 (object-fit: cover 방식) ──
    function drawImageCover(imgObj, dx, dy, dw, dh) {
      const { img, w: sw, h: sh } = imgObj;
      const srcRatio = sw / sh;
      const dstRatio = dw / dh;
      let sx, sy, sWidth, sHeight;
      if (srcRatio > dstRatio) {
        sHeight = sh;
        sWidth = sh * dstRatio;
        sx = (sw - sWidth) / 2;
        sy = 0;
      } else {
        sWidth = sw;
        sHeight = sw / dstRatio;
        sx = 0;
        sy = (sh - sHeight) / 2;
      }
      ctx.drawImage(img, sx, sy, sWidth, sHeight, dx, dy, dw, dh);
    }

    function fillRect(x, y, w, h, color) {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
    }
    function text(str, x, y, color, size, bold=false) {
      ctx.fillStyle = color;
      ctx.font = `${bold ? '900' : '700'} ${size}px "${fontR}", sans-serif`;
      ctx.fillText(str, x, y);
    }
    function centerText(str, y, color, size, bold=false) {
      ctx.fillStyle = color;
      ctx.font = `${bold ? '900' : '700'} ${size}px "${fontR}", sans-serif`;
      const w2 = ctx.measureText(str).width;
      ctx.fillText(str, (W - w2) / 2, y);
    }
    function line(x1, y1, x2, y2, color, lw=1) {
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    }
    function wrapText(str, x, y, maxW, size, color, lhAdd=8, bold=false) {
      ctx.fillStyle = color;
      ctx.font = `${bold ? '900' : '700'} ${size}px "${fontR}", sans-serif`;
      const lh = size + lhAdd;
      let cur = '';
      let cy = y;
      for (const ch of str) {
        const test = cur + ch;
        if (ctx.measureText(test).width > maxW) {
          ctx.fillText(cur, x, cy);
          cy += lh; cur = ch;
        } else cur = test;
      }
      if (cur) { ctx.fillText(cur, x, cy); cy += lh; }
      return cy;
    }

    // ── 구분 이미지 그리기 공통 함수 (메인 이미지와 동일 양식) ──
    function drawDividerImage(imgIdx, yPos) {
      if (!hasImg(imgIdx)) return yPos;
      fillRect(0, yPos, W, DIVIDER_PHOTO_H, BG);
      drawImageCover(loadedImgs[imgIdx], 0, yPos, W, DIVIDER_PHOTO_H);
      return yPos + DIVIDER_PHOTO_H;
    }

    let y = 0;

    // ══════════════════════════════════════════════
    // 1. 헤더
    // ══════════════════════════════════════════════
    fillRect(0, y, W, heroH, DARK);
    const bt = 'NATIONAL GEOGRAPHIC STYLE  ·  FASHION & ACCESSORY';
    centerText(bt, y+24, YELLOW, 10);
    const ti = d.product_name || '상품 상세페이지';
    centerText(ti.length > 18 ? ti.slice(0,18)+'...' : ti, y+58, '#ffffff', 24, true);
    const su = d.subtitle || '';
    centerText(su, y+86, LGRAY, 13);
    y += heroH;

    // ══════════════════════════════════════════════
    // 2. 이미지 1 — 메인 사진
    // ══════════════════════════════════════════════
    if (hasImg(0) && mainH > 0) {
      fillRect(0, y, W, mainH, BG);
      drawImageCover(loadedImgs[0], 0, y, W, mainH);
      y += mainH;
    }

    // ══════════════════════════════════════════════
    // 3. 메인 카피
    // ══════════════════════════════════════════════
    fillRect(0, y, W, copyH, IVORY);
    line(60, y+36, 100, y+36, GOLD, 2);
    text('MAIN COPY', 108, y+31, GOLD, 10);
    let cy = y+60;
    const copyLines = (d.main_copy||'').split('\n');
    for (const cl of copyLines) {
      cy = wrapText(cl, 60, cy, W-120, 18, BLACK, 8, true);
    }
    y += copyH;

    // ══════════════════════════════════════════════
    // 4. 이미지 4 — 메인 카피 ↔ 판매 포인트 사이
    // ══════════════════════════════════════════════
    y = drawDividerImage(3, y);

    // ══════════════════════════════════════════════
    // 5. 이미지 8 — 이미지4 ↔ 판매 포인트 사이
    // ══════════════════════════════════════════════
    y = drawDividerImage(7, y);

    // ══════════════════════════════════════════════
    // 6. 판매 포인트
    // ══════════════════════════════════════════════
    fillRect(0, y, W, ptH, BG);
    line(60, y+28, 100, y+28, GOLD, 2);
    text('SELLING POINTS', 108, y+23, GOLD, 10);
    const pts = d.selling_points || [];
    const colW = (W-80)/3;
    const px = y+60;
    for (let i=0; i<3; i++) {
      const cx = 40 + i*(colW+10);
      ctx.fillStyle = LGRAY;
      ctx.font = `900 28px "${fontR}", sans-serif`;
      ctx.fillText(`0${i+1}`, cx, px+42);
      line(cx, px+48, cx+colW-10, px+48, LINE);
      ctx.fillStyle = BLACK;
      ctx.font = `900 12px "${fontR}", sans-serif`;
      ctx.fillText((pts[i]||'').slice(0,10), cx, px+64);
      if (pts[i]) wrapText(pts[i], cx, px+82, colW-10, 11, GRAY, 6);
    }
    y += ptH;

    // ══════════════════════════════════════════════
    // 7. 이미지 5 — 판매 포인트 ↔ 상세 설명 사이
    // ══════════════════════════════════════════════
    y = drawDividerImage(4, y);

    // ══════════════════════════════════════════════
    // 8. 이미지 9 — 이미지5 ↔ 상세 설명 사이
    // ══════════════════════════════════════════════
    y = drawDividerImage(8, y);

    // ══════════════════════════════════════════════
    // 9. 상세 설명 — 1문단
    // ══════════════════════════════════════════════
    if (para1) {
      fillRect(0, y, W, descH, IVORY);
      line(60, y+36, 100, y+36, GOLD, 2);
      text('PRODUCT STORY', 108, y+31, GOLD, 10);
      let dy = y+60;
      dy = wrapText(para1, 60, dy, W-120, 13, GRAY, 6);
      y += descH;
    }

    // ══════════════════════════════════════════════
    // 10. 이미지 6 — 상세 설명 1문단 ↔ 2문단 사이
    // ══════════════════════════════════════════════
    y = drawDividerImage(5, y);

    // ══════════════════════════════════════════════
    // 11. 상세 설명 — 2문단
    // ══════════════════════════════════════════════
    if (para2) {
      fillRect(0, y, W, descH, IVORY);
      line(60, y+36, 100, y+36, GOLD, 2);
      text('PRODUCT STORY', 108, y+31, GOLD, 10);
      let dy = y+60;
      const p2Lines = para2.split('\n').filter(Boolean);
      for (const pLine of p2Lines) {
        dy = wrapText(pLine, 60, dy, W-120, 13, GRAY, 6);
        dy += 14;
      }
      y += descH;
    }

    // ══════════════════════════════════════════════
    // 12. 이미지 7 — 상세 설명 2문단 ↔ 컬러 선택 사이
    // ══════════════════════════════════════════════
    y = drawDividerImage(6, y);

    // ══════════════════════════════════════════════
    // 13. 이미지 10 — 이미지7 ↔ 컬러 선택 사이
    // ══════════════════════════════════════════════
    y = drawDividerImage(9, y);

    // ══════════════════════════════════════════════
    // 14. 컬러 선택 (이미지 2+3 나란히)
    // ══════════════════════════════════════════════
    if (hasColorImgs) {
      fillRect(0, y, W, lbl2H, DARK);
      centerText('COLOR VARIATION  ·  컬러 선택', y+24, YELLOW, 10);
      y += lbl2H;

      fillRect(0, y, W, colorH, BG);
      if (hasImg(2)) drawImageCover(loadedImgs[2], 0,   y, W/2, colorH);
      if (hasImg(1)) drawImageCover(loadedImgs[1], W/2, y, W/2, colorH);
      // 라벨
      fillRect(0,    y+colorH-30, W/2, 30, 'rgba(20,20,20,0.85)');
      fillRect(W/2,  y+colorH-30, W/2, 30, 'rgba(240,240,240,0.85)');
      centerText('● COLOR 1', y+colorH-14, '#ffffff', 10);
      line(W/2, y, W/2, y+colorH, '#b0b0b0');
      y += colorH;
    }

    // ══════════════════════════════════════════════
    // 15. 스펙 표
    // ══════════════════════════════════════════════
    fillRect(0, y, W, specH, BG);
    line(60, y+36, 100, y+36, GOLD, 2);
    text('SPECIFICATION', 108, y+31, GOLD, 10);
    const specs = d.specs || [];
    let sy = y+60;
    for (const s of specs) {
      line(60, sy+30, W-60, sy+30, LINE);
      ctx.fillStyle = BLACK;
      ctx.font = `900 12px "${fontR}", sans-serif`;
      ctx.fillText(s.key, 70, sy+20);
      ctx.fillStyle = GRAY;
      ctx.font = `700 12px "${fontR}", sans-serif`;
      ctx.fillText(s.value, 220, sy+20);
      sy += 31;
    }
    y += specH;

    // ══════════════════════════════════════════════
    // 16. 키워드
    // ══════════════════════════════════════════════
    fillRect(0, y, W, kwH, IVORY);
    line(60, y+28, 100, y+28, GOLD, 2);
    text('SEARCH KEYWORDS', 108, y+23, GOLD, 10);
    const kws = d.keywords || [];
    let kx = 60, ky = y+50;
    for (const kw of kws) {
      ctx.font = `700 11px "${fontR}", sans-serif`;
      const kw2 = '#'+kw;
      const kw_w = ctx.measureText(kw2).width + 18;
      if (kx + kw_w > W-60) { kx=60; ky+=32; }
      ctx.strokeStyle = DARK; ctx.lineWidth=1;
      ctx.strokeRect(kx, ky, kw_w, 26);
      ctx.fillStyle = DARK;
      ctx.fillText(kw2, kx+9, ky+17);
      kx += kw_w+8;
    }
    y += kwH;

    // ══════════════════════════════════════════════
    // 17. 주의사항
    // ══════════════════════════════════════════════
    fillRect(0, y, W, cautH, BG);
    line(60, y+36, 100, y+36, GOLD, 2);
    text('CAUTION', 108, y+31, GOLD, 10);
    const cauts = (d.caution||'').split(/[.。]/).filter(c=>c.trim().length>2).slice(0,3);
    let ccy = y+58;
    for (const c of cauts) {
      ctx.fillStyle = GRAY; ctx.beginPath();
      ctx.arc(64, ccy+7, 4, 0, Math.PI*2); ctx.fill();
      ccy = wrapText(c.trim()+'.', 78, ccy, W-138, 12, GRAY, 6);
      ccy += 10;
    }
    y += cautH;

    // ══════════════════════════════════════════════
    // 18. 푸터
    // ══════════════════════════════════════════════
    fillRect(0, y, W, footH, DARK);
    const priceNum = price ? parseInt(price.replace(/[^0-9]/g,''),10) : 0;
    if (priceNum) {
      centerText(`${priceNum.toLocaleString()}원`, y+38, YELLOW, 22, true);
      centerText('PageCraft Pro로 제작된 상세페이지', y+64, '#555568', 10);
    } else {
      centerText('PageCraft Pro  ·  AI 상세페이지 생성기', y+44, YELLOW, 13, true);
      centerText('Made with PageCraft Pro', y+68, '#555568', 10);
    }

    // PNG 출력
    const buffer = canvas.toBuffer('image/png');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', 'attachment; filename="detail-page.png"');
    return res.status(200).send(buffer);

  } catch(err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
