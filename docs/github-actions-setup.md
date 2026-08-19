# GitHub Actions 配置指南

本文档说明 NarraCat 项目的 GitHub Actions 配置需求。

---

## 📋 当前 Workflows

### 1. `app-ci.yml` - 应用 CI
**触发条件**: push to main / pull_request
**运行环境**: ubuntu-latest
**功能**: 类型检查 + 测试

**需要的 Secrets**: 无（公共 CI，不需要密钥）

---

### 2. `agent-core-ci.yml` - Agent Core CI
**触发条件**: push / pull_request（agent-core/ 路径）
**运行环境**: ubuntu-latest
**功能**: Agent Core 测试

**需要的 Secrets**: 无

---

### 3. `agent-core-schema-pr-check.yml` - Schema 变更检查
**触发条件**: pull_request（schemas/ 路径）
**运行环境**: ubuntu-latest
**功能**: 检查 Schema 变更的 PR

**需要的 Secrets**: 无

---

### 4. `cla.yml` - 贡献者协议
**触发条件**: pull_request
**运行环境**: ubuntu-latest
**功能**: 检查贡献者是否签署 CLA

**需要的 Secrets**: 
- `GITHUB_TOKEN`（自动提供，无需配置）

---

### 5. `windows-build-smoke.yml` - Windows 构建冒烟
**触发条件**: 
- workflow_dispatch（手动触发）
- push（当 package.json / bun.lock / workflow 文件变更时）

**运行环境**: windows-latest
**功能**: 
- Job 1: 冒烟测试（安装依赖、原生模块验证）
- Job 2: 完整出包（需要签名证书）

**需要的 Secrets**（可选）:
- `WINDOWS_CERT_PFX` - Windows 签名证书（Base64 编码）
- `WINDOWS_CERT_PASSWORD` - 证书密码
- `WINDOWS_CERT_THUMBPRINT` - 证书指纹

**⚠️ 注意**: 
- 没有配置证书时，Job 2 会自动跳过（不会报错）
- Job 1 总是运行（验证原生模块能否编译）

---

## 🔐 需要配置的 Secrets（按优先级）

### 必需（用于发布）
如果你计划使用 GitHub Actions 自动构建和发布，需要配置：

#### macOS 签名和公证
```
APPLE_ID                    - Apple ID 邮箱
APPLE_APP_PASSWORD          - App-specific 密码（从 appleid.apple.com 生成）
APPLE_TEAM_ID               - Team ID（Developer ID 证书的 Team）
APPLE_API_KEY               - App Store Connect API Key（.p8 文件路径或内容）
APPLE_API_KEY_ID            - API Key ID
APPLE_API_ISSUER            - Issuer ID
```

#### Windows 签名（可选，未购买证书可不配）
```
WINDOWS_CERT_PFX            - 证书文件（Base64 编码）
WINDOWS_CERT_PASSWORD       - 证书密码
WINDOWS_CERT_THUMBPRINT     - 证书指纹（40 位十六进制）
```

### 可选（用于其他功能）
```
PAT_GITHUB                  - Personal Access Token（用于跨仓库操作）
DISCORD_WEBHOOK             - Discord 通知 webhook（可选）
```

---

## ⚙️ 配置步骤

### 在 GitHub 网页配置

1. **访问仓库 Settings**
   - https://github.com/WDQ-CN/Narracat/settings/secrets/actions

2. **点击 "New repository secret"**

3. **添加每个 Secret**
   - Name: 密钥名称（如 `APPLE_ID`）
   - Value: 密钥值

4. **保存**

---

## 🚀 启用 GitHub Actions

### 方法 1：自动启用（推荐）
GitHub Actions 在有 workflow 文件的仓库中自动启用。

### 方法 2：手动启用
1. 访问：https://github.com/WDQ-CN/Narracat/actions
2. 如果看到 "Enable Actions" 按钮，点击启用

---

## 🧪 测试 Workflows

### 测试 app-ci
```bash
# 推送到 main 分支会自动触发
git push origin main
```

### 测试 windows-build-smoke（手动触发）
1. 访问：https://github.com/WDQ-CN/Narracat/actions/workflows/windows-build-smoke.yml
2. 点击 "Run workflow" → "Run workflow"

---

## 📊 当前状态

### 无需配置即可运行的 Workflows
- ✅ `app-ci.yml` - 应用 CI
- ✅ `agent-core-ci.yml` - Agent Core CI
- ✅ `agent-core-schema-pr-check.yml` - Schema PR 检查
- ✅ `cla.yml` - CLA 检查
- ✅ `windows-build-smoke.yml` Job 1（冒烟测试）

### 需要配置才能运行的 Workflows
- ⚠️ `windows-build-smoke.yml` Job 2（完整出包，需要签名证书）

---

## 💡 建议

### 阶段 1：基础 CI（当前可用）
无需任何配置，以下功能已可用：
- ✅ 代码推送自动测试
- ✅ PR 自动检查
- ✅ Windows 原生模块验证

### 阶段 2：macOS 自动构建（需要证书）
配置 macOS 签名和公证 Secrets 后，可以：
- 自动构建 macOS 版本
- 自动签名和公证
- 自动发布 Release

### 阶段 3：Windows 自动构建（需要购买证书）
购买 Windows 代码签名证书后，可以：
- 自动构建 Windows 版本
- 自动签名
- 自动发布 Release

---

## 🔒 安全提示

1. **Never commit secrets to code**
   - Secrets 只能通过 GitHub Settings 配置
   - 不要在代码或 workflow 文件中硬编码密钥

2. **限制 Secret 访问范围**
   - Organization secrets: 所有仓库可用
   - Repository secrets: 仅本仓库可用（推荐）

3. **定期轮换密钥**
   - Apple App Password: 每 6-12 个月更换
   - API Keys: 定期审查和更新

---

## 📝 FAQ

### Q: 为什么 CI badge 显示 "no status"？
A: 需要先触发一次 workflow。推送一次代码到 main 分支即可。

### Q: Windows 出包 Job 为什么 skip？
A: 因为没有配置 Windows 签名证书。这是预期行为，不是错误。

### Q: 如何禁用某个 workflow？
A: 在 workflow 文件中注释掉触发条件，或在 Actions 页面禁用。

### Q: Secrets 配置后多久生效？
A: 立即生效，下次 workflow 运行时就会使用。

---

## 🆘 故障排查

### CI 失败
1. 查看 Actions 页面的错误日志
2. 检查依赖安装是否成功
3. 确认测试在本地能通过

### Secrets 无效
1. 检查 Secret 名称是否正确（区分大小写）
2. 检查 Secret 值是否包含多余的空格或换行
3. 重新生成并配置 Secret

---

需要帮助？[提交 Issue](https://github.com/WDQ-CN/Narracat/issues)
