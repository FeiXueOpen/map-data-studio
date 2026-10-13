#!/bin/bash
set -euo pipefail
task_tmp=$(mktemp -d)
trap 'rm -rf "$task_tmp"' EXIT
script_dir=$(cd "$(dirname "$0")" && pwd)
if [ -f "$script_dir/install.sh" ]; then installer="$script_dir/install.sh"; else
 installer="$task_tmp/install.sh"
 curl --fail --location --retry 3 https://raw.githubusercontent.com/FeiXueOpen/map-data-studio/main/scripts/install/install.sh -o "$installer"
fi
bash "$installer" --client doubao "$@"
