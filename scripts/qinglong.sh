#!/usr/bin/env bash
set -euo pipefail

runtime_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
state_dir="${JUEJIN_STATE_DIR:-$runtime_dir/state}"
mode="${1:-run}"
case "$mode" in
  run|inspect|force) ;;
  *) echo '用法：qinglong.sh [run|inspect|force]' >&2; exit 2 ;;
esac

mkdir -p "$state_dir"
exec 9>"$state_dir/run.lock"
if ! flock -n 9; then
  echo '掘金任务已在运行，本次跳过。'
  exit 0
fi

# Only this task's prefixed settings are passed to the existing workflow.
for name in COOKIE COOKIE_2 COOKIE_3 COOKIE_4 COOKIE_5 \
  AUTO_READ_ARTICLES READING_MAX_ARTICLES AUTO_LIKE_ARTICLES AUTO_LIKE_PINS \
  AUTO_COLLECT_ARTICLES AUTO_FOLLOW_USERS AUTO_CLAIM_LUCKY FOLLOW_USER_IDS COLLECTION_ID \
  TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID TELEGRAM_MESSAGE_THREAD_ID TG_BOT_TOKEN TG_CHAT_ID TG_USER_ID \
  EMAIL_USER EMAIL_PASS EMAIL_TO DINGDING_WEBHOOK PUSHPLUS_TOKEN WEIXIN_WEBHOOK \
  SERVERPUSHKEY FEISHU_WEBHOOK BARK_WEBHOOK; do
  scoped_name="JUEJIN_$name"
  if [[ -n "${!scoped_name:-}" ]]; then
    export "$name=${!scoped_name}"
  else
    unset "$name"
  fi
done

today="$(TZ=Asia/Shanghai date +%F)"
if [[ "$mode" == run && -f "$state_dir/$today.success" ]]; then
  echo "北京时间 $today 已成功完成掘金任务，本次跳过。"
  exit 0
fi
export TASK_MODE=run
if [[ "$mode" == inspect ]]; then export TASK_MODE=inspect; fi

node "$runtime_dir/workflows/checkin.js"
if [[ "$mode" != inspect ]]; then
  date -u +%FT%TZ > "$state_dir/$today.success.tmp"
  mv "$state_dir/$today.success.tmp" "$state_dir/$today.success"
fi
