#!/usr/bin/env bash
# 并行执行：把「依赖已完成、文件范围互不重叠」的任务各放进一个 git worktree，每个 worktree 里跑一条循环；
# 跑完按依赖顺序逐个合并回当前分支，每合并一个就在主干再跑一次门禁。有冲突或门禁不过就停下，不强行合并。
#
#   scripts/fanout.sh [--engine claude|codex] [--jobs 2] [--dry] [--minutes 40]
#   scripts/fanout.sh --engines claude,codex     任务轮流分给两个引擎
#
# 在交互式 Claude Code 会话里，同样的事可以用 Agent 工具做（每个任务一个 implementer，isolation: worktree）。
# 并行数默认 2：这台 Mac 内存和磁盘都紧。门禁可信之前不要调大。
set -uo pipefail
cd "$(dirname "$0")/.."
ENGINES=claude; JOBS=2; DRY=0; MINUTES=40
while [ $# -gt 0 ]; do case "$1" in
  --engine|--engines) ENGINES="$2"; shift;; --jobs) JOBS="$2"; shift;; --dry) DRY=1;; --minutes) MINUTES="$2"; shift;;
  *) echo "不认识的参数：$1"; exit 2;; esac; shift; done
[ -z "$(git status --porcelain)" ] || { echo "工作区有未提交的改动，先提交。worktree 从 HEAD 开出，看不到未提交的文件。"; exit 1; }

ready=$(node scripts/tasks.mjs ready --max "$JOBS")
[ -z "$ready" ] && { echo "没有可并行的任务。"; exit 0; }
echo "这一批：$(echo $ready | tr '\n' ' ')"
[ $DRY = 1 ] && exit 0

WT=.claude/worktrees
mkdir -p "$WT" .local/loop
IFS=',' read -r -a engines <<< "$ENGINES"
n=0; pids=()
for id in $ready; do
  engine="${engines[$(( n % ${#engines[@]} ))]}"; n=$((n + 1))
  node scripts/tasks.mjs claim "$id" --by "$engine" > /dev/null   # 在主干先占位，防止下一批重复领取
  git worktree add -q "$WT/$id" -b "task/$id" HEAD || { echo "开 worktree 失败：$id"; exit 1; }
  ( cd "$WT/$id" && pnpm install --frozen-lockfile --prefer-offline > /dev/null 2>&1
    mkdir -p .local && ln -sfn "$OLDPWD/.local/textbook" .local/textbook   # 原创检查要用的教材文本
    COA_LOG_DIR="$OLDPWD/.local/loop" bash scripts/loop.sh --engine "$engine" --max 3 --task "$id" --minutes "$MINUTES" ) > ".local/loop/fanout-$id.log" 2>&1 &
  pids+=($!); echo "  $id → ${engine}（日志 .local/loop/fanout-$id.log）"
done
for pid in "${pids[@]}"; do wait "$pid"; done
# 主干上占位用的状态文件丢掉，真正的状态由各分支合并带回（不丢的话合并会因未跟踪文件冲突）。
for id in $ready; do
  if git ls-files --error-unmatch "plan/state/$id.json" > /dev/null 2>&1; then git checkout -q -- "plan/state/$id.json"; else rm -f "plan/state/$id.json"; fi
done

status=0
for id in $(node scripts/tasks.mjs order); do
  echo "$ready" | grep -qx "$id" || continue
  if ! git -C "$WT/$id" log -1 --format=%s | grep -q "^$id:"; then
    echo "✗ $id 没有完成（看 .local/loop/fanout-$id.log），分支 task/$id 和 worktree 保留。"; status=1
    node scripts/tasks.mjs block "$id" "并行执行未完成，见 .local/loop/fanout-$id.log" > /dev/null; continue
  fi
  if ! git merge -q --no-ff "task/$id" -m "merge task/$id"; then
    git merge --abort; echo "✗ $id 合并冲突，已放弃这次合并。交给 reviewer：对照任务范围看谁越界了。"; status=1; continue
  fi
  if ! bash scripts/gate.sh > ".local/loop/merge-$id.gate" 2>&1; then
    echo "✗ $id 合并后主干门禁没过：$(grep -E '^(GATE FAIL|✗)' ".local/loop/merge-$id.gate" | head -1)"
    git reset -q --hard HEAD~1; status=1; continue
  fi
  git worktree remove --force "$WT/$id" && git branch -q -D "task/$id"
  echo "✓ $id 已合并"
done
[ $status = 0 ] && echo "这一批全部合并。全量检查：bash scripts/gate.sh --build"
exit $status
