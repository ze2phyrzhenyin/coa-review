# 计组复习

计算机组成原理复习网站：https://coa.zhaoyang.fr

面向本科生，按戴志涛、白中英《计算机组成原理》第七版（科学出版社，2024）第 1–6、8 章的讲法。每页回答一个学生会问的问题，在 3D 场景里一步一步走，答题也在场景里完成。

## 运行

```
pnpm install
pnpm dev                              # http://localhost:4630，只列已上线的页面
VITE_SHOW_PLANNED=1 pnpm dev          # 列出全部页面
bash scripts/gate.sh                  # 类型、单测、结构、术语、文案
bash scripts/gate.sh --build          # 再加构建、导航检查、逐页检查
```

需要 Node 24 和 pnpm。原创检查要用的教材文本不在仓库里，没有时自动跳过。

## 结构

- `src/engines/`：每个主题一个引擎，纯函数，输入参数，输出逐步的状态序列。场景、解题表、判分都读它。
- `src/scene/`：three.js 部件库。`src/player/`：逐步播放器。`src/pages/<编号>/`：页面。
- `docs/PLAN.md`：57 个页面的计划。`docs/INTERACTION.md`：交互和动效标准。`docs/DESIGN.md`：视觉规范。
- `AGENTS.md`：给 AI 编码工具的项目说明。`evals/look/`：每页的验收记录。

## 说明

题目、讲解、图都是原创，教材只引页码。答案由引擎算出。教材没有写明的规则按 `docs/DECISIONS.md` 里的约定处理，页面上标「本站约定」。

代码以 MIT 许可发布，见 `LICENSE`。
