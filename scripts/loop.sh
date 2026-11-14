#!/usr/bin/env bash
# 循环执行器（Ralph 式）：每一轮新开一个 agent 进程，上下文只从文件里读；一轮只做一个任务；
# 门禁通过才提交（由本脚本提交，agent 不提交：Codex 沙箱里 .git 只读，两个引擎走同一条路）。
#
#   scripts/loop.sh [--engine claude|codex] [--max 10] [--task T003] [--minutes 40] [--model 名字]
#
# 上限：最多 --max 轮；单轮超过 --minutes 分钟就结束这一轮；同一任务门禁连续失败 2 次标为 blocked 换下一个；
# 连续 3 轮没有任何任务完成就停下。日志在 .local/loop/。
set -uo pipefail
cd "$(dirname "$0")/.."
ENGINE=claude; MAX=10; TASK=""; MINUTES=40; MODEL=""
while [ $# -gt 0 ]; do case "$1" in
  --engine) ENGINE="$2"; shift;; --max) MAX="$2"; shift;; --task) TASK="$2"; shift;;
  --minutes) MINUTES="$2"; shift;; --model) MODEL="$2"; shift;;
  *) echo "不认识的参数：$1"; exit 2;; esac; shift; done
LOG_DIR="${COA_LOG_DIR:-.local/loop}"   # fanout.sh 把它指到主目录，worktree 删掉后日志还在
mkdir -p "$LOG_DIR" .local/loop
export COA_LOOP=1 COA_AGENT="$ENGINE"

# macOS 没有 timeout 命令：用 perl 的 alarm 给一轮限时，超时杀掉整个进程组。
limited() { perl -e 'my $s=shift; my $p=fork; if(!$p){setpgrp(0,0); exec @ARGV; exit 127} $SIG{ALRM}=sub{kill "TERM",-$p; sleep 5; kill "KILL",-$p; exit 124}; alarm $s; waitpid $p,0; exit($?>>8)' "$(( MINUTES * 60 ))" "$@"; }

run_agent() { # run_agent <任务 id> <日志前缀>
  local id="$1" log="$2" prompt
  prompt="$(cat prompts/loop.md)

TASK=$id
$(node scripts/tasks.mjs show "$id")"
  case "$ENGINE" in
    claude)
      limited claude -p "$prompt" --permission-mode acceptEdits --permission-prompts none \
        --allowedTools "Read,Glob,Grep,Edit,Write,Bash(pnpm *),Bash(node scripts/*),Bash(bash scripts/gate.sh*),Bash(git status*),Bash(git diff*),Bash(git log*),Bash(ls *),Bash(mkdir *)" \
        ${MODEL:+--model "$MODEL"} --output-format json > "$log.json" 2> "$log.err"
      local code=$?; jq -r '.result // empty' "$log.json" > "$log.md" 2>/dev/null; return $code ;;
    codex)
      printf '%s' "$prompt" | limited codex exec - --sandbox workspace-write -c 'approval_policy="never"' \
        ${MODEL:+-m "$MODEL"} --json -o "$log.md" > "$log.jsonl" 2> "$log.err" ;;
    *) echo "不认识的引擎：$ENGINE"; exit 2 ;;
  esac
}

