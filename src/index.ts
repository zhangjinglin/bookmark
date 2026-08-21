import indexHtml from './index.html';

export interface Env {
  BOOKMARKS: KVNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS 头部
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

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

    // API 路由

    // 获取所有分类
    if (url.pathname === '/api/categories' && request.method === 'GET') {
      const data = await env.BOOKMARKS.get('categories', 'json');
      const categories = data || [];
      categories.sort((a: any, b: any) => a.order - b.order);
      return new Response(JSON.stringify(categories), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // 新建分类
    if (url.pathname === '/api/categories' && request.method === 'POST') {
      const body = await request.json();
      const { name } = body;
      
      if (!name) {
        return new Response(JSON.stringify({ error: 'Name is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      const data = await env.BOOKMARKS.get('categories', 'json');
      const categories = data || [];
      const newCategory = {
        id: crypto.randomUUID(),
        name,
        order: categories.length,
        createdAt: new Date().toISOString(),
      };
      categories.push(newCategory);
      await env.BOOKMARKS.put('categories', JSON.stringify(categories));

      return new Response(JSON.stringify(newCategory), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // 编辑分类
    const categoryMatch = url.pathname.match(/^\/api\/categories\/(.+)$/);
    if (categoryMatch && request.method === 'PUT') {
      const id = categoryMatch[1];
      const body = await request.json();
      const { name, order } = body;
      
      const data = await env.BOOKMARKS.get('categories', 'json');
      const categories = data || [];
      const index = categories.findIndex((c: any) => c.id === id);
      
      if (index === -1) {
        return new Response(JSON.stringify({ error: 'Category not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (name !== undefined) categories[index].name = name;
      if (order !== undefined) categories[index].order = order;
      
      await env.BOOKMARKS.put('categories', JSON.stringify(categories));
      return new Response(JSON.stringify(categories[index]), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // 删除分类
    if (categoryMatch && request.method === 'DELETE') {
      const id = categoryMatch[1];
      const data = await env.BOOKMARKS.get('categories', 'json');
      const categories = data || [];
      const filtered = categories.filter((c: any) => c.id !== id);
      await env.BOOKMARKS.put('categories', JSON.stringify(filtered));
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    if (url.pathname === '/api/health') {
      return new Response(
        JSON.stringify({ status: 'ok', message: 'Worker is running' }),
        {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }

    // 获取所有书签
    if (url.pathname === '/api/bookmarks' && request.method === 'GET') {
      const data = await env.BOOKMARKS.get('bookmarks', 'json');
      const bookmarks = data || [];
      return new Response(JSON.stringify(bookmarks), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // 添加书签
    if (url.pathname === '/api/bookmarks' && request.method === 'POST') {
      const body = await request.json();
      const { url: bookmarkUrl, title, categoryIds = [] } = body;
      
      if (!bookmarkUrl) {
        return new Response(JSON.stringify({ error: 'URL is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      const data = await env.BOOKMARKS.get('bookmarks', 'json');
      const bookmarks = data || [];
      const newBookmark = {
        id: crypto.randomUUID(),
        url: bookmarkUrl,
        title: title || bookmarkUrl,
        categoryIds,
        createdAt: new Date().toISOString(),
      };
      bookmarks.push(newBookmark);
      await env.BOOKMARKS.put('bookmarks', JSON.stringify(bookmarks));

      return new Response(JSON.stringify(newBookmark), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // 更新书签（修改分类归属）
    const updateMatch = url.pathname.match(/^\/api\/bookmarks\/(.+)$/);
    if (updateMatch && request.method === 'PUT') {
      const id = updateMatch[1];
      const body = await request.json();
      const { categoryIds } = body;
      
      const data = await env.BOOKMARKS.get('bookmarks', 'json');
      const bookmarks = data || [];
      const index = bookmarks.findIndex((b: any) => b.id === id);
      
      if (index === -1) {
        return new Response(JSON.stringify({ error: 'Bookmark not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (categoryIds !== undefined) bookmarks[index].categoryIds = categoryIds;
      
      await env.BOOKMARKS.put('bookmarks', JSON.stringify(bookmarks));
      return new Response(JSON.stringify(bookmarks[index]), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // 删除书签
    const deleteMatch = url.pathname.match(/^\/api\/bookmarks\/(.+)$/);
    if (deleteMatch && request.method === 'DELETE') {
      const id = deleteMatch[1];
      const data = await env.BOOKMARKS.get('bookmarks', 'json');
      const bookmarks = data || [];
      const filtered = bookmarks.filter((b: any) => b.id !== id);
      await env.BOOKMARKS.put('bookmarks', JSON.stringify(filtered));
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // 默认返回 404
    return new Response('Not Found', { status: 404 });
  },
};
