// 把去混淆后仍是 _0x…… 的 import 绑定改回可读名字（app、fs、path……），纯语法改写，不执行目标代码。
// 用法（需用 _work/tooling 里的 node 与依赖）：
//   node tools/rename-imports.mjs <输入.js> <输出.js>
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// babel 来自 webcrack 的依赖树，装在 _work/tooling 下，这里按该目录解析
const require = createRequire(resolve(process.cwd(), '_work/tooling/package.json'));
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('用法：node tools/rename-imports.mjs <输入.js> <输出.js>');
  process.exit(2);
}

const ast = parser.parse(readFileSync(input, 'utf8'), { sourceType: 'module' });

// 模块名 → 默认/命名空间导入时用的基础名
function baseNameOf(source) {
  const cleaned = source.replace(/^node:/, '').replace(/\.js$/, '');
  const last = cleaned.split('/').filter(Boolean).pop() ?? 'mod';
  return last.replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''));
}

const used = new Set();
let renamed = 0;

traverse(ast, {
  Program(path) {
    for (const name of Object.keys(path.scope.getAllBindings())) used.add(name);
  },
  ImportDeclaration(path) {
    for (const spec of path.node.specifiers) {
      const local = spec.local.name;
      if (!/^_0x[0-9a-f]+$/.test(local)) continue;
      let wanted;
      if (spec.type === 'ImportSpecifier') {
        wanted = spec.imported.type === 'Identifier' ? spec.imported.name : spec.imported.value;
      } else {
        wanted = baseNameOf(path.node.source.value);
        if (spec.type === 'ImportNamespaceSpecifier') wanted += 'NS';
      }
      // 保留字或已占用的名字加后缀，保证改名后程序语义不变
      let candidate = /^[A-Za-z_$][\w$]*$/.test(wanted) ? wanted : `imp_${renamed}`;
      let n = 2;
      while (used.has(candidate) || !path.scope.getProgramParent().hasBinding(local)) {
        if (!used.has(candidate)) break;
        candidate = `${wanted}_${n++}`;
      }
      path.scope.getProgramParent().rename(local, candidate);
      used.add(candidate);
      renamed++;
    }
  },
});

writeFileSync(output, generate(ast, { retainLines: false, compact: false }).code);
console.log(`改名 ${renamed} 个导入绑定 → ${output}`);
