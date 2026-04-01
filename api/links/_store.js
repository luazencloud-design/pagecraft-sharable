let kv = null;

async function getStore() {
  if (kv) return kv;

  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (kvUrl && kvToken) {
    try {
      // @vercel/kv v2: createClient 사용
      const mod = await import('@vercel/kv');
      const client = mod.createClient
        ? mod.createClient({ url: kvUrl, token: kvToken })
        : mod.kv; // v1 fallback

      // 연결 테스트
      await client.ping();
      console.log('✅ Vercel KV 연결 성공:', kvUrl.slice(0, 30) + '...');

      kv = {
        async get(key) { return await client.get(key); },
        async set(key, value, options) {
          if (options && options.ex) {
            await client.set(key, value, { ex: options.ex });
          } else {
            await client.set(key, value);
          }
        },
        async del(key) { await client.del(key); },
        async keys(pattern) { return await client.keys(pattern); }
      };
      return kv;
    } catch (e) {
      console.error('❌ Vercel KV 연결 실패:', e.message);
      console.error('   KV_REST_API_URL 존재:', !!kvUrl);
      console.error('   KV_REST_API_TOKEN 존재:', !!kvToken);
    }
  } else {
    console.warn('⚠️ KV 환경변수 없음 → 메모리 스토어 사용 (데이터 휘발성)');
  }

  // 메모리 fallback
  const memStore = globalThis.__pagecraftStore || {};
  globalThis.__pagecraftStore = memStore;

  kv = {
    async get(key) {
      const entry = memStore[key];
      if (!entry) return null;
      if (entry._expiresAt && Date.now() > entry._expiresAt) {
        delete memStore[key];
        return null;
      }
      return entry._value !== undefined ? entry._value : entry;
    },
    async set(key, value, options) {
      if (options && options.ex) {
        memStore[key] = { _value: value, _expiresAt: Date.now() + options.ex * 1000 };
      } else {
        memStore[key] = value;
      }
    },
    async del(key) { delete memStore[key]; },
    async keys(pattern) {
      const prefix = pattern.replace('*', '');
      return Object.keys(memStore).filter(k => k.startsWith(prefix));
    }
  };
  return kv;
}

export { getStore };
