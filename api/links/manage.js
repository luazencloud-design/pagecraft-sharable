import { getStore } from './_store.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

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
    const { token, action } = body;

    if (!token) return res.status(400).json({ error: '토큰이 필요합니다.' });

    const raw = await store.get(`link:${token}`);
    if (!raw) return res.status(404).json({ error: '링크를 찾을 수 없습니다.' });

    // 삭제
    if (action === 'delete' || req.method === 'DELETE') {
      await store.del(`link:${token}`);
      return res.status(200).json({ success: true, message: '링크가 삭제되었습니다.' });
    }

    // 토글 (활성/비활성)
    if (action === 'toggle') {
      const link = typeof raw === 'string' ? JSON.parse(raw) : raw;
      link.active = !link.active;
      await store.set(`link:${token}`, JSON.stringify(link));
      return res.status(200).json({ success: true, active: link.active });
    }

    // 수정
    if (action === 'update') {
      const link = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const { maxVisits, expiresAt, title } = body;
      if (title !== undefined) link.title = title;
      if (maxVisits !== undefined) link.maxVisits = parseInt(maxVisits) || 0;
      if (expiresAt !== undefined) link.expiresAt = expiresAt || null;
      await store.set(`link:${token}`, JSON.stringify(link));
      return res.status(200).json({ success: true, data: link });
    }

    // 방문 기록 초기화
    if (action === 'resetVisits') {
      const link = typeof raw === 'string' ? JSON.parse(raw) : raw;
      link.currentVisits = 0;
      link.visitLog = [];
      await store.set(`link:${token}`, JSON.stringify(link));
      return res.status(200).json({ success: true, message: '방문 기록이 초기화되었습니다.' });
    }

    return res.status(400).json({ error: '유효하지 않은 action입니다.' });

  } catch (err) {
    console.error('링크 관리 에러:', err);
    return res.status(500).json({ error: err.message });
  }
}