idle=0
for pass in $(seq 1 "$MAX"); do
  id="${TASK:-$(node scripts/tasks.mjs ready --max 1)}"
  [ -z "$id" ] && { echo "没有可做的任务。"; node scripts/tasks.mjs list | grep -cE ' (todo|doing|blocked) ' | xargs -I{} echo "未完成 {} 个"; exit 0; }
  state=$(node scripts/tasks.mjs show "$id" | jq -r .state)
  [ "$state" = done ] && { echo "$id 已完成。"; exit 0; }
  [ "$state" = blocked ] && { echo "$id 被标为 blocked，先看 plan/progress/$id.md。"; exit 1; }
  log="$LOG_DIR/$(date +%m%d-%H%M%S)-$id-$ENGINE"
  echo "── 第 $pass/$MAX 轮（${ENGINE}）：$id"
  [ "$state" = todo ] && node scripts/tasks.mjs claim "$id" > /dev/null
  base=$(git rev-parse HEAD)
  run_agent "$id" "$log"; code=$?
  [ $code = 124 ] && echo "   这一轮超过 $MINUTES 分钟，已结束。"

  # 通过的条件：范围内确实有改动；没有越界；任务自己的验收命令通过；门禁通过。
  accept=$(node scripts/tasks.mjs show "$id" | jq -r .accept)
  own="plan/state/$id.json plan/progress/$id.md"
  changed=$( { git diff --name-only "$base"; git ls-files --others --exclude-standard; } | sort -u | grep -vxF -e "plan/state/$id.json" -e "plan/progress/$id.md" | wc -l | tr -d ' ')
  if [ "$changed" = 0 ] && [ "$code" != 0 ] && [ "$code" != 124 ]; then
    # 引擎本身没跑起来（没登录、额度用完、网络）：不算任务失败，任务退回 todo，整个循环停下。
    node scripts/tasks.mjs reset "$id" > /dev/null
    hint=$(grep -hoE 'refresh token was revoked[^"]*|Not logged in[^"]*|usage limit[^"]*|rate limit[^"]*|401 Unauthorized|Invalid API key[^"]*' "$log".* 2>/dev/null | head -1)
    echo "引擎 $ENGINE 没能运行（退出码 ${code}）：${hint:-看 $log.err}"
    [ "$ENGINE" = codex ] && echo "Codex 需要重新登录：在终端运行 codex login。"
    exit 3
  fi
  if [ "$changed" = 0 ]; then
    echo "✗ 这一轮没有改动任何文件（看 $log.md 里 agent 的说明）" > "$log.gate"; ok=1
  else
    { node scripts/tasks.mjs scope "$id" --base "$base" && echo "── 验收：$accept" && bash -c "$accept" && bash scripts/gate.sh; } > "$log.gate" 2>&1; ok=$?
    [ $ok = 0 ] || grep -qE '^(GATE FAIL|✗)' "$log.gate" || echo "✗ 验收命令没过：$accept" >> "$log.gate"
  fi
  if [ $ok = 0 ]; then
    node scripts/tasks.mjs done "$id" > /dev/null
    git add -A && git commit -q -m "$id: $(node scripts/tasks.mjs show "$id" | jq -r .title)

Engine: $ENGINE" && echo "   完成并提交 $(git rev-parse --short HEAD)"
    idle=0; rm -f ".local/loop/fails-$id"
    [ -n "$TASK" ] && exit 0
  else
    reason=$(grep -E '^(GATE FAIL|✗)' "$log.gate" | head -1)
    echo "   没过：${reason:-见 $log.gate}"
    fails=$(( $(cat ".local/loop/fails-$id" 2>/dev/null || echo 0) + 1 )); echo "$fails" > ".local/loop/fails-$id"
    # 失败原因留给下一轮：下一轮的 agent 是全新的，只能从文件里知道上一轮卡在哪。
    mkdir -p plan/progress
    printf -- '- %s %s 第 %s 次没过门禁：%s\n' "$(date +%m-%d\ %H:%M)" "$ENGINE" "$fails" "${reason:-见 $log.gate}" >> "plan/progress/$id.md"
    if [ "$fails" -ge 2 ]; then
      node scripts/tasks.mjs block "$id" "门禁连续 $fails 次没过：${reason:-见日志}" > /dev/null
      echo "   $id 标为 blocked。"; [ -n "$TASK" ] && exit 1
    fi
    idle=$((idle + 1))
    [ "$idle" -ge 3 ] && { echo "连续 3 轮没有任务完成，停下。看 plan/progress/ 和 .local/loop/。"; exit 1; }
  fi
done
echo "到达轮数上限 ${MAX}。"
