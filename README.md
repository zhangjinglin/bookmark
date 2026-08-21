# 🔖 Bookmark - 书签管理工具

一个基于 Cloudflare Worker 的书签管理工具，支持 Chrome 浏览器扩展一键保存。

## 功能特性

- ✅ 一键保存网页书签
- ✅ 分类管理
- ✅ 拖拽分类（已移除，改为右键菜单）
- ✅ 右键菜单选择分类
- ✅ 现代化 UI 设计

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置 Cloudflare Worker

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 创建 KV 命名空间：
   ```bash
   pnpm wrangler kv:namespace create "BOOKMARKS"
   ```
3. 复制返回的 KV Namespace ID
4. 创建 `wrangler.toml` 文件（从模板复制）：
   ```bash
   cp wrangler.toml.example wrangler.toml
   ```
5. 编辑 `wrangler.toml`，填入你的 KV Namespace ID

### 3. 部署 Worker

```bash
pnpm deploy
```

### 4. 配置 Chrome 扩展

1. 复制配置文件模板：
   ```bash
   cp extension/config.example.js extension/config.js
   ```
2. 编辑 `extension/config.js`，填入你的 Worker 地址和域名
3. 在 Chrome 中加载扩展：
   - 打开 `chrome://extensions/`
   - 开启「开发者模式」
   - 点击「加载已解压的扩展程序」
   - 选择 `extension` 目录

## 文件结构

```
bookmark/
├── src/
│   ├── index.ts          # Worker 入口
│   └── index.html        # 前端页面
├── extension/
│   ├── manifest.json     # Chrome 扩展配置
│   ├── background.js     # 后台脚本
│   ├── popup.html        # Popup 界面
│   ├── popup.js          # Popup 逻辑
│   ├── config.example.js # 配置文件模板
│   └── icons/            # 扩展图标
├── wrangler.toml         # Cloudflare Worker 配置（需自行创建）
├── package.json
└── .gitignore
```

## API 接口

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/bookmarks` | 获取所有书签 |
| POST | `/api/bookmarks` | 添加书签 |
| PUT | `/api/bookmarks/:id` | 更新书签 |
| DELETE | `/api/bookmarks/:id` | 删除书签 |
| GET | `/api/categories` | 获取所有分类 |
| POST | `/api/categories` | 新建分类 |
| PUT | `/api/categories/:id` | 编辑分类 |
| DELETE | `/api/categories/:id` | 删除分类 |

## 技术栈

- **后端**: Cloudflare Worker
- **存储**: Cloudflare KV
- **前端**: Tailwind CSS
- **扩展**: Chrome Extension Manifest V3

## 注意事项

- `wrangler.toml` 和 `extension/config.js` 包含敏感配置，已被 `.gitignore` 忽略
- 请勿将这些文件上传到公开仓库
- KV 命名空间 ID 虽然不是密钥，但建议保密

## License

MIT
