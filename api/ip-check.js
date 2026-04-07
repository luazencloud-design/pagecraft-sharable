import { getStore } from './links/_store.js';

// ── IP 인식 확인 API ──
// GET /api/ip-check → 이 IP가 등록되어 있는지 + AI 모델 이미지 잔여 횟수 반환

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
    return res.status(200).json({ recognized: false, error: 'IP를 확인할 수 없습니다.' });
  }

  try {
    const store = await getStore();
    const ipRaw = await store.get(`ip:${clientIp}`);

    if (!ipRaw) {
      return res.status(200).json({ recognized: false });
    }

    const ipData = typeof ipRaw === 'string' ? JSON.parse(ipRaw) : ipRaw;
    const { currentCycleStart, currentCycleEnd } = calcCycle(ipData.firstVisit);

    // 사용량 조회
    const usageRaw = await store.get(`ip-usage:${clientIp}`);
    let usage = usageRaw ? (typeof usageRaw === 'string' ? JSON.parse(usageRaw) : usageRaw) : null;

    let used = 0;
    if (usage && usage.cycleStart === currentCycleStart) {
      used = usage.count;
    }
    // cycleStart가 다르면 이전 주기 데이터 → used = 0

    return res.status(200).json({
      recognized: true,
      remaining: Math.max(0, LIMIT - used),
      used,
      limit: LIMIT,
      cycleResetAt: new Date(currentCycleEnd).toISOString(),
      firstVisit: ipData.firstVisit,
    });

  } catch (err) {
    console.error('IP 확인 에러:', err);
    return res.status(500).json({ error: err.message });
  }
}
