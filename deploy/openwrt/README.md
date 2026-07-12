# 在 ARM64 OpenWrt 上部署 openLinAI

目标：在 ARM64 OpenWrt 设备上运行 openLinAI，并将生成图片、任务和配置数据保存到外部存储，减少对路由器 Flash 的写入。

## 已验证环境

- GL.iNet MT6000 / MT7986（aarch64）
- GL.iNet 官方固件 4.9.0
- 1 GB RAM
- 外部存储挂载点：`/mnt/sda1/`
- Entware 安装于 `/opt`

本文后续命令和仓库自带脚本均以上述环境为默认配置。如果外部存储挂载在其他路径，必须根据实际情况同步修改：

- `deploy/openwrt/initd/linai` 中的 `APP_DIR`
- `deploy/openwrt/initd/run.sh` 中的 `APP_DIR`
- 本文命令中的 `/mnt/sda1/linai`

其他 ARM64 OpenWrt 设备原则上也可参考部署，但 CPU 架构、固件版本、软件源、挂载路径和可用内存不同，需自行调整并验证。

> [!WARNING]
> openLinAI 当前没有内置用户登录和 API 访问鉴权，仅建议在可信局域网内使用。不要将 3000 或 8080 端口直接映射到公网。如需远程访问，请在服务前增加身份认证、HTTPS、VPN 或防火墙访问控制。

## 0. 工作原理

- 后端经 tsup 打包成**单个自包含 JS**（`dist/server/index.js`），除 `sharp`/`playwright` 外全部内联；本项目已用 ffmpeg 取代 sharp、并移除 wan(playwright) 路由，因此**路由器上无需 `node_modules`**，只要一个 `node` 二进制即可运行。
- 所有数据路径由 `DATA_DIR` 环境变量决定（默认 `cwd/data`），本部署固定指向 `/mnt/sda1/linai/data`。
- 图像处理（参考图压缩、缩略图）由 `IMAGE_BACKEND=ffmpeg` 调用系统 `ffmpeg`，避免 musl 上编译原生模块。Entware 的精简版 ffmpeg 不含 libwebp，因此 ffmpeg 后端**输出 JPEG**（用内置 `mjpeg` 编码器，无需额外库）；sharp 后端（PC 开发）输出 webp。后缀与 MIME 由后端自动决定。

## 1. 安装 Entware（到 SSD）

GL.iNet 官方固件不带 Entware，但可一键安装。Entware 会装到 `/opt`（指向外接存储），避免占用 Flash。

SSH 登录路由器后：

```sh
# 先确保 SSD 已挂载
mount | grep sda1
# → /dev/sda1 on /mnt/sda1 type ext4 ...

# 安装 Entware（aarch64）
wget -O - https://bin.entware.net/aarch64-k3.10/installer/generic.sh | sh
```

装完后 ` /opt` 指向 Entware 根目录。验证：

```sh
/opt/bin/opkg update
/opt/bin/opkg -v
```

> 若上面的 URL 不可用，请前往 https://bin.entware.net/ ，根据设备架构和当前可用的软件源选择对应 `aarch64-*` 目录下的 `installer/generic.sh`。不要仅凭设备型号套用软件源，具体以设备架构及 Entware 当前说明为准。

## 2. 安装 node 与 ffmpeg

```sh
/opt/bin/opkg install node ffmpeg
/opt/bin/node -v                        # 期望输出版本号
/opt/bin/ffmpeg -encoders | grep mjpeg  # 期望有 VFS... mjpeg 一行
```

> ffmpeg 后端用内置 `mjpeg` 编码器输出 JPEG，**不需要 libwebp**。Entware 精简版 ffmpeg 默认带 mjpeg，上面那条 grep 有输出即可。若连 mjpeg 都没有（极少见），才需考虑 `IMAGE_BACKEND=sharp` 并拷 musl-arm64 版 `node_modules/sharp` 到 SSD。

## 3. 在 PC 上构建项目

在项目根目录（本仓库）：

```sh
pnpm install
pnpm build:privateSkipTag
```

产物在 `dist/`：

- `dist/server/index.js` — 自包含后端
- `dist/client/` — 前端静态资源
- `dist/data/` — 模板/示例图片种子数据
- `dist/runtime/` — Windows 用的 node.exe，**OpenWrt 不需要，跳过**

## 4. 传到路由器

从 PC（Git Bash / PowerShell 均可）：

