import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ── 한글 폰트 로딩 (Vercel 서버리스 환경 대응) ──
let fontsLoaded = false;

async function ensureFonts() {
  if (fontsLoaded) return;

  const tmpDir = '/tmp/pagecraft-fonts';
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  // ── Regular 폰트 로드 ──
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

      const boldPath = p.replace('Regular', 'Bold').replace('Medium', 'Bold');
      if (existsSync(boldPath)) {
        GlobalFonts.registerFromPath(boldPath, 'NotoSansKRBold');
      }
      break;
    }
  }

  const cachedFont = join(tmpDir, 'NotoSansKR.otf');
  if (!fontsLoaded && existsSync(cachedFont)) {
    GlobalFonts.registerFromPath(cachedFont, 'NotoSansKR');
    fontsLoaded = true;
    console.log('Font loaded from /tmp cache');
  }

  if (!fontsLoaded) {
    const fontUrls = [
      'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/public/static/Pretendard-Regular.otf',
      'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/SubsetOTF/KR/NotoSansKR-Regular.otf',
      'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-kr@5.0.19/files/noto-sans-kr-all-400-normal.woff',
    ];

    for (const url of fontUrls) {
      try {
        console.log('Downloading font from:', url);
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 10000) continue;
        writeFileSync(cachedFont, buf);
        GlobalFonts.registerFromPath(cachedFont, 'NotoSansKR');
        fontsLoaded = true;
        console.log('Font downloaded and registered from:', url);
        break;
      } catch (e) {
        console.warn('Font download failed for', url, e.message);
      }
    }
  }

  // ── Heavy(Black) 폰트 로드 (강조 텍스트용) ──
  const heavyBundled = [
    join(projectDir, 'fonts', 'NotoSansKR-Black.ttf'),
    join(projectDir, 'public', 'fonts', 'NotoSansKR-Black.ttf'),
  ];
  let heavyLoaded = false;
  for (const p of heavyBundled) {
    if (existsSync(p)) {
      GlobalFonts.registerFromPath(p, 'NotoSansKRHeavy');
      heavyLoaded = true;
      console.log('Heavy font loaded from bundled path:', p);
      break;
    }
  }

  const cachedHeavy = join(tmpDir, 'NotoSansKR-Black.otf');
  if (!heavyLoaded && existsSync(cachedHeavy)) {
    GlobalFonts.registerFromPath(cachedHeavy, 'NotoSansKRHeavy');
    heavyLoaded = true;
    console.log('Heavy font loaded from /tmp cache');
  }

  if (!heavyLoaded) {
    const heavyUrls = [
      'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/SubsetOTF/KR/NotoSansKR-Black.otf',
      'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/public/static/Pretendard-Black.otf',
    ];
    for (const url of heavyUrls) {
      try {
        console.log('Downloading heavy font from:', url);
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 10000) continue;
        writeFileSync(cachedHeavy, buf);
        GlobalFonts.registerFromPath(cachedHeavy, 'NotoSansKRHeavy');
        heavyLoaded = true;
        console.log('Heavy font downloaded and registered from:', url);
        break;
      } catch (e) {
        console.warn('Heavy font download failed for', url, e.message);
      }
    }
  }

  if (!fontsLoaded) {
    console.error('⚠️ 한글 폰트를 로드할 수 없습니다. fonts/ 디렉토리에 NotoSansKR-Regular.ttf를 넣어주세요.');
  }
}

