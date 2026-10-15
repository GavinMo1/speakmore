// 文案里的两种小标记，拆成页面好画的片段。

/**
 * 口述里 ~~ 括起来的是会被删掉的部分："~~嗯，~~我们开会" → [{ text: "嗯，", cut: true }, { text: "我们开会", cut: false }]
 * @returns {{ text: string, cut: boolean }[]}
 */
export function cutMarks(text) {
  const parts = text.split("~~");
  if (parts.length % 2 === 0) throw new Error(`~~ 没有成对：${text}`);
  return parts.map((part, index) => ({ text: part, cut: index % 2 === 1 })).filter((part) => part.text !== "");
}

/**
 * 把 {name} 换成给的值。值可以是字以外的东西（比如一个链接），所以交出的是一串片段，由页面拼起来
 * @returns {unknown[]}
 */
export function fill(template, values) {
  return template
    .split(/(\{\w+\})/)
    .filter((part) => part !== "")
    .map((part) => {
      const name = /^\{(\w+)\}$/.exec(part)?.[1];
      if (name === undefined) return part;
      if (!(name in values)) throw new Error(`文案里的 {${name}} 没有给值：${template}`);
      return values[name];
    });
}

/** 只换字的版本：图片的说明、标题这些只收字的地方用 */
export function fillText(template, values) {
  return fill(template, values).join("");
}
