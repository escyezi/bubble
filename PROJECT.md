# Bubble 项目描述（MVP）

Bubble 是一个纯前端的“直播/陪伴型聊天助手”原型：页面主体是一个颜文字角色，会以气泡的方式展示模型输出，并通过“情绪标签”在回复过程中切换表情。对话与设置会落盘到浏览器端存储（优先 IndexedDB / Dexie，不支持 IndexedDB 时回退 `localStorage`），刷新不会丢。

> MVP 目标：用最小代价跑通交互闭环（输入 → 流式生成 → 气泡逐字显示 → 表情切换 → 历史记录持久化）。

---

## 1. 页面与交互

### 1.1 主界面
- **主体**：大号颜文字 Bubble + 一段气泡文字。
- **底部**：输入框 + 发送按钮。
- **快捷按钮**（输入框上方）：
  - `吟诵俳句吧！`：发送同名提示词
  - `讲个笑话`：发送“讲个笑话，然后换行解释一下笑话的笑点，解释完笑点后直接接一个逗号并以\"令人忍俊不禁。\"结尾”
  - `吐槽一下`：发送“风趣地吐槽一下社会现象”

### 1.2 右上角
- `设置`：弹窗配置 OpenAI 相关信息。
- `记录`：弹窗查看当前对话内容，支持清空已落盘的对话记录。

---

## 2. LLM 接入方式

### 2.1 请求
- **纯前端直连**：使用浏览器 `fetch` 调用 OpenAI 兼容接口 `POST {baseUrl}/chat/completions`。
- **流式**：`stream: true`，前端解析 SSE（Server-Sent Events）响应，从 `choices[0].delta.content` 增量拿到文本。

实现文件：`src/bubble/openai.ts`

### 2.2 输出约束（情绪标签协议）
模型输出为“普通文本”，但允许嵌入情绪标签来控制 Bubble 的表情切换。

**标签格式（内嵌、不展示）**：
- `[[n]]` neutral（中性）
- `[[h]]` happy（开心）
- `[[s]]` sad（难过）
- `[[a]]` angry（生气）
- `[[c]]` confused（困惑）
- `[[t]]` thinking（思考）
- `[[ex]]` excited（兴奋）
- `[[sp]]` surprised（惊讶）
- `[[sh]]` shy（害羞）
- `[[sl]]` sleepy（困）
- `[[lv]]` love（爱心）

约定：标签应该出现在它所影响的文本之前，例如：

```
[[h]]先开心一下～[[sp]]诶？！[[c]]这里我有点不确定…[[ex]]啊原来如此！[[lv]]
```

实现文件：
- 提示词约束：`src/bubble/openai.ts`
- 标签解析器：`src/bubble/emotionTags.ts`

---

## 3. 显示逻辑

### 3.1 流式 + 打字机
- SSE 流式增量到达时：先进行“情绪标签解析”，得到两类事件：
  - **emotion**：切换当前表情（不输出字符）
  - **text**：进入待输出队列
- UI 使用打字机模式逐字输出：每次 tick 输出 1 个字符，支持标点停顿。

实现文件：`src/bubble/state/runtime.ts`、`src/bubble/chatUtils.ts`

### 3.2 文字换行策略
- **不人为插入换行**。
- 只有当模型输出文本本身包含换行符时，气泡才会换行。
- 气泡区域使用 `whitespace-pre-wrap` 渲染。

---

## 4. 历史记录与持久化

### 4.1 存储层（Dexie 优先，localStorage fallback）
当前实现引入了一个存储抽象层：启动时若 IndexedDB（Dexie）可用，则全程使用 Dexie；仅在环境不支持/无法初始化 IndexedDB 时，才启用 `localStorage` 兜底（避免运行时逐操作回退导致数据不一致）。

- localStorage key（fallback / 兼容旧数据）：
  - 设置：`bubble.settings.v1`
  - 当前会话：`bubble.conversation.current.v1`
- IndexedDB（Dexie）：
  - DB 名：`bubble`
  - `settings` 表：仅 1 行，主键固定 `id="default"`，带 `updatedAt`
  - `conversations` 表：以 `Conversation.id` 为主键，带 `updatedAt`
  - `app` 表：仅 1 行，主键固定 `id="default"`，保存 `currentConversationId`

实现文件：`src/bubble/storage/*`

### 4.2 Hydration（启动读取）
由于 IndexedDB 是异步接口，启动时会先用默认值渲染，再在挂载后异步加载存储数据覆盖到状态中。Hydrate 完成前会禁用发送（避免“未加载完就写回覆盖”）。

