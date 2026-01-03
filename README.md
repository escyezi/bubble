# Bubble

纯前端的聊天小助手原型：一个颜文字 Bubble + 输入框，通过 OpenAI 兼容接口进行流式对话；支持情绪标签驱动表情切换，并把对话与设置持久化到浏览器 `localStorage`。

## 功能

- 主界面：大号颜文字 Bubble + 气泡文本 + 输入框
- 右上角：`设置`（OpenAI Key/Base URL/Model）与 `记录`（对话历史弹窗）
- 流式输出：边生成边“打字机”逐字显示
- 情绪标签：模型在输出中嵌入 `[[h]]` 等标签以切换表情；主界面不展示标签，历史记录会保留原文（支持 `[[n]] [[h]] [[s]] [[a]] [[c]] [[t]] [[ex]] [[sp]] [[sh]] [[sl]] [[lv]]）
- 预置提示词按钮：`吟诵俳句吧！` / `讲个笑话` / `吐槽一下`

## 运行

To install dependencies:

```bash
bun install
```

To start a development server:

```bash
bun dev
```

To run for production:

```bash
bun start
```

## 使用

1) 点右上角 `设置`，填写：
- `OpenAI Key`
- `Base URL`（默认 `https://api.openai.com/v1`，需要支持浏览器 CORS）
- `Model`（默认 `gpt-4o-mini`）

2) 在输入框输入内容回车发送，或点击底部预置按钮。

## 重要约束/安全提示

- **不要把真实 OpenAI Key 用在公开部署的纯前端页面**：Key 会暴露给所有访问者。
- 浏览器直连 OpenAI 官方域名可能遇到 **CORS**；如遇到问题，请使用你自己的代理/网关作为 `Base URL`。

This project was created using `bun init` in bun v1.3.4. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
