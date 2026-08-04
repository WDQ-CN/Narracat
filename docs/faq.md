# FAQ：API Key 与费用

## 为什么要自备 API Key（BYOK）？

NarraCat 不经手你的模型调用——应用直连你选择的模型服务商，Key 存在 macOS 钥匙串里。你写的每个字只在你和服务商之间流动。

## 推荐哪家？怎么申请？

推荐 **DeepSeek**（中文写作性价比高，官方支持 Anthropic 兼容接口）：

1. 打开 platform.deepseek.com，注册并实名
2. 充值（10 元起即可开写）
3. 「API Keys」页新建一个 Key，复制
4. NarraCat 设置页 → 模型服务 → 粘贴 Key → 点「测试」通过即可

也支持 Anthropic（Claude）等提供 Anthropic 兼容 API 的服务商。

## 写一章要花多少钱？

取决于模型与章节长度。以 DeepSeek 为例，生成一章 3000–4000 字连同大纲/记忆上下文，**单章成本通常在几毛到几元人民币**。用 Claude 等一线模型质量更高，单章成本会显著上升。

> 本区间为估算，首发前会用真实跑批数据校准（见发布检查单）。

## Key 安全吗？

Key 通过 macOS Keychain 存储，永不明文落盘；仓库代码可查证这一点（`electron/main/secrets.ts`）。
