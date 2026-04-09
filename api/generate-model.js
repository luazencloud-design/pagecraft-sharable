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

  // 1) 상품명에서 구체적 아이템 감지
  // 머리 착용 액세서리 → 머리만 보이게
  if (/모자|캡|비니|버킷햇|햇|헤어밴드|머리띠/.test(name)) return { part: 'head only', shot: 'tight close-up of the head from top of hat to chin, showing ONLY the head and the accessory. No shoulders, no body.', crop: 'top of accessory to chin only' };
  if (/귀걸이|이어링/.test(name)) return { part: 'head only', shot: 'close-up of the head and ears only, no shoulders visible. Focus on the earrings.', crop: 'top of head to chin' };
  if (/안경|선글라스/.test(name)) return { part: 'head only', shot: 'close-up of the face only, showing the eyewear clearly. No body below chin.', crop: 'forehead to chin' };

  // 목/가슴 액세서리 → 머리+목+가슴
  if (/목걸이|네크리스|펜던트/.test(name)) return { part: 'head and neck', shot: 'portrait from head to mid-chest showing the necklace on the neckline', crop: 'head to mid-chest' };
  if (/스카프|머플러|넥워머/.test(name)) return { part: 'head and neck', shot: 'portrait from head to chest showing how the scarf is wrapped', crop: 'head to chest' };

  // 손목/손 액세서리
  if (/팔찌|뱅글|시계|손목/.test(name)) return { part: 'wrist', shot: 'close-up of the wrist and hand area only', crop: 'elbow to fingertips' };
  if (/반지|링/.test(name)) return { part: 'hand', shot: 'extreme close-up of the hand showcasing the ring', crop: 'hand and fingers only' };

  // 허리
  if (/벨트/.test(name)) return { part: 'waist', shot: 'mid-body shot focusing on the waist area', crop: 'chest to thighs' };

  // 발 → 의자에 앉은 포즈
  if (/양말|삭스/.test(name)) return { part: 'feet', shot: 'model sitting on a white stool/chair with legs crossed, low-angle shot focusing on the feet and ankles. The shoes/socks must be the center of attention.', crop: 'knees to feet' };

  // 2) 카테고리 기반
  // 상의 → 머리+몸만 보이게 (하반신 없음)
  if (/패딩|점퍼|집업|후리스|후리|티셔츠|맨투맨|상의|자켓|코트|셔츠|블라우스|니트|가디건|조끼/.test(cat)) {
    return { part: 'head and torso', shot: 'upper body portrait showing ONLY head and torso. Crop below the waist — no legs visible. Focus on the outerwear details.', crop: 'top of head to waist, no legs' };
  }
  if (/바지|하의|팬츠|스커트|치마|레깅스|청바지|슬랙스/.test(cat)) {
    return { part: 'lower body', shot: 'full body shot with emphasis on the lower half, standing pose showing pants/skirt details clearly', crop: 'waist to feet' };
  }
  // 가방 → 머리+몸+가방 보이게
  if (/가방|배낭|백팩|토트|크로스백|숄더백/.test(cat)) {
    return { part: 'head and torso with bag', shot: 'upper body or 3/4 body shot showing ONLY head, torso, and the bag. The model carries the bag naturally. Show head and body only.', crop: 'head to hips, showing bag' };
  }
  // 모자 → 머리만
  if (/모자|캡|비니|버킷햇|햇/.test(cat)) {
    return { part: 'head only', shot: 'tight close-up of the head showing ONLY the head with the hat. No shoulders, no body below chin.', crop: 'top of hat to chin only' };
  }
  // 신발 → 의자에 앉은 포즈로 신발 강조
  if (/신발|부츠|스니커즈|운동화|로퍼|구두/.test(cat)) {
    return { part: 'feet and legs seated', shot: 'model sitting casually on a white stool/chair with one leg crossed over the other, camera at low angle focusing on the footwear. The shoes must be the CENTER and largest element in the frame.', crop: 'seated pose, thighs to feet' };
  }
  if (/슬리퍼|샌들|쪼리/.test(cat)) {
    return { part: 'feet seated', shot: 'model sitting on a white stool with feet forward, close-up focusing on the sandals/slippers. Shoes are the center of the image.', crop: 'knees to feet, seated' };
  }
  if (/스카프|머플러|넥워머/.test(cat)) {
    return { part: 'head and neck', shot: 'portrait from head to chest showing how the scarf is styled', crop: 'head to chest' };
  }
  if (/액세서리/.test(cat)) {
    return { part: 'accessory focus', shot: 'close-up showing ONLY the body part where the accessory is worn. Minimize visible body area.', crop: 'tight on accessory' };
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

  // ── 만료 확인 → IP 즉시 삭제 ──
  if (info.ipData.expiresAt && new Date(info.ipData.expiresAt) < new Date()) {
    await store.del(`ip:${clientIp}`);
    await store.del(`ip-usage:${clientIp}`);
    return res.status(403).json({ error: '링크의 유효 기간이 만료되었습니다.', code: 'LINK_EXPIRED' });
  }

  // ── 연결된 링크 상태 확인 ──
  const linkRaw = await store.get(`link:${info.ipData.linkToken}`);
  if (!linkRaw) {
    // 링크 삭제됨 → IP도 삭제
    await store.del(`ip:${clientIp}`);
    await store.del(`ip-usage:${clientIp}`);
    return res.status(403).json({ error: '링크가 삭제되었습니다.', code: 'LINK_DELETED' });
  }
  const linkedLink = typeof linkRaw === 'string' ? JSON.parse(linkRaw) : linkRaw;
  if (!linkedLink.active) {
    return res.status(403).json({ error: '링크가 비활성화되었습니다.', code: 'LINK_INACTIVE' });
  }
  if (linkedLink.expiresAt && new Date(linkedLink.expiresAt) < new Date()) {
    await store.del(`ip:${clientIp}`);
    await store.del(`ip-usage:${clientIp}`);
    return res.status(403).json({ error: '링크의 유효 기간이 만료되었습니다.', code: 'LINK_EXPIRED' });
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
- The product MUST be positioned at the CENTER of the image frame
- The product on the ${focus.part} must be the visual focal point of the image
- Use shallow depth of field to draw attention to the product area
- Center the product both horizontally and vertically in the composition

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
