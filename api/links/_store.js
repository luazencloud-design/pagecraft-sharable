let kv = null;

async function getStore() {
  if (kv) return kv;

  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const { kv: vercelKv } = await import('@vercel/kv');
      kv = {
        async get(key) { return await vercelKv.get(key); },
        async set(key, value, options) {
          if (options && options.ex) {
            await vercelKv.set(key, value, { ex: options.ex });
          } else {
            await vercelKv.set(key, value);
          }
        },
        async del(key) { await vercelKv.del(key); },
        async keys(pattern) { return await vercelKv.keys(pattern); }
      };
      return kv;
    } catch (e) {
      console.warn('Vercel KV 로드 실패, 메모리 스토어로 전환:', e.message);
    }
  }

  const memStore = globalThis.__pagecraftStore || {};
  globalThis.__pagecraftStore = memStore;

  kv = {
    async get(key) {
      const entry = memStore[key];
      if (!entry) return null;
      // TTL 지원
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
