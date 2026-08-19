# Windows 安装指南

> NarraCat Windows 版本目前为**预览版（未签名）**，首次安装时会出现 Windows SmartScreen 安全提示。本指南将帮助你顺利完成安装。

## 为什么会有安全提示？

Windows SmartScreen 是微软的安全功能，用于保护用户免受未知软件的威胁。由于 NarraCat Windows 版本是**预览版**，目前尚未购买代码签名证书，因此会触发此提示。

**这不代表软件不安全**：
- ✅ NarraCat 是开源软件，代码公开透明
- ✅ 所有代码在 GitHub 上可审查
- ✅ 构建过程在 GitHub Actions 上公开执行
- ✅ macOS 版本已完成签名和公证

我们计划在正式版发布时购买 Windows 代码签名证书，以提供更好的用户体验。

---

## 安装步骤

### 步骤 1：下载安装包

1. 访问 [Releases](https://github.com/yannikzz/narracat-novel-agent/releases) 页面
2. 下载最新的 `NarraCat-x.x.x-win-x64.exe` 文件

### 步骤 2：运行安装程序

双击下载的 `.exe` 文件，会出现 **Windows SmartScreen** 提示：

```
┌─────────────────────────────────────────┐
│  ⚠️ Windows 已保护你的电脑              │
│                                         │
│  Microsoft Defender SmartScreen         │
│  已阻止启动一个未识别的应用。           │
│  运行此应用可能会导致电脑风险。         │
│                                         │
│  应用: NarraCat-x.x.x-win-x64.exe       │
│  发布者: 未知                           │
│                                         │
│  [ 不运行 ]   [ 更多信息 ]             │
└─────────────────────────────────────────┘
```

### 步骤 3：绕过 SmartScreen 警告

1. **点击"更多信息"**链接（在窗口左侧）
2. 窗口会展开，显示新的按钮
3. **点击"仍要运行"**按钮

```
┌─────────────────────────────────────────┐
│  ⚠️ Windows 已保护你的电脑              │
│                                         │
│  Microsoft Defender SmartScreen         │
│  已阻止启动一个未识别的应用。           │
│                                         │
│  应用: NarraCat-x.x.x-win-x64.exe       │
│  发布者: 未知                           │
│                                         │
│  此应用来自未知发布者，因此不在         │
│  SmartScreen 的可信应用列表中。         │
│                                         │
│  [ 不运行 ]   [ 仍要运行 ]             │
└─────────────────────────────────────────┘
```

### 步骤 4：完成安装

1. NSIS 安装向导会启动
2. 选择安装目录（默认：`C:\Program Files\NarraCat`）
3. 选择是否创建桌面快捷方式
4. 点击"安装"完成

---

## 首次启动

安装完成后：

1. 从桌面快捷方式或开始菜单启动 NarraCat
2. 可能会再次出现 SmartScreen 提示（针对主程序）
3. 重复上述"更多信息 → 仍要运行"的步骤
4. 之后 Windows 会记住你的选择，不再提示

---

## 常见问题

### Q1: 为什么会显示"未知发布者"？

**A**: NarraCat Windows 版本目前是预览版，尚未购买代码签名证书。代码签名证书需要年费约 $200-500，我们计划在正式版发布时购买。

### Q2: 这个软件安全吗？

**A**: 是的。NarraCat 是 [AGPL-3.0 开源软件](https://github.com/yannikzz/narracat-novel-agent)，所有代码公开可审查。你可以：
- 查看完整源代码
- 审查构建流程（GitHub Actions）
- 自行编译（参见 CONTRIBUTING.md）

### Q3: 我的杀毒软件报警怎么办？

**A**: 部分杀毒软件可能会对未签名的安装程序报警。建议：
1. 将 NarraCat 添加到杀毒软件白名单
2. 或临时禁用杀毒软件进行安装
3. 安装完成后重新启用杀毒软件

### Q4: 什么时候会有签名版本？

**A**: 我们会根据以下因素决定：
- Windows 版本的用户反馈和使用量
- 功能稳定性
- 社区需求

预计在 Windows 版本进入**正式版**（非预览版）时购买证书。

### Q5: macOS 版本也有这个问题吗？

**A**: 没有。macOS 版本已经完成了 Developer ID 签名和公证，可以直接安装，无任何警告。

### Q6: 可以不安装，直接运行吗？

**A**: Windows 版本目前只提供 NSIS 安装包（`.exe`），需要通过安装程序安装。我们未来可能提供免安装的 ZIP 版本。

---

## 卸载

如需卸载 NarraCat：

### 方法 1：通过控制面板
1. 打开"设置 → 应用 → 已安装的应用"
2. 找到"NarraCat"
3. 点击"卸载"

### 方法 2：通过卸载程序
1. 打开安装目录（默认：`C:\Program Files\NarraCat`）
2. 运行 `Uninstall.exe`

**注意**：卸载只会删除应用程序，不会删除你的小说项目文件。

---

## 数据位置

NarraCat 的数据存储位置：

- **应用程序**: `C:\Program Files\NarraCat\`
- **用户数据**: `C:\Users\<你的用户名>\AppData\Roaming\NarraCat\`
- **小说项目**: 你在创建小说时指定的位置

---

## 反馈与支持

遇到安装问题？

- 🐛 [提交 Issue](https://github.com/yannikzz/narracat-novel-agent/issues)
- 💬 查看 [FAQ](./faq.md)
- 📖 阅读 [CONTRIBUTING.md](../CONTRIBUTING.md)

**重要提醒**：提交 Issue 时，**请勿粘贴小说正文和 API Key**。

---

## 技术说明

### 系统要求
- Windows 10 1809 或更高版本（推荐 Windows 11）
- 64 位 (x64) 处理器
- 4 GB RAM（推荐 8 GB 或更多）
- 500 MB 可用磁盘空间

### 关于代码签名
代码签名证书是由受信任的证书颁发机构（CA）签发的数字证书，用于验证软件发布者的身份。购买证书的成本：
- **OV 证书**（组织验证）：约 $200/年，初期仍有 SmartScreen 警告
- **EV 证书**（扩展验证）：约 $400/年，可立即消除警告，但需硬件 USB Token

我们选择在 Windows 版本稳定后再购买证书，以确保投入的合理性。

---

**感谢使用 NarraCat Windows 预览版！** 🐈‍⬛
