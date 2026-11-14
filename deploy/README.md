# 部署

静态站点，rex-ovh，做法同 veillee.zhaoyang.fr。下面三步是首次发布前的一次性工作，每一步都要负责人同意。

1. DNS：`ovh-dns add zhaoyang.fr coa A 51.210.42.88`。
2. nginx：在 rex-ovh 建 `/var/www/coa/{releases,current}` 和 `sites-available/coa-zhaoyang.conf`。要点：`root /var/www/coa/current;`，`try_files $uri /index.html;`（前端路由），`/assets/` 长缓存，`index.html` 和 `version.txt` 不缓存。
3. 证书：certbot 为 `coa.zhaoyang.fr` 单独签发。

之后每次发布：`bash scripts/release.sh`。回滚：`bash scripts/release.sh rollback`。发布后按 `post-deploy-cleanup` 技能清理。
rex-ovh 磁盘只剩约 12 GB，低于 10 GB 工单发布会被拒：站点保持小体积，不放视频和大 PDF。
