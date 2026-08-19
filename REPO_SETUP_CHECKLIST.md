# 仓库配置清单

完成以下配置，让 NarraCat 仓库更专业。

---

## ✅ 已完成

- [x] 推送代码到新仓库
- [x] 更新 README 链接
- [x] 准备 Release Notes
- [x] 编写 GitHub Actions 配置指南

---

## 📋 待完成配置

### 1. 仓库基本信息

访问：https://github.com/WDQ-CN/Narracat

#### About 部分（右侧栏）
点击 ⚙️ 图标，配置：

```
Description: 面向中国网文作者的 AI 共创桌面应用
Website: (如果有官网，暂时可留空)

Topics (标签):
- electron
- ai
- writing
- chinese
- novel
- desktop-app
- claude
- agent
- typescript
- react
```

---

### 2. 仓库设置

访问：https://github.com/WDQ-CN/Narracat/settings

#### General

**Features**:
- ✅ Wikis: 启用（可以写文档）
- ✅ Issues: 启用（默认已启用）
- ✅ Discussions: 可选（社区讨论，推荐启用）
- ❌ Projects: 可选（项目看板，按需启用）
- ❌ Preserve this repository: 不勾选

**Pull Requests**:
- ✅ Allow squash merging: 启用
- ✅ Allow merge commits: 启用
- ❌ Allow rebase merging: 可选
- ✅ Automatically delete head branches: 启用（合并 PR 后自动删除分支）

**Archives**:
- ❌ Include Git LFS objects in archives: 不勾选（项目中没有 LFS）

---

### 3. GitHub Actions

访问：https://github.com/WDQ-CN/Narracat/settings/actions

#### General
- **Actions permissions**: ✅ Allow all actions and reusable workflows（允许所有 actions）
- **Workflow permissions**: ✅ Read and write permissions（读写权限）
- ✅ Allow GitHub Actions to create and approve pull requests

#### Secrets and variables

**当前无需配置**（基础 CI 可直接运行）

**未来如需自动构建发布，再配置**：
- macOS 签名和公证密钥
- Windows 签名证书（购买后）

详见：[GitHub Actions 配置指南](./github-actions-setup.md)

---

### 4. 分支保护（可选）

访问：https://github.com/WDQ-CN/Narracat/settings/branches

如果需要代码审查，可以配置 `main` 分支保护：

```
Branch name pattern: main

保护规则（推荐）:
✅ Require a pull request before merging
  - Require approvals: 1（需要 1 人审查）
✅ Require status checks to pass before merging
  - Status checks: app-ci, agent-core-ci
✅ Require conversation resolution before merging
❌ Do not allow bypassing the above settings

可选：
❌ Require linear history
❌ Require deployments to succeed
```

**⚠️ 注意**：如果只有你一个人开发，不需要配置分支保护。

---

### 5. GitHub Pages（可选）

如果想发布文档站点：

访问：https://github.com/WDQ-CN/Narracat/settings/pages

```
Source: Deploy from a branch
Branch: gh-pages（需要先创建这个分支）
```

---

### 6. 社交账号（可选）

访问：https://github.com/WDQ-CN/Narracat/settings

#### Social preview

上传一张 1280x640 的项目封面图（可选）

---

### 7. 许可证展示

GitHub 会自动识别 `LICENSE` 文件，无需额外配置。

当前许可证：**AGPL-3.0-only** ✅

---

## 🎯 优先级建议

### 高优先级（立即配置）
1. ✅ **About 部分**（Description + Topics）
   - 让访客快速了解项目
   - 提升搜索可见性

2. ✅ **启用 GitHub Actions**
   - 自动 CI/CD
   - 代码质量保障

### 中优先级（本周内）
3. ✅ **Pull Request 设置**
   - 自动删除分支
   - 选择合并策略

4. ✅ **Issues 模板**（可选）
   - 规范问题报告
   - 提升反馈质量

### 低优先级（按需配置）
5. ⚪ **分支保护**（多人协作时再配置）
6. ⚪ **GitHub Pages**（有文档站点需求时）
7. ⚪ **Discussions**（社区讨论，用户多时再启用）

---

## 📝 配置步骤总结

### 1 分钟快速配置
```
1. 访问: https://github.com/WDQ-CN/Narracat
2. 点击右侧 ⚙️ → 填写 Description + Topics
3. 完成！
```

### 5 分钟完整配置
```
1. 配置 About（1 分钟）
2. 启用 Features（1 分钟）
3. 配置 Pull Request 设置（1 分钟）
4. 检查 GitHub Actions（1 分钟）
5. 提交首个 Issue 测试（1 分钟）
```

---

## 🔍 验证配置

配置完成后，检查：

- [ ] 仓库主页显示 Description
- [ ] Topics 标签已添加
- [ ] CI badge 状态正常
- [ ] Actions 页面有运行记录
- [ ] Issues 功能可用

---

## 📚 相关文档

- [GitHub Actions 配置指南](./github-actions-setup.md)
- [Windows 安装指南](./windows-install-guide.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md)

---

## 🆘 需要帮助？

配置遇到问题？
- 📖 查阅 [GitHub 官方文档](https://docs.github.com)
- 💬 在仓库 Discussions 提问

---

**配置完成后，记得删除本文件！** 🗑️

或者保留在 `docs/` 目录作为参考。
