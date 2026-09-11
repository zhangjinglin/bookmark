import config from './config.js';
const WORKER_URL = config.WORKER_URL;
const BOOKMARK_URL = config.BOOKMARK_URL;

const NO_CATEGORY = '__none__';

let categories = [];
let bookmarks = [];
let currentCategoryId = null;
let collapsedCategories = new Set(JSON.parse(localStorage.getItem('popupCollapsed') || '[]'));

const treeEl = document.getElementById('tree');
const listEl = document.getElementById('list');
const statsEl = document.getElementById('stats');
const openSiteBtn = document.getElementById('open-site');
const saveBtn = document.getElementById('save-btn');
const saveTitle = document.getElementById('save-title');
const statusEl = document.getElementById('bookmark-status');

let currentTab = null;

document.addEventListener('DOMContentLoaded', async () => {
  // 顶部栏脱离文档流后，让内容区向下让出顶部栏高度（用 ResizeObserver 应对字体加载等高度变化）
  const topEl = document.getElementById('top');
  if (topEl) {
    const updateTopPadding = () => {
      document.body.style.paddingTop = `${topEl.offsetHeight}px`;
    };
    updateTopPadding();
    new ResizeObserver(updateTopPadding).observe(topEl);
  }

  openSiteBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: BOOKMARK_URL });
    window.close();
  });

  saveBtn.addEventListener('click', saveCurrentPage);

  treeEl.addEventListener('click', handleTreeClick);
  listEl.addEventListener('click', handleListClick);
  listEl.addEventListener('error', (e) => {
    if (e.target.tagName === 'IMG') e.target.style.display = 'none';
  }, true);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;
  const saveable = tab && /^https?:/.test(tab.url || '');
  saveBtn.disabled = !saveable;
  saveTitle.textContent = saveable ? (tab.title || tab.url) : '';

  await loadData();
});

async function loadData() {
  try {
    const [catRes, bmRes] = await Promise.all([
      fetch(`${WORKER_URL}/api/categories`),
      fetch(`${WORKER_URL}/api/bookmarks`)
    ]);
    categories = await catRes.json();
    bookmarks = await bmRes.json();
    restoreSelection();
    updateSaveBtnLabel();
    renderCategoryTree();
    renderBookmarks();
    updateBookmarkStatus();
  } catch (err) {
    listEl.innerHTML = emptyHtml('加载失败');
  }
}

function updateSaveBtnLabel() {
  if (currentCategoryId && currentCategoryId !== NO_CATEGORY) {
    const cat = categories.find(c => c.id === currentCategoryId);
    if (cat) {
      saveBtn.textContent = `保存到「${cat.name}」`;
      return;
    }
  }
  saveBtn.textContent = '保存到「无分类」';
}

