import { getStore } from './_store.js';
import crypto from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 어드민 비밀번호 검증
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

    const {
      title,           // 링크 제목/설명
      maxVisits,       // 최대 접근 횟수 (0 = 무제한)
      expiresAt,       // 만료 일시 (ISO string, null = 무제한)
      allowedEmails,   // 허용된 이메일 목록 (배열)
      content,         // 공유할 콘텐츠 (HTML or 이미지 URL 등)
      contentType,     // 'html', 'image', 'redirect'
      redirectUrl,     // contentType이 'redirect'일 때 리디렉트할 URL
    } = body;

    if (!title) return res.status(400).json({ error: '제목(title)은 필수입니다.' });
    if (!allowedEmails || !Array.isArray(allowedEmails) || allowedEmails.length === 0) {
      return res.status(400).json({ error: '허용 이메일 목록(allowedEmails)은 필수입니다.' });
    }

    // 고유 토큰 생성
    const token = crypto.randomBytes(16).toString('hex');

    const linkData = {
      token,
      title,
      maxVisits: parseInt(maxVisits) || 0,
      currentVisits: 0,
      visitLog: [],
      expiresAt: expiresAt || null,
      allowedEmails: allowedEmails.map(e => e.trim().toLowerCase()),
      content: content || null,
      contentType: contentType || 'html',
      redirectUrl: redirectUrl || null,
      createdAt: new Date().toISOString(),
      active: true,
    };

    await store.set(`link:${token}`, JSON.stringify(linkData));

    return res.status(200).json({
      success: true,
      token,
      url: `/view?token=${token}`,
      data: linkData,
    });

  } catch (err) {
    console.error('링크 생성 에러:', err);
    return res.status(500).json({ error: err.message });
  }
}
