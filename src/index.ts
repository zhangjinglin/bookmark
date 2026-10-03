import indexHtml from './index.html';

export interface Env {
  BOOKMARKS: KVNamespace;
  API_TOKEN: string;
  AI: Ai;
}

// 允许的前端来源（Chrome 扩展来源动态放行，不依赖固定扩展 ID）
const ALLOWED_ORIGINS = [
  'https://book.jiv.de5.net',
  'https://bookmark-worker.jiv.workers.dev',
];

// 按请求 Origin 生成 CORS 头部，并放行 Authorization 请求头
function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin') || '';
  const allowOrigin =
    ALLOWED_ORIGINS.includes(origin) || origin.startsWith('chrome-extension://')
      ? origin
      : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };
}

function jsonResponse(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

// 安全解析 JSON 请求体，非法 JSON 返回 null
async function parseJsonBody(request: Request): Promise<Record<string, any> | null> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}

// 从 KV 读取 JSON 数组，非法数据返回空数组
async function readList(env: Env, key: string): Promise<any[]> {
  const data = await env.BOOKMARKS.get(key, 'json');
  return Array.isArray(data) ? data : [];
}

// AI 标题重写用模型（中文短标题质量与 Neurons 开销的折中）
const AI_TITLE_MODEL = '@cf/meta/llama-3.1-8b-instruct';

