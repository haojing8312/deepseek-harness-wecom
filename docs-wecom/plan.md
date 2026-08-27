# 企微销冠工作台 · 一期需求与验收口径（正式方案）

**状态**: 正式方案（定稿） · **版本**: v1.0 · **日期**: 2026-08-26
**底座**: DeepSeek Harness `dsh-v0.1.1-rc.2`（一切皆插件，Cordis）
**对标参考**: WeiClaw 3.0（`_reference/WeiClaw-analysis/`，逆向参考，非正式 PRD）

> 本文是企微销冠工作台的一期正式方案，后续开发以此为准。决策日志见 §0，DSH 扩展点速查见 §8。

---

## 0. 决策日志

| # | 决策 | 状态 |
|---|---|---|
| D-1 | 非商业**技术验证**，不做商业合规/计费设计 | ✅ 已锁定 |
| D-2 | 接入路线 = **DLL 注入接管员工企微账号**（对标参考产品） | ✅ 已锁定 |
| D-3 | 底座 = DSH，**插件方式**；服务**外部个人微信客户**；**全自动回复，无人工审批**（保留急停/限流/审计） | ✅ 已锁定 |
| D-4 | 注入 DLL = `vworkApi.dll`，**授权沿用**，随包分发（key/激活物料另行固化） | ✅ 已锁定 2026-08-26 |
| D-5 | 回复端到端延迟预算 = **≤15s**（含 LLM） | ✅ 已锁定 2026-08-26 |
| D-6 | 客户 preset 白名单一期 = **回复 + 只读知识库**，二者之外一律关闭 | ✅ 已锁定 2026-08-26 |
| D-7 | 一期拆两个交付点：**M1 源码闭环 → M2 桌面安装包** | ✅ 已锁定 |

## 1. 目标与边界

**一句话目标**：
> 单企微账号下，外部客户在员工企微上发消息 → 通道插件收到 → Harness Agent 处理 → 自动回复 → 会话全量可追踪。

**一期不做（Out of Scope）**：多账号/多空间、联系人 CRM/标签、素材库、SOP/规则引擎/定时任务、主动触达、云同步、计费会员、SILK 语音、附件复杂预览、飞书适配、人工审批流。

## 2. 总体架构

参考 WeiClaw"三层控制环"，映射到 DSH 插件体系：

```
┌─────────────────────────────────────────────────────────┐
│  企微 PC 客户端（固定版本，被注入的"躯壳"）                  │
│   ←  vworkApi.dll 远程线程注入 + HTTP 双通道（命令/回调）  →  │
└──────────────────────────────┬──────────────────────────┘
                               │ 回调（新消息）/ 命令（发送）
┌──────────────────────────────▼──────────────────────────┐
│  WeCom 通道插件（新增 DSH bundle，Windows-only）           │
│   · 入站: 回调 → UserMessage → agent.followup()           │
│   · 出站: agent 调用 wecom.reply → 命令 → DLL 发送         │
│   · 会话映射: external_chat_id ↔ session_id（自建持久 KV） │
└──────────────────────────────┬──────────────────────────┘
                               │ followup + whenIdle
┌──────────────────────────────▼──────────────────────────┐
│  ReactLoopAgent（既有 agent-loop）                        │
│   └─ 客户会话 preset（isolate realm，白名单仅两项工具）      │
│      · wecom.reply              —— 回复发送                │
│      · wecom.knowledge.search   —— 只读知识库检索           │
└──────────────────────────────┬──────────────────────────┘
                               │ Electron shell: file:// 加载
                               │ apps/web/dist + IPC bridge
┌──────────────────────────────▼──────────────────────────┐
│  Web UI（新增"企微客户会话" ConversationNode）+ 桌面壳       │
└─────────────────────────────────────────────────────────┘
```

**双 Agent 隔离**（安全边界）：客户会话 Agent（受限）与运维/调试 Agent（全量）完全分离，二者互不可达。依据：**外部客户消息是不可信输入**，不能进默认带 Shell/文件系统的高权限 Agent。

## 3. 功能需求与验收标准

### FR-1 企微接入（DLL 注入通道）

