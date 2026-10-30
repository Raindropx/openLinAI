#!/bin/sh
# LinAI 启动 wrapper
# 位置：/mnt/sda1/linai/run.sh（与 init.d/linai 中的 RUNNER 路径对应）
#
# 为什么需要 wrapper：
# 某些 OpenWrt/procd 版本对 `procd_set_param env KEY=value` 支持不完整，
# 会导致 DATA_DIR、IMAGE_BACKEND 等环境变量没有传到 node 进程，
# 表现为数据写到 Flash（/data、/root/data）或上传图片时报找不到 sharp。
# 通过 wrapper 在 exec 前显式 export 所有环境变量，可彻底规避该问题。

APP_DIR=/mnt/sda1/linai
NODE_BIN=/opt/bin/node
FFMPEG_BIN=/opt/bin/ffmpeg
PORT=3000

export NODE_ENV=production
export OPEN_BROWSER=false
export IMAGE_BACKEND=ffmpeg
export FFMPEG_BIN="$FFMPEG_BIN"
export IMAGE_FFMPEG_CONCURRENCY="${IMAGE_FFMPEG_CONCURRENCY:-1}"
export DATA_DIR="$APP_DIR/data"
export VIDEO_STORAGE_DIR="${VIDEO_STORAGE_DIR:-}"
export VIDEO_STORAGE_MOUNT="${VIDEO_STORAGE_MOUNT:-/mnt/sda1}"
export VIDEO_ALLOWED_HOSTS="${VIDEO_ALLOWED_HOSTS:-}"
export VIDEO_PUBLIC_ORIGIN="${VIDEO_PUBLIC_ORIGIN:-}"
export VIDEO_RETRIEVAL_CONCURRENCY="${VIDEO_RETRIEVAL_CONCURRENCY:-1}"
export VIDEO_MAX_FILE_BYTES="${VIDEO_MAX_FILE_BYTES:-1073741824}"
export VIDEO_MIN_FREE_BYTES="${VIDEO_MIN_FREE_BYTES:-134217728}"
export VIDEO_TRANSFER_TIMEOUT_MS="${VIDEO_TRANSFER_TIMEOUT_MS:-1800000}"
export VIDEO_GENERATION_TIMEOUT_MS="${VIDEO_GENERATION_TIMEOUT_MS:-21600000}"
# Optional simulator; leave empty for normal use. Real adapters require their own documented configuration.
export VIDEO_MOCK_RESULT_URL="${VIDEO_MOCK_RESULT_URL:-}"
export PORT="$PORT"
# Entware 库不在默认搜索路径，需显式指定避免 node 或 ffmpeg 加载动态库失败
export LD_LIBRARY_PATH=/opt/lib

# 限制 Node 堆内存，防止 OOM 影响路由器整体稳定性。
# 默认 256MB，RAM 较小的设备可改小（如 128），RAM 充裕可改大。
NODE_MAX_OLD_SPACE=${NODE_MAX_OLD_SPACE:-256}

cd "$APP_DIR" || exit 1
exec "$NODE_BIN" --max-old-space-size="$NODE_MAX_OLD_SPACE" "$APP_DIR/dist/server/index.js"
