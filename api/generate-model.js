// ── AI 모델 이미지 생성 ──
// gemini-2.5-flash-image 모델로 상품 착용 모델 이미지 생성
// 월 100개 제한 (인메모리 카운터 — Vercel 서버리스에서는 cold start마다 리셋됨)
// ⚠️ 프로덕션에서는 KV/DB 기반 카운터로 교체 필요

let monthlyCount = { month: new Date().getMonth(), count: 0 };

function checkMonthlyLimit() {
  const now = new Date().getMonth();
  if (monthlyCount.month !== now) {
    monthlyCount = { month: now, count: 0 };
  }
  return monthlyCount.count < 100;
}

// ── 카테고리별 촬영 포커스 결정 ──
function getCameraFocus(category, productName) {
  const name = (productName || '').toLowerCase();
  const cat = (category || '').toLowerCase();

  // 1) 상품명에서 구체적 아이템 감지 (카테고리보다 우선)
  if (/귀걸이|이어링|귀/.test(name)) return { part: 'ears and face', shot: 'close-up head and shoulders shot focusing on the ears', crop: 'head to shoulders' };
  if (/목걸이|네크리스|펜던트|목/.test(name)) return { part: 'neck and chest', shot: 'close-up upper body shot focusing on the neckline', crop: 'face to mid-chest' };
  if (/팔찌|뱅글|시계|손목/.test(name)) return { part: 'wrist and forearm', shot: 'close-up shot of the wrist and hand area', crop: 'elbow to fingertips' };
  if (/반지|링/.test(name)) return { part: 'fingers and hand', shot: 'extreme close-up of the hand showcasing the ring on the finger', crop: 'hand and fingers only' };
  if (/안경|선글라스/.test(name)) return { part: 'face', shot: 'close-up face shot focusing on the eyewear', crop: 'head to chin' };
  if (/벨트/.test(name)) return { part: 'waist', shot: 'mid-body shot focusing on the waist and belt area', crop: 'chest to thighs' };
  if (/양말|삭스/.test(name)) return { part: 'feet and ankles', shot: 'low-angle shot focusing on the feet and ankles', crop: 'knees to feet' };

  // 2) 카테고리 기반 포커스
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

  // 3) 기본: 전신
  return { part: 'full body', shot: 'full body shot showing the complete outfit', crop: 'head to toe' };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: 남은 횟수 조회 (테스트/디버그용)
  if (req.method === 'GET') {
    checkMonthlyLimit();
    return res.status(200).json({
      remaining: 100 - monthlyCount.count,
      used: monthlyCount.count,
      limit: 100,
      currentMonth: monthlyCount.month,
      note: '⚠️ 인메모리 카운터: Vercel cold start 시 리셋됨. 프로덕션에서는 KV/DB 사용 권장.'
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });

  if (!checkMonthlyLimit()) {
    return res.status(429).json({
      error: '이번 달 AI 모델 이미지 생성 한도(100개)를 초과했습니다.',
      remaining: 0, used: monthlyCount.count, limit: 100
    });
  }

  // ── 테스트용: _testCount 파라미터로 카운터 강제 설정 ──
  if (req.body._testCount !== undefined) {
    monthlyCount.count = parseInt(req.body._testCount, 10) || 0;
    return res.status(200).json({
      message: `테스트: 카운터를 ${monthlyCount.count}로 설정했습니다.`,
      remaining: 100 - monthlyCount.count, used: monthlyCount.count, limit: 100
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

    // 모든 상품 이미지를 참고 이미지로 포함 (최대 5장)
    const imageParts = [];
    if (productImages && Array.isArray(productImages)) {
      for (const imgData of productImages.slice(0, 5)) {
        if (!imgData || typeof imgData !== 'string') continue;
        const mimeMatch = imgData.match(/^data:(image\/\w+);base64,/);
        if (mimeMatch) {
          imageParts.push({
            inlineData: { mimeType: mimeMatch[1], data: imgData.split(',')[1] }
          });
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
      return res.status(500).json({
        error: 'AI가 이미지를 생성하지 못했습니다. 다시 시도해주세요.'
      });
    }

    monthlyCount.count++;

    return res.status(200).json({
      image: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`,
      remaining: 100 - monthlyCount.count,
      used: monthlyCount.count,
      limit: 100,
      focus: focus.part
    });

  } catch (err) {
    console.error('모델 이미지 생성 에러:', err);
    return res.status(500).json({ error: err.message });
  }
}
