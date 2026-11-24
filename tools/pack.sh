#!/usr/bin/env bash
# 打发布包（可复现）：bash tools/pack.sh [输出目录]      # 默认输出到当前目录
#
# 产出：
#   <out>/theme.tar.gz           ← 面板「从 GitHub 更新」只认这个名字
#   <out>/theme.tar.gz.sha256    ← 内容只有 `<64 位哈希>  theme.tar.gz`
#
# 为什么能复现：条目顺序固定（--sort=name）、mtime 归零（--mtime=@0）、
# 属主/属组归零（--owner=0 --group=0 --numeric-owner）、gzip 不写文件名与时间（-n）。
# 同一份源码 + 同一版 GNU tar/gzip 打两次，哈希必须一致。
set -euo pipefail
cd "$(dirname "$0")/.."

# 先构建：src/ → dist/（版本号只在 theme.json 写一次，?v= 由构建注入）
node tools/build.mjs

OUT="${1:-$PWD}"
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)

VER=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' theme.json | head -1)
META=$(sed -n 's/.*name="theme-version" content="\([^"]*\)".*/\1/p' dist/index.html | head -1)
# ★这两个 grep 是「有就收、没有也算正常」的探测：--include 组合会让其中一个在
# 某些目录结构下一条都匹配不到，返回码 1；在 set -o pipefail 下这会把整条命令判失败，
# 于是 pack.sh 在 VS= 这行就静默 exit 1（实测：包其实已经打好了，但 .sha256 永远不生成）。
# 收尾统一加 `|| true`，只让下面的显式校验决定成败。
VS=$( { grep -rhoE "(from|import\() *['\"][^'\"]*\?v=[0-9][0-9.]*" dist --include="*.js" || true ;
        grep -rhoE '(src|"three" *= *")[^"]*\?v=[0-9][0-9.]*' dist/index.html || true ; } \
      | grep -oE '\?v=[0-9][0-9.]*' | sed 's/?v=//' | sort -u | tr '\n' ' ' || true )
[ -n "$VER" ] || { echo "!! 读不到 theme.json 的 version"; exit 1; }
[ "$VER" = "$META" ] || { echo "!! theme.json=$VER 与 <meta theme-version>=$META 不一致"; exit 1; }
[ "$VS" = "$VER " ] || { echo "!! dist 里的 ?v= 是 [$VS]，应为 $VER"; exit 1; }

# ★preview.png 必须比 theme.json 新（或同一次改动里一起更新）。
#   踩过的坑：1.8.4 首发时截的图一直用到 1.12.0 都没换，图上还印着当时的旧界面
#   （顶栏有「更新 hh:mm」）和旧的 mock 机器名 —— 包是新的、预览图是旧的，
#   安装者看到的和实际界面对不上。这里只在明显陈旧时警告，不拦构建：
#   版本号本身也可能只是改文案，不必强制重截。
if [ -f preview.png ] && [ theme.json -nt preview.png ]; then
  echo "!! 提醒：preview.png 比 theme.json 旧。若有界面变化，请重截："
  echo "   node tools/preview-mock.mjs --port 5361 &   # 中性数据，勿用真实机器名"
  echo "   node ../tools/shot-preview.mjs http://127.0.0.1:5361/ preview.png --no-prompt"
fi

rm -f "$OUT/theme.tar.gz" "$OUT/theme.tar.gz.sha256"
tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner \
    -cf - theme.json preview.png dist LICENSE README.md THIRD-PARTY-NOTICES.md \
  | gzip -9n > "$OUT/theme.tar.gz"
( cd "$OUT" && sha256sum theme.tar.gz | sed -E 's/[* ]+/  /' > theme.tar.gz.sha256 )

echo "版本 $VER → $OUT/theme.tar.gz ($(stat -c %s "$OUT/theme.tar.gz") B)"
cat "$OUT/theme.tar.gz.sha256"