- **需求**: 加载 `vworkApi.dll`（D-4 授权沿用），远程线程注入指定版本企微 PC 客户端，建立 HTTP 双通道；注入后"硬化"企微防升级破坏；健康检测 + 自愈（参考技术方案 §3.2/§3.6/§3.7）。
- **验收**:
  - AC-1.1 指定企微版本上注入成功，回调通道 **≤3s** 建立。
  - AC-1.2 通道断线 **≤10s** 检测到并自动重连/自愈，客户消息不丢（落队列）。
  - AC-1.3 注入失败给出可读错误：未安装企微 / 版本不符 / 权限不足 / DLL 缺失。

### FR-2 入站消息接入

- **需求**: 订阅 DLL 回调 → 文本消息转 `UserMessage`，经 `agent.followup()` 投递进对应 Harness 会话；自定义消息源 kind（扩展 `MessageSourceMap`），模型可见输入以 `user/message` 渲染（扩展 `SessionEventMap` + `deriveEventMessage`）。
- **验收**:
  - AC-2.1 文本消息从回调到达 → 投递进会话 **≤1s**。
  - AC-2.2 会话日志可完整回溯该消息来源（渠道、外部会话、原始文本）。

### FR-3 外部会话映射

- **需求**: 自建 `external_chat_id ↔ session_id` 持久映射（DSH 无现成设施），重启恢复，生命周期明确。
- **验收**:
  - AC-3.1 同一客户会话始终映射同一 Harness 会话（除非显式重置），上下文可续接。
  - AC-3.2 进程重启后映射仍在，消息能接上历史上下文。
  - AC-3.3 提供显式"重置会话"能力，重置后新建会话并记录旧会话归档。

### FR-4 客户 Agent preset（安全边界）

- **需求**: 客户会话用独立 preset（session header `agentPreset` + `isolate` realm）。一期白名单**仅两项能力**（D-6）：
  1. `wecom.reply` —— 回复发送（客户 Agent 显式调用，审计落点）
  2. `wecom.knowledge.search` —— 只读知识库检索（见 FR-4.1）

  其余一律关闭：shell、subprocess、fs 写、凭据、网络任意访问、其他全部工具。

- **验收**:
  - AC-4.1 客户 preset 可用工具 = **恰好** `{wecom.reply, wecom.knowledge.search}`（可断言测试，多一即失败）。
  - AC-4.2 客户消息无法触达运维 Agent 或宿主 Shell/文件系统。
  - AC-4.3 知识库内容由运维侧维护，客户 Agent 只读。

#### FR-4.1 只读知识库（一期最小实现）

- **需求**: 客户 Agent 应答所需的受控资料。一期**不引入向量库**，用"目录内 Markdown/文本全文检索"；检索工具只读、结果截断、来源目录可配。
- **验收**:
  - AC-4.1.1 知识库检索只读，返回片段 + 来源，无文件系统写路径。
  - AC-4.1.2 来源目录可配置，默认 `docs-wecom/knowledge/`。
  - AC-4.1.3 检索工具仅挂载于客户 preset。

### FR-5 自动回复闭环

- **需求**: 收到客户消息 → Agent 处理 → 经 `wecom.reply` **自动发送**回复；无需人工确认。
- **验收**:
  - AC-5.1 收到消息到回复发出 **≤15s**（D-5，含 LLM）。
  - AC-5.2 发送失败有限重试（可配），并记录发送结果。
  - AC-5.3 Agent 拒答/出错/未调用 reply 时，通道插件发兜底文案，不静默丢消息。

### FR-6 安全控制

- **需求**: 全局急停、暂停、客户 allowlist、限流、全量审计。
- **验收**:
  - AC-6.1 全局急停 → 同时停掉入站投递与 `wecom.reply`，全部自动回复 **≤2s** 停止；恢复需显式操作。
  - AC-6.2 客户 allowlist：非白名单客户可配置"不自动回复"。
  - AC-6.3 单客户/全局消息限速可配，防刷屏。
  - AC-6.4 消息、工具调用（含 reply 与 knowledge.search）、发送结果全量落审计日志，可导出。

### FR-7 会话可追踪 / Web UI

