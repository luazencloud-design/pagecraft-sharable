import { getStore } from './_store.js';
import crypto from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const store = await getStore();
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { token } = body;

    if (!token) return res.status(400).json({ error: '토큰이 필요합니다.' });

    const raw = await store.get(`link:${token}`);
    if (!raw) return res.status(404).json({ error: '유효하지 않은 링크입니다.', code: 'NOT_FOUND' });

    const link = typeof raw === 'string' ? JSON.parse(raw) : raw;

    if (!link.active) return res.status(403).json({ error: '비활성화된 링크입니다.', code: 'INACTIVE' });
    if (link.expiresAt && new Date(link.expiresAt) < new Date())
      return res.status(403).json({ error: '만료된 링크입니다.', code: 'EXPIRED' });
    if (link.maxVisits > 0 && link.currentVisits >= link.maxVisits)
      return res.status(403).json({ error: '최대 접근 횟수를 초과했습니다.', code: 'MAX_VISITS' });

    // ✅ 접근 허용 → 카운트 증가
    link.currentVisits += 1;
    link.visitLog.push({
      visitedAt: new Date().toISOString(),
      visitNumber: link.currentVisits,
      ip: req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown',
    });
    await store.set(`link:${token}`, JSON.stringify(link));

    // ✅ 세션 토큰 발급 (1시간 유효)
    const sessionToken = crypto.randomBytes(24).toString('hex');
    const sessionData = {
      linkToken: token,
      title: link.title,
      createdAt: new Date().toISOString(),
    };
    await store.set(`session:${sessionToken}`, JSON.stringify(sessionData), { ex: 3600 });

    return res.status(200).json({
      success: true,
      sessionToken,
      title: link.title,
      remainingVisits: link.maxVisits > 0 ? link.maxVisits - link.currentVisits : null,
      expiresAt: link.expiresAt,
    });

  } catch (err) {
    console.error('접근 검증 에러:', err);
    return res.status(500).json({ error: err.message });
  }
}
