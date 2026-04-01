import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;
const ADMIN_PASSWORD = 'test1234';

// ── 메모리 스토어 (TTL 지원) ──
const store = {};
const kvStore = {
  async get(key) {
    const entry = store[key];
    if (!entry) return null;
    if (entry._expiresAt && Date.now() > entry._expiresAt) { delete store[key]; return null; }
    return entry._value !== undefined ? entry._value : entry;
  },
  async set(key, value, options) {
    if (options && options.ex) {
      store[key] = { _value: value, _expiresAt: Date.now() + options.ex * 1000 };
    } else {
      store[key] = value;
    }
  },
  async del(key) { delete store[key]; },
  async keys(pattern) {
    const prefix = pattern.replace('*', '');
    return Object.keys(store).filter(k => k.startsWith(prefix));
  }
};

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
  });
}

async function handleAPI(req, res, pathname) {
  const auth = (req.headers.authorization || '').replace('Bearer ', '');
  const json = (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end();
  }

  const body = await parseBody(req);

  // ── POST /api/links/create ──
  if (pathname === '/api/links/create' && req.method === 'POST') {
    if (auth !== ADMIN_PASSWORD) return json({ error: '관리자 인증 실패' }, 401);
    const { title, maxVisits, expiresAt } = body;
    if (!title) return json({ error: '제목은 필수입니다.' }, 400);
    const token = crypto.randomBytes(16).toString('hex');
    const linkData = {
      token, title,
      maxVisits: parseInt(maxVisits) || 0,
      currentVisits: 0, visitLog: [],
      expiresAt: expiresAt || null,
      createdAt: new Date().toISOString(),
      active: true,
    };
    await kvStore.set(`link:${token}`, JSON.stringify(linkData));
    return json({ success: true, token, url: `/view?token=${token}`, data: linkData });
  }

  // ── GET /api/links/list ──
  if (pathname === '/api/links/list' && req.method === 'GET') {
    if (auth !== ADMIN_PASSWORD) return json({ error: '관리자 인증 실패' }, 401);
    const keys = await kvStore.keys('link:');
    const links = [];
    for (const key of keys) {
      const raw = await kvStore.get(key);
      if (raw) {
        const link = JSON.parse(raw);
        links.push(link);
      }
    }
    links.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return json({ success: true, links });
  }

  // ── POST /api/links/verify ──
  if (pathname === '/api/links/verify' && req.method === 'POST') {
    const { token } = body;
    if (!token) return json({ error: '토큰이 필요합니다.' }, 400);
    const raw = await kvStore.get(`link:${token}`);
    if (!raw) return json({ error: '유효하지 않은 링크입니다.', code: 'NOT_FOUND' }, 404);
    const link = JSON.parse(raw);
    if (!link.active) return json({ error: '비활성화된 링크입니다.', code: 'INACTIVE' }, 403);
    if (link.expiresAt && new Date(link.expiresAt) < new Date())
      return json({ error: '만료된 링크입니다.', code: 'EXPIRED' }, 403);
    if (link.maxVisits > 0 && link.currentVisits >= link.maxVisits)
      return json({ error: '최대 접근 횟수를 초과했습니다.', code: 'MAX_VISITS' }, 403);

    link.currentVisits += 1;
    link.visitLog.push({
      visitedAt: new Date().toISOString(),
      visitNumber: link.currentVisits,
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local',
    });
    await kvStore.set(`link:${token}`, JSON.stringify(link));

    // 세션 토큰 발급 (1시간)
    const sessionToken = crypto.randomBytes(24).toString('hex');
    await kvStore.set(`session:${sessionToken}`, JSON.stringify({
      linkToken: token, title: link.title, createdAt: new Date().toISOString(),
    }), { ex: 3600 });

    return json({
      success: true, sessionToken, title: link.title,
      remainingVisits: link.maxVisits > 0 ? link.maxVisits - link.currentVisits : null,
      expiresAt: link.expiresAt,
    });
  }

  // ── POST /api/links/check-session ──
  if (pathname === '/api/links/check-session' && req.method === 'POST') {
    const { sessionToken } = body;
    if (!sessionToken) return json({ valid: false, error: '세션 토큰이 필요합니다.' }, 401);
    const raw = await kvStore.get(`session:${sessionToken}`);
    if (!raw) return json({ valid: false, error: '유효하지 않거나 만료된 세션입니다.' }, 401);
    const session = JSON.parse(raw);
    return json({ valid: true, title: session.title, linkToken: session.linkToken });
  }

  // ── POST /api/links/manage ──
  if (pathname === '/api/links/manage' && req.method === 'POST') {
    if (auth !== ADMIN_PASSWORD) return json({ error: '관리자 인증 실패' }, 401);
    const { token, action } = body;
    if (!token) return json({ error: '토큰이 필요합니다.' }, 400);
    const raw = await kvStore.get(`link:${token}`);
    if (!raw) return json({ error: '링크를 찾을 수 없습니다.' }, 404);
    if (action === 'delete') { await kvStore.del(`link:${token}`); return json({ success: true, message: '삭제되었습니다.' }); }
    if (action === 'toggle') {
      const link = JSON.parse(raw); link.active = !link.active;
      await kvStore.set(`link:${token}`, JSON.stringify(link));
      return json({ success: true, active: link.active });
    }
    if (action === 'resetVisits') {
      const link = JSON.parse(raw); link.currentVisits = 0; link.visitLog = [];
      await kvStore.set(`link:${token}`, JSON.stringify(link));
      return json({ success: true, message: '초기화되었습니다.' });
    }
    if (action === 'update') {
      const link = JSON.parse(raw);
      if (body.title !== undefined) link.title = body.title;
      if (body.maxVisits !== undefined) link.maxVisits = parseInt(body.maxVisits) || 0;
      if (body.expiresAt !== undefined) link.expiresAt = body.expiresAt || null;
      await kvStore.set(`link:${token}`, JSON.stringify(link));
      return json({ success: true, data: link });
    }
    return json({ error: '유효하지 않은 action' }, 400);
  }

  // ── POST /api/generate (프록시 — 로컬에서는 mock) ──
  if (pathname === '/api/generate' && req.method === 'POST') {
    return json({
      candidates: [{
        content: {
          parts: [{ text: JSON.stringify({
            product_name: "테스트 상품",
            subtitle: "AI 생성 테스트",
            main_copy: "이것은 로컬 테스트용 목업 데이터입니다.\n실제 AI 생성은 Vercel 배포 후 작동합니다.",
            selling_points: ["고급 소재", "트렌디 디자인", "편안한 착용감"],
            description: "로컬 테스트 환경에서는 Gemini API에 접근할 수 없으므로 목업 데이터가 반환됩니다.",
            specs: [
              { key: "소재", value: "면 100%" },
              { key: "사이즈", value: "S / M / L / XL" },
              { key: "색상", value: "블랙, 화이트, 네이비" }
            ],
            keywords: ["테스트", "목업", "로컬개발"],
            caution: "이 데이터는 테스트용입니다. 실제 서비스에서는 AI가 생성합니다."
          })}]
        }
      }]
    });
  }

  return json({ error: 'Not Found' }, 404);
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  };
  if (!fs.existsSync(filePath)) { res.writeHead(404); return res.end('Not Found'); }
  res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  if (pathname.startsWith('/api/')) return handleAPI(req, res, pathname);
  if (pathname === '/admin') return serveFile(res, path.join(__dirname, 'admin.html'));
  if (pathname === '/view') return serveFile(res, path.join(__dirname, 'view.html'));
  if (pathname === '/' || pathname === '/index.html') return serveFile(res, path.join(__dirname, 'index.html'));
  serveFile(res, path.join(__dirname, pathname));
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ┌──────────────────────────────────────────────────┐');
  console.log('  │                                                  │');
  console.log('  │   🚀  PageCraft Pro 로컬 테스트 서버             │');
  console.log('  │                                                  │');
  console.log(`  │   메인 (잠금):  http://localhost:${PORT}            │`);
  console.log(`  │   어드민:      http://localhost:${PORT}/admin       │`);
  console.log('  │                                                  │');
  console.log('  │   🔑 어드민 비밀번호: test1234                   │');
  console.log('  │                                                  │');
  console.log('  │   💡 테스트 순서:                                │');
  console.log('  │      1. /admin 접속 → 링크 생성                  │');
  console.log('  │      2. 생성된 URL 클릭 → 세션 발급              │');
  console.log('  │      3. 메인 페이지로 리디렉트 → AI 기능 해제     │');
  console.log('  │                                                  │');
  console.log('  │   Ctrl+C 로 종료                                 │');
  console.log('  │                                                  │');
  console.log('  └──────────────────────────────────────────────────┘');
  console.log('');
});
