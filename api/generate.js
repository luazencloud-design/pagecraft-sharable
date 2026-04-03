import { verifySession, setCors, sanitizeError } from './links/_auth.js';

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── 세션 검증 (인증된 사용자만 AI 기능 사용 가능) ──
  const session = await verifySession(req);
  if (!session.ok) return res.status(session.status).json({ error: session.error });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { model, systemInstruction, contents, generationConfig } = body;

    if (!contents || !Array.isArray(contents) || contents.length === 0) {
      return res.status(400).json({ 
        error: "contents 데이터가 누락되었습니다." 
      });
    }

    const targetModel = model || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    return res.status(500).json({ error: sanitizeError(err) });
  }
}
