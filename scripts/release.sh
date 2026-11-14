#!/usr/bin/env bash
# 发布到 rex-ovh（静态站点，做法同 veillee.zhaoyang.fr）。
#   scripts/release.sh            发布已提交的 HEAD（工作区不干净就拒绝）
#   scripts/release.sh rollback   回到上一个版本
#   scripts/release.sh status     列出服务器上的版本和当前版本
# 域名和服务器目录在 deploy/site.env。首次发布前要先建好 DNS、nginx 站点和证书（deploy/README.md）。
set -euo pipefail
cd "$(dirname "$0")/.."
. deploy/site.env   # HOST BASE DOMAIN

case "${1:-release}" in
status)
  ssh "$HOST" "ls -1 $BASE/releases; echo 当前：\$(readlink $BASE/current)"; exit 0 ;;
rollback)
  ssh "$HOST" "set -e; cd $BASE/releases; cur=\$(basename \$(readlink $BASE/current)); prev=\$(ls -1 | grep -B1 -x \"\$cur\" | head -1); [ \"\$prev\" != \"\$cur\" ] || { echo 没有更早的版本; exit 1; }; ln -sfn $BASE/releases/\$prev $BASE/current.tmp && mv -T $BASE/current.tmp $BASE/current; echo 当前：\$prev"
  exit 0 ;;
release) ;;
*) echo "用法：$0 [release|rollback|status]"; exit 2 ;;
esac

[ -z "$(git status --porcelain)" ] || { echo "工作区有未提交的改动，先提交。"; exit 1; }
sha=$(git rev-parse --short HEAD)
ts=$(date -u +%Y%m%dT%H%M%SZ)-$sha
bash scripts/gate.sh --build
pnpm -s exec vite build
echo "$sha $ts" > dist/version.txt
node scripts/lint-copy.mjs --quiet dist

ssh "$HOST" "mkdir -p $BASE/releases/$ts"
rsync -az --delete -e "ssh -o IPQoS=none" dist/ "$HOST:$BASE/releases/$ts/"
ssh "$HOST" "set -e; chmod -R a+rX $BASE/releases/$ts; ln -sfn $BASE/releases/$ts $BASE/current.tmp && mv -T $BASE/current.tmp $BASE/current; cd $BASE/releases && ls -1 | head -n -5 | xargs -r rm -rf; echo 当前：$ts"

live=$(curl -fsS "https://$DOMAIN/version.txt")
echo "线上 version.txt：$live"
[ "${live%% *}" = "$sha" ] || { echo "线上版本不是 $sha"; exit 1; }
ORIGIN="https://$DOMAIN" bash scripts/gate.sh --live
echo "发布完成。按 post-deploy-cleanup skill 清理 rex-ovh。"
