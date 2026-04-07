import crypto from 'crypto';
import { getStore } from './links/_store.js';

// ── PIN 검증 → IP 등록 + 앱 접근 허용 ──
// 관리자 PIN 입력 시: IP 등록 + 어드민 권한 부여
// 일반 사용자도 PIN 입력하면 링크 없이 접근 가능

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const adminPw = process.env.ADMIN_PASSWORD;
  if (!adminPw) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD 환경변수가 설정되지 않았습니다.' });
  }

  try {
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: 'PIN을 입력해주세요.' });

    // 타이밍 공격 방지 비교
    const a = Buffer.from(adminPw, 'utf8');
    const b = Buffer.from(pin, 'utf8');
    const match = a.length === b.length && crypto.timingSafeEqual(a, b);

    if (!match) {
      return res.status(401).json({ error: 'PIN이 올바르지 않습니다.' });
    }

    // PIN 일치 → IP 등록
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.headers['x-real-ip']
      || 'unknown';

    const store = await getStore();
    const ipKey = `ip:${clientIp}`;
    const existing = await store.get(ipKey);

    if (!existing) {
      await store.set(ipKey, JSON.stringify({
        firstVisit: new Date().toISOString(),
        linkToken: 'pin-auth',
        registeredAt: new Date().toISOString(),
      }));
    }

    return res.status(200).json({
      success: true,
      admin: true,
      ipRegistered: true,
      message: '관리자 인증 완료. 앱과 어드민 페이지에 접근할 수 있습니다.',
    });

  } catch (err) {
    console.error('PIN 검증 에러:', err);
    return res.status(500).json({ error: err.message });
  }
}
