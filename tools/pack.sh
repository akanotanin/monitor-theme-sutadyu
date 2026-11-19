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

OUT="${1:-$PWD}"
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)

VER=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' theme.json | head -1)
META=$(sed -n 's/.*name="theme-version" content="\([^"]*\)".*/\1/p' dist/index.html | head -1)
VS=$(grep -rho '?v=[0-9][0-9.]*' dist | sed 's/?v=//' | sort -u | tr '\n' ' ')
[ -n "$VER" ] || { echo "!! 读不到 theme.json 的 version"; exit 1; }
[ "$VER" = "$META" ] || { echo "!! theme.json=$VER 与 <meta theme-version>=$META 不一致"; exit 1; }
[ "$VS" = "$VER " ] || { echo "!! dist 里的 ?v= 是 [$VS]，应为 $VER"; exit 1; }

rm -f "$OUT/theme.tar.gz" "$OUT/theme.tar.gz.sha256"
tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner \
    -cf - theme.json preview.png dist LICENSE README.md THIRD-PARTY-NOTICES.md \
  | gzip -9n > "$OUT/theme.tar.gz"
( cd "$OUT" && sha256sum theme.tar.gz | sed -E 's/[* ]+/  /' > theme.tar.gz.sha256 )

echo "版本 $VER → $OUT/theme.tar.gz ($(stat -c %s "$OUT/theme.tar.gz") B)"
cat "$OUT/theme.tar.gz.sha256"
