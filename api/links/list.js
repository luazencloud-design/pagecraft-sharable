import { getStore } from './_store.js';
import { verifyAdmin, setCors, sanitizeError } from './_auth.js';

export default async function handler(req, res) {
  setCors(req, res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = verifyAdmin(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  try {
    const store = await getStore();
    const keys = await store.keys('link:*');
    const links = [];

    for (const key of keys) {
      const raw = await store.get(key);
      if (raw) {
        const link = typeof raw === 'string' ? JSON.parse(raw) : raw;
        links.push(link);
      }
    }

    links.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.status(200).json({ success: true, links });

  } catch (err) {
    console.error('링크 목록 에러:', err);
    return res.status(500).json({ error: sanitizeError(err) });
  }
}
