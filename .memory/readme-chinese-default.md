---
name: readme-chinese-default
description: SpeakMore 的 README 中文为主页（README.md）、英文切换（README.en.md），按"五个自由"写，讲好不讲坏、多配图，图放图片桶
metadata:
  type: feedback
---

README 中文版是主页 `README.md`，英文版 `README.en.md` 作为切换，两份同步改（2026-10-17 他说"默认显示中文版 readme，英文版作为切换"；之前是英文为主，已改）。

写法（2026-10-14 起陆续定的）：
- HTML 排版、配轻量 emoji，简单干练，不写成论文；细节收进折叠块，开发和验证记录放 docs/development.md。
- 主旨是"自由"，五节：模型、方式、硬件、隐私、花钱。原话"讲好不讲坏"：不写已知不足、不写以后要做什么。
- 和 Typeless 的对比只放 README，要列它的每一档套餐，SpeakMore 按推荐组合、每天 100 次估月成本（和 App 同一口径）。
- 数字要有出处（官网价、实测、bench/results）；对外说法照实写。
- 原话"能补图就尽量补图，不要只是干巴巴的文字和列表"。图用真 App 截（隔离家目录、造的数据），**传到图片桶、不从仓库引用**（原话"之后咱们做视频和做网站时都会用到这些图，所以这东西必须都得上桶"），流程见 docs/development.md 的"README 的图"。

**Why:** README 是门面，他看重成本、隐私和观感；用户多在国内。
**How to apply:** 改 README 时两份一起改、图一起换；推上 GitHub 后查一遍 camo 代理取到的图不是空的。相关：[[website-no-typeless]]、[[desktop-copy-and-look]]、[[speakmore-website]]。
