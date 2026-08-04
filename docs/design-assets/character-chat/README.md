# Character Chat Design Options

Source:
- 本次 `唠个嗑` 产品讨论产生的 HTML prototype。
- 原型用于视觉方向选择，不是生产实现源。

Durable references:
- `mockups/character-chat-options.html`：三种 MVP 沉浸式方向，可通过底部切换器或 `?option=a|b|c` 查看。
- `oss-audit.md`：Character chat 相关开源项目调研与复用边界。
- `../../adr/0010-character-chat-is-native-app-runtime.md`：Character chat 使用 App-native runtime 的架构决策。

Decision:
- 当前 MVP 视觉方向采用 A 通讯器：最接近 App 现有 Workbench，角色像联系人，右侧保留设定与记忆边界。
- A 通讯器默认只展示联系人列表 + 一对一聊天；角色资料、知识章、最近经历和边界通过「资料」抽屉打开，不常驻占屏。
- B 视觉小说作为后续更强沉浸模式参考，不进入 MVP。
- C 剧情终端作为后续角色来信 / 战后近况方向参考，不进入 MVP。

Current MVP constraints reflected:
- 单本 Novel project 内的独立板块。
- 角色联系人是一对一聊天，不做群聊。
- 联系人列表只显示可聊的 Appeared character，不显示未出场角色灰态。
- 角色设定稳定装载；对话时按需补查 NovelMemory。
- MVP 不要求每个角色有专属头像或立绘，使用稳定自动头像或既有氛围图即可。
- 输入区附近提供 2-3 个轻量开场话题 chip，帮助用户进入角色语境；它们不是 Agent action，也不写入正史。
- NovelMemory 补查策略属于 Character chat runner，renderer 不根据用户文本做知识路由。
- 知识边界固定为最新 Chapter completed。
- 聊天记录只属于 App 层，保存在 App 用户数据边界；不写入 Novel project、NovelMemory 或写作主流程。
- MVP 不做 Character chat 到 Agent action 的交接；角色聊天保持纯聊天。
- MVP 固定作者身份，不做作者 / 读者模式切换；数据结构和术语保留未来 user mode。
- Character chat 不是 Agent action，但仍需要模型服务；MVP 复用 Model service verification gate，未验证时显示引导去 Settings 的空态。
- 角色回复支持 streaming，但 UI 只显示角色打字中或气泡逐步出现，不展示工具调用、检索过程或 Agent 执行日志。
- 普通发送失败在聊天流内显示轻量错误并允许重试，不创建 Result notification 或 Push notification。
- MVP 不做后台主动推送，Character ping 只作为未来概念预留。

Later:
- 未来可在 Novel settings 的角色设定中支持用户上传角色头像；Character chat 复用该头像，不自建独立头像资产系统。
- 若未来支持外部 Character Card import/export，再重新评估 Character Card V2 / OpenRouter character utilities；MVP 不引入外部角色卡依赖。

Usage:
- 后续 PRD 或 issue 可以引用本目录作为设计参考。
- 实现应重新落到项目设计系统和 React 组件，不直接复用本 HTML。
