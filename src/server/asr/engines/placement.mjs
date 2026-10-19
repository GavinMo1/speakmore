// 本机运行库按做法放词典：清单里模型声明了收词表的做法（vocabulary.kind），运行库这一族的 vocabulary 表里要有这种做法的放法。
// 和云端的适配器一样按做法查表（cloud/bailian.mjs 的 VOCABULARY），对不上就装不上、照实报错，不悄悄换成别的放法。

/**
 * @param {{ id?: string, family: string, vocabulary?: { kind: string } | null }} model 清单里的一项
 * @param {{ vocabulary?: Record<string, Function> }} family 运行库认得的这一族
 * @param {string} engine 运行库的名字（报错用）
 * @returns {Function | null} 这一族放这种词表的办法；模型不收词表是 null
 */
export function placementOf(model, family, engine) {
  if (!model.vocabulary) return null;
  const place = family.vocabulary?.[model.vocabulary.kind];
  if (!place) {
    throw new Error(
      `${engine} 的 ${model.family} 不会放 ${model.vocabulary.kind} 这种词表（${model.id ?? model.family}）`,
    );
  }
  return place;
}
