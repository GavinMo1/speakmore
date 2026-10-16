import { fingerprint } from "../results.mjs";

// 判分：由 Claude（开发时协作的那个 agent，Claude Opus 5.5）当判官，看本地模型转出来的字和参照对不对得上。
// 作者 2026-10-16 定的：判官不用任何接进 App 的模型，Gemini 3.6 Flash 的成品只当参照。
// 所以这一环不调接口，分两步：pending 把还没判的格子按样本导出成文件，判官照下面的标准逐条打分写成 verdicts，
// record 校验后存进结果库（bench/judge.mjs）。判过的格子按指纹记着，换了标准或判官才会重判。
//
// 本地转写只是中间一跳，后面还要交给大模型润色，所以判的不是"字字一样"，而是"交给润色之后能不能还原出参照的意思"。

export const JUDGE = Object.freeze({ by: "claude-opus-5-5" });

/** 问题的类别：只能从这几样里挑，报告里按类数 */
export const PROBLEMS = Object.freeze(["漏内容", "多出内容", "字词错", "英文词错", "数字错", "语言不对", "认不出"]);

export const RUBRIC = `同一段口述录音有两份文字：
- 参照：App 的原生链路（Gemini 听录音直接整理）出的成品，已经删掉口头禅、重复和改口，补好了标点，当作"他想说的话"。
- 转写：本地小模型对同一段录音的原样转写，之后会交给大模型润色成成品。

判的是：把这份转写交给润色模型之后，能不能还原出参照的意思。

这些差别是润色会处理的，不扣分：
- 口头禅、填充词（嗯、那个、就是），重复和口吃，改口前说错的那半句
- 标点、空格、分段，繁体和简体，英文大小写，数字写成汉字还是阿拉伯数字
- 参照删掉了而转写里还留着的内容，只要那是口头禅、重复或者被改口否定的话

这些才扣分：
- 漏内容：参照里有的意思，转写里没有
- 多出内容：转写里有参照里没有的实际内容（不是口头禅、重复或改口）
- 字词错：同音字、近音字认错了
- 英文词错：英文单词、专有名词（产品名、技术词）认错，或者写成了中文音译
- 数字错：数量、日期、版本号等认错
- 语言不对：说的是中文却转成了别的语言，或者反过来
- 认不出：大段内容是乱的、空的，或者和参照毫不相干

分数（整数 0 到 5）：
5：意思完整，差别都在不扣分的那一类里
4：有一两处不影响理解的小错（个别同音字），润色时能猜出原意
3：有关键处出错（专有名词、英文词、数字、人名），或者漏了零星一句，但大意还在
2：漏了或错了相当一部分，只靠这份转写还原不出原意
1：只认出了零星片段
0：空的、乱码，或者和参照毫不相干

参照也是模型听出来的，可能听错。两份冲突、又看不出谁对时按参照判，note 里写上"参照存疑"。
problems 从 ${PROBLEMS.join("、")} 里挑出现了的，没有就是空列表；note 用一句话说主要问题，没有问题写"无"。`;

const RUBRIC_PRINT = fingerprint(RUBRIC);

/** 参照、转写、判官和评分标准，哪样变了就要重判。两个候选转出一模一样的字，判一次就够 */
export const judgeKey = (reference, transcript) =>
  fingerprint({
    reference: fingerprint(reference),
    transcript: fingerprint(transcript),
    judge: JUDGE,
    rubric: RUBRIC_PRINT,
  });

/** 待判文件里给每一格的短编号：指纹的前 12 位，判官照抄起来不容易错 */
export const handleOf = (key) => key.slice(0, 12);

/**
 * 还没判的格子，按样本分组：一条样本一份参照，下面是各个候选的转写（转得一模一样的并成一项）。
 * 转写是空的不用判官看，直接记 0 分。
 * @param {{ clip: object, candidate: { id: string }, reference: { text: string }, transcript: { text: string } }[]} cells
 *   有参照（且参照不是空的）、有转写的格子
 * @returns {{ groups: object[], empty: { key: string, clip: string, candidates: string[] }[] }}
 */
export function pendingJudgements(cells, results, { force = false } = {}) {
  const groups = new Map();
  const empty = new Map();
  for (const { clip, candidate, reference, transcript } of cells) {
    const key = judgeKey(reference.text, transcript.text);
    if (!force && results.get("judge", key) !== null) continue;
    if (transcript.text.trim() === "") {
      const entry = empty.get(key) ?? { key, clip: clip.id, candidates: [] };
      entry.candidates.push(candidate.id);
      empty.set(key, entry);
      continue;
    }
    const group = groups.get(clip.id) ?? {
      clip: clip.id,
      lang: clip.lang,
      durationSec: clip.durationSec,
      reference: reference.text,
      items: [],
    };
    const same = group.items.find((item) => item.key === key);
    if (same) same.candidates.push(candidate.id);
    else group.items.push({ id: handleOf(key), key, candidates: [candidate.id], transcript: transcript.text });
    groups.set(clip.id, group);
  }
  return { groups: [...groups.values()], empty: [...empty.values()] };
}

/**
 * 校验判官写的一批结论，全部对得上才存（不存半批）：编号是这一批里的，分数是 0–5 的整数，问题在 PROBLEMS 里。
 * @param {{ id: string, score: number, problems: string[], note: string }[]} verdicts
 * @param {object[]} groups pendingJudgements 导出的那一批
 * @returns {number} 存了几格
 */
export function recordJudgements(results, verdicts, groups) {
  const items = new Map(groups.flatMap((group) => group.items.map((item) => [item.id, { group, item }])));
  const seen = new Set();
  const problems = [];
  for (const [index, verdict] of verdicts.entries()) {
    const where = `第 ${index + 1} 条（${verdict?.id}）`;
    if (!items.has(verdict?.id)) problems.push(`${where}：这一批里没有这个编号`);
    else if (seen.has(verdict.id)) problems.push(`${where}：编号重复`);
    seen.add(verdict?.id);
    if (!Number.isInteger(verdict?.score) || verdict.score < 0 || verdict.score > 5)
      problems.push(`${where}：分数要是 0–5 的整数`);
    if (!Array.isArray(verdict?.problems) || verdict.problems.some((p) => !PROBLEMS.includes(p))) {
      problems.push(`${where}：problems 只能从 ${PROBLEMS.join("、")} 里挑`);
    }
    if (typeof verdict?.note !== "string" || verdict.note.trim() === "") problems.push(`${where}：note 不能是空的`);
  }
  if (problems.length > 0) throw new Error(`判分结论没有存，有 ${problems.length} 处不对：\n${problems.join("\n")}`);
  for (const verdict of verdicts) {
    const { group, item } = items.get(verdict.id);
    results.put("judge", item.key, {
      clip: group.clip,
      subject: item.candidates.join(","),
      output: { score: verdict.score, problems: verdict.problems, note: verdict.note, by: JUDGE.by },
    });
  }
  return verdicts.length;
}

/** 空的转写直接记 0 分，不用判官看 */
export function recordEmpty(results, empty) {
  for (const { key, clip, candidates } of empty) {
    results.put("judge", key, {
      clip,
      subject: candidates.join(","),
      output: { score: 0, problems: ["认不出"], note: "转写是空的", by: "rule" },
    });
  }
  return empty.length;
}
