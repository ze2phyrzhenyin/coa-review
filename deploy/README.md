# 部署

静态站点，rex-ovh，做法同 veillee.zhaoyang.fr。下面三步已在 2026-11-14 做完（负责人同意），留作记录和重建用。nginx 配置的副本是 `deploy/nginx-coa-zhaoyang.conf`，证书续签后由 `/etc/letsencrypt/renewal-hooks/deploy/64-coa-nginx` 重载 nginx。

1. DNS：`ovh-dns add zhaoyang.fr coa A 51.210.42.88`。
2. nginx：在 rex-ovh 建 `/var/www/coa/{releases,current}` 和 `sites-available/coa-zhaoyang.conf`。要点：`root /var/www/coa/current;`，`try_files $uri /index.html;`（前端路由），`/assets/` 长缓存，`index.html` 和 `version.txt` 不缓存。
3. 证书：certbot 为 `coa.zhaoyang.fr` 单独签发。

之后每次发布：`bash scripts/release.sh`。回滚：`bash scripts/release.sh rollback`。发布后按 `post-deploy-cleanup` 技能清理。
