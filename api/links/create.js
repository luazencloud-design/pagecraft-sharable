import { getStore } from './_store.js';
import { verifyAdmin, setCors, sanitizeError } from './_auth.js';
import crypto from 'crypto';

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = verifyAdmin(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  try {
    const store = await getStore();
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    const { title, maxVisits, expiresAt } = body;

    if (!title) return res.status(400).json({ error: '제목(title)은 필수입니다.' });

    const token = crypto.randomBytes(16).toString('hex');

    const linkData = {
      token,
      title,
      maxVisits: parseInt(maxVisits) || 0,
      currentVisits: 0,
      visitLog: [],
      expiresAt: expiresAt || null,
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
    return res.status(500).json({ error: sanitizeError(err) });
  }
}
