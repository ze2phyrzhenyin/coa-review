#!/bin/bash
# Stop：只在循环执行器里生效（COA_LOOP=1）。门禁没过就不让这一轮结束，把原因交回给 agent。
[ "${COA_LOOP:-}" = 1 ] || exit 0
input=$(cat)
[ "$(jq -r '.stop_hook_active // false' <<<"$input")" = true ] && exit 0   # 已经因为门禁被叫回来过一次，不无限循环
cd "$(jq -r '.cwd // "."' <<<"$input")" || exit 0
if ! out=$(bash scripts/gate.sh 2>&1); then
  echo "门禁没过，修好再结束：" >&2; echo "$out" | tail -n 30 >&2; exit 2
fi
exit 0