async function saveCurrentPage() {
  if (!currentTab || saveBtn.disabled) return;
  saveBtn.disabled = true;
  const categoryIds = currentCategoryId && currentCategoryId !== NO_CATEGORY ? [currentCategoryId] : [];
  try {
    const res = await fetch(`${WORKER_URL}/api/bookmarks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: currentTab.url, title: currentTab.title, categoryIds })
    });
    if (!res.ok) throw new Error('save failed');
    const created = await res.json();
    bookmarks.push(created);
    renderCategoryTree();
    renderBookmarks();
    listEl.scrollTop = 0;
    updateBookmarkStatus();
    flash('✓ 已保存', 'saved');
  } catch (err) {
    flash('✗ 保存失败', 'failed');
  }
}

function flash(text, cls) {
  saveBtn.textContent = text;
  saveBtn.classList.add(cls);
  setTimeout(() => {
    saveBtn.classList.remove(cls);
    updateSaveBtnLabel();
    saveBtn.disabled = false;
  }, 1200);
}

function restoreSelection() {
  const saved = localStorage.getItem('popupLastCategory');
  if (saved === 'none') {
    currentCategoryId = NO_CATEGORY;
  } else if (saved && saved !== 'all') {
    // 分类可能已被删除，失效则回退到"全部"
    currentCategoryId = categories.some(c => c.id === saved) ? saved : null;
  } else {
    currentCategoryId = null;
  }
}

function buildCategoryTree() {
  const byParent = new Map();
  for (const c of categories) {
    const pid = c.parentId || null;
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid).push(c);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => (a.order || 0) - (b.order || 0));
  }
  return byParent;
}

function getCategoryCount(categoryId) {
  if (categoryId === null) return bookmarks.length;
  if (categoryId === NO_CATEGORY) {
    return bookmarks.filter(b => !b.categoryIds || b.categoryIds.length === 0).length;
  }
  return bookmarks.filter(b => b.categoryIds && b.categoryIds.includes(categoryId)).length;
}

function renderCategoryTree() {
  const byParent = buildCategoryTree();
  let html = '';

  html += treeNodeHtml(null, '全部', getCategoryCount(null), '', 0, 'sticky');
  html += treeNodeHtml(NO_CATEGORY, '无分类', getCategoryCount(NO_CATEGORY), '', 0, 'sticky');
  html += renderTreeLevel(byParent, null, 0);

  treeEl.innerHTML = html;
}

function treeNodeHtml(id, name, count, toggle, depth, extraClass = '') {
  const active = currentCategoryId === id ? ' active' : '';
  const cls = ['tree-node', active, extraClass].filter(Boolean).join(' ');
  const dataId = id === null ? 'all' : (id === NO_CATEGORY ? 'none' : escapeAttr(id));
  const paddingLeft = 0.5 + depth;
  return `<div class="${cls}" data-id="${dataId}" style="padding-left:${paddingLeft}rem">
    <span class="tree-toggle">${toggle}</span>
    <span class="tree-name">${escapeHtml(name)}</span>
    <span class="category-count">${count}</span>
  </div>`;
}

function renderTreeLevel(byParent, parentId, depth) {
  const list = byParent.get(parentId) || [];
  let html = '';
  for (const c of list) {
    const children = byParent.get(c.id) || [];
    const hasChildren = children.length > 0;
    const expanded = !collapsedCategories.has(c.id);
    const toggle = hasChildren ? (expanded ? '▾' : '▸') : '';

    html += treeNodeHtml(c.id, c.name, getCategoryCount(c.id), toggle, depth);

    if (hasChildren && expanded) {
      html += renderTreeLevel(byParent, c.id, depth + 1);
    }
  }
  return html;
}

function handleTreeClick(e) {
  const node = e.target.closest('.tree-node');
  if (!node) return;

  const dataId = node.dataset.id;
  const toggleEl = e.target.closest('.tree-toggle');

  if (toggleEl && toggleEl.textContent.trim() && dataId !== 'all' && dataId !== 'none') {
    if (collapsedCategories.has(dataId)) {
      collapsedCategories.delete(dataId);
    } else {
      collapsedCategories.add(dataId);
    }
    localStorage.setItem('popupCollapsed', JSON.stringify([...collapsedCategories]));
    renderCategoryTree();
    return;
  }

  if (dataId === 'all') {
    currentCategoryId = null;
  } else if (dataId === 'none') {
    currentCategoryId = NO_CATEGORY;
  } else {
    currentCategoryId = dataId;
  }
  localStorage.setItem('popupLastCategory', dataId);

  updateSaveBtnLabel();
  renderCategoryTree();
  renderBookmarks();
  listEl.scrollTop = 0;
}

function renderBookmarks() {
  let filtered = bookmarks;
  if (currentCategoryId === NO_CATEGORY) {
    filtered = bookmarks.filter(b => !b.categoryIds || b.categoryIds.length === 0);
  } else if (currentCategoryId) {
    filtered = bookmarks.filter(b => b.categoryIds && b.categoryIds.includes(currentCategoryId));
  }

  // 新收藏排在最前，保存后无需翻页即可看到
  filtered = filtered.slice().sort((a, b) => {
    const ta = a.createdAt || '';
    const tb = b.createdAt || '';
    return ta < tb ? 1 : ta > tb ? -1 : 0;
  });

  statsEl.textContent = `共 ${filtered.length} 条`;

  if (filtered.length === 0) {
    listEl.innerHTML = emptyHtml('暂无书签');
    return;
  }

  listEl.innerHTML = filtered.map(b => {
    const title = escapeHtml(b.title || b.url);
    const url = escapeAttr(b.url);
    const id = escapeAttr(b.id);
    const favicon = getFaviconUrl(b.url);
    return `<div class="bookmark-item" data-url="${url}" title="${escapeAttr(b.title || b.url)}">
      <img class="bookmark-favicon" src="${favicon}" alt="">
      <span class="bookmark-title">${title}</span>
      <button class="bookmark-delete" data-id="${id}" title="删除书签" aria-label="删除书签">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    </div>`;
  }).join('');
}

function handleListClick(e) {
  const delBtn = e.target.closest('.bookmark-delete');
  if (delBtn) {
    deleteBookmark(delBtn.dataset.id);
    return;
  }
  const item = e.target.closest('.bookmark-item');
  if (!item) return;
  const url = item.dataset.url;
  if (url) {
    chrome.tabs.create({ url });
    window.close();
  }
}

async function deleteBookmark(id) {
  try {
    const res = await fetch(`${WORKER_URL}/api/bookmarks/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('delete failed');
    bookmarks = bookmarks.filter(b => b.id !== id);
    renderCategoryTree();
    renderBookmarks();
    updateBookmarkStatus();
  } catch (err) {
    flash('✗ 删除失败', 'failed');
  }
}

// 规范化 URL：忽略 hash、去默认端口、host 小写、去尾部斜杠，便于比较是否已收藏
function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    const defaultPort =
      (u.protocol === 'https:' && u.port === '443') ||
      (u.protocol === 'http:' && u.port === '80');
    const port = defaultPort ? '' : `:${u.port}`;
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.protocol}//${u.hostname.toLowerCase()}${port}${path}${u.search}`;
  } catch {
    return String(raw || '').trim();
  }
}

