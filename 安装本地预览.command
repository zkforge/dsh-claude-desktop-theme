#!/bin/bash
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo '找不到 Node.js，请先安装 Node.js >=22.18.0。'
  read -r -p '按回车关闭窗口…'
  exit 1
fi
node scripts/install-local.mjs
ccd_preview_status=$?
if [ "$ccd_preview_status" -ne 0 ]; then
  echo '安装未完成，请查看上方错误信息。'
fi
read -r -p '按回车关闭窗口…'
exit "$ccd_preview_status"
