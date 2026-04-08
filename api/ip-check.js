import { getStore } from './links/_store.js';

// ── IP 인식 확인 API ──

const CYCLE_DAYS = 30;
const CYCLE_MS = CYCLE_DAYS * 24 * 60 * 60 * 1000;
const LIMIT = 100;

function calcCycle(firstVisitIso) {
  const firstVisit = new Date(firstVisitIso).getTime();
  const now = Date.now();
  const cyclesPassed = Math.floor((now - firstVisit) / CYCLE_MS);
  const currentCycleStart = firstVisit + cyclesPassed * CYCLE_MS;
  const currentCycleEnd = currentCycleStart + CYCLE_MS;
  return { currentCycleStart, currentCycleEnd };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || 'unknown';

  if (clientIp === 'unknown') {
    return res.status(200).json({ recognized: false });
  }

  try {
    const store = await getStore();
    const ipRaw = await store.get(`ip:${clientIp}`);

    if (!ipRaw) {
      return res.status(200).json({ recognized: false });
    }

    const ipData = typeof ipRaw === 'string' ? JSON.parse(ipRaw) : ipRaw;

    // ── 1. 만료 확인 → 만료되면 IP 즉시 삭제 ──
    if (ipData.expiresAt && new Date(ipData.expiresAt) < new Date()) {
      await store.del(`ip:${clientIp}`);
      await store.del(`ip-usage:${clientIp}`);
      return res.status(200).json({ recognized: false, expired: true });
    }

    // ── 2. 연결된 링크 존재 여부 확인 ──
    const linkRaw = await store.get(`link:${ipData.linkToken}`);
    if (!linkRaw) {
      // 링크가 삭제됨 → 고아 IP → 삭제
      await store.del(`ip:${clientIp}`);
      await store.del(`ip-usage:${clientIp}`);
      return res.status(200).json({ recognized: false });
    }

    const link = typeof linkRaw === 'string' ? JSON.parse(linkRaw) : linkRaw;

    // ── 3. 링크 비활성화 확인 → IP는 유지하되 접근 차단 ──
    if (!link.active) {
      return res.status(200).json({ recognized: false, inactive: true });
    }

    // ── 4. 링크 자체의 만료 확인 (관리자가 만료일을 변경했을 수 있음) ──
    if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
      await store.del(`ip:${clientIp}`);
      await store.del(`ip-usage:${clientIp}`);
      return res.status(200).json({ recognized: false, expired: true });
    }

    // ── 5. 사용량 조회 ──
    const { currentCycleStart, currentCycleEnd } = calcCycle(ipData.firstVisit);
    const usageRaw = await store.get(`ip-usage:${clientIp}`);
    let usage = usageRaw ? (typeof usageRaw === 'string' ? JSON.parse(usageRaw) : usageRaw) : null;

    let used = 0;
    if (usage && usage.cycleStart === currentCycleStart) {
      used = usage.count;
    }

    return res.status(200).json({
      recognized: true,
      remaining: Math.max(0, LIMIT - used),
      used,
      limit: LIMIT,
      cycleResetAt: new Date(currentCycleEnd).toISOString(),
      firstVisit: ipData.firstVisit,
      expiresAt: ipData.expiresAt || link.expiresAt || null,
    });

  } catch (err) {
    console.error('IP 확인 에러:', err);
    return res.status(500).json({ error: err.message });
  }
}
