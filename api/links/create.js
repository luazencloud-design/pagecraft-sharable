import { getStore } from './_store.js';
import crypto from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const adminPw = process.env.ADMIN_PASSWORD;
  if (!adminPw) return res.status(500).json({ error: 'ADMIN_PASSWORD 환경변수가 설정되지 않았습니다.' });

  const authHeader = req.headers.authorization || '';
  const providedPw = authHeader.replace('Bearer ', '');
  if (providedPw !== adminPw) {
    return res.status(401).json({ error: '관리자 인증 실패' });
  }

  try {
    const store = await getStore();
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    const {
      title,
      maxVisits,
      expiresAt,
      content,
      contentType,
      redirectUrl,
    } = body;

    if (!title) return res.status(400).json({ error: '제목(title)은 필수입니다.' });

    const token = crypto.randomBytes(16).toString('hex');

    const linkData = {
      token,
      title,
      maxVisits: parseInt(maxVisits) || 0,
      currentVisits: 0,
      visitLog: [],
      expiresAt: expiresAt || null,
      content: content || null,
      contentType: contentType || 'html',
      redirectUrl: redirectUrl || null,
      createdAt: new Date().toISOString(),
      active: true,
    };

    await store.set(`link:${token}`, JSON.stringify(linkData));

    return res.status(200).json({
      success: true,
      token,
      url: `/view?token=${token}`,
      data: linkData,
    });

  } catch (err) {
    console.error('링크 생성 에러:', err);
    return res.status(500).json({ error: err.message });
  }
}
