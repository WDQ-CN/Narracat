# 自动化构建配置指南

本文档说明如何配置 NarraCat 的自动化构建和发布流程。

---

## 📋 新增的 Workflow

### `release-build.yml` - 自动化 Release 构建

**触发条件**:
1. 推送标签（如 `v0.2.0`, `v1.0.0`）
2. 手动触发（workflow_dispatch）

**功能**:
- ✅ 自动构建 macOS 版本（Apple Silicon）
- ✅ 自动构建 Windows 版本（x64）
- ✅ 自动创建 GitHub Release
- ✅ 自动上传安装包
- ✅ 支持签名（如果配置了证书）
- ✅ 支持无签名构建（预览版）

---

## 🚀 使用方法

### 方法 1：推送标签（推荐）

```bash
# 1. 确保代码已提交
git add .
git commit -m "feat: 准备发布 v0.2.0"
git push

# 2. 创建并推送标签
git tag -a v0.2.0 -m "Release v0.2.0 - Windows 预览版首发"
git push origin v0.2.0

# 3. 自动触发构建
# 访问 https://github.com/WDQ-CN/Narracat/actions 查看进度
```

### 方法 2：手动触发

1. 访问：https://github.com/WDQ-CN/Narracat/actions/workflows/release-build.yml
2. 点击 **"Run workflow"**
3. 选择分支（通常是 `main`）
4. 点击 **"Run workflow"**

---

## 🔐 Secrets 配置

### 当前状态：无需配置即可运行

**未签名模式**（当前）:
- ✅ macOS: 构建未签名的 DMG/ZIP
- ✅ Windows: 构建未签名的 NSIS 安装包
- ✅ 自动创建 Release
- ✅ 标记为 Pre-release（预览版）

### 未来：配置签名（可选）

#### macOS 签名和公证

访问：https://github.com/WDQ-CN/Narracat/settings/secrets/actions

添加以下 Secrets：

```
APPLE_ID                    - Apple ID 邮箱（如：your@email.com）
APPLE_APP_PASSWORD          - App-specific 密码（从 appleid.apple.com 生成）
APPLE_TEAM_ID              - Team ID（10 位字母数字，如：ABCDE12345）
```

配置后，macOS 版本会自动签名和公证。

#### Windows 签名（需购买证书）

```
WINDOWS_CERT_PFX           - 证书文件（Base64 编码）
WINDOWS_CERT_PASSWORD      - 证书密码
WINDOWS_CERT_THUMBPRINT    - 证书指纹（40 位十六进制）
```

配置后，Windows 版本会自动签名。

---

## 📊 构建流程

### 完整流程图

```
推送标签 (v0.2.0)
    ↓
触发 release-build.yml
    ↓
┌─────────────┬─────────────┐
│             │             │
macOS 构建   Windows 构建
│             │
├─ 安装依赖   ├─ 安装依赖
├─ 准备 Core  ├─ 准备 Core
├─ 准备模型   ├─ 准备模型
├─ 构建应用   ├─ 构建应用
├─ 打包 DMG   ├─ 打包 NSIS
└─ 上传产物   └─ 上传产物
    │             │
    └─────────────┘
          ↓
    创建 Release
          ↓
    ┌─ 下载产物
    ├─ 读取 Release Notes
    ├─ 创建 GitHub Release
    └─ 上传安装包
          ↓
    完成 ✅
```

### 预计构建时间

| 平台 | 时间 | 说明 |
|------|------|------|
| macOS | ~10-15 分钟 | 包含 Agent Core 准备和模型下载 |
| Windows | ~8-12 分钟 | 原生模块编译稍快 |
| 总计 | ~15-20 分钟 | 并行构建 |

---

## 📦 构建产物

### macOS
```
dist/
├── NarraCat-0.2.0-mac-arm64.dmg       # DMG 安装包
├── NarraCat-0.2.0-mac-arm64-mac.zip   # ZIP 压缩包
└── latest-mac.yml                     # 自动更新清单
```

### Windows
```
dist/
├── NarraCat-0.2.0-win-x64.exe         # NSIS 安装包
└── latest.yml                         # 自动更新清单
```

---

## 🧪 测试自动化构建

### 步骤 1：创建测试标签

```bash
# 创建测试标签（不会发布正式版本）
git tag -a v0.2.0-beta.1 -m "测试自动化构建"
git push origin v0.2.0-beta.1
```

### 步骤 2：观察构建

