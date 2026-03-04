# AI Bridge 🌉

> 跨 AI 工具会话迁移，一行命令搞定。

AI Bridge 让你在不同的 AI 编程工具之间无缝迁移会话历史。在 Claude 里聊了一半，想换到 Codex 继续？没问题。

## ✨ 核心功能

- **🔀 无缝迁移** - 在 Claude、Codex、Copilot、Kimi 等工具间迁移会话
- **📦 统一格式** - 中间表示层(IR)确保数据不丢失
- **⚡ 一键恢复** - 自动生成目标工具的 resume 命令
- **🔌 插件化架构** - 轻松扩展新 backend

## 🚀 快速开始

```bash
# 构建
npm run build

# 查看支持的 backend
node ./dist/index.js --list-backend

# 迁移会话（示例：从 Claude 到 Codex）
node ./dist/index.js --from claude:abc123 --to codex

# 查看某 backend 的会话列表
node ./dist/index.js --list-session claude
```

## 🛠️ 支持的 Backend

| Backend | 读取 | 写入 |
|---------|------|------|
| Claude | ✅ | ✅ |
| Codex | ✅ | ✅ |
| Copilot | ✅ | ✅ |
| Kimi | ✅ | ✅ |

## 📖 文档

- [如何添加新 Backend](./docs/how-to-add-a-new-backend.md)

## 🏗️ 架构

```
src/
├── adapters/          # 各 AI 工具适配器
│   ├── claude/
│   ├── codex/
│   ├── private/       # 私有适配器
│   └── registry.ts    # 动态注册
├── commands/          # CLI 命令
├── types.ts           # IR 定义
└── utils/             # 通用工具
```

## 🔧 开发

```bash
# 开发模式
npm run dev -- --list-backend

# 构建
npm run build
```

---

**AI Bridge** - 打破工具壁垒，让你的 AI 会话自由流动。