```sh
# 先通过 SSH 在路由器上创建目标目录
ssh root@<路由器IP> "mkdir -p /mnt/sda1/linai/dist"

# 再上传构建产物
scp -r dist/server dist/client dist/data root@<路由器IP>:/mnt/sda1/linai/dist/
```

`<路由器IP>` 换成你的 MT6000 地址（如 192.168.8.1）。最终结构：

```
/mnt/sda1/linai/
└── dist/
    ├── server/index.js
    ├── client/
    └── data/
```

## 5. 配置 API Key

先手动跑一次确认无误：

```sh
cd /mnt/sda1/linai
DATA_DIR=/mnt/sda1/linai/data \
IMAGE_BACKEND=ffmpeg \
FFMPEG_BIN=/opt/bin/ffmpeg \
OPEN_BROWSER=false \
NODE_ENV=production \
/opt/bin/node dist/server/index.js
```

看到 `Server is running on http://localhost:3000` 后，浏览器打开 `http://<路由器IP>:3000`：

1. 右上角设置 → 填入 GPT Image 端点和 API Key。配置保存在 SSD 的 `data/config.json`；部分 Key 仅进行可逆混淆，不应视为安全加密，请保护该文件和数据目录。
2. 在首页模板区填 prompt、选比例、可选上传参考图 → 生成。
3. 对支持余额查询的端点，可在右上角查看余额；自定义端点可能不支持该功能。

确认正常后 `Ctrl+C` 停止，进入下一步开机自启。

## 6. 配置开机自启（procd）

本部署使用 **init 脚本 + run.sh wrapper** 的方式：

- `init.d/linai`：负责 procd 托管、开机自启、挂载触发、依赖等待；
- `run.sh`：负责设置 `DATA_DIR`、`IMAGE_BACKEND=ffmpeg` 等环境变量。

> 为什么要用 wrapper？某些 OpenWrt/procd 版本对 `procd_set_param env KEY=value` 支持不完整，会导致环境变量没有传到 node 进程，表现为**数据写到 Flash（`/data`、`/root/data`）或上传图片时报找不到 `sharp`**。wrapper 在 `exec` 前显式 `export` 所有变量，可彻底规避。

把两个文件都传到路由器：

```sh
scp deploy/openwrt/initd/linai root@<路由器IP>:/etc/init.d/linai
scp deploy/openwrt/initd/run.sh  root@<路由器IP>:/mnt/sda1/linai/run.sh
```

路由器上：

```sh
chmod +x /etc/init.d/linai
chmod +x /mnt/sda1/linai/run.sh
/etc/init.d/linai enable
/etc/init.d/linai start
# 查看日志：
logread -f | grep -i linai
```

之后重启路由器会自动拉起服务。数据目录、环境变量都已在脚本里设好。

验证环境变量是否生效：

```sh
PID=$(ps | grep 'dist/server/index.js' | grep -v grep | awk '{print $1}')
cat /proc/$PID/environ | tr '\0' '\n' | grep -E 'DATA_DIR|IMAGE_BACKEND|NODE_ENV'
# 应看到 DATA_DIR=/mnt/sda1/linai/data 和 IMAGE_BACKEND=ffmpeg
```

## 7. （可选）nginx 反代到 8080

若不想带 `:3000` 访问，用 `deploy/openwrt/nginx.conf`：

```sh
opkg install nginx
scp deploy/openwrt/nginx.conf root@<路由器IP>:/etc/nginx/conf.d/linai.conf
/etc/init.d/nginx restart
```

之后访问 `http://<路由器IP>:8080`。注意别和 LuCI 的 80 端口冲突。

## 8. 故障排查

- **重启后服务没有自动启动，但 `/etc/init.d/linai start` 手动可以启动**：
  最常见的原因是 **启动时外接存储 `/mnt/sda1`（以及 Entware 的 `/opt`）尚未挂载完成**，procd 在 `START=99` 尝试启动时找不到 `node` 或服务文件。当前 init 脚本已内置：

  1. `wait_for_deps` 在启动前最多等待 60 秒让 `$APP_DIR`、`$NODE_BIN`、`$FFMPEG_BIN` 就绪；
  2. `service_triggers` 订阅 mount 事件，挂载完成后再重试启动；
  3. `cwd` 指向 `$APP_DIR`，避免 `process.cwd()` 落到 `/` 导致数据写入错误位置。
     若仍不自动启动，请按下面步骤排查：

  ```sh
  # 1. 确认 rc.d 链接已创建
  ls -l /etc/rc.d/S*linai /etc/rc.d/K*linai

  # 2. 重启后立刻看日志（SSH 连上去越早越好）
  logread -e linai

  # 3. 检查 /mnt/sda1 与 /opt 实际挂载时间
  mount | grep -E 'sda1|opt'

  # 4. 如果 init 脚本从 Windows 直接 scp 上去，可能有 CRLF 换行导致 /bin/sh 解析失败
  file /etc/init.d/linai
  # 若显示 "CRLF line terminators"，执行：
  # opkg install dos2unix && dos2unix /etc/init.d/linai

  # 5. 重新加载触发器并启动
  /etc/init.d/linai enable
  /etc/init.d/linai restart
  ```
