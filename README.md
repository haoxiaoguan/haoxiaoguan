# 号小管 (haoxiaoguan)

> 面向 AI 编程 CLI 的「账号 + API 代理」桌面工具。

号小管是一个基于 Electron 的跨平台桌面应用，把多家 AI 上游（Kiro、Codex / ChatGPT 原生、第三方中转等）统一聚合成本地的 **OpenAI / Anthropic / Gemini 兼容端点**，并配套多账号池、额度管理、客户端一键接入、用量统计大屏等能力，方便在 Claude Code、Codex、Gemini CLI 等工具中稳定、可控地使用 AI 服务。

- 平台：macOS / Windows / Linux
- 许可证：[GPL-3.0-or-later](./LICENSE)
- 状态：`0.1.0`（首个正式版）

---

## 功能特性

- **本地 API 反向代理**：内置 HTTP 服务，对外提供 OpenAI / Anthropic / Gemini 兼容接口；支持账号池、故障转移、健康检查与冷却、令牌桶限流、路由组合（跨供应商降级链）、客户端 Key 加密管理、Prometheus `/metrics` 可观测性。
- **多账号管理**：OAuth 登录、凭证加密落库、额度查询、Token 定时刷新、账号健康检测、账号分组。
- **客户端一键接入**：把代理 / 供应商配置写入 Claude、Gemini、Codex、OpenCode、OpenClaw、Hermes 等 CLI 客户端。
- **出站代理 IP 管理**：代理池 + 账号 / 分组级代理绑定，可跟随系统代理。
- **会话历史浏览**：只读浏览本地 Claude / Codex / Gemini 的对话历史。
- **用量与活动统计**：增量扫描会话日志，统计 token 用量与趋势，提供数据大屏。
- **技能 / MCP 管理**：管理 AI Agent Skills 与 MCP Server 配置并同步到各客户端。
- **数据安全**：WebDAV 端到端加密整库同步、30 分钟定时本地备份、`safeStorage` 保护的主密钥。
- **自动更新**：基于 `electron-updater`，三平台 CI 自动打包发布到 GitHub Releases。

---

## 技术栈

| 分层 | 选型 |
| --- | --- |
| 应用框架 | Electron 40 · electron-vite |
| 渲染层 | React 19 · React Router 7 · Tailwind CSS 3 · shadcn/ui (Radix) · daisyUI · Zustand · i18next · Recharts · Monaco |
| 主进程 | MikroORM 6 · better-sqlite3 · Hono · reflect-metadata（装饰器实体） |
| 安全 / 网络 | node-forge · Electron safeStorage · undici · fetch-socks（SOCKS 代理） |
| 测试 | Vitest（单元）· Playwright（E2E） |
| 工程 | SWC（装饰器元数据）· bytecodePlugin（字节码保护）· pnpm |

---

## 目录结构

```text
src/
├─ main/                      # 主进程（后端）
│  ├─ main.ts                 # 应用入口：窗口 / 托盘 / 生命周期 / 定时任务
│  ├─ container.ts            # 依赖注入容器：集中装配全部服务单例
│  ├─ contexts/<域>/          # 业务上下文，按 application/domain/infrastructure/ipc 分层
│  │   account · accountGroup · credential · quota · proxy · apiProxy ·
│  │   clientConfig · sessions · activity · usage · skill · mcp · sync ·
│  │   localBackup · updater · settings
│  ├─ agents/                 # AI 客户端适配器（claude / codex / gemini-cli / kiro / qoder …）
│  └─ platform/               # 基础设施：crypto / net / oauth / persistence / fs / log …
├─ preload/                   # contextBridge 暴露安全 IPC
├─ renderer/                  # React 应用（pages / components / stores / features / hooks / i18n）
└─ shared/                    # 主/渲染共享的 IPC 通道与类型契约
```

设计文档与实施计划位于 [`docs/superpowers/`](./docs/superpowers)（`specs/` 设计、`plans/` 计划）。

---

## 快速开始

### 环境要求

- Node.js ≥ 20（CI 使用 Node 22）
- [pnpm](https://pnpm.io/) 10（仓库已固定 `packageManager` 版本）

### 安装

```bash
pnpm install
```

### 开发

```bash
pnpm dev          # 重建原生模块(better-sqlite3) 后启动 electron-vite 开发模式(热更新)
```

### 质量校验

```bash
pnpm typecheck    # 类型检查（node 侧 + web 侧）
pnpm lint         # ESLint 静态检查
pnpm format       # Prettier 格式化
pnpm test         # Vitest 单元测试
pnpm test:e2e     # Playwright 端到端测试
```

### 构建与打包

```bash
pnpm build        # 构建主进程 / preload / 渲染层
pnpm dist:mac     # 打包 macOS（dmg + zip）
pnpm dist:win     # 打包 Windows（nsis）
pnpm dist:linux   # 打包 Linux（AppImage + deb）
```

---

## 发布流程

推送形如 `v0.1.0`（正式）或 `v0.1.1-beta.1`（预发布）的 tag 触发 [`.github/workflows/release.yml`](./.github/workflows/release.yml)：三平台并行打包并发布到 GitHub Releases。

- **正式 tag**（`vX.Y.Z`）→ 上传为 **draft**，人工审核后点 Publish 才放给所有用户。
- **预发布 tag**（含 `-beta` 等）→ 发布为 **Pre-release**，仅开启 `allowPrerelease` 的客户端可拉到，实现灰度。

> macOS 当前为未签名构建：客户端通过「下载 dmg → 手动拖入 Applications」安装；Windows / Linux 可正常自动更新（仅有系统安全警告）。

---

## 免责声明

本项目仅用于学习与技术研究。使用本工具聚合 / 中转第三方 AI 服务，可能违反相关服务的使用条款，并存在账号风险。请在遵守当地法律法规及各服务条款的前提下自行评估并承担使用风险，作者不对因使用本项目产生的任何后果负责。

---

## 许可证

[GPL-3.0-or-later](./LICENSE)
