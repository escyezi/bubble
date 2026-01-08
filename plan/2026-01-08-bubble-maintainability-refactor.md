# Bubble Maintainability Refactor Plan

## Background / 背景
近期完成了两件结构性改动：
- 用 Valtio 统一状态管理，并将状态与 actions 拆分到 `src/bubble/state/*`
- 引入存储抽象层，IndexedDB（Dexie）优先、localStorage fallback：`src/bubble/storage/*`

当前主要风险在于：`src/bubble/state/actions.ts` 单文件承担了 hydration、持久化订阅、清空语义、发送/流式、打字机 runtime 等多种职责，且使用大量 module-level 可变状态，后续迭代容易出现竞态与回归。

## Goals / 目标
- 降低 `actions.ts` 复杂度，按职责拆分模块，便于测试与局部修改。
- 让“会话/历史/清空”的语义更清晰：清空=删除存储记录；当前会话=显式指针而不是“猜 latest”。
- 持久化写入链路更稳健：避免 Valtio Proxy 写入导致 Dexie 失败、隐式 fallback。
- 减少重复工具函数（如 JSON parse）与隐式行为，提高可读性与可追踪性。

## Non-goals / 非目标
- 不改 UI 交互与视觉。
- 不引入后端/账户体系/多设备同步。
- 不在本轮引入完整测试体系（如果仓库目前缺少测试框架）。

## Approach / 方案
分阶段小步重构，每阶段保持功能等价（或仅做可验证的行为改进），并用 `bun run typecheck` 作为基础验收。

关键决策：
- 将“运行时引擎”（打字机队列、定时器、AbortController、解析器）封装为一个可显式 init/cleanup 的 runtime 模块，避免散落全局变量。
- 将 hydration 与 persistence 变成独立模块，提供明确的生命周期与“暂停持久化/恢复持久化”能力，替代一次性 flag。
- 让 storage 层支持“当前会话指针”，避免通过 `updatedAt` 推断 latest 的隐式语义。

## TODO

### 1) 拆分 state/actions（职责分离）
- [ ] 新增 `src/bubble/state/hydration.ts`：抽出 `ensureHydrated/loadInitialState` 调用与状态写回逻辑。
- [ ] 新增 `src/bubble/state/persistence.ts`：抽出订阅、debounce、flush、pagehide 处理与统一的 start/stop API。
- [ ] 新增 `src/bubble/state/runtime.ts`：封装流式发送、队列、打字机 tick、abort、cleanup；actions 只负责“把状态/依赖喂给 runtime”。
- [ ] 保持 `src/bubble/state/index.ts` 对外 API 不变（仅内部重定向导出），减少调用方改动面。

### 2) 改进落盘数据“去 Proxy”策略
- [ ] 将持久化写入前的 `toPlainJson(JSON.parse(JSON.stringify))` 替换为更明确的快照/拷贝策略（例如 `valtio` 的 snapshot + `structuredClone`）。
- [ ] 明确落盘数据边界：只落盘 `settings` 与“当前会话”；其余 UI 状态不落盘。

### 3) 明确“当前会话”与“历史列表”的模型
- [ ] 在 storage 抽象层增加“当前会话指针”能力（例如 `getCurrentConversationId/setCurrentConversationId` 或 `getCurrentConversation/setCurrentConversation`）。
- [ ] Dexie 增加轻量表（例如 `app` 或复用 `settings` 存一个字段）来保存当前会话 id，类型安全且可迁移。
- [ ] 将 `getLatestConversation()` 仅作为迁移/兜底路径，主路径改为“读当前会话”。

### 4) 清空语义与竞态收敛
- [ ] 将 `clearConversation` 拆成：`clearHistory()`（只删存储历史）+ `startNewConversation()`（只切换内存会话）。
- [ ] 在 persistence 层提供 `pausePersistence(async fn)`：清空/迁移期间暂停会话写入，避免靠 `suppressNextEmptyConversationPersist` 维护隐式状态。
- [ ] 明确清空期间对 send 的行为：等待清空完成或直接禁止发送（与 UI 状态一致）。

### 5) 工具函数与类型收敛
- [ ] 统一 JSON parse 工具（避免 `safeJsonParse` 多处重复实现）。
- [ ] 评估将 `Conversation.messages` 等类型升级为 `ReadonlyArray`（或提供 `ReadonlyConversation`）以减少 snapshot 的 readonly 摩擦。
- [ ]（可选）补充最小“集成级”验证脚本：覆盖 hydrate → send → clear → 再 send 的关键路径。

## Acceptance Criteria / 验收标准
- `src/bubble/state/actions.ts` 明显瘦身（主要是薄的 orchestrator），runtime/persistence/hydration 逻辑可定位到独立文件。
- Dexie 可用时，新对话必写入 IndexedDB；仅在 Dexie 抛错时才落到 localStorage（且行为可解释）。
- “清空”不会产生新的空记录落盘；存储层历史被真正删除；UI 能继续开始新对话。
- `bun run typecheck` 通过，且关键交互（发送、设置保存、记录弹窗、清空）无回归。

## Progress log (optional)
- 2026-01-08: 创建重构计划文档。

