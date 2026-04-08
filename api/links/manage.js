import { getStore } from './_store.js';
import { verifyAdmin, setCors, sanitizeError } from './_auth.js';

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

// 특정 링크로 등록된 모든 IP를 삭제 (+ 해당 IP의 사용량 데이터도 삭제)
async function revokeIpsForLink(store, linkToken) {
  try {
    const ipKeys = await store.keys('ip:*');
    let revoked = 0;
    for (const key of ipKeys) {
      const raw = await store.get(key);
      if (!raw) continue;
      const ipData = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (ipData.linkToken === linkToken) {
        const ip = key.replace('ip:', '');
        await store.del(key);
        await store.del(`ip-usage:${ip}`);
        revoked++;
      }
    }
    return revoked;
  } catch (e) {
    console.warn('IP 정리 중 오류:', e.message);
    return 0;
  }
}

export default async function handler(req, res) {
  setCors(req, res, 'POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = verifyAdmin(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  try {
    const store = await getStore();
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { token, action } = body;

    if (!token) return res.status(400).json({ error: '토큰이 필요합니다.' });

    const raw = await store.get(`link:${token}`);
    if (!raw) return res.status(404).json({ error: '링크를 찾을 수 없습니다.' });

    // 삭제 → 관련 세션 + IP 즉시 삭제
    if (action === 'delete' || req.method === 'DELETE') {
      const revokedSessions = await revokeSessionsForLink(store, token);
      const revokedIps = await revokeIpsForLink(store, token);
      await store.del(`link:${token}`);
      return res.status(200).json({ success: true, message: '링크와 관련 접근 권한이 모두 삭제되었습니다.', revokedSessions, revokedIps });
    }

    // 토글 (활성/비활성) → 비활성화 시 세션 + IP 즉시 삭제
    if (action === 'toggle') {
      const link = typeof raw === 'string' ? JSON.parse(raw) : raw;
      link.active = !link.active;
      await store.set(`link:${token}`, JSON.stringify(link));
      let revokedSessions = 0, revokedIps = 0;
      if (!link.active) {
        revokedSessions = await revokeSessionsForLink(store, token);
        revokedIps = await revokeIpsForLink(store, token);
      }
      return res.status(200).json({ success: true, active: link.active, revokedSessions, revokedIps });
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

    // 방문 기록 초기화 → 관련 IP도 삭제 (새로 링크 접근 필요)
    if (action === 'resetVisits') {
      const link = typeof raw === 'string' ? JSON.parse(raw) : raw;
      link.currentVisits = 0;
      link.visitLog = [];
      await store.set(`link:${token}`, JSON.stringify(link));
      const revokedSessions = await revokeSessionsForLink(store, token);
      const revokedIps = await revokeIpsForLink(store, token);
      return res.status(200).json({ success: true, message: '방문 기록과 접근 권한이 초기화되었습니다.', revokedSessions, revokedIps });
    }

    return res.status(400).json({ error: '유효하지 않은 action입니다.' });

  } catch (err) {
    console.error('링크 관리 에러:', err);
    return res.status(500).json({ error: sanitizeError(err) });
  }
}