function updateBookmarkStatus() {
  if (!currentTab || !/^https?:/.test(currentTab.url || '')) {
    statusEl.textContent = '';
    statusEl.classList.remove('bookmarked', 'not-bookmarked');
    return;
  }
  const target = normalizeUrl(currentTab.url);
  const found = bookmarks.some(b => normalizeUrl(b.url) === target);
  if (found) {
    // 汇总当前 URL 所有书签的分类名（去重），徽章上同时展示
    const catNames = new Set();
    for (const b of bookmarks) {
      if (normalizeUrl(b.url) !== target) continue;
      for (const cid of (b.categoryIds || [])) {
        const cat = categories.find(c => c.id === cid);
        if (cat) catNames.add(cat.name);
      }
    }
    let label = '✓ 已收藏';
    const names = [...catNames];
    if (names.length > 0) {
      label += ` · ${names.slice(0, 2).join('、')}`;
      if (names.length > 2) label += ` 等${names.length}个分类`;
    }
    statusEl.textContent = label;
    statusEl.classList.add('bookmarked');
    statusEl.classList.remove('not-bookmarked');
  } else {
    statusEl.textContent = '未收藏';
    statusEl.classList.add('not-bookmarked');
    statusEl.classList.remove('bookmarked');
  }
}

function getFaviconUrl(url) {
  try {
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`;
  } catch {
    return '';
  }
}

function emptyHtml(text) {
  return `<div class="empty">
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/>
    </svg>
    <span>${escapeHtml(text)}</span>
  </div>`;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function escapeAttr(s) {
  return String(s || '').replace(/"/g, '&quot;');
}