- **`/opt/bin/node: not found`**：Entware 未装好或没挂载 SSD，重做第 1 步。
- **上传参考图报错 `Cannot find package 'sharp'`**：
  说明 `IMAGE_BACKEND=ffmpeg` 没有传到 node 进程，代码走了 sharp 分支。按下面步骤检查：

  ```sh
  PID=$(ps | grep 'dist/server/index.js' | grep -v grep | awk '{print $1}')
  cat /proc/$PID/environ | tr '\0' '\n' | grep IMAGE_BACKEND
  # 正确应输出 IMAGE_BACKEND=ffmpeg；若为空，说明 procd 没把环境变量传进去
  ```

  请确认已按第 6 步同时上传了 `run.sh`，并且 `chmod +x /mnt/sda1/linai/run.sh`。
- **生成的图片/任务列表找不到，或者数据写到 `/data`、`/root/data`（Flash）**：
  说明 `DATA_DIR` 环境变量没生效，`getDataDir()` fallback 到了 `process.cwd()/data`。检查方法同上：

  ```sh
  cat /proc/$PID/environ | tr '\0' '\n' | grep DATA_DIR
  # 正确应输出 DATA_DIR=/mnt/sda1/linai/data
  ```

  如果之前的数据落到了错误位置，可以停服务后迁回 SSD：

  ```sh
  /etc/init.d/linai stop
  cp -r /data/* /mnt/sda1/linai/data/ 2>/dev/null || true
  cp -r /root/data/* /mnt/sda1/linai/data/ 2>/dev/null || true
  /etc/init.d/linai start
  ```
- **`spawn ffmpeg ENOENT`**：procd 服务 PATH 不含 `/opt/bin`，ffmpeg 找不到。确认 init 脚本里设了 `FFMPEG_BIN=/opt/bin/ffmpeg`（仓库脚本已内置），重拷脚本并 `/etc/init.d/linai restart`。前台手跑也要带 `FFMPEG_BIN=/opt/bin/ffmpeg`。
- **生成图片 500 / `Image processing failed`**：`/opt/bin/ffmpeg -encoders | grep mjpeg` 确认 mjpeg 编码器在（Entware 精简版默认带）。若在仍失败，前台跑（第 5 步）看 stderr 的 ffmpeg 报错；极少数情况无 mjpeg 才换 `IMAGE_BACKEND=sharp` 并拷 PC 端 `node_modules/sharp`（需 musl-arm64）。
- **端口被占**：改 init 脚本里的 `PORT=3000` 或用 nginx 反代。
- **数据没落 SSD**：确认 `DATA_DIR` 指向 `/mnt/sda1/linai/data`（`ls /mnt/sda1/linai/data/images/generated`）。
- **日志**：`logread -e linai` 或直接前台跑（第 5 步）看 stderr。

## 9. 数据备份/迁移

全部数据集中在 `/mnt/sda1/linai/data/`：`images/{generated,input,thumb}`、`tasks.json`、`templates.json`、`config.json`。整目录拷走即完成备份。

## 10. 更新部署

更新前请先停止服务并备份完整数据目录：

```sh
/etc/init.d/linai stop
cp -a /mnt/sda1/linai/data /mnt/sda1/linai/data.backup
```

在 PC 上重新生成产物后，只更新程序和前端文件：

```sh
scp -r dist/server dist/client root@<路由器IP>:/mnt/sda1/linai/dist/
```

`dist/data` 是种子数据。已有部署升级时不要直接用它覆盖 `/mnt/sda1/linai/data`，以免影响现有配置、任务、模板和图片。若新版本明确要求更新种子数据，请先备份，再按版本说明处理。

更新部署脚本后重新上传，随后启动并检查日志：

```sh
/etc/init.d/linai start
logread -e linai
```
