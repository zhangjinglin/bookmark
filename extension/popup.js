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

document.addEventListener('DOMContentLoaded', async () => {
  openSiteBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: BOOKMARK_URL });
    window.close();
  });

  treeEl.addEventListener('click', handleTreeClick);
  listEl.addEventListener('click', handleListClick);
  listEl.addEventListener('error', (e) => {
    if (e.target.tagName === 'IMG') e.target.style.display = 'none';
  }, true);

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
    renderCategoryTree();
    renderBookmarks();
  } catch (err) {
    listEl.innerHTML = emptyHtml('加载失败');
  }
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

  html += treeNodeHtml(null, '全部', getCategoryCount(null), '', 0);
  html += treeNodeHtml(NO_CATEGORY, '无分类', getCategoryCount(NO_CATEGORY), '', 0);
  html += renderTreeLevel(byParent, null, 0);

  treeEl.innerHTML = html;
}

function treeNodeHtml(id, name, count, toggle, depth) {
  const active = currentCategoryId === id ? ' active' : '';
  const dataId = id === null ? 'all' : (id === NO_CATEGORY ? 'none' : escapeAttr(id));
  const paddingLeft = 0.5 + depth;
  return `<div class="tree-node${active}" data-id="${dataId}" style="padding-left:${paddingLeft}rem">
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

  renderCategoryTree();
  renderBookmarks();
}

function renderBookmarks() {
  let filtered = bookmarks;
  if (currentCategoryId === NO_CATEGORY) {
    filtered = bookmarks.filter(b => !b.categoryIds || b.categoryIds.length === 0);
  } else if (currentCategoryId) {
    filtered = bookmarks.filter(b => b.categoryIds && b.categoryIds.includes(currentCategoryId));
  }

  statsEl.textContent = `共 ${filtered.length} 条`;

  if (filtered.length === 0) {
    listEl.innerHTML = emptyHtml('暂无书签');
    return;
  }

  listEl.innerHTML = filtered.map(b => {
    const title = escapeHtml(b.title || b.url);
    const url = escapeAttr(b.url);
    const favicon = getFaviconUrl(b.url);
    return `<div class="bookmark-item" data-url="${url}" title="${escapeAttr(b.title || b.url)}">
      <img class="bookmark-favicon" src="${favicon}" alt="">
      <span class="bookmark-title">${title}</span>
    </div>`;
  }).join('');
}

function handleListClick(e) {
  const item = e.target.closest('.bookmark-item');
  if (!item) return;
  const url = item.dataset.url;
  if (url) {
    chrome.tabs.create({ url });
    window.close();
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
