#!/bin/bash
set -euo pipefail
client=none
version=''
launch=yes
dry=no
while [ "$#" -gt 0 ]; do
 case "$1" in
  --client) client="${2:?缺少客户端}"; shift 2;;
  --version) version="${2:?缺少版本}"; shift 2;;
  --no-open) launch=no; shift;;
  --dry-run) dry=yes; shift;;
  *) printf '参数：--client codex|claude|doubao|none [--version v0.1.0] [--no-open] [--dry-run]\n'; exit 1;;
 esac
done
case "$client" in codex|claude|doubao|none) ;; *) echo '未知AI客户端'; exit 1;; esac
[ "$(uname -s)" = Darwin ] || { echo 'Windows请使用install.ps1'; exit 1; }
case "$(uname -m)" in arm64) arch=arm64;; x86_64) arch=x64;; *) echo '不支持的CPU'; exit 1;; esac
if [ -z "$version" ]; then
 version=$(curl --fail --silent --show-error --location --max-time 30 https://api.github.com/repos/FeiXueOpen/map-data-studio/releases/latest | plutil -extract tag_name raw -o - -)
fi
[[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo '版本格式应为v0.1.0'; exit 1; }
name="map-data-studio-${version#v}-macos-${arch}.zip"
base="https://github.com/FeiXueOpen/map-data-studio/releases/download/$version"
target="$HOME/Applications/Map Data Studio.app"
if [ "$dry" = yes ]; then printf '版本：%s\n下载：%s/%s\n安装目录：%s\nAI客户端：%s\n' "$version" "$base" "$name" "$target" "$client"; exit 0; fi
task_tmp=$(mktemp -d)
trap 'rm -rf "$task_tmp"' EXIT
curl --fail --location --retry 3 "$base/$name" -o "$task_tmp/$name"
curl --fail --location --retry 3 "$base/$name.sha256" -o "$task_tmp/$name.sha256"
(cd "$task_tmp" && shasum -a 256 -c "$name.sha256")
ditto -x -k "$task_tmp/$name" "$task_tmp/unpacked"
app="$task_tmp/unpacked/Map Data Studio.app"
[ -x "$app/Contents/MacOS/map-data-studio" ] || { echo '压缩包结构无效'; exit 1; }
mkdir -p "$HOME/Applications"
if [ -e "$target" ]; then mv "$target" "$target.backup-$(date +%Y%m%d%H%M%S)"; fi
mv "$app" "$target"
"$target/Contents/Resources/image-runtime/node" "$target/Contents/Resources/automation/setup-ai.mjs" --client "$client" --command "$target/Contents/MacOS/map-data-studio"
if [ "$launch" = yes ]; then
 open "$target" || echo '请用户从Finder启动并完成系统首次打开确认。'
 "$target/Contents/Resources/image-runtime/node" "$target/Contents/Resources/automation/check-connection.mjs" "$target/Contents/MacOS/map-data-studio" || echo '应用已安装，但本地服务预检未通过，请完成首次打开确认后重试。'
fi
printf '客户端已安装：%s\n' "$target"