实现文件：`src/bubble/state/state.ts`、`src/bubble/state/hydration.ts`、`src/bubble/state/persistence.ts`

### 4.3 历史记录“保留标签”的策略
- 主界面显示：使用打字机输出后的 `message.text`（不包含标签）。
- 历史记录显示：assistant 优先显示 `message.rawText`（包含标签），方便调试/复盘表情切换。

数据结构：`src/bubble/types.ts`

### 4.4 写入节流与类型安全
流式过程中消息会频繁更新。MVP 中对持久化做了 debounce（settings 200ms / conversation 250ms）避免频繁落盘；同时写入前会对 Valtio 数据做快照并拷贝（`snapshot + structuredClone`，必要时回退 JSON），避免把 Proxy 直接写入 IndexedDB 导致结构化克隆失败。

实现文件：`src/bubble/state/persistence.ts`

### 4.5 清空对话
“清空”会真正删除存储层的对话记录（Dexie：清空 `conversations` 表并清掉当前会话指针；localStorage：移除对应 key），同时在内存中切换到一个新会话继续聊天，不会把“空会话”写回存储。

实现文件：`src/bubble/state/actions.ts`、`src/bubble/state/persistence.ts`、`src/bubble/storage/*`

---

## 5. 主要文件与职责

- `src/bubble/BubbleApp.tsx`
  - 页面结构与交互绑定（读取 valtio snapshot，调用 actions）
  - 全局错误捕获（`window.error` / `unhandledrejection`）与弹窗展示
- `src/bubble/errorHooks.ts`
  - 全局错误捕获相关 hooks
- `src/bubble/components/SettingsModal.tsx`
  - 设置弹窗 UI 与表单
- `src/bubble/components/HistoryModal.tsx`
  - 记录弹窗 UI 与清空逻辑
- `src/bubble/components/GlobalErrorModal.tsx`
  - 全局错误弹窗 UI
- `src/bubble/state/state.ts`
  - 全局状态（valtio proxy）
- `src/bubble/state/errors.ts`
  - 全局错误上报与清除（写入 state + console 输出）
- `src/bubble/state/actions.ts`
  - 业务动作（send/clear/open/close 等）
- `src/bubble/state/hydration.ts`
  - 启动 hydration：从 storage 读入 settings + 当前会话
- `src/bubble/state/persistence.ts`
  - 持久化订阅、debounce、flush、pagehide、pause/restore
- `src/bubble/state/runtime.ts`
  - 流式增量接入 + 情绪标签事件队列
  - 打字机输出与表情切换
- `src/bubble/openai.ts`
  - OpenAI 兼容 `/chat/completions` 调用
  - SSE 流式解析，回调 `onDeltaText`
  - 系统提示词（要求使用情绪标签）
- `src/bubble/emotionTags.ts`
  - 情绪标签流式解析器（支持 tag 在 chunk 边界被切断）
- `src/bubble/chatUtils.ts`
  - 消息更新与打字机工具函数（分段、字符节奏等）
- `src/bubble/constants.ts`
  - 常量配置（存储 key、默认设置、打字机节奏、快捷提示词）
- `src/bubble/storage/*`
  - Dexie/localStorage 存储抽象与实现（Dexie 优先，IndexedDB 不可用时 fallback）
- `src/bubble/storageHooks.ts`
  - 旧版 `useLocalStorageState`（带 debounce），当前 `BubbleApp` 未使用
- `src/bubble/types.ts`
  - Settings/Conversation/Message 类型

---

## 6. 约束与风险（MVP 范围内）

### 6.1 Key 安全
- 纯前端模式下 OpenAI Key 会保存在浏览器端并可被用户看到。
- **不建议用于公开部署**；MVP 默认仅用于本地自用或原型验证。

### 6.2 CORS
- 浏览器直接请求 OpenAI 官方域名可能遇到 CORS 限制。
- `Base URL` 需要支持 CORS；否则需要增加后端代理（不在 MVP 范围）。

### 6.3 标签稳定性
- 情绪标签依赖模型遵循提示词，仍可能出现：标签拼错/标签过多/在不合适位置插入。
- 解析器对未知标签会按普通文本处理（不影响显示，但会出现在历史记录）。

### 6.4 localStorage 容量与性能
- localStorage 容量有限且写入同步。
- 当前默认使用 IndexedDB（Dexie）落盘，localStorage 仅作为 fallback/兼容旧数据。

---

## 7. 运行与构建

- 开发：`bun dev`
- 构建：`bun run build`
- 生产启动：`bun start`
