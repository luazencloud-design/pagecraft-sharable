import { getStore } from './_store.js';
import { setCors, sanitizeError } from './_auth.js';

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const store = await getStore();
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { sessionToken } = body;

    if (!sessionToken) {
      return res.status(401).json({ valid: false, error: '세션 토큰이 필요합니다.' });
    }

    // ① 세션 토큰 확인
    const raw = await store.get(`session:${sessionToken}`);
    if (!raw) {
      return res.status(401).json({ valid: false, error: '유효하지 않거나 만료된 세션입니다.', code: 'SESSION_EXPIRED' });
    }

    const session = typeof raw === 'string' ? JSON.parse(raw) : raw;

    // ② 원본 링크의 유효성도 함께 검증
    const linkRaw = await store.get(`link:${session.linkToken}`);
    if (!linkRaw) {
      await store.del(`session:${sessionToken}`);
      return res.status(403).json({
        valid: false,
        error: '링크가 삭제되었습니다.',
        code: 'LINK_DELETED',
        kicked: true,
      });
    }

    const link = typeof linkRaw === 'string' ? JSON.parse(linkRaw) : linkRaw;

    // ③ 링크 비활성화 확인
    if (!link.active) {
      await store.del(`session:${sessionToken}`);
      return res.status(403).json({
        valid: false,
        error: '관리자가 링크를 비활성화했습니다.',
        code: 'LINK_INACTIVE',
        kicked: true,
      });
    }

    // ④ 링크 만료 시간 확인
    if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
      await store.del(`session:${sessionToken}`);
      return res.status(403).json({
        valid: false,
        error: '링크의 유효 기간이 만료되었습니다.',
        code: 'LINK_EXPIRED',
        kicked: true,
      });
    }

    // ⑤ 세션 자동 갱신: 링크가 유효한 동안 세션 TTL을 연장
    const MAX_SESSION_TTL = 7 * 24 * 3600;  // 7일
    const MIN_SESSION_TTL = 3600;            // 1시간
    let renewTtl = MAX_SESSION_TTL;

    if (link.expiresAt) {
      const remainingSec = Math.floor((new Date(link.expiresAt).getTime() - Date.now()) / 1000);
      renewTtl = Math.max(MIN_SESSION_TTL, Math.min(remainingSec, MAX_SESSION_TTL));
    }

    // 기존 세션 데이터를 새 TTL로 덮어쓰기 (갱신)
    await store.set(`session:${sessionToken}`, JSON.stringify(session), { ex: renewTtl });

    // ⑥ 유효 → 남은 시간 정보 포함 응답 (linkToken은 노출하지 않음)
    const now = Date.now();
    let remainingMs = null;
    if (link.expiresAt) {
      remainingMs = new Date(link.expiresAt).getTime() - now;
    }

    return res.status(200).json({
      valid: true,
      title: session.title,
      expiresAt: link.expiresAt || null,
      remainingMs,
    });

  } catch (err) {
    console.error('세션 확인 에러:', err);
    return res.status(500).json({ valid: false, error: sanitizeError(err) });
  }
}
