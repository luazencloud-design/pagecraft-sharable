// api/coupang-suggest.js
// 쿠팡 자동완성(연관 인기검색어) 스크래핑 프록시
// 프론트는 CORS 때문에 쿠팡을 직접 호출할 수 없으므로 서버리스 함수에서 대신 호출합니다.
// 여러 시드 키워드를 쉼표로 구분해 한번에 보낼 수 있습니다. 예: /api/coupang-suggest?keyword=무선이어폰,블루투스이어폰

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// 쿠팡 자동완성 원본 엔드포인트 후보 (첫번째부터 시도)
const ENDPOINTS = [
  (kw) => `https://www.coupang.com/np/search/autocomplete?keyword=${encodeURIComponent(kw)}`,
  (kw) => `https://m.coupang.com/nm/search/autoComplete?keyword=${encodeURIComponent(kw)}`,
];

async function fetchOne(keyword) {
  for (const build of ENDPOINTS) {
    try {
      const r = await fetch(build(keyword), {
        method: 'GET',
        headers: {
          'User-Agent': UA,
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
          'Referer': 'https://www.coupang.com/',
        },
      });
      if (!r.ok) continue;
      const text = await r.text();
      let data;
      try { data = JSON.parse(text); } catch { continue; }

      // 응답 스키마 정규화: {keywords:[{keyword:"..."}]} 또는 배열 혹은 {autoComplete:[...]}
      let list = [];
      if (Array.isArray(data)) list = data;
      else if (Array.isArray(data.keywords)) list = data.keywords;
      else if (Array.isArray(data.autoComplete)) list = data.autoComplete;
      else if (Array.isArray(data?.data?.keywords)) list = data.data.keywords;

      const norm = list
        .map((x) => (typeof x === 'string' ? x : x?.keyword || x?.keywordName || x?.name || ''))
        .map((s) => String(s).trim())
        .filter(Boolean);

      if (norm.length) return norm;
    } catch (_) {
      // 다음 엔드포인트 시도
    }
  }
  return [];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    let raw = '';
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      raw = body.keyword || body.keywords || '';
    } else {
      raw = (req.query && (req.query.keyword || req.query.keywords)) || '';
    }

    const seeds = String(raw)
      .split(/[,\n]/g)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 5); // 과도호출 방지

    if (seeds.length === 0) {
      return res.status(400).json({ error: 'keyword 파라미터가 필요합니다.' });
    }

    const results = await Promise.all(seeds.map((s) => fetchOne(s)));

    // 중복 제거 + 시드 자체 제외 + 상위 N개
    const merged = [];
    const seen = new Set(seeds.map((s) => s.replace(/\s/g, '').toLowerCase()));
    for (const arr of results) {
      for (const kw of arr) {
        const key = kw.replace(/\s/g, '').toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(kw);
      }
    }

    return res.status(200).json({
      seeds,
      bySeed: seeds.map((s, i) => ({ seed: s, suggestions: results[i] })),
      suggestions: merged.slice(0, 30),
    });
  } catch (err) {
    console.error('coupang-suggest error:', err);
    return res.status(500).json({ error: err.message, suggestions: [] });
  }
}
