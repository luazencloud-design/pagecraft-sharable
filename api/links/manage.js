import { getStore } from './_store.js';

// 특정 링크에 연결된 모든 세션을 즉시 삭제
async function revokeSessionsForLink(store, linkToken) {
  try {
    const sessionKeys = await store.keys('session:*');
    let revoked = 0;
    for (const key of sessionKeys) {
      const raw = await store.get(key);
      if (!raw) continue;
      const session = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (session.linkToken === linkToken) {
        await store.del(key);
        revoked++;
      }
    }
    return revoked;
  } catch (e) {
    console.warn('세션 정리 중 오류:', e.message);
    return 0;
  }
}

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

    // 삭제 → 관련 세션도 즉시 삭제
    if (action === 'delete' || req.method === 'DELETE') {
      const revoked = await revokeSessionsForLink(store, token);
      await store.del(`link:${token}`);
      return res.status(200).json({ success: true, message: '링크가 삭제되었습니다.', revokedSessions: revoked });
    }

    // 토글 (활성/비활성) → 비활성화 시 세션도 즉시 삭제
    if (action === 'toggle') {
      const link = typeof raw === 'string' ? JSON.parse(raw) : raw;
      link.active = !link.active;
      await store.set(`link:${token}`, JSON.stringify(link));
      let revoked = 0;
      if (!link.active) {
        revoked = await revokeSessionsForLink(store, token);
      }
      return res.status(200).json({ success: true, active: link.active, revokedSessions: revoked });
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
