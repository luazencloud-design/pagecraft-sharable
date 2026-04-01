// ── 스토리지 추상화 (Vercel KV 우선, 없으면 메모리 fallback) ──
let kv = null;

async function getStore() {
  if (kv) return kv;

  // Vercel KV 사용 시도
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const { kv: vercelKv } = await import('@vercel/kv');
      kv = {
        async get(key) {
          const val = await vercelKv.get(key);
          return val;
        },
        async set(key, value) {
          await vercelKv.set(key, value);
        },
        async del(key) {
          await vercelKv.del(key);
        },
        async keys(pattern) {
          return await vercelKv.keys(pattern);
        }
      };
      return kv;
    } catch (e) {
      console.warn('Vercel KV 로드 실패, 메모리 스토어로 전환:', e.message);
    }
  }

  // 메모리 fallback (개발용 - 서버 재시작 시 초기화됨)
  const memStore = globalThis.__pagecraftStore || {};
  globalThis.__pagecraftStore = memStore;

  kv = {
    async get(key) {
      return memStore[key] || null;
    },
    async set(key, value) {
      memStore[key] = value;
    },
    async del(key) {
      delete memStore[key];
    },
    async keys(pattern) {
      const prefix = pattern.replace('*', '');
      return Object.keys(memStore).filter(k => k.startsWith(prefix));
    }
  };
  return kv;
}

export { getStore };
