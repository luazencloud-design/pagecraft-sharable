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
    const { token, email } = body;

    if (!token || !email) {
      return res.status(400).json({ error: '토큰과 이메일이 필요합니다.' });
    }

    const raw = await store.get(`link:${token}`);
    if (!raw) {
      return res.status(404).json({ error: '유효하지 않은 링크입니다.', code: 'NOT_FOUND' });
    }

    const link = typeof raw === 'string' ? JSON.parse(raw) : raw;

    // 1. 활성 상태 확인
    if (!link.active) {
      return res.status(403).json({ error: '비활성화된 링크입니다.', code: 'INACTIVE' });
    }

    // 2. 만료 확인
    if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
      return res.status(403).json({ error: '만료된 링크입니다.', code: 'EXPIRED' });
    }

    // 3. 이메일 허용 확인
    const normalizedEmail = email.trim().toLowerCase();
    if (!link.allowedEmails.includes(normalizedEmail)) {
      return res.status(403).json({ error: '접근 권한이 없습니다.', code: 'UNAUTHORIZED' });
    }

    // 4. 최대 방문 횟수 확인
    if (link.maxVisits > 0 && link.currentVisits >= link.maxVisits) {
      return res.status(403).json({ error: '최대 접근 횟수를 초과했습니다.', code: 'MAX_VISITS' });
    }

    // ✅ 접근 허용 → 방문 카운트 증가
    link.currentVisits += 1;
    link.visitLog.push({
      email: normalizedEmail,
      visitedAt: new Date().toISOString(),
      visitNumber: link.currentVisits,
    });

    await store.set(`link:${token}`, JSON.stringify(link));

    return res.status(200).json({
      success: true,
      title: link.title,
      content: link.content,
      contentType: link.contentType,
      redirectUrl: link.redirectUrl,
      remainingVisits: link.maxVisits > 0 ? link.maxVisits - link.currentVisits : null,
      expiresAt: link.expiresAt,
    });

  } catch (err) {
    console.error('접근 검증 에러:', err);
    return res.status(500).json({ error: err.message });
  }
}
