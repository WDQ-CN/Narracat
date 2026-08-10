// 引擎文件里的路径变量：注入用绝对、展示用相对。
//
// 引擎的 agents / commands / skills 正文用 `${CLAUDE_PLUGIN_ROOT}` 指代 Agent Core 根目录。
// 这个名字是换掉上游 SDK 底座之前的遗留：**它已经不是真的环境变量**（pi 底座下没有任何地方
// 设置它），现在纯粹是「App 负责把它替换掉」的文本约定。名字本身与 ADR-0007「引擎是内部
// 维护物、不是插件」的定性矛盾，改名是独立一刀（见 docs/agents/progress.md 的下一步）。
//
// 同一个变量有两种展开语义，**不能共用一个函数**——这是真机走查换来的教训：
//
// - **注入给模型** → 绝对路径（expandEngineRoot）。模型要拿它去 Read 真实文件，少一个字符就读不到。
// - **展示给作者** → 相对路径（relativizeEngineRoot）。作者需要的信息是「这是引擎里的哪个文件」，
//   绝对路径对他是纯噪音；更要命的是它带着本机用户名与目录结构，作者截图求助时会一并泄露出去
//   （首轮真机走查里就发生了）。相对路径还有个好处：开源后在 GitHub 上按同一条路径就能找到该文件。
//
// 抽成独立模块而非放在某个消费方里：两个消费方职责不同，不该为了字符串替换互相依赖。

/** 变量的两种书写形态：`${CLAUDE_PLUGIN_ROOT}` 与裸 `$CLAUDE_PLUGIN_ROOT`。 */
const ENGINE_ROOT_VAR = /\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT\b/g

/** 同上，但连吃掉紧跟的一个 `/`——相对化时用，避免留下 `/skills/...` 这种带头斜杠的怪路径。 */
const ENGINE_ROOT_VAR_WITH_SLASH = /(?:\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT\b)\/?/g

/**
 * 注入侧：替换为真实的 Agent Core 绝对路径，模型据此 Read 契约与素材文件。
 * 不展开会让 subagent 拿字面变量当路径，Read 不到契约。
 */
export function expandEngineRoot(text: string, agentCorePath: string): string {
  return text.replace(ENGINE_ROOT_VAR, agentCorePath)
}

/**
 * 展示侧：去掉变量前缀（连带紧跟的斜杠），留下相对引擎根的路径，
 * 如 `skills/novel-web-craft/references/pack-index.md`。
 * 绝不在这里改成绝对路径——见本文件顶部的两种语义说明。
 */
export function relativizeEngineRoot(text: string): string {
  return text.replace(ENGINE_ROOT_VAR_WITH_SLASH, '')
}
