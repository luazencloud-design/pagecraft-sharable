export default async function handler(req, res) {
  // CORS 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });

  try {
    // 1. 안전한 JSON 파싱 (문자열로 넘어올 경우 대비)
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    
    // 프론트엔드에서 넘어온 페이로드 추출
    const { model, systemInstruction, contents, generationConfig } = body;
    
    // 2. contents 누락 방어 로직 (에러 디버깅용)
    if (!contents || !Array.isArray(contents) || contents.length === 0) {
      console.error("요청 바디 확인:", body); // Vercel 로그에서 원인 파악 가능
      return res.status(400).json({ 
        error: "contents 데이터가 누락되었습니다. 프론트엔드에서 데이터를 제대로 보내고 있는지 확인해주세요." 
      });
    }

    const targetModel = model || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      // 빈 값이 있는 속성은 제거하고 유효한 데이터만 전송
      body: JSON.stringify({
        ...(systemInstruction && { systemInstruction }),
        contents,
        ...(generationConfig && { generationConfig })
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error("Gemini API 에러:", data);
      return res.status(response.status).json(data);
    }
    
    return res.status(200).json(data);
    
  } catch (err) {
    console.error("서버 내부 에러:", err);
    return res.status(500).json({ error: err.message });
  }
}