- **需求**: Web UI 新增"企微客户会话"节点（`ConversationNodeDefinition` + `ctx.conversationEvents.register`，slot `conversation.chat.node`）；展示连接状态、凭据/注入配置。
- **验收**:
  - AC-7.1 Web UI 能查看每个企微客户的会话树（入站消息 + 工具调用 + 回复），复用现有会话渲染。
  - AC-7.2 连接状态（未注入/在线/掉线/自愈中）在 UI 可见。
  - AC-7.3 注入配置与企微路径/版本可在 UI 配置。
  - AC-7.4 现有 Harness 会话能力（历史、续接、fork 等）对客户会话可用。

### FR-8 桌面打包（M2 交付点）

- **需求**: 源码闭环验证通过后，把 Web + 后端 + 注入依赖 + 固定版本企微打进 Windows 安装包。Electron 壳按官方设计（`packages/host/webserver/src/index.ts` 注释：Electron 以 `file://` 加载 `apps/web/dist`，经 IPC bridge 转发 fetch），bundle/profile 整体离线分发。
- **验收**:
  - AC-8.1 安装包在干净 Windows 环境安装即用，无需装 Node、无需跑源码。
  - AC-8.2 安装包含固定版本企微客户端，升级/重装不会破坏注入（"硬化"）。
  - AC-8.3 `vworkApi.dll` 授权沿用（D-4）随包分发；key/激活物料合法可用并固化进打包脚本（残余动作，M2 前置）。

## 4. 非功能要求

- **NFR-1 稳定性**: 通道插件崩溃不影响 DSH 主进程与既有 Harness 功能（插件级隔离）。
- **NFR-2 性能**: 回复端到端 ≤15s（D-5）；单客户消息串行安全，不并发错乱。
- **NFR-3 可观测**: 参考技术方案 §12.5 日志体系；审计可导出。
- **NFR-4 安全**: 凭据不落明文；注入层最小权限；客户数据本地化不云传。
- **NFR-5 版本锁定**: DSH 锁 `dsh-v0.1.1-rc.2`；企微版本固定；DLL 版本固定。

## 5. 里程碑

| 里程碑 | 交付内容 | 验收口径 |
|---|---|---|
| **M1 源码闭环** | WeCom 通道插件 + 客户 preset + 会话映射 + Web UI 节点；`pnpm dsh web` 跑通单客户闭环 | AC-1 ~ AC-7 全绿 |
| **M2 桌面安装包** | Electron 壳 + 打包脚本 + 固定版企微 + 注入依赖 | AC-8 全绿；M1 闭环在安装包内原样可跑 |

## 6. 风险与依赖

| # | 风险 | 状态与残余动作 |
|---|---|---|
| R-1 | `vworkApi.dll` 许可/再分发 | ✅ 已决策授权沿用（D-4）；残余：确认 key/激活物料并固化进打包脚本，纳入 M2 前置 |
| R-2 | 企微版本升级破坏注入 | 固定版本 + "硬化"（技术方案 §3.6） |
| R-3 | 封号风险 | 非商业也真实存在；保留限流/急停；不做反检测规避 |
| R-4 | DSH 快速迭代 breaking change | 锁 `dsh-v0.1.1-rc.2`；按扩展点（§8）最小侵入 |
| R-5 | Electron 桌面壳无现成代码 | 仓库仅设计注释，M2 为新增工程 |

## 7. 分期路线图

- **P2**: 多账号/多客户并行、主动触达、联系人初步管理
- **P3**: 素材库、SOP、规则引擎、定时任务
- **P4**: 空间系统、云同步、可选的官方通道并存

## 8. DSH 扩展点速查（开发用）

