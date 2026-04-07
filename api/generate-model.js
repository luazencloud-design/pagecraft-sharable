// ── AI 모델 이미지 생성 (테스트용 — 인증 없음) ──
// Gemini Imagen API를 사용하여 상품을 착용한 모델 이미지 생성
// 월 100개 제한 (인메모리 카운터 — 서버리스 환경에서는 KV/DB 필요)

let monthlyCount = { month: new Date().getMonth(), count: 0 };

function checkMonthlyLimit() {
  const now = new Date().getMonth();
  if (monthlyCount.month !== now) {
    monthlyCount = { month: now, count: 0 };
  }
  return monthlyCount.count < 100;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });

  // 월간 제한 체크
  if (!checkMonthlyLimit()) {
    return res.status(429).json({
      error: '이번 달 AI 모델 이미지 생성 한도(100개)를 초과했습니다. 다음 달에 다시 시도해주세요.',
      remaining: 0
    });
  }

  try {
    const { productName, category, gender, productImageBase64 } = req.body;

    if (!productName && !category) {
      return res.status(400).json({ error: '상품명 또는 카테고리가 필요합니다.' });
    }

    const genderKo = gender === 'male' ? '남성' : '여성';
    const genderEn = gender === 'male' ? 'male' : 'female';

    const prompt = `Professional e-commerce product photo of a Korean ${genderEn} model in their late 20s wearing/holding "${productName || category}".
Full body shot, clean white studio background, natural studio lighting, high-resolution commercial photography style.
The model should look confident and stylish, suitable for a Korean online shopping mall product detail page.
No text, no watermark, no logo. Photorealistic, 4K quality.`;

    // Gemini의 이미지 생성 모델 사용
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-image-generation:generateContent?key=${apiKey}`;

    const requestBody = {
      contents: [{
        role: 'user',
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        maxOutputTokens: 4096
      }
    };

    // 상품 이미지가 있으면 참고 이미지로 포함
    if (productImageBase64) {
      const mimeMatch = productImageBase64.match(/^data:(image\/\w+);base64,/);
      if (mimeMatch) {
        requestBody.contents[0].parts.unshift({
          inlineData: {
            mimeType: mimeMatch[1],
            data: productImageBase64.split(',')[1]
          }
        });
        requestBody.contents[0].parts[1].text =
          `Based on this product image, create a ${prompt}`;
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Gemini Imagen 에러:', data);
      return res.status(response.status).json({
        error: data.error?.message || `이미지 생성 실패 (${response.status})`
      });
    }

    // 응답에서 이미지 데이터 추출
    const parts = data.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find(p => p.inlineData);

    if (!imagePart) {
      return res.status(500).json({
        error: 'AI가 이미지를 생성하지 못했습니다. 다시 시도해주세요.'
      });
    }

    // 카운터 증가
    monthlyCount.count++;

    return res.status(200).json({
      image: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`,
      remaining: 100 - monthlyCount.count
    });

  } catch (err) {
    console.error('모델 이미지 생성 에러:', err);
    return res.status(500).json({ error: err.message });
  }
}
