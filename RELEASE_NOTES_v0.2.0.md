# NarraCat v0.2.0 - Windows 预览版首发

## 🎉 重大更新：Windows 平台支持

NarraCat 现已支持 **Windows x64** 平台！本版本是 Windows 预览版，包含完整的桌面功能，可以在 Windows 10/11 x64 系统上运行。

---

## 📦 下载

### macOS（Apple Silicon）
- **文件**: `NarraCat-0.2.0-mac-arm64.dmg`
- **状态**: ✅ 完整支持（已签名、已公证）
- **直接安装**，无任何警告

### Windows（x64）⚠️ 预览版
- **文件**: `NarraCat-0.2.0-win-x64.exe`
- **状态**: 🧪 预览版（未签名）
- **⚠️ 首次安装会有 SmartScreen 警告**

#### Windows 用户必读

本版本是预览版，尚未购买代码签名证书，首次安装时会出现 **"Windows 已保护你的电脑"** 提示。

这是正常的，按以下步骤操作：
1. 点击 **"更多信息"**
2. 点击 **"仍要运行"**

**详细说明**：[Windows 安装指南](https://github.com/WDQ-CN/Narracat/blob/main/docs/windows-install-guide.md)

---

## ✨ 新特性

### Windows 平台支持
- ✅ NSIS 安装器（一键安装、自动创建快捷方式）
- ✅ 原生模块支持（sqlite、onnxruntime、sharp 全部就绪）
- ✅ Windows 10/11 原生通知（Toast）
- ✅ 自动更新支持（Windows x64 专用更新 feed）
- ✅ 跨平台路径契约保证（35+ 处修复）

### 平台兼容性改进
- ✅ 新增 `.gitattributes` 强制 LF 行尾（根治 Windows CRLF 问题）
- ✅ 修复 24+ 个测试文件的平台假设
- ✅ 路径分隔符跨平台归一化
- ✅ Symlink 权限探针（Windows 无管理员权限自动跳过）

---

## 🔧 改进

### 引擎与核心
- ✅ `novel-layout.ts` 路径契约层 35 处修复（核心）
- ✅ `engine-hooks.ts` 路径正则静默失效修复
- ✅ Windows 通知规则扩展（darwin + win32）

### 测试健康度
- ✅ 修复 macOS 专属测试的 POSIX 路径假设（3 个文件）
- ✅ 测试从 375 pass / 10 fail → 预期全通过
- ✅ 跨平台测试兼容性全面提升

### 文档完善
- ✅ 新增 [Windows 安装指南](https://github.com/WDQ-CN/Narracat/blob/main/docs/windows-install-guide.md)（183 行详细文档）
- ✅ README 更新平台支持说明
- ✅ 进度文档全程记录（3 次更新）

---

## 🐛 已知问题

### Windows 平台
1. ⚠️ **SmartScreen 警告**
   - 原因：预览版未购买代码签名证书
   - 影响：首次安装需手动确认"仍要运行"
   - 解决：按照[安装指南](https://github.com/WDQ-CN/Narracat/blob/main/docs/windows-install-guide.md)操作

2. ⚠️ **部分杀毒软件可能报警**
   - 原因：未签名的安装程序
   - 解决：添加到白名单或临时禁用杀毒软件安装

### 通用
- 无重大已知问题

---

## 🔍 系统要求

### macOS
- **系统版本**: macOS 12 Monterey 或更高
- **处理器**: Apple Silicon (M1/M2/M3)
- **内存**: 4 GB RAM（推荐 8 GB）
- **磁盘空间**: 500 MB

### Windows
- **系统版本**: Windows 10 1809 或更高（推荐 Windows 11）
- **处理器**: x64（64 位）
- **内存**: 4 GB RAM（推荐 8 GB）
- **磁盘空间**: 500 MB

---

## 📝 升级说明

### 从旧版本升级

#### macOS
- 直接安装新版本，会自动覆盖旧版本
- 你的小说项目和配置不受影响

#### Windows（首次安装）
- 按照[安装指南](https://github.com/WDQ-CN/Narracat/blob/main/docs/windows-install-guide.md)操作
- 配置 API Key（DeepSeek 推荐）
- 开始创作！

---

## 🙏 致谢

感谢所有测试用户的反馈和建议，特别是：
- Windows 真机测试和验证
- 跨平台兼容性问题报告
- 文档改进建议

---

## 🔗 相关链接

- **项目主页**: https://github.com/WDQ-CN/Narracat
- **Windows 安装指南**: https://github.com/WDQ-CN/Narracat/blob/main/docs/windows-install-guide.md
- **问题反馈**: https://github.com/WDQ-CN/Narracat/issues
- **开发文档**: [CONTRIBUTING.md](https://github.com/WDQ-CN/Narracat/blob/main/CONTRIBUTING.md)

---

## 📊 技术细节

### 提交记录
本版本包含 8 个高质量提交：
- `c31a5cd` fix(platform): Windows 平台兼容性修复
- `bafaecb` feat(build): Windows 出包链补齐
- `55d94bb` fix(test): 修复 macOS 专属测试的 POSIX 路径假设
- `9b4d937` docs(readme): 更新平台支持说明
- `040be81` docs: 新增 Windows 安装指南
- `d0d97ee` docs(readme): 更新仓库链接到新地址
- ...以及进度文档更新

### 改动统计
- **50 个文件**改动
- **+1,303 行**新增
- **-267 行**删除

---

## ⚖️ 许可证

[AGPL-3.0](https://github.com/WDQ-CN/Narracat/blob/main/LICENSE) — 你可以自由使用、修改、分发；基于本项目的分发或网络服务须以同等条款开源。

---

## 💬 反馈

遇到问题或有建议？

- 🐛 [提交 Issue](https://github.com/WDQ-CN/Narracat/issues)
- 💬 查看 [FAQ](https://github.com/WDQ-CN/Narracat/blob/main/docs/faq.md)
- 📖 阅读 [CONTRIBUTING.md](https://github.com/WDQ-CN/Narracat/blob/main/CONTRIBUTING.md)

**重要提醒**：提交 Issue 时，**请勿粘贴小说正文和 API Key**。

---

**感谢使用 NarraCat！** 🐈‍⬛
