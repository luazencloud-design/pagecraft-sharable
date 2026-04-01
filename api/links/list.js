import { getStore } from './_store.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const adminPw = process.env.ADMIN_PASSWORD;
  if (!adminPw) return res.status(500).json({ error: 'ADMIN_PASSWORD 환경변수가 설정되지 않았습니다.' });

  const authHeader = req.headers.authorization || '';
  const providedPw = authHeader.replace('Bearer ', '');
  if (providedPw !== adminPw) {
    return res.status(401).json({ error: '관리자 인증 실패' });
  }

  try {
    const store = await getStore();
    const keys = await store.keys('link:*');
    const links = [];

    for (const key of keys) {
      const raw = await store.get(key);
      if (raw) {
        const link = typeof raw === 'string' ? JSON.parse(raw) : raw;
        // 콘텐츠는 목록에서 제외 (용량 절약)
        const { content, ...summary } = link;
        summary.hasContent = !!content;
        links.push(summary);
      }
    }

    // 최신순 정렬
    links.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.status(200).json({ success: true, links });

  } catch (err) {
    console.error('링크 목록 에러:', err);
    return res.status(500).json({ error: err.message });
  }
}