1. 访问：https://github.com/WDQ-CN/Narracat/actions
2. 找到 "Release Build" workflow
3. 点击进入查看详情

### 步骤 3：检查结果

构建完成后：
1. 访问：https://github.com/WDQ-CN/Narracat/releases
2. 确认 Release 已创建
3. 确认安装包已上传
4. 下载测试安装包验证

### 步骤 4：清理测试

```bash
# 删除测试标签
git tag -d v0.2.0-beta.1
git push origin --delete v0.2.0-beta.1

# 删除测试 Release（在 GitHub 网页操作）
访问：https://github.com/WDQ-CN/Narracat/releases
找到测试 Release → 点击 Delete
```

---

## 🔧 高级配置

### 修改 Release 类型

编辑 `.github/workflows/release-build.yml`:

```yaml
# 第 174 行附近
prerelease: true   # true = 预览版, false = 正式版
draft: false       # true = 草稿, false = 立即发布
```

### 添加构建通知

在 workflow 末尾添加：

```yaml
- name: 发送通知
  if: success()
  run: |
    curl -X POST ${{ secrets.DISCORD_WEBHOOK }} \
      -H "Content-Type: application/json" \
      -d '{"content": "✅ Release ${{ github.ref_name }} 构建完成！"}'
```

### 自定义构建参数

在对应的 job 中添加环境变量：

```yaml
env:
  NODE_OPTIONS: --max-old-space-size=4096
  ELECTRON_BUILDER_CACHE: .cache
```

---

## 🐛 故障排查

### 构建失败：依赖安装

**问题**: `bun install` 失败

**解决**:
```yaml
# 尝试使用 npm 作为备选
- name: 安装依赖（备选）
  if: failure()
  run: npm ci
```

### 构建失败：原生模块编译

**问题**: `better-sqlite3` 编译失败

**解决**: 检查 GitHub Actions 运行环境是否有必要的构建工具。

### macOS 签名失败

**问题**: 公证失败

**解决**:
1. 检查 `APPLE_ID` / `APPLE_APP_PASSWORD` 是否正确
2. 检查 Apple Developer 账号状态
3. 查看详细日志确认错误原因

### Windows 签名失败

**问题**: 证书导入失败

**解决**:
1. 检查 `WINDOWS_CERT_PFX` 是否正确 Base64 编码
2. 检查 `WINDOWS_CERT_PASSWORD` 是否正确
3. 确认证书未过期

---

## 📝 Release Notes 配置

### 自动读取

workflow 会自动查找以下文件（按优先级）：

1. `RELEASE_NOTES_v0.2.0.md`（版本专属）
2. `RELEASE_NOTES_${VERSION}.md`（通用模式）
3. 默认内容（如果没有文件）

### 自定义 Release Notes

为每个版本创建专属文件：

```bash
# 复制模板
cp RELEASE_NOTES_v0.2.0.md RELEASE_NOTES_v0.3.0.md

# 编辑内容
# 修改版本号、更新内容等

# 提交
git add RELEASE_NOTES_v0.3.0.md
git commit -m "docs: 添加 v0.3.0 Release Notes"
git push
```

---

## 🎯 最佳实践

### 1. 版本号规范

遵循语义化版本：`v主版本.次版本.修订号`

```
v0.2.0 - 新增 Windows 支持（次版本）
v0.2.1 - 修复 Windows 安装问题（修订号）
v1.0.0 - 正式版发布（主版本）
```

### 2. Release 策略

```
开发阶段: v0.x.x + prerelease: true
稳定阶段: v1.x.x + prerelease: false
紧急修复: v1.x.1 立即发布
```

### 3. 测试流程

```
1. 本地测试 → 通过
2. 推送代码 → CI 通过
3. 创建标签 → 自动构建
4. 下载产物 → 真机测试
5. 确认无误 → 发布正式版
```

---

## 📚 相关文档

- [GitHub Actions 配置指南](./github-actions-setup.md)
- [Windows 安装指南](./windows-install-guide.md)
- [Release Notes v0.2.0](../RELEASE_NOTES_v0.2.0.md)

---

## 🆘 需要帮助？

配置遇到问题？
- 📖 查阅 [GitHub Actions 文档](https://docs.github.com/actions)
- 💬 在 [Issues](https://github.com/WDQ-CN/Narracat/issues) 提问
- 🔍 查看 [Actions 运行日志](https://github.com/WDQ-CN/Narracat/actions)

---

**自动化构建让发布更轻松！** 🚀
