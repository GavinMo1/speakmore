---
name: one-review-round-is-enough
description: 对抗性审查派一轮就够，改完不再派第二轮，除非他点名要
metadata:
  node_type: memory
  type: feedback
  originSessionId: 6b5e9ce5-00ff-48cc-99ba-a927306fc7c3
  modified: 2026-10-14T13:32:51.635Z
---

对抗性审查（派独立的 agent 找茬）做一轮就够：拿到结论、逐条核实、改完就收，不再派第二轮去审修复和后续改动。2026-10-14 他原话："不用审第二轮了，审一次就够了"。

**Why:** AGENTS.md 写的是"审到连续一轮再无实质新发现为止"，他嫌多审的那几轮花时间、收益小；这条是他对那条规矩的具体放宽。

**How to apply:** 一个功能做完派一轮审查即可；之后的修复、追加的小功能靠测试和真机验证把关，不再自动派审查 agent。他点名要再审时才派。和 [[dont-rerun-tests-without-changes]] 一样，是在"验证到位"和"不重复花时间"之间他选的平衡点。
