import { getStore } from './_store.js';
import { setCors, sanitizeError } from './_auth.js';
import crypto from 'crypto';

// ── 봇/프리페치 감지 ──
function isBotOrPrefetch(req) {
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  const purpose = (req.headers['purpose'] || req.headers['sec-purpose'] || '').toLowerCase();

  const botPatterns = [
    'bot', 'crawler', 'spider', 'preview', 'slurp', 'facebookexternalhit',
    'kakaotalk', 'slackbot', 'discordbot', 'telegrambot', 'whatsapp',
    'twitterbot', 'linkedinbot', 'embedly', 'quora', 'pinterest',
    'googlebot', 'bingbot', 'yandex', 'baiduspider',
  ];

  if (botPatterns.some(p => ua.includes(p))) return true;
  if (purpose === 'prefetch' || purpose === 'preview') return true;
  if (req.headers['x-purpose'] === 'preview') return true;

  return false;
}

export default async function handler(req, res) {
  setCors(req, res);
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

    // ── 봇/프리페치 요청은 조용히 무시 (에러 메시지 노출 없이) ──
    if (isBotOrPrefetch(req)) {
      return res.status(200).json({ success: false, preview: true });
    }

    // ── 기본 검증 ──
    // 만료/비활성/횟수초과 시: 기존에 등록된 IP면 실제 사유 표시,
    // 미등록 IP면 "유효하지 않은 링크"로 위장 (보안)
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.headers['x-real-ip'] || 'unknown';
    const existingIp = await store.get(`ip:${clientIp}`);

    const linkExpired = link.expiresAt && new Date(link.expiresAt) < new Date();
    const linkInactive = !link.active;
    const linkMaxed = link.maxVisits > 0 && link.currentVisits >= link.maxVisits;

    if (linkExpired || linkInactive || linkMaxed) {
      // 이전에 등록된 IP → 실제 사유 알려줌
      if (existingIp) {
        if (linkExpired) return res.status(403).json({ error: '만료된 링크입니다.', code: 'EXPIRED' });
        if (linkInactive) return res.status(403).json({ error: '비활성화된 링크입니다.', code: 'INACTIVE' });
        return res.status(403).json({ error: '최대 접근 횟수를 초과했습니다.', code: 'MAX_VISITS' });
      }
      // 미등록 IP → 링크 존재 자체를 숨김
      return res.status(404).json({ error: '유효하지 않은 링크입니다.', code: 'NOT_FOUND' });
    }

    // ── 방문 유예기간: 같은 IP에서 5분 이내 재방문이면 카운트 안 함 ──
    const graceKey = `grace:${token}:${clientIp}`;
    const existingGrace = await store.get(graceKey);
    const shouldCountVisit = !existingGrace;

    if (shouldCountVisit) {
      // ── 레이스 컨디션 완화: 먼저 증가 후 한도 재확인 ──
      link.currentVisits += 1;

      if (link.maxVisits > 0 && link.currentVisits > link.maxVisits) {
        link.currentVisits -= 1;
        await store.set(`link:${token}`, JSON.stringify(link));
        return res.status(403).json({ error: '최대 접근 횟수를 초과했습니다.', code: 'MAX_VISITS' });
      }

      link.visitLog.push({
        visitedAt: new Date().toISOString(),
        visitNumber: link.currentVisits,
        ip: clientIp,
      });

      await store.set(`link:${token}`, JSON.stringify(link));
      // 5분간 유예기간 설정
      await store.set(graceKey, '1', { ex: 300 });
    }

    // ── 세션 TTL 계산: 링크 잔여 시간에 맞춤 (최소 1시간, 최대 7일) ──
    const MAX_SESSION_TTL = 7 * 24 * 3600;  // 7일
    const MIN_SESSION_TTL = 3600;            // 1시간
    let sessionTtl = MAX_SESSION_TTL;

    if (link.expiresAt) {
      const remainingSec = Math.floor((new Date(link.expiresAt).getTime() - Date.now()) / 1000);
      sessionTtl = Math.max(MIN_SESSION_TTL, Math.min(remainingSec, MAX_SESSION_TTL));
    }

    // ── 세션 토큰 발급 ──
    const sessionToken = crypto.randomBytes(24).toString('hex');
    const sessionData = {
      linkToken: token,
      title: link.title,
      createdAt: new Date().toISOString(),
    };
    await store.set(`session:${sessionToken}`, JSON.stringify(sessionData), { ex: sessionTtl });

    // ── IP 등록: 유효한 링크를 통해 접근한 IP를 기억 ──
    const ipKey = `ip:${clientIp}`;
    if (!existingIp) {
      await store.set(ipKey, JSON.stringify({
        firstVisit: new Date().toISOString(),
        linkToken: token,
        registeredAt: new Date().toISOString(),
      }));
    }

    return res.status(200).json({
      success: true,
      sessionToken,
      title: link.title,
      remainingVisits: link.maxVisits > 0 ? link.maxVisits - link.currentVisits : null,
      expiresAt: link.expiresAt,
      ipRegistered: true,
    });

  } catch (err) {
    console.error('접근 검증 에러:', err);
    return res.status(500).json({ error: sanitizeError(err) });
  }
}
