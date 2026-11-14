#!/bin/bash
# PreToolUse(Edit|Write)：拦住密钥、教材原文、已有的固定用例。退出码 2 才会拦截。
input=$(cat)
file=$(jq -r '.tool_input.file_path // empty' <<<"$input")
[ -z "$file" ] && exit 0
case "$file" in
  */.env|*/.env.*|*.pem|*/deploy/secrets/*)
    echo "拦截：$file 是密钥或环境文件，不由 agent 修改。" >&2; exit 2 ;;
  */.local/textbook/*)
    echo "拦截：.local/textbook 是教材原文，只读。" >&2; exit 2 ;;
  */evals/golden/*)
    if [ -e "$file" ] && [ "${COA_ALLOW_GOLDEN:-}" != 1 ]; then
      echo "拦截：$file 是已有的固定用例，只增不改。用例真的错了，把依据写进 plan/progress 交给 planner。" >&2; exit 2
    fi ;;
esac
exit 0
