import { getStore } from './_store.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const result = {
    env: {
      KV_REST_API_URL: process.env.KV_REST_API_URL ? '✅ 설정됨' : '❌ 없음',
      KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN ? '✅ 설정됨' : '❌ 없음',
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ? '✅ 설정됨' : '❌ 없음',
    },
    store: '확인 중...',
    test: null,
  };

  try {
    const store = await getStore();
    
    // 쓰기 테스트
    await store.set('_diag_test', JSON.stringify({ t: Date.now() }));
    
    // 읽기 테스트
    const readBack = await store.get('_diag_test');
    
    // 정리
    await store.del('_diag_test');

    result.store = readBack ? '✅ KV 정상 작동' : '⚠️ 메모리 스토어 (KV 미연결)';
    result.test = { write: '✅', read: readBack ? '✅' : '❌', delete: '✅' };

    // 현재 저장된 링크 수 확인
    const keys = await store.keys('link:*');
    result.linkCount = keys.length;

  } catch (e) {
    result.store = '❌ 에러: ' + e.message;
  }

  return res.status(200).json(result);
}