| 需求 | DSH 机制 | 关键位置 |
|---|---|---|
| 入站投递 | `agent.followup(UserMessage)` + `agent.whenIdle()` | `packages/core/agent/src/runtime-types.ts`；headless 范例 `packages/bundle/headless/src/index.ts` |
| 自定义消息源 | 扩展 `MessageSourceMap` | `packages/llm/llm/src/message.ts` |
| 新模型可见事件 | 扩展 `SessionEventMap`，经 `user/message` 渲染 | `packages/core/session/src/types.ts`、`surface.ts`（`deriveEventMessage`） |
| 会话创建 | `ctx.sessions.create()` / `prepare()+enter()+announce()` | `packages/core/session/src/index.ts` |
| 工具注册 | `ctx.tools` | `packages/core/tools` |
| 每会话工具集 | session header `agentPreset` + `isolate` realm | `packages/preset/agent-presets/src/mount.ts`（`resolveSessionPreset()`） |
| 后台/监听循环 | `ctx.jobs`、`ctx.on`/`ctx.setInterval` | `packages/jobs/jobs/src/index.ts` |
| Agent 生命周期 | `agent/session-start`、`agent/inbox/inserted`、`agent/status`、`agent/error`、`agent/turn-stopping` | `packages/core/agent/src/types.ts` |
| Web UI 会话节点 | `ConversationNodeDefinition` + `registerConversationNodes` + slot `conversation.chat.node` | `packages/client/runtime/src/client/contract/conversation.ts`；教程 `docs/cookbook/adding-a-conversation-node.zh.md` |
| 前后端通信 | HTTP + SSE；`api-gateway` = `@deepseek-ai/dsh-host-apiproxy`；`connection` = `@deepseek-ai/dsh-client-connection` | `packages/host/webserver`、`packages/client/connection` |
| 桌面壳设计 | Electron 加载 `apps/web/dist`（`file://`）+ IPC bridge 转发 fetch | `packages/host/webserver/src/index.ts`（注释） |
| 离线分发 | profile/bundle 整体拷贝；`dsh --profile web` | `packages/bundle/{base,web-app,headless}`、`apps/cli/src/profile-boot.ts` |

## 9. 参考

- `_reference/WeiClaw-analysis/WeiClaw技术方案.md` — 对标架构与实现细节（注入 §3、消息流水线 §6、安全 §13、合规 §14）
- `docs/architecture.md` — DSH 架构（扩展点权威说明）
- `docs/cookbook/extension-cookbook.md` — 能力到扩展点映射

## 10. vworkApi 实机验证（M1 交付点）✅ 已验证

真实适配器 `@deepseek-ai/dsh-wecom-channel/vworkapi-adapter` 已实现并**实机验证通过**（微信 → DLL 钩子 → 回调 → 客户会话 → LLM 回复 → 自动发送回客户）。验证环境：`D:\worksoft\WXWork` 企微 5.0.3.6005 + `D:\worksoft\WeiClaw` 里的 vworkApi.dll/inject_tool。

### 实机流程与关键经验

1. **注入必须用 WeiClaw 式流程**：先杀运行中的企微 → `inject_tool` 用 `--exe_path` 启动**单一全新实例**并注入 → 等登录。**不要**对已独立运行的企微注入——inject_tool 会拉起新实例（孤儿进程）而打不中已登录主进程。适配器 `killWecomBeforeStart` 控制。
2. **DeepSeek key**：根 `.env` 配 `DEEPSEEK_API_KEY`（gitignored，启动时加载）。
3. **工具名不能用点号**：`wecom.reply` 等点号名被 DeepSeek API 校验拒绝（`Invalid 'tools[0].function.name'`）——已改名 `wecom_reply`/`wecom_knowledge_search`（下划线）。
4. **回复发送**：模型不可靠地调用 `wecom_reply`，驱动改为**自动发送 agent 最终文本**（对标 WeiClaw MessageSender）；`wecom_reply` 保留为显式审计路径。
5. **必须过滤自回显**：DLL 把发出的回复也回调回来（`is_self_msg=1`），不过滤会触发回复死循环。适配器按 `is_self_msg` 丢弃。
6. **客户 preset 需要引导指令**：tools 插件注册 system-prompt section，指示模型"回复必须调用 wecom_reply"。
7. **注意**：企微版本升级会破坏注入（R-2）——硬化设置（关闭自动更新等，参考 §3.6）。vworkApi 单线程 HTTP，多开端口递增。

### 复现步骤

1. 装好固定版企微 + vworkApi（本机已有）。
2. `.env` 配 `DEEPSEEK_API_KEY`。
3. bundle 里 vworkapi 适配器已启用（`killWecomBeforeStart: true`）。
4. `pnpm dsh web` → 自动杀企微、重启、注入、等登录（可能需扫码一次）。
5. 微信发消息 → 收到自动回复。


