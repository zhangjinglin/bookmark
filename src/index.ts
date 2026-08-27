import indexHtml from './index.html';

export interface Env {
  BOOKMARKS: KVNamespace;
}

// CORS 头部
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 处理 OPTIONS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 根路径 - 返回前端页面
    if (url.pathname === '/') {
      return new Response(indexHtml, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders },
      });
    }

    // 健康检查
    if (url.pathname === '/api/health') {
      return jsonResponse({ status: 'ok', message: 'Worker is running' });
    }

    // 获取所有分类
    if (url.pathname === '/api/categories' && request.method === 'GET') {
      const categories = await readList(env, 'categories');
      categories.sort((a, b) => a.order - b.order);
      return jsonResponse(categories);
    }

    // 新建分类
    if (url.pathname === '/api/categories' && request.method === 'POST') {
      const body = await parseJsonBody(request);
      const name = body?.name;

      if (!name) {
        return jsonResponse({ error: 'Name is required' }, 400);
      }

      const categories = await readList(env, 'categories');
      const newCategory = {
        id: crypto.randomUUID(),
        name,
        order: categories.length,
        createdAt: new Date().toISOString(),
      };
      categories.push(newCategory);
      await env.BOOKMARKS.put('categories', JSON.stringify(categories));

      return jsonResponse(newCategory);
    }

    // 批量更新分类顺序
    if (url.pathname === '/api/categories/order' && request.method === 'PUT') {
      const body = await parseJsonBody(request);
      const order = body?.order;
      if (!Array.isArray(order)) {
        return jsonResponse({ error: 'order must be an array' }, 400);
      }
      const categories = await readList(env, 'categories');
      const categoryMap = new Map(categories.map((c) => [c.id, c]));
      order.forEach((id: string, index: number) => {
        const cat = categoryMap.get(id);
        if (cat) cat.order = index;
      });
      await env.BOOKMARKS.put('categories', JSON.stringify(categories));
      return jsonResponse(categories);
    }

    // 编辑分类
    const categoryMatch = url.pathname.match(/^\/api\/categories\/(.+)$/);
    if (categoryMatch && request.method === 'PUT') {
      const id = categoryMatch[1];
      const body = await parseJsonBody(request);
      if (!body) {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
      }
      const { name, order } = body;

      const categories = await readList(env, 'categories');
      const index = categories.findIndex((c) => c.id === id);

      if (index === -1) {
        return jsonResponse({ error: 'Category not found' }, 404);
      }

      if (name !== undefined) categories[index].name = name;
      if (order !== undefined) categories[index].order = order;

      await env.BOOKMARKS.put('categories', JSON.stringify(categories));
      return jsonResponse(categories[index]);
    }

    // 删除分类（同时清理书签中对该分类的引用）
    if (categoryMatch && request.method === 'DELETE') {
      const id = categoryMatch[1];
      const categories = await readList(env, 'categories');
      const filtered = categories.filter((c) => c.id !== id);
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

      return jsonResponse({ success: true });
    }

    // 获取所有书签
    if (url.pathname === '/api/bookmarks' && request.method === 'GET') {
      return jsonResponse(await readList(env, 'bookmarks'));
    }

    // 添加书签
    if (url.pathname === '/api/bookmarks' && request.method === 'POST') {
      const body = await parseJsonBody(request);
      const bookmarkUrl = body?.url;
      const title = body?.title;
      const categoryIds = Array.isArray(body?.categoryIds) ? body.categoryIds : [];

      if (!bookmarkUrl) {
        return jsonResponse({ error: 'URL is required' }, 400);
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

      return jsonResponse(newBookmark);
    }

    // 更新书签（修改分类归属）
    const bookmarkMatch = url.pathname.match(/^\/api\/bookmarks\/(.+)$/);
    if (bookmarkMatch && request.method === 'PUT') {
      const id = bookmarkMatch[1];
      const body = await parseJsonBody(request);
      if (!body) {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
      }
      const { categoryIds } = body;

      const bookmarks = await readList(env, 'bookmarks');
      const index = bookmarks.findIndex((b) => b.id === id);

      if (index === -1) {
        return jsonResponse({ error: 'Bookmark not found' }, 404);
      }

      if (categoryIds !== undefined) bookmarks[index].categoryIds = categoryIds;

      await env.BOOKMARKS.put('bookmarks', JSON.stringify(bookmarks));
      return jsonResponse(bookmarks[index]);
    }

    // 删除书签
    if (bookmarkMatch && request.method === 'DELETE') {
      const id = bookmarkMatch[1];
      const bookmarks = await readList(env, 'bookmarks');
      const filtered = bookmarks.filter((b) => b.id !== id);
      await env.BOOKMARKS.put('bookmarks', JSON.stringify(filtered));
      return jsonResponse({ success: true });
    }

    // 默认返回 404
    return new Response('Not Found', { status: 404 });
  },
};
