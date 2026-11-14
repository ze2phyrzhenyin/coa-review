---
name: coa-release
description: 构建、发布到 rex-ovh、线上冒烟、回滚。负责人同意发布之后使用。
---
1. 发布要负责人同意。工作区必须干净并已提交。
2. 首次发布前的一次性工作在 `deploy/README.md`：DNS 记录、nginx 站点、证书。每一项都要负责人同意。
3. `bash scripts/release.sh`：跑 `gate.sh --build`，构建，上传到带时间戳的目录，切换软链接，核对线上 `version.txt`，对线上跑导航和逐页检查。服务器只留最近 5 个版本。
4. 出问题：`bash scripts/release.sh rollback`。
5. 发布后按 `post-deploy-cleanup` 技能清理 rex-ovh，并报告清了什么。
6. 在 `docs/HANDOFF.md` 更新线上版本号和日期。
