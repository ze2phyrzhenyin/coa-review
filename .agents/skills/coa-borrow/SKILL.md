---
name: coa-borrow
description: 从开源项目借代码或做法的流程。想引入第三方代码、算法、测试数据或新依赖时使用。只是参考思路不拷代码时也要记一行。
---
1. 先查 `docs/research/oss.md` 和 `docs/BORROWED.md`，看是否已经评估过。
2. 读仓库的 LICENSE 文件本身。GPL、LGPL、AGPL、MPL、CC-NC、没有许可证的：只参考思路，不拷代码。
3. 能自己写 300 行解决的不加依赖。要加依赖：记下版本、体积、最近提交日期，按需加载。
4. 拷代码时钉住 commit，只取需要的部分，文件头注明来源和许可证。
5. 在 `docs/BORROWED.md` 记一行：来源、commit、许可证、借了什么、改了什么。
