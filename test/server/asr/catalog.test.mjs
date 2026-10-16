import assert from "node:assert/strict";
import { test } from "node:test";
import { downloadSize, findModel, MODELS } from "../../../src/server/asr/catalog.mjs";
import { findEngine } from "../../../src/server/asr/engines/index.mjs";

test("清单：id 不重复，只用小写字母、数字、点和横线（它也是模型的目录名）", () => {
  const ids = MODELS.map((model) => model.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z0-9][a-z0-9.-]*$/);
  assert.equal(findModel(ids[0]), MODELS[0]);
  assert.equal(findModel("nope"), null);
});

test("清单：每个文件是仓库里的相对路径，带大小和 sha256；下载地址钉在某一次提交上", () => {
  for (const model of MODELS) {
    assert.match(model.source.revision, /^[0-9a-f]{40}$/, model.id);
    for (const file of Object.values(model.files)) {
      assert.match(file.path, /^[\w.-]+(\/[\w.-]+)*$/, `${model.id} ${file.path}`);
      assert.ok(!file.path.split("/").includes(".."), `${model.id} ${file.path}`);
      assert.match(file.sha256, /^[0-9a-f]{64}$/, `${model.id} ${file.path}`);
      assert.ok(Number.isInteger(file.size) && file.size > 0, `${model.id} ${file.path}`);
    }
  }
  const sizes = Object.values(MODELS[0].files).map((file) => file.size);
  assert.equal(
    downloadSize(MODELS[0]),
    sizes.reduce((a, b) => a + b, 0),
  );
});

test("清单：用的运行库登记过，它认得这一族，填配置时要的文件清单里都有", async () => {
  for (const model of MODELS) {
    const engine = findEngine(model.engine);
    assert.ok(engine, `${model.id} 的运行库 ${model.engine}`);
    const { FAMILIES } = await engine.load();
    assert.ok(FAMILIES[model.family], `${engine.name} 认不认 ${model.family}`);
    const asked = [];
    FAMILIES[model.family]((role) => {
      assert.ok(model.files[role], `${model.id} 缺 ${role}`);
      asked.push(role);
      return `/models/${model.id}/${model.files[role].path}`;
    });
    assert.ok(asked.length > 0);
  }
});