// ── 메인 핸들러 (인증 없음 — 테스트용) ──
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await ensureFonts();

    const { data: d, price, images, storeIntroImage, termsImage } = req.body;
    const W = 800;

    const BG     = '#ffffff';
    const BLACK  = '#0f0f0f';
    const GRAY   = '#646464';
    const LGRAY  = '#d2d2d2';
    const IVORY  = '#f8f7f4';
    const LINE   = '#e1e1e1';
    const DARK   = '#161616';
    const GOLD   = '#c8a050';
    const YELLOW = '#ffc800';
    const SISAL  = '#E5E1D6';

    const fontFamily = fontsLoaded ? 'NotoSansKR' : 'sans-serif';
    const fontR = fontFamily;
    const fontH = GlobalFonts.families.some(f => f.family === 'NotoSansKRHeavy') ? 'NotoSansKRHeavy' : fontR;

    const heroH   = 110;
    const copyH   = 190;
    const ptH     = 270;
    const descH   = 180;
    const specH   = 320;
    const kwH     = 120;
    const cautH   = 200;
    const footH   = 90;

    const MAIN_PHOTO_H = 800;
    const DIVIDER_PHOTO_H = 600;
    const COLOR_PHOTO_H = 500;

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

    const hasImg = (idx) => idx < loadedImgs.length && loadedImgs[idx] !== null;

    async function loadExtraImage(dataUrl) {
      if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.includes(',')) return null;
      try {
        const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
        const img = await loadImage(buf);
        const drawH = Math.round(img.height * (W / img.width));
        return { img, w: img.width, h: img.height, drawH };
      } catch (e) {
        console.warn('extra image load failed:', e.message);
        return null;
      }
    }
    const storeImgObj = await loadExtraImage(storeIntroImage);
    const termsImgObj = await loadExtraImage(termsImage);
    const storeH = storeImgObj ? storeImgObj.drawH : 0;
    const termsH = termsImgObj ? termsImgObj.drawH : 0;

    const mainH   = hasImg(0) ? MAIN_PHOTO_H : 0;
    const hasColorImgs = hasImg(1) || hasImg(2);
    const colorH  = hasColorImgs ? COLOR_PHOTO_H : 0;
    const lbl2H   = hasColorImgs ? 40 : 0;

    const divH = (idx) => hasImg(idx) ? DIVIDER_PHOTO_H : 0;

    // 상세 설명 파싱
    const descRaw = Array.isArray(d.description) ? d.description.join('\n') : String(d.description||'');
    // 리터럴 \n (백슬래시+n)도 실제 줄바꿈으로 변환
    const descStr = descRaw.replace(/\\n/g, '\n');
    const allDescLines = descStr.split('\n').filter(Boolean);
    const para1 = allDescLines.length > 0 ? allDescLines[0] : '';
    // 이미지 5~10 (인덱스 4~9) 에 붙일 설명 줄 (이미지가 있을 때만)
    const dividerImgIndices = [4, 5, 6, 7, 8, 9];
    const extraDescLines = [];
    let descLineIdx = 1; // para1 다음부터
    for (const imgIdx of dividerImgIndices) {
      if (hasImg(imgIdx) && descLineIdx < allDescLines.length) {
        extraDescLines.push({ imgIdx, text: allDescLines[descLineIdx] });
        descLineIdx++;
      }
    }

    const descH1 = para1 ? descH : 0;
    // 이미지+설명 쌍의 높이 계산
    const EXTRA_DESC_H = 140; // 이미지 아래 설명 1줄 높이 (위아래 여백 포함)
    let extraSectionH = 0;
    for (const ed of extraDescLines) {
      extraSectionH += DIVIDER_PHOTO_H + EXTRA_DESC_H;
    }
    // 설명 없는 구분 이미지 (이미지4~9 중 설명이 안 붙은 것)
    const usedImgIndices = new Set(extraDescLines.map(e => e.imgIdx));
    let plainDivH = 0;
    for (const imgIdx of dividerImgIndices) {
      if (hasImg(imgIdx) && !usedImgIndices.has(imgIdx)) {
        plainDivH += DIVIDER_PHOTO_H;
      }
    }

    const total = storeH + heroH + mainH + copyH
      + divH(3) + ptH + descH1
      + extraSectionH + plainDivH
      + (hasColorImgs ? lbl2H + colorH : 0)
      + specH + kwH + cautH + footH + termsH;

    const canvas = createCanvas(W, total);
    const ctx = canvas.getContext('2d');

    function drawImageCover(imgObj, dx, dy, dw, dh) {
      const { img, w: sw, h: sh } = imgObj;
      const srcRatio = sw / sh;
      const dstRatio = dw / dh;
      let sx, sy, sWidth, sHeight;
      if (srcRatio > dstRatio) {
        sHeight = sh; sWidth = sh * dstRatio; sx = (sw - sWidth) / 2; sy = 0;
      } else {
        sWidth = sw; sHeight = sw / dstRatio; sx = 0; sy = (sh - sHeight) / 2;
      }
      ctx.drawImage(img, sx, sy, sWidth, sHeight, dx, dy, dw, dh);
    }

    function fillRect(x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); }
    function text(str, x, y, color, size, bold=false) {
      ctx.fillStyle = color;
      ctx.font = `${bold ? '700' : '500'} ${size}px "${fontR}", sans-serif`;
      ctx.fillText(str, x, y);
    }
    function centerText(str, y, color, size, bold=false) {
      ctx.fillStyle = color;
      ctx.font = `${bold ? '700' : '500'} ${size}px "${fontR}", sans-serif`;
      const w2 = ctx.measureText(str).width;
      ctx.fillText(str, (W - w2) / 2, y);
    }
    function line(x1, y1, x2, y2, color, lw=1) {
      ctx.strokeStyle = color; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    }
    function wrapText(str, x, y, maxW, size, color, lhAdd=8, bold=false, useHeavy=false) {
      ctx.fillStyle = color;
      const face = useHeavy ? fontH : fontR;
      ctx.font = `${bold ? '700' : '500'} ${size}px "${face}", sans-serif`;
      const lh = size + lhAdd;
      let cur = '';
      let cy = y;
      for (const ch of str) {
        const test = cur + ch;
        if (ctx.measureText(test).width > maxW) { ctx.fillText(cur, x, cy); cy += lh; cur = ch; }
        else cur = test;
      }
      if (cur) { ctx.fillText(cur, x, cy); cy += lh; }
      return cy;
    }

    function drawDividerImage(imgIdx, yPos) {
      if (!hasImg(imgIdx)) return yPos;
      fillRect(0, yPos, W, DIVIDER_PHOTO_H, BG);
      drawImageCover(loadedImgs[imgIdx], 0, yPos, W, DIVIDER_PHOTO_H);
      return yPos + DIVIDER_PHOTO_H;
    }

    let y = 0;

    // 0. 스토어 소개
    if (storeImgObj) {
      fillRect(0, y, W, storeH, BG);
      ctx.drawImage(storeImgObj.img, 0, 0, storeImgObj.w, storeImgObj.h, 0, y, W, storeH);
      y += storeH;
    }

    // 1. 헤더
    fillRect(0, y, W, heroH, DARK);
    const bt = 'NATIONAL GEOGRAPHIC STYLE  ·  FASHION & ACCESSORY';
    centerText(bt, y+24, YELLOW, 10);
    const ti = d.product_name || '상품 상세페이지';
    const titleStr = ti;
    const maxTitleW = W - 80;
    let titleSize = 24;
    ctx.font = `700 ${titleSize}px "${fontH}", sans-serif`;
    while (ctx.measureText(titleStr).width > maxTitleW && titleSize > 12) {
      titleSize -= 1;
      ctx.font = `700 ${titleSize}px "${fontH}", sans-serif`;
    }
    const tw = ctx.measureText(titleStr).width;
    const tx = (W - tw) / 2;
    ctx.fillStyle = '#ffffff'; ctx.fillText(titleStr, tx, y+58);
    const su = d.subtitle || '';
    centerText(su, y+86, LGRAY, 13);
    y += heroH;

    // 2. 메인 사진
    if (hasImg(0) && mainH > 0) {
      fillRect(0, y, W, mainH, BG);
      drawImageCover(loadedImgs[0], 0, y, W, mainH);
      y += mainH;
    }

    // 3. 메인 카피
    fillRect(0, y, W, copyH, IVORY);
    line(60, y+36, 100, y+36, GOLD, 2);
    text('MAIN COPY', 108, y+31, GOLD, 10);
    let cy = y+60;
    const copyLines = (d.main_copy||'').split('\n');
    for (const cl of copyLines) {
      cy = wrapText(cl, 60, cy, W-120, 18, BLACK, 8, true, true);
    }
    y += copyH;

    // 4. 이미지 4
    y = drawDividerImage(3, y);

    // 5. 판매 포인트
    fillRect(0, y, W, ptH, SISAL);
    line(60, y+36, 100, y+36, GOLD, 2);
    text('SELLING POINTS', 108, y+31, GOLD, 10);
    const pts = d.selling_points || [];
    const colW = (W-80)/3;
    const px = y+60;
    for (let i=0; i<3; i++) {
      const cx = 40 + i*(colW+10);
      ctx.fillStyle = BG;
      ctx.font = `700 28px "${fontH}", sans-serif`;
      ctx.fillText(`0${i+1}`, cx, px+42);
      line(cx, px+48, cx+colW-10, px+48, BG);
      ctx.fillStyle = BLACK;
      ctx.font = `700 12px "${fontH}", sans-serif`;
      const ptTitle = (pts[i]||'');
      const ptMaxW = colW - 10;
      let ptText = ptTitle;
      if (ctx.measureText(ptTitle).width > ptMaxW) {
        for (let c = ptTitle.length; c > 0; c--) {
          if (ctx.measureText(ptTitle.slice(0, c)).width <= ptMaxW) { ptText = ptTitle.slice(0, c); break; }
        }
      }
      ctx.fillText(ptText, cx, px+64);
    }
    y += ptH;

    // 6. 상세 설명 1문단 (메인 카피처럼 굵고 크게)
    if (para1) {
      fillRect(0, y, W, descH, IVORY);
      line(60, y+36, 100, y+36, GOLD, 2);
      text('PRODUCT STORY', 108, y+31, GOLD, 10);
      let dy = y+60;
      const p1Lines = String(para1).split('\n');
      for (const pl of p1Lines) {
        dy = wrapText(pl, 60, dy, W-120, 18, BLACK, 8, true, true);
      }
      y += descH;
    }

    // 7~12. 이미지 5~10 + 각각 상세 설명 1줄 (있을 때만)
    for (const imgIdx of dividerImgIndices) {
      if (!hasImg(imgIdx)) continue;
      // 이미지 그리기
      fillRect(0, y, W, DIVIDER_PHOTO_H, BG);
      drawImageCover(loadedImgs[imgIdx], 0, y, W, DIVIDER_PHOTO_H);
      y += DIVIDER_PHOTO_H;
      // 이 이미지에 붙을 설명이 있으면 표시
      const ed = extraDescLines.find(e => e.imgIdx === imgIdx);
      if (ed) {
        fillRect(0, y, W, EXTRA_DESC_H, IVORY);
        wrapText(ed.text, 60, y+70, W-120, 18, BLACK, 8, true, true);
        y += EXTRA_DESC_H;
      }
    }

    // 13. 컬러 선택
    if (hasColorImgs) {
      fillRect(0, y, W, lbl2H, DARK);
      centerText('COLOR VARIATION  ·  컬러 선택', y+24, YELLOW, 10);
      y += lbl2H;
      fillRect(0, y, W, colorH, BG);
      if (hasImg(2)) drawImageCover(loadedImgs[2], 0, y, W/2, colorH);
      if (hasImg(1)) drawImageCover(loadedImgs[1], W/2, y, W/2, colorH);
      fillRect(0, y+colorH-30, W/2, 30, 'rgba(20,20,20,0.85)');
      fillRect(W/2, y+colorH-30, W/2, 30, 'rgba(240,240,240,0.85)');
      centerText('● COLOR 1', y+colorH-14, '#ffffff', 10);
      line(W/2, y, W/2, y+colorH, '#b0b0b0');
      y += colorH;
    }

    // 15. 스펙 표
    fillRect(0, y, W, specH, SISAL);
    line(60, y+36, 100, y+36, GOLD, 2);
    text('SPECIFICATION', 108, y+31, GOLD, 10);
    const specs = d.specs || [];
    let sy = y+60;
    for (const s of specs) {
      line(60, sy+30, W-60, sy+30, LINE);
      ctx.fillStyle = BLACK;
      ctx.font = `700 12px "${fontH}", sans-serif`;
      ctx.fillText(s.key, 70, sy+20);
      ctx.fillStyle = GRAY;
      ctx.font = `500 12px "${fontR}", sans-serif`;
      ctx.fillText(s.value, 220, sy+20);
      sy += 31;
    }
    y += specH;

    // 16. 키워드
    fillRect(0, y, W, kwH, IVORY);
    line(60, y+28, 100, y+28, GOLD, 2);
    text('SEARCH KEYWORDS', 108, y+23, GOLD, 10);
    const kws = d.keywords || [];
    let kx = 60, ky = y+50;
    for (const kw of kws) {
      ctx.font = `500 11px "${fontR}", sans-serif`;
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

    // 17. 주의사항
    fillRect(0, y, W, cautH, SISAL);
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

    // 18. 푸터
    fillRect(0, y, W, footH, DARK);
    const priceNum = price ? parseInt(price.replace(/[^0-9]/g,''),10) : 0;
    if (priceNum) {
      centerText(`${priceNum.toLocaleString()}원`, y+38, YELLOW, 22, true);
      centerText('PageCraft Pro로 제작된 상세페이지', y+64, '#555568', 10);
    } else {
      centerText('PageCraft Pro  ·  AI 상세페이지 생성기', y+44, YELLOW, 13, true);
      centerText('Made with PageCraft Pro', y+68, '#555568', 10);
    }
    y += footH;

    // 19. 약관
    if (termsImgObj) {
      fillRect(0, y, W, termsH, BG);
      ctx.drawImage(termsImgObj.img, 0, 0, termsImgObj.w, termsImgObj.h, 0, y, W, termsH);
      y += termsH;
    }

    const buffer = canvas.toBuffer('image/png');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', 'attachment; filename="detail-page.png"');
    return res.status(200).send(buffer);

  } catch(err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
