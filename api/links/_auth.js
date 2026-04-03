import crypto from 'crypto';
import { getStore } from './_store.js';

// ── 타이밍 공격 방지 비밀번호 비교 ──
export function verifyAdmin(req) {
  const adminPw = process.env.ADMIN_PASSWORD;
  if (!adminPw) return { ok: false, status: 500, error: 'ADMIN_PASSWORD 환경변수가 설정되지 않았습니다.' };

  const authHeader = req.headers.authorization || '';
  const providedPw = authHeader.replace('Bearer ', '');

  if (!providedPw) return { ok: false, status: 401, error: '관리자 인증 실패' };

  // 길이가 다르면 더미 비교 후 실패 (타이밍 일정하게 유지)
  const a = Buffer.from(adminPw, 'utf8');
  const b = Buffer.from(providedPw, 'utf8');
  const match = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!match) return { ok: false, status: 401, error: '관리자 인증 실패' };
  return { ok: true };
}

// ── API용 세션 검증 (generate, render에서 사용) ──
export async function verifySession(req) {
  const sessionToken = req.headers['x-session-token'];
  if (!sessionToken) {
    return { ok: false, status: 401, error: '세션 토큰이 필요합니다.' };
  }

  const store = await getStore();
  const raw = await store.get(`session:${sessionToken}`);
  if (!raw) {
    return { ok: false, status: 401, error: '유효하지 않거나 만료된 세션입니다.' };
  }

  const session = typeof raw === 'string' ? JSON.parse(raw) : raw;

  // 원본 링크 유효성도 확인
  const linkRaw = await store.get(`link:${session.linkToken}`);
  if (!linkRaw) {
    await store.del(`session:${sessionToken}`);
    return { ok: false, status: 403, error: '링크가 삭제되었습니다.' };
  }

  const link = typeof linkRaw === 'string' ? JSON.parse(linkRaw) : linkRaw;
  if (!link.active) {
    await store.del(`session:${sessionToken}`);
    return { ok: false, status: 403, error: '링크가 비활성화되었습니다.' };
  }
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
    await store.del(`session:${sessionToken}`);
    return { ok: false, status: 403, error: '링크가 만료되었습니다.' };
  }

  return { ok: true, session, link };
}

// ── 에러 메시지 정제 (내부 정보 노출 방지) ──
export function sanitizeError(err) {
  const msg = err?.message || String(err);
  // 스택 트레이스, 파일 경로 등 제거
  if (msg.includes('/') || msg.includes('\\') || msg.length > 200) {
    return '서버 내부 오류가 발생했습니다.';
  }
  return msg;
}

// ── CORS 헤더 설정 ──
export function setCors(req, res, methods = 'POST, OPTIONS') {
  const origin = req.headers.origin;
  const allowedHost = process.env.ALLOWED_ORIGIN; // 선택적 환경변수

  if (allowedHost) {
    // 환경변수가 설정되어 있으면 해당 origin만 허용
    if (origin === allowedHost) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
  } else {
    // 같은 도메인 요청이면 허용 (origin이 없으면 same-origin)
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
  }

  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Token');
  res.setHeader('Vary', 'Origin');
}
