#!/bin/bash
# NarraCat MCP 启动器：用与 mcp-server 构建时一致的 Node 跑 NovelMemory MCP server。
#
# 背景：mcp-server 的原生依赖 better-sqlite3 按构建时的 Node ABI 编译。若 Claude Code
# spawn MCP 用的默认 node 与构建 node 的 ABI 不符（如默认 node26 vs 构建 node22），
# 加载即 NODE_MODULE_VERSION mismatch 崩溃（见 CLAUDE.md「验证方法」节）。
#
# 策略：优先 Homebrew node@22；其次 PATH 上的 node22；都没有则回退默认 node
# （让"默认 node 已是 22"的开发机 / CI 正常工作，不强依赖本启动器）。
set -e
for cand in \
  "/opt/homebrew/opt/node@22/bin/node" \
  "/usr/local/opt/node@22/bin/node" \
  "$(command -v node22 2>/dev/null || true)"; do
  if [ -n "$cand" ] && [ -x "$cand" ]; then exec "$cand" "$@"; fi
done
exec node "$@"
