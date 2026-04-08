import { getStore } from './links/_store.js';

// ── AI 모델 이미지 생성 ──
// gemini-2.5-flash-image 모델로 상품 착용 모델 이미지 생성
// Vercel KV 기반 IP별 월 100장 제한 (첫 방문일 기준 30일 주기)

const CYCLE_DAYS = 30;
const CYCLE_MS = CYCLE_DAYS * 24 * 60 * 60 * 1000;
const LIMIT = 100;

function calcCycle(firstVisitIso) {
  const firstVisit = new Date(firstVisitIso).getTime();
  const now = Date.now();
  const cyclesPassed = Math.floor((now - firstVisit) / CYCLE_MS);
  const currentCycleStart = firstVisit + cyclesPassed * CYCLE_MS;
  return currentCycleStart;
}

// ── 카테고리별 촬영 포커스 결정 ──
function getCameraFocus(category, productName) {
  const name = (productName || '').toLowerCase();
  const cat = (category || '').toLowerCase();

  if (/귀걸이|이어링|귀/.test(name)) return { part: 'ears and face', shot: 'close-up head and shoulders shot focusing on the ears', crop: 'head to shoulders' };
  if (/목걸이|네크리스|펜던트|목/.test(name)) return { part: 'neck and chest', shot: 'close-up upper body shot focusing on the neckline', crop: 'face to mid-chest' };
  if (/팔찌|뱅글|시계|손목/.test(name)) return { part: 'wrist and forearm', shot: 'close-up shot of the wrist and hand area', crop: 'elbow to fingertips' };
  if (/반지|링/.test(name)) return { part: 'fingers and hand', shot: 'extreme close-up of the hand showcasing the ring on the finger', crop: 'hand and fingers only' };
  if (/안경|선글라스/.test(name)) return { part: 'face', shot: 'close-up face shot focusing on the eyewear', crop: 'head to chin' };
  if (/벨트/.test(name)) return { part: 'waist', shot: 'mid-body shot focusing on the waist and belt area', crop: 'chest to thighs' };
  if (/양말|삭스/.test(name)) return { part: 'feet and ankles', shot: 'low-angle shot focusing on the feet and ankles', crop: 'knees to feet' };

  if (/패딩|점퍼|집업|후리스|후리|티셔츠|맨투맨|상의|자켓|코트|셔츠|블라우스|니트|가디건|조끼/.test(cat)) {
    return { part: 'upper body', shot: '3/4 upper body shot focusing on the torso and outerwear details', crop: 'head to waist' };
  }
  if (/바지|하의|팬츠|스커트|치마|레깅스|청바지|슬랙스/.test(cat)) {
    return { part: 'lower body', shot: 'full body shot with emphasis on the lower half, pants/skirt details clearly visible', crop: 'waist to feet' };
  }
  if (/가방|배낭|백팩|토트|크로스백|숄더백/.test(cat)) {
    return { part: 'back and side view', shot: '3/4 rear view or side view showing the bag being carried naturally', crop: 'head to knees, angled to show bag' };
  }
  if (/모자|캡|비니|버킷햇|햇/.test(cat)) {
    return { part: 'head and face', shot: 'close-up head and upper body shot, clearly showing the hat style', crop: 'top of hat to shoulders' };
  }
  if (/신발|부츠|스니커즈|운동화|로퍼|구두/.test(cat)) {
    return { part: 'feet and legs', shot: 'full body shot with low camera angle emphasizing the footwear', crop: 'full body, camera low angle' };
  }
  if (/슬리퍼|샌들|쪼리/.test(cat)) {
    return { part: 'feet', shot: 'close-up shot of the feet clearly showing the sandals/slippers', crop: 'knees to feet' };
  }
  if (/스카프|머플러|넥워머/.test(cat)) {
    return { part: 'neck and shoulders', shot: 'upper body portrait focusing on the neck area and how the scarf is styled', crop: 'head to chest' };
  }
  if (/모자|액세서리/.test(cat)) {
    return { part: 'accessory area', shot: 'close-up shot clearly showcasing the accessory being worn', crop: 'focused on accessory location' };
  }

  return { part: 'full body', shot: 'full body shot showing the complete outfit', crop: 'head to toe' };
}

