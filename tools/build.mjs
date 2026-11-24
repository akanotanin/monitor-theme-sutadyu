#!/usr/bin/env node
/**
 * 构建：src/ → dist/，并按 theme.json 的 version 给所有相对模块路径加上 ?v=
 *
 *   node tools/build.mjs
 *
 * 为什么要有这一步：仓库里放的是手写源码（src/），hub 装的是 dist/。
 * 版本号只在 theme.json 写一次，构建时统一注入——不用再手工改几十处 ?v=。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'theme.json'), 'utf8'));

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
}

fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(src, dist, { recursive: true });

// ---- JS：给相对模块路径加 ?v= ----
/* ★必须先剥掉旧的 ?v= 再注入。
   原来的正则用了 [^'"?]+\.js（不含 ?），遇到已经带 ?v= 的路径就直接跳过，
   于是硬编码了旧版本号的模块会一直指向旧 URL——浏览器拿缓存，
   表现为「改了代码没生效」。实测 dist 里混进过 ?v=1.9.0 就是这么来的。
   这样处理后 build 是幂等的：跑几次结果都一样。 */
let stamped = 0;
for (const file of walk(path.join(dist)).filter((f) => f.endsWith('.js'))) {
  if (file.includes(`${path.sep}vendor${path.sep}`)) continue; // three.js 由 importmap 统一带版本
  let code = fs.readFileSync(file, 'utf8');
  const before = code;
  code = code.replace(/(\bfrom\s+['"])(\.{1,2}\/[^'"]+?\.js)\?v=[\d.]+(['"])/g, (_, a, spec, c) => `${a}${spec}${c}`);
  code = code.replace(/(\bimport\s*\(\s*['"])(\.{1,2}\/[^'"]+?\.js)\?v=[\d.]+(['"]\s*\))/g, (_, a, spec, c) => `${a}${spec}${c}`);
  // import ... from './x.js' / export ... from './x.js'
  code = code.replace(/(\bfrom\s+['"])(\.{1,2}\/[^'"?]+\.js)(['"])/g, (_, a, spec, c) => `${a}${spec}?v=${version}${c}`);
  // 动态 import('./x.js')
  code = code.replace(/(\bimport\s*\(\s*['"])(\.{1,2}\/[^'"?]+\.js)(['"]\s*\))/g, (_, a, spec, c) => `${a}${spec}?v=${version}${c}`);
  if (code !== before) {
    fs.writeFileSync(file, code);
    stamped++;
  }
}

// ---- index.html：meta 版本 + 入口脚本 + importmap ----
const indexFile = path.join(dist, 'index.html');
let html = fs.readFileSync(indexFile, 'utf8');
html = html
  .replace(/(<meta name="theme-version" content=")[^"]*(")/, `$1${version}$2`)
  .replace(/(<script type="module" src="\.\/boot\.js)(\?v=[0-9.]+)?(")/, `$1?v=${version}$3`)
  .replace(/("three":\s*"\.\/vendor\/three\.module\.js)(\?v=[0-9.]+)?(")/, `$1?v=${version}$3`);
fs.writeFileSync(indexFile, html);

// ---- 自检：不许留下未带版本的相对模块路径 ----
const problems = [];
for (const file of walk(dist).filter((f) => f.endsWith('.js') && !f.includes(`${path.sep}vendor${path.sep}`))) {
  const code = fs.readFileSync(file, 'utf8');
  for (const m of code.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"]+\.js)(['"])/g)) {
    if (!m[1].includes('?v=')) problems.push(`${path.relative(root, file)}: ${m[1]}`);
  }
}
if (!/boot\.js\?v=/.test(html)) problems.push('index.html: ./boot.js 没有带 ?v=');
if (!/three\.module\.js\?v=/.test(html)) problems.push('index.html: importmap 里的 three 没有带 ?v=');
if (problems.length) {
  console.error('构建失败：相对模块路径缺少 ?v=\n  ' + problems.join('\n  '));
  process.exit(1);
}

const files = walk(dist);

/* ---- 发布前自检：宁可构建失败，也不要打出一个缺件却「看起来成功」的包 ----
   这三条都是踩过的坑：
   ① src/vendor/flags 若没进 git（或忘了拷进 dist），打出来的包国旗全变破图，
      而构建本身不报错；
   ② src 里被 import 的模块若漏拷（新增文件忘了加进 build 的模块清单），
      浏览器 404、整站起不来，构建同样不报错；
   ③ package.json 与 theme.json 版本号不一致时，Release tag 容易对不上。 */
{
  const pkgFile = path.join(root, 'package.json');
  const pkgVer = JSON.parse(fs.readFileSync(pkgFile, 'utf8')).version;
  if (pkgVer !== version) {
    console.error(`构建失败：package.json ${pkgVer} ≠ theme.json ${version}`);
    process.exit(1);
  }

  const srcFlags = path.join(root, 'src', 'vendor', 'flags');
  const distFlags = path.join(dist, 'vendor', 'flags');
  const countPng = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.png')).length : 0);
  const nSrc = countPng(srcFlags);
  const nDist = countPng(distFlags);
  if (nSrc !== nDist || nDist === 0) {
    console.error(`构建失败：国旗数量不一致 src=${nSrc} dist=${nDist}`);
    process.exit(1);
  }

  // 每个被 import 的相对模块都必须在 dist 里真实存在
  const missing = [];
  for (const file of files.filter((f) => f.endsWith('.js'))) {
    const code = fs.readFileSync(file, 'utf8');
    for (const m of code.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.[^'"]+\.js)(?:\?[^'"]*)?['"]/g)) {
      const target = path.resolve(path.dirname(file), m[1]);
      if (!fs.existsSync(target)) missing.push(`${path.relative(dist, file)} → ${m[1]}`);
    }
  }
  if (missing.length) {
    console.error('构建失败：以下相对模块在 dist 里不存在\n  ' + [...new Set(missing)].join('\n  '));
    process.exit(1);
  }
}

console.log(`构建完成 → dist/  ${version}  ${files.length} 个文件，注入 ?v= 的文件 ${stamped} 个`);
