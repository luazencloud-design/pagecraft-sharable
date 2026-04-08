import crypto from 'crypto';

// ── PIN 검증 (어드민 페이지 접근 전용) ──
// IP 등록은 하지 않음 — 앱 접근은 오직 유효한 링크를 통해서만 가능

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

    const a = Buffer.from(adminPw, 'utf8');
    const b = Buffer.from(pin, 'utf8');
    const match = a.length === b.length && crypto.timingSafeEqual(a, b);

    if (!match) {
      return res.status(401).json({ error: 'PIN이 올바르지 않습니다.' });
    }

    // PIN 일치 → 어드민 접근만 허용 (앱 IP 등록 없음)
    return res.status(200).json({
      success: true,
      admin: true,
      message: '관리자 인증 완료. 어드민 페이지로 이동할 수 있습니다.',
    });

  } catch (err) {
    console.error('PIN 검증 에러:', err);
    return res.status(500).json({ error: err.message });
  }
}
