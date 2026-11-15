# 出处

2026-11-06 合并。每条规则从哪来，哪些没收、为什么。

## 网上的 skill

| 来源 | 许可 | 收了什么 | 没收什么 |
|---|---|---|---|
| [blader/humanizer](https://github.com/blader/humanizer) v3.1.0，约 6.5 万星，依据 Wikipedia「Signs of AI writing」 | MIT | 否定对比、收尾复述、格言腔、开场铺垫、跟空气辩论、三段式、-ing 尾巴、夸大意义、借权威、绕开 is/has、加粗标签、聊天残留、知识截止声明、写文档本身、标题被首句重复、回复里重讲背景；「真有三项就留」「引文和专名不改」 | 连字符位置、弯引号（只对英文有意义，中文本来就用全角引号） |
| [hardikpandya/stop-slop](https://github.com/hardikpandya/stop-slop)，约 1.9 万星 | MIT | 物件替人做事、旁观者口吻、模糊宣告、开场套话、副词堆积 | 「删掉所有副词」「禁止被动语态」「Wh- 开头要改写」（太绝对，中文不适用）；35/50 打分表（主观，换成了检查脚本和三条自查） |
| [haidrrrry/humanize-ai-writing](https://github.com/haidrrrry/humanize-ai-writing)，27 星 | MIT | 复制残留标记：contentReference、oaicite、turn0search、utm_source=chatgpt | 其余和 humanizer 重复 |
| [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) | CC BY-SA | 上面三个的共同来源 | |

都是读完后用自己的话重写，没有照抄原文。

## 你自己的项目

| 位置 | 收了什么 |
|---|---|
| Mac `~/Developer/carbonne-carrelage/docs/research/anti-ai.md`（2026-10-27 调研） | 法语、英语词表和 23 条句式；版式的 AI 痕迹（第一波、第二波配色，字体，卡片，动效，页面骨架）；目录式写法和品牌反例。原文带全部网络出处：pixelslop、impeccable.style/slop、Krebs、capitalandcompute、Pangram、Anthropic 的前端设计文章等 |
| Mac `carbonne-carrelage`、`wagyuya-refonte`、`jiaoziguan-refonte` 的 `banned-phrases.json` 和 `scripts/lint-copy.mjs` | 合并成 `scripts/phrases.json`（去重，去掉只属于某个项目草稿的句子）；检查脚本在三份基础上重写 |
| Mac `~/Developer/gansu-journey/docs/DESIGN.md`「反 AI 味」 | 中文禁用词；标题用名词、按钮用动词；说明放进 tooltip |
| Mac `~/Developer/sac_plat/DESIGN.md` | 禁止营销首屏、玻璃拟态、随机渐变、彩色大饼图、无意义卡片墙、过小灰字、假统计、默认 $ |
| 之前几次对话里你的原话 | 「极其克制文字」「不要副标题」「表单说明在输入框上方」「报价 PDF 不超过两页、不要有色方框」「对外页面不放内部流程」 |

## 新加的

前面这些都没有覆盖中文句式，这次补上：先…再…最后…；「X，也有 Y」两段口号；「今天，」开头；换一种方式；让…更…；只需…即可；每一份…都值得；冒号标语；数数；夸大意义的动词（彰显、诠释、赋予、扮演…角色）；中文聊天残留（综上所述、希望对你有帮助）。检查脚本加了这些句式、副标题和眉标检测，以及自测样例。

## 检查脚本的校准

在 carbonne-carrelage、jiaoziguan-refonte、wagyuya-refonte 的构建产物上跑，0 个 error，剩下的 warn 主要是「标题下一行说明」，需要人判断。rex-web-experience（现在的官网）能查出正文破折号、emoji、「值得信赖」。
