import { getStore } from './_store.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const store = await getStore();
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { sessionToken } = body;

    if (!sessionToken) {
      return res.status(401).json({ valid: false, error: '세션 토큰이 필요합니다.' });
    }

    const raw = await store.get(`session:${sessionToken}`);
    if (!raw) {
      return res.status(401).json({ valid: false, error: '유효하지 않거나 만료된 세션입니다.' });
    }

    const session = typeof raw === 'string' ? JSON.parse(raw) : raw;

    return res.status(200).json({
      valid: true,
      title: session.title,
      linkToken: session.linkToken,
    });

  } catch (err) {
    console.error('세션 확인 에러:', err);
    return res.status(500).json({ valid: false, error: err.message });
  }
}
