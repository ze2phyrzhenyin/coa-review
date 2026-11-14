# evals

- `golden/`：固定用例。教材例题的数值（注明页码）和手算的小例子。引擎测试读它们。只增不改，hook 会拦住对已有文件的修改。
- `look/<页面编号>/`：页面验收记录。截图、逐帧图、`report.md`。由 evaluator 按 `.agents/skills/coa-look` 产出。