// ── IP에서 사용량 조회/업데이트 공통 로직 ──
async function getIpUsage(store, clientIp) {
  const ipRaw = await store.get(`ip:${clientIp}`);
  if (!ipRaw) return { registered: false };

  const ipData = typeof ipRaw === 'string' ? JSON.parse(ipRaw) : ipRaw;
  const currentCycleStart = calcCycle(ipData.firstVisit);

  const usageRaw = await store.get(`ip-usage:${clientIp}`);
  let usage = usageRaw ? (typeof usageRaw === 'string' ? JSON.parse(usageRaw) : usageRaw) : null;

  // 새 주기면 리셋
  if (!usage || usage.cycleStart !== currentCycleStart) {
    usage = { count: 0, cycleStart: currentCycleStart };
  }

  return { registered: true, ipData, usage, currentCycleStart };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || 'unknown';

  const store = await getStore();

  // ── GET: IP별 사용량 조회 ──
  if (req.method === 'GET') {
    const info = await getIpUsage(store, clientIp);
    if (!info.registered) {
      return res.status(200).json({ recognized: false, remaining: 0, used: 0, limit: LIMIT });
    }
    const remaining = Math.max(0, LIMIT - info.usage.count);
    return res.status(200).json({
      recognized: true,
      remaining,
      used: info.usage.count,
      limit: LIMIT,
      cycleResetAt: new Date(info.currentCycleStart + CYCLE_MS).toISOString(),
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });

  // ── 테스트용: _testCount 파라미터 ──
  if (req.body._testCount !== undefined) {
    const info = await getIpUsage(store, clientIp);
    if (!info.registered) {
      return res.status(403).json({ error: '등록되지 않은 IP입니다.' });
    }
    const testCount = parseInt(req.body._testCount, 10) || 0;
    const usage = { count: testCount, cycleStart: info.currentCycleStart };
    await store.set(`ip-usage:${clientIp}`, JSON.stringify(usage));
    return res.status(200).json({
      message: `테스트: ${clientIp}의 카운터를 ${testCount}로 설정했습니다.`,
      remaining: LIMIT - testCount, used: testCount, limit: LIMIT
    });
  }

  // ── IP 등록 확인 ──
  const info = await getIpUsage(store, clientIp);
  if (!info.registered) {
    return res.status(403).json({
      error: '등록되지 않은 접근입니다. 유효한 링크를 통해 먼저 접근해주세요.',
      code: 'IP_NOT_REGISTERED'
    });
  }

  // ── 링크 유효기간 만료 확인 ──
  if (info.ipData.expiresAt && info.ipData.linkToken !== 'pin-auth') {
    if (new Date(info.ipData.expiresAt) < new Date()) {
      return res.status(403).json({
        error: '링크의 유효 기간이 만료되었습니다.',
        code: 'LINK_EXPIRED'
      });
    }
  }

  // ── 한도 확인 ──
  if (info.usage.count >= LIMIT) {
    return res.status(429).json({
      error: `AI 모델 이미지 생성 한도(${LIMIT}개)를 초과했습니다. ${new Date(info.currentCycleStart + CYCLE_MS).toLocaleDateString('ko-KR')}에 초기화됩니다.`,
      remaining: 0, used: info.usage.count, limit: LIMIT
    });
  }

  try {
    const { productName, category, gender, productImages } = req.body;

    if (!productName && !category) {
      return res.status(400).json({ error: '상품명 또는 카테고리가 필요합니다.' });
    }

    const genderEn = gender === 'male' ? 'male' : 'female';
    const focus = getCameraFocus(category, productName);

    const prompt = `You are a professional Korean e-commerce product photographer.

CREATE a photorealistic studio photograph with these EXACT specifications:

SUBJECT: A Korean ${genderEn} model in their late 20s wearing/using "${productName || category}"

CAMERA & COMPOSITION:
- ${focus.shot}
- Crop: ${focus.crop}
- The product on the ${focus.part} must be the visual focal point of the image
- Use shallow depth of field to draw attention to the product area

IMPORTANT — PRODUCT vs CATEGORY CONFLICT:
- If the reference images show a product that does NOT match the category "${category}", ALWAYS follow what the reference images show.
- For example: if category says "모자" but the image shows a jacket, photograph the model wearing the jacket (upper body focus).

STYLING:
- Clean white or light gray studio background
- Professional studio lighting (soft key light + fill light + rim light)
- The model should look natural, confident, and stylish
- Product details (color, shape, material, pattern, texture) must match the reference images EXACTLY

TECHNICAL:
- High-resolution commercial photography, 4K quality
- No text, watermark, or logo
- Photorealistic — must look like a real photograph, not AI-generated`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`;

    const imageParts = [];
    if (productImages && Array.isArray(productImages)) {
      for (const imgData of productImages.slice(0, 5)) {
        if (!imgData || typeof imgData !== 'string') continue;
        const mimeMatch = imgData.match(/^data:(image\/\w+);base64,/);
        if (mimeMatch) {
          imageParts.push({ inlineData: { mimeType: mimeMatch[1], data: imgData.split(',')[1] } });
        }
      }
    }

    const textPart = imageParts.length > 0
      ? `Here are ${imageParts.length} reference photo(s) of the product. Study the product's color, shape, material, and design carefully, then determine what type of product it actually is (regardless of the category label). Then create: ${prompt}`
      : prompt;

    const requestBody = {
      contents: [{ role: 'user', parts: [...imageParts, { text: textPart }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'], maxOutputTokens: 4096 }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Gemini Image 에러:', data);
      return res.status(response.status).json({
        error: data.error?.message || `이미지 생성 실패 (${response.status})`
      });
    }

    const parts = data.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find(p => p.inlineData);

    if (!imagePart) {
      return res.status(500).json({ error: 'AI가 이미지를 생성하지 못했습니다. 다시 시도해주세요.' });
    }

    // ── 카운터 증가 & KV 저장 ──
    info.usage.count += 1;
    await store.set(`ip-usage:${clientIp}`, JSON.stringify(info.usage));

    return res.status(200).json({
      image: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`,
      remaining: LIMIT - info.usage.count,
      used: info.usage.count,
      limit: LIMIT,
      focus: focus.part
    });

  } catch (err) {
    console.error('모델 이미지 생성 에러:', err);
    return res.status(500).json({ error: err.message });
  }
}
