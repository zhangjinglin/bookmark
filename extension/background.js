// 导入配置
import config from './config.js';
const WORKER_URL = config.WORKER_URL;
const BOOKMARK_URL = config.BOOKMARK_URL;

// 重新构建右键菜单
async function rebuildContextMenu() {
  // 先移除所有现有菜单
  await chrome.contextMenus.removeAll();
  
  // 加载最新分类
  let categories = [];
  try {
    const res = await fetch(`${WORKER_URL}/api/categories`);
    categories = await res.json();
  } catch (err) {
    console.error('加载分类失败:', err);
  }
  
  // 创建「添加到分类」父菜单
  chrome.contextMenus.create({
    id: 'add-to-category',
    title: '添加到分类',
    contexts: ['action']
  });
  
  // 创建「无分类」选项
  chrome.contextMenus.create({
    id: 'add-no-category',
    parentId: 'add-to-category',
    title: '无分类',
    contexts: ['action']
  });
  
  // 创建各分类子菜单
  categories.forEach(cat => {
    chrome.contextMenus.create({
      id: `add-to-${cat.id}`,
      parentId: 'add-to-category',
      title: cat.name,
      contexts: ['action']
    });
  });
  
  // 创建「打开书签管理」菜单
  chrome.contextMenus.create({
    id: 'open-bookmarks',
    title: '打开书签管理',
    contexts: ['action']
  });
  
  // 创建「刷新分类」菜单
  chrome.contextMenus.create({
    id: 'refresh-categories',
    title: '🔄 刷新分类',
    contexts: ['action']
  });
}

// 初始化
chrome.runtime.onInstalled.addListener(async () => {
  await rebuildContextMenu();
});

// 右键点击插件图标时处理菜单点击
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'open-bookmarks') {
    chrome.tabs.create({ url: BOOKMARK_URL });
    return;
  }
  
  if (info.menuItemId === 'refresh-categories') {
    // 刷新分类菜单
    await rebuildContextMenu();
    // 显示刷新成功提示
    await chrome.action.setBadgeText({ text: '✓' });
    await chrome.action.setBadgeBackgroundColor({ color: '#28a745' });
    setTimeout(async () => {
      await chrome.action.setBadgeText({ text: '' });
    }, 1500);
    return;
  }
  
  if (info.menuItemId === 'add-no-category') {
    await saveBookmark(tab, []);
  } else if (info.menuItemId.startsWith('add-to-')) {
    const categoryId = info.menuItemId.replace('add-to-', '');
    await saveBookmark(tab, [categoryId]);
  }
});

// 左键点击：直接保存（无分类）
chrome.action.onClicked.addListener(async (tab) => {
  await saveBookmark(tab, []);
});

// 保存书签函数
async function saveBookmark(tab, categoryIds = []) {
  // 显示保存中状态
  await chrome.action.setBadgeText({ text: '...' });
  await chrome.action.setBadgeBackgroundColor({ color: '#007bff' });
  
  try {
    const response = await fetch(`${WORKER_URL}/api/bookmarks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: tab.url,
        title: tab.title,
        categoryIds
      }),
    });

    if (response.ok) {
      // 显示成功状态
      await chrome.action.setBadgeText({ text: '✓' });
      await chrome.action.setBadgeBackgroundColor({ color: '#28a745' });
    } else {
      // 显示失败状态
      await chrome.action.setBadgeText({ text: '✗' });
      await chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });
    }
  } catch (error) {
    // 显示错误状态
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });
    console.error('保存书签失败:', error);
  }
  
  // 2秒后清除状态
  setTimeout(async () => {
    await chrome.action.setBadgeText({ text: '' });
  }, 2000);
}