// 抓页面并提取可用于生成标题的文本，失败返回 null（调用方保留原标题）
async function fetchPageExcerpt(targetUrl: string): Promise<{ originalTitle: string; excerpt: string } | null> {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(targetUrl, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; BookmarkBot/1.0; +https://book.jiv.de5.net)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!/html/i.test(contentType)) return null;

    let html = await res.text();
    if (html.length > 200_000) html = html.slice(0, 200_000);

    const pickMeta = (name: string): string => {
      const re = new RegExp(
        `<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`,
        'i'
      );
      const tag = html.match(re)?.[0] || '';
      return tag.match(/content=["']([^"']{1,500})["']/i)?.[1]?.trim() || '';
    };

    const rawTitle =
      html.match(/<title[^>]*>([\s\S]{1,300})<\/title>/i)?.[1]?.trim() || '';
    const description =
      pickMeta('description') || pickMeta('og:description') || '';
    const ogTitle = pickMeta('og:title') || '';

    const textOnly = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 3000);

    const excerpt = [ogTitle, description, textOnly].filter(Boolean).join('\n').slice(0, 3500);
    if (!excerpt) return null;
    return { originalTitle: rawTitle, excerpt };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 清洗 AI 输出：只取第一行、去引号、截长，不合格返回空
function sanitizeAiTitle(raw: string): string {
  let s = String(raw || '').trim();
  s = s.split('\n')[0]?.trim() || '';
  s = s.replace(/^["'「『（(\[]+/, '').replace(/["'」』）)\].。:：;；!！?？.]+$/, '');
  s = s.replace(/^(标题[：:]\s*|书签标题[：:]\s*)/, '').trim();
  if (s.length > 30) s = s.slice(0, 30).trim();
  return s;
}

// 后台任务：抓页面 + 调 AI + 写回 KV，全程失败只保留原标题
async function rewriteTitleWithAi(env: Env, bookmarkId: string, bookmarkUrl: string): Promise<void> {
  try {
    if (!env.AI) return;
    const page = await fetchPageExcerpt(bookmarkUrl);
    if (!page) return;

    const result: any = await env.AI.run(AI_TITLE_MODEL, {
      messages: [
        {
          role: 'system',
          content:
            '你是书签标题助手。根据用户收藏的网页内容，生成一个一眼能看懂的简体中文短标题。要求：不超过20个汉字，只输出标题本身，不加引号、不加解释、不加前缀。',
        },
        {
          role: 'user',
          content: `网址：${bookmarkUrl}\n原标题：${page.originalTitle}\n网页内容：\n${page.excerpt}`,
        },
      ],
    } as any);
    const raw =
      typeof result === 'string'
        ? result
        : result?.response || result?.result || '';
    const title = sanitizeAiTitle(raw);
    if (!title) return;

    const bookmarks = await readList(env, 'bookmarks');
    const index = bookmarks.findIndex((b) => b.id === bookmarkId);
    if (index === -1) return;
    // AI 没产出有效差异就不写回，避免无意义覆盖
    if (!title || bookmarks[index].title === title) return;
    bookmarks[index].title = title;
    await env.BOOKMARKS.put('bookmarks', JSON.stringify(bookmarks));
  } catch {
    // 降级：保留原标题
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders = getCorsHeaders(request);
    const sendJson = (data: unknown, status = 200): Response =>
      jsonResponse(data, status, corsHeaders);

    // 处理 OPTIONS 预检请求（浏览器不会在预检中带 Authorization，直接放行）
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 根路径 - 返回前端页面
    if (url.pathname === '/') {
      return new Response(indexHtml, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders },
      });
    }

    // 健康检查（公开，方便监控）
    // extVersion: 扩展 bundle 版本号，仅在 extension/ 有改动时才 bump，
    // 纯网站改动不要动它，否则插件会误报"有新版"
    if (url.pathname === '/api/health') {
      return sendJson({ status: 'ok', message: 'Worker is running', extVersion: '1.2.0' });
    }

    // 其余 /api/* 需要 Bearer Token（缺省 secret 时直接失败，避免误裸奔）
    if (url.pathname.startsWith('/api/')) {
      if (!env.API_TOKEN) {
        return sendJson({ error: 'Server misconfigured: API_TOKEN not set' }, 500);
      }
      const auth = request.headers.get('Authorization') || '';
      if (auth !== `Bearer ${env.API_TOKEN}`) {
        return sendJson({ error: 'Unauthorized' }, 401);
      }
    }

    // 获取所有分类
    if (url.pathname === '/api/categories' && request.method === 'GET') {
      const categories = await readList(env, 'categories');
      categories.sort((a, b) => a.order - b.order);
      return sendJson(categories);
    }

    // 新建分类（支持 parentId 指定父分类）
    if (url.pathname === '/api/categories' && request.method === 'POST') {
      const body = await parseJsonBody(request);
      const name = body?.name;
      const parentId = body?.parentId ?? null;

      if (!name) {
        return sendJson({ error: 'Name is required' }, 400);
      }

      const categories = await readList(env, 'categories');
      if (parentId !== null && !categories.some((c) => c.id === parentId)) {
        return sendJson({ error: 'Parent category not found' }, 400);
      }

      const siblings = categories.filter((c) => (c.parentId ?? null) === parentId);
      const newCategory = {
        id: crypto.randomUUID(),
        name,
        parentId,
        order: siblings.length,
        createdAt: new Date().toISOString(),
      };
      categories.push(newCategory);
      await env.BOOKMARKS.put('categories', JSON.stringify(categories));

      return sendJson(newCategory);
    }

    // 批量更新分类顺序
    if (url.pathname === '/api/categories/order' && request.method === 'PUT') {
      const body = await parseJsonBody(request);
      const order = body?.order;
      if (!Array.isArray(order)) {
        return sendJson({ error: 'order must be an array' }, 400);
      }
      const categories = await readList(env, 'categories');
      const categoryMap = new Map(categories.map((c) => [c.id, c]));
      order.forEach((id: string, index: number) => {
        const cat = categoryMap.get(id);
        if (cat) cat.order = index;
      });
      await env.BOOKMARKS.put('categories', JSON.stringify(categories));
      return sendJson(categories);
    }

    // 编辑分类（name、order、parentId）
    const categoryMatch = url.pathname.match(/^\/api\/categories\/(.+)$/);
    if (categoryMatch && request.method === 'PUT') {
      const id = categoryMatch[1];
      const body = await parseJsonBody(request);
      if (!body) {
        return sendJson({ error: 'Invalid JSON body' }, 400);
      }
      const { name, order, parentId } = body;

      const categories = await readList(env, 'categories');
      const index = categories.findIndex((c) => c.id === id);

      if (index === -1) {
        return sendJson({ error: 'Category not found' }, 404);
      }

      if (parentId !== undefined) {
        const targetParentId = parentId ?? null;
        if (targetParentId !== null) {
          if (!categories.some((c) => c.id === targetParentId)) {
            return sendJson({ error: 'Parent category not found' }, 400);
          }
          // 防止循环：目标父分类不能是自身或自身的后代
          let cursor: any = categories.find((c) => c.id === targetParentId);
          let guard = 0;
          while (cursor && guard < 1000) {
            if (cursor.id === id) {
              return sendJson({ error: 'Cannot move category under its own descendant' }, 400);
            }
            cursor = categories.find((c) => c.id === (cursor.parentId ?? null));
            guard++;
          }
        }
        categories[index].parentId = targetParentId;
        // 移动到新父级后排到该层级末尾
        categories[index].order = categories.filter(
          (c, i) => i !== index && (c.parentId ?? null) === targetParentId
        ).length;
      }

      if (name !== undefined) categories[index].name = name;
      if (order !== undefined) categories[index].order = order;

      await env.BOOKMARKS.put('categories', JSON.stringify(categories));
      return sendJson(categories[index]);
    }

    // 删除分类（子分类提升到父级，同时清理书签中对该分类的引用）
    if (categoryMatch && request.method === 'DELETE') {
      const id = categoryMatch[1];
      const categories = await readList(env, 'categories');
      const target = categories.find((c) => c.id === id);
      const newParentId = target ? (target.parentId ?? null) : null;

      const filtered = categories.filter((c) => c.id !== id);
      for (const c of filtered) {
        if ((c.parentId ?? null) === id) c.parentId = newParentId;
      }
      await env.BOOKMARKS.put('categories', JSON.stringify(filtered));

      const bookmarks = await readList(env, 'bookmarks');
      let changed = false;
      for (const b of bookmarks) {
        if (Array.isArray(b.categoryIds) && b.categoryIds.includes(id)) {
          b.categoryIds = b.categoryIds.filter((cid: string) => cid !== id);
          changed = true;
        }
      }
      if (changed) {
        await env.BOOKMARKS.put('bookmarks', JSON.stringify(bookmarks));
      }

      return sendJson({ success: true });
    }

    // 获取所有书签（按创建时间倒序，新的排在前面）
    if (url.pathname === '/api/bookmarks' && request.method === 'GET') {
      const bookmarks = await readList(env, 'bookmarks');
      bookmarks.sort((a, b) => {
        const ta = a.createdAt || '';
        const tb = b.createdAt || '';
        return ta < tb ? 1 : ta > tb ? -1 : 0;
      });
      return sendJson(bookmarks);
    }

    // 添加书签
    if (url.pathname === '/api/bookmarks' && request.method === 'POST') {
      const body = await parseJsonBody(request);
      const bookmarkUrl = body?.url;
      const title = body?.title;
      const categoryIds = Array.isArray(body?.categoryIds) ? body.categoryIds : [];

      if (!bookmarkUrl) {
        return sendJson({ error: 'URL is required' }, 400);
      }

      const bookmarks = await readList(env, 'bookmarks');
      const newBookmark = {
        id: crypto.randomUUID(),
        url: bookmarkUrl,
        title: title || bookmarkUrl,
        categoryIds,
        createdAt: new Date().toISOString(),
      };
      bookmarks.push(newBookmark);
      await env.BOOKMARKS.put('bookmarks', JSON.stringify(bookmarks));

      // 秒存原文立即返回，AI 在后台重写标题（失败保留原文）
      try {
        ctx.waitUntil(rewriteTitleWithAi(env, newBookmark.id, bookmarkUrl));
      } catch {
        // waitUntil 不可用时忽略，不影响主流程
      }

      return sendJson(newBookmark);
    }

    // 更新书签（修改分类归属）
    const bookmarkMatch = url.pathname.match(/^\/api\/bookmarks\/(.+)$/);
    if (bookmarkMatch && request.method === 'PUT') {
      const id = bookmarkMatch[1];
      const body = await parseJsonBody(request);
      if (!body) {
        return sendJson({ error: 'Invalid JSON body' }, 400);
      }
      const { title, url, categoryIds } = body;

      const bookmarks = await readList(env, 'bookmarks');
      const index = bookmarks.findIndex((b) => b.id === id);

      if (index === -1) {
        return sendJson({ error: 'Bookmark not found' }, 404);
      }

      if (title !== undefined) bookmarks[index].title = title;
      if (url !== undefined) bookmarks[index].url = url;
      if (categoryIds !== undefined) bookmarks[index].categoryIds = categoryIds;

      await env.BOOKMARKS.put('bookmarks', JSON.stringify(bookmarks));
      return sendJson(bookmarks[index]);
    }

    // 删除书签
    if (bookmarkMatch && request.method === 'DELETE') {
      const id = bookmarkMatch[1];
      const bookmarks = await readList(env, 'bookmarks');
      const filtered = bookmarks.filter((b) => b.id !== id);
      await env.BOOKMARKS.put('bookmarks', JSON.stringify(filtered));
      return sendJson({ success: true });
    }

    // 默认返回 404
    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
};
