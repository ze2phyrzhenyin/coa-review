#!/bin/bash
# PreToolUse(Bash)：提交前跑门禁；发布、强推、改 DNS、删大目录先问人。
input=$(cat)
command=$(jq -r '.tool_input.command // empty' <<<"$input")
ask() { jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"ask",permissionDecisionReason:$r}}'; exit 0; }
case "$command" in
  *"scripts/release.sh"*|*"ovh-dns add"*|*"ovh-dns update"*|*"ovh-dns delete"*) ask "发布或改 DNS：要负责人同意。" ;;
  *"git push"*"--force"*|*"git push"*" -f"*|*"git reset --hard"*|*"git clean -f"*) ask "会丢改动的 git 命令：要负责人同意。" ;;
  *"rm -rf /"*|*"rm -rf ~"*|*"rm -rf .git"*|*"rm -rf .local/textbook"*) echo "拦截：危险的删除命令。" >&2; exit 2 ;;
esac
case "$command" in
  *"git commit"*)
    cd "$(jq -r '.cwd // "."' <<<"$input")" || exit 0
    if ! out=$(bash scripts/gate.sh 2>&1); then
      echo "拦截：门禁没过，先修再提交。" >&2; echo "$out" | tail -n 30 >&2; exit 2
    fi ;;
esac
exit 0
