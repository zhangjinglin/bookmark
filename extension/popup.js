// 配置（从 config.js 同步更新）
const WORKER_URL = 'https://bookmark-worker.jiv.workers.dev';

// DOM 元素
const pageTitle = document.getElementById('page-title');
const pageUrl = document.getElementById('page-url');
const categorySelect = document.getElementById('category-select');
const saveBtn = document.getElementById('save-btn');
const message = document.getElementById('message');

let currentTab = null;

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  // 绑定保存按钮事件
  saveBtn.addEventListener('click', saveBookmark);
  // 获取当前标签页
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;
  
  // 显示页面信息
  pageTitle.textContent = tab.title || '无标题';
  pageUrl.textContent = tab.url || '';
  
  // 加载分类列表
  await loadCategories();
});

// 加载分类
async function loadCategories() {
  try {
    const res = await fetch(`${WORKER_URL}/api/categories`);
    const categories = await res.json();
    
    categories.forEach(cat => {
      const option = document.createElement('option');
      option.value = cat.id;
      option.textContent = cat.name;
      categorySelect.appendChild(option);
    });
  } catch (err) {
    console.error('加载分类失败:', err);
  }
}

// 保存书签
async function saveBookmark() {
  if (!currentTab) return;
  
  saveBtn.disabled = true;
  saveBtn.textContent = '保存中...';
  
  try {
    const categoryId = categorySelect.value;
    const categoryIds = categoryId ? [categoryId] : [];
    
    const res = await fetch(`${WORKER_URL}/api/bookmarks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: currentTab.url,
        title: currentTab.title,
        categoryIds
      }),
    });
    
    if (res.ok) {
      message.innerHTML = '<div class="success">✅ 保存成功</div>';
      setTimeout(() => window.close(), 1000);
    } else {
      throw new Error('保存失败');
    }
  } catch (err) {
    message.innerHTML = '<div class="error">❌ 保存失败</div>';
    saveBtn.disabled = false;
    saveBtn.textContent = '保存';
  }
}
