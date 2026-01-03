# Bubble 项目描述（MVP）

Bubble 是一个纯前端的“直播/陪伴型聊天助手”原型：页面主体是一个颜文字角色，会以气泡的方式展示模型输出，并通过“情绪标签”在回复过程中切换表情。对话与设置保存在浏览器 `localStorage` 中，刷新不会丢。

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
- `记录`：弹窗查看对话历史，支持清空当前会话。

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

实现文件：`src/bubble/BubbleApp.tsx`、`src/bubble/chatUtils.ts`

### 3.2 文字换行策略
- **不人为插入换行**。
- 只有当模型输出文本本身包含换行符时，气泡才会换行。
- 气泡区域使用 `whitespace-pre-wrap` 渲染。

---

## 4. 历史记录与持久化

### 4.1 localStorage
- 设置存储 key：`bubble.settings.v1`
- 当前会话存储 key：`bubble.conversation.current.v1`

实现文件：`src/bubble/storage.ts`

### 4.2 历史记录“保留标签”的策略
- 主界面显示：使用打字机输出后的 `message.text`（不包含标签）。
- 历史记录显示：assistant 优先显示 `message.rawText`（包含标签），方便调试/复盘表情切换。

数据结构：`src/bubble/types.ts`

### 4.3 写入节流
流式过程中消息会频繁更新，`localStorage` 写入是同步操作。MVP 中对写入做了 200ms 的 debounce，避免 UI 卡顿。

---

## 5. 主要文件与职责

- `src/bubble/BubbleApp.tsx`
  - 页面结构、输入/发送逻辑
  - 流式增量接入 + 情绪标签事件队列
  - 打字机输出与表情切换（与工具函数协作）
- `src/bubble/components/SettingsModal.tsx`
  - 设置弹窗 UI 与表单
- `src/bubble/components/HistoryModal.tsx`
  - 记录弹窗 UI 与清空逻辑
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
- `src/bubble/storage.ts`
  - `useLocalStorageState`（带 debounce）
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
- MVP 阶段默认不处理超量与清理策略；后续可切换 IndexedDB。

---

## 7. 运行与构建

- 开发：`bun dev`
- 构建：`bun run build`
- 生产启动：`bun start`
