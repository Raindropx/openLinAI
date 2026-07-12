# openLinAI

支持 Windows 本地运行和 ARM 架构 OpenWrt 部署的 AI 生图 API 与任务管理平台。

本项目 fork 自 [libudu/LinAI](https://github.com/libudu/LinAI)，在原项目基础上针对轻量化部署、GPT Image 生图流程和本地数据管理进行了调整。

## 功能

- GPT Image 生图与任务队列管理
- 参考图片上传、压缩和缩略图处理
- 生图模板、风格预设与提示词辅助
- 角色卡生成与管理
- API、模型和本地数据目录配置
- 生成记录、任务状态与图片文件管理
- 支持在 Windows PC 上本地运行
- 支持使用 FFmpeg 作为图片处理后端
- 支持 ARM64 OpenWrt、外接存储和 procd 自启动部署

## 支持平台

- **Windows**：适合在个人电脑上本地运行和开发，默认使用 Sharp 处理图片。
- **ARM64 OpenWrt**：适合在路由器等低功耗设备上长期运行，可使用外接存储保存数据，并通过 FFmpeg 避免原生模块兼容问题。

OpenWrt 是本项目额外适配的部署方式，并非唯一运行平台。普通 Windows 用户可以直接按照下方步骤安装依赖并启动项目。

## Windows 本地运行与开发

### 环境要求

- Node.js
- pnpm

### 启动

```bash
pnpm install
pnpm dev
```

在 Windows PowerShell 或终端中执行以上命令即可。应用数据默认保存在项目运行目录下的 `data` 文件夹中。

开发环境默认使用以下端口：

- 前端：以 Vite 输出为准
- 后端 API：`http://localhost:3001`

API Key 等配置请通过应用内设置填写。请勿将包含密钥的 `.env`、数据目录或配置文件提交到 Git。

## OpenWrt 部署

OpenWrt 部署涉及 Entware、Node.js、FFmpeg、外接存储、procd 自启动和可选的 nginx 反向代理。

完整步骤请参阅：**[OpenWrt 部署指南](deploy/openwrt/README.md)**。

当前部署方案主要面向：

- ARM64 / aarch64 OpenWrt 设备
- GL.iNet MT6000 / MT7986 或相近环境
- 使用 SSD 等外接存储保存任务、配置与生成图片
- 使用 Entware 提供 Node.js 和 FFmpeg

经过验证的默认配置为：**GL.iNet MT6000，官方固件 4.9.0，外部存储挂载为 `/mnt/sda1/`**。

仓库中的部署脚本和文档默认使用 `/mnt/sda1/linai`。如果外部存储挂载点为其他路径，或设备的 CPU 架构、固件版本、Entware 软件源及端口配置不同，需要根据实际环境修改部署脚本和命令，不能直接套用默认路径。

## 数据与安全

- 默认数据目录为运行目录下的 `data`，可通过 `DATA_DIR` 修改。
- OpenWrt 部署建议将 `DATA_DIR` 指向外接存储，避免频繁写入路由器 Flash。
- 不要公开提交 API Key、用户数据、生成图片或私有发布包。
- ZIP、`dist`、依赖目录及本地运行数据已通过 `.gitignore` 排除。

## 上游与许可证

本项目保留上游项目的 Git 提交历史，并注明原项目来源：

- 上游项目：[libudu/LinAI](https://github.com/libudu/LinAI)
- 本项目：[Raindropx/openLinAI](https://github.com/Raindropx/openLinAI)

上游 `package.json` 声明许可证为 `ISC`，但仓库当前未包含独立的 `LICENSE` 正文文件。原项目代码的权利与授权范围以原作者的声明为准；本项目不会以此 README 替代或扩展原作者授予的许可。

在公开分发修改版二进制文件或将项目用于需要明确许可证合规的场景前，建议先向上游作者确认许可范围。

## 致谢

感谢 [libudu](https://github.com/libudu) 创建并公开 LinAI 项目。
