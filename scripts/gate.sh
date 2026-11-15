#!/usr/bin/env bash
# 唯一的质量门禁。输出尽量短：每个失败项一行，说明怎么修。循环执行器读第一条失败原因进入下一轮。
#   bash scripts/gate.sh            快门禁：类型、单测、结构、术语、文案、原创、任务图
#   bash scripts/gate.sh --build    再加：构建、构建产物文案、导航检查、逐页检查（要起本地预览）
#   ORIGIN=https://coa.zhaoyang.fr bash scripts/gate.sh --live   只对线上跑导航和逐页检查
set -uo pipefail
cd "$(dirname "$0")/.."
MODE="${1:-}"
T=$(mktemp -d)
SERVER=""
cleanup() { [ -n "$SERVER" ] && kill "$SERVER" 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT
fail() { echo "GATE FAIL：$1"; exit 1; }
step() { # step <名字> <修法> <命令…>
  local name="$1" fix="$2"; shift 2
  if ! "$@" > "$T/out" 2>&1; then grep -v 'npm warn' "$T/out" | tail -25; fail "${name}。${fix}"; fi
}

if [ "$MODE" = "--live" ]; then
  [ -n "${ORIGIN:-}" ] || fail "--live 需要 ORIGIN=https://…"
  step "导航（线上）" "见 AGENTS.md › Navigation" node scripts/qa-navigation.mjs
  step "逐页（线上）" "见 docs/INTERACTION.md" node scripts/qa-pages.mjs
  echo "GATE OK（线上 ${ORIGIN}）"; exit 0
fi

step "任务图" "按提示修 plan/ 或页面清单" node scripts/tasks.mjs validate
step "功能清单" "implementer 不改 plan/features.json" node scripts/check-features.mjs
step "类型检查" "修到 tsc 无输出" pnpm -s exec tsc --noEmit
step "单元测试" "先看失败的断言；引擎的固定用例在 evals/golden，不许改用例迁就代码" pnpm -s exec vitest run --reporter=dot
step "结构" "引擎保持纯函数" node scripts/check-arch.mjs
step "术语" "用教材的说法，表在 scripts/terms.json" node scripts/lint-terms.mjs src
step "文案" "读 .agents/skills/no-ai-flavor/SKILL.md 后改" node scripts/lint-copy.mjs --quiet src
step "原创" "题目和讲解用自己的话、自己的数" node scripts/check-originality.mjs

if [ "$MODE" = "--build" ]; then
  # 每个工作目录用自己的端口和输出目录，并行的 worktree 互不干扰。
  PORT=$((4700 + $(pwd | cksum | cut -d' ' -f1) % 200))
  OUT=.local/qa-dist
  step "构建" "看上面的报错" env VITE_SHOW_PLANNED=1 pnpm -s exec vite build --outDir "$OUT" --emptyOutDir
  step "构建产物文案" "读 .agents/skills/no-ai-flavor/SKILL.md 后改" node scripts/lint-copy.mjs --quiet "$OUT"
  pnpm -s exec vite preview --outDir "$OUT" --host 127.0.0.1 --port "$PORT" --strictPort > "$T/server" 2>&1 &
  SERVER=$!
  for _ in $(seq 1 50); do curl -sf "http://127.0.0.1:$PORT/" > /dev/null && break; sleep 0.2; done
  curl -sf "http://127.0.0.1:$PORT/" > /dev/null || { tail -5 "$T/server"; fail "预览服务没起来（端口 ${PORT}）"; }
  export PORT
  step "导航" "侧栏不许随换页重建；页内状态写进网址。见 AGENTS.md › Navigation" node scripts/qa-navigation.mjs
  step "逐页" "见 docs/INTERACTION.md 和 specs/_player-contract.md" node scripts/qa-pages.mjs
  # 线上只列已上线的页面，侧栏比上面的构建短：按线上的样子再查一遍导航（0.3 版曾在这里漏过）。
  kill "$SERVER" 2>/dev/null; SERVER=""
  step "构建（线上样式）" "看上面的报错" pnpm -s exec vite build --outDir "$OUT-live" --emptyOutDir
  pnpm -s exec vite preview --outDir "$OUT-live" --host 127.0.0.1 --port "$PORT" --strictPort > "$T/server" 2>&1 &
  SERVER=$!
  for _ in $(seq 1 50); do curl -sf "http://127.0.0.1:$PORT/" > /dev/null && break; sleep 0.2; done
  step "导航（线上样式）" "侧栏不许跳；见 AGENTS.md › Navigation" node scripts/qa-navigation.mjs
fi
echo "GATE OK${MODE:+ $MODE}"
