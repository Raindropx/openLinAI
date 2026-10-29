# 视频生成：架构与实施说明

## 仓库审查与范围

- React 19 / Ant Design / Zustand，Vite 前端；Node / Hono 后端。现有图片 provider 位于 `src/server/module/gpt-image/`，图片端点和工作室密钥分别使用现有服务端配置。
- 图片任务使用 `TaskManager`、`tasks.json`、任务分页目录和资源事件；`SafeJsonStore` 串行更新并通过临时 JSON 文件原子替换。原图片任务重启后失败，视频任务增加单独的恢复规则。
- 图库已有输入图／生成图 URL、上传大小／内容验证和引用回收保护。工作室暂存台有 UUID 文件与独立索引。视频选图复用已有上传流程，把图库或暂存台图片复制成受控输入图；输入引用保存在原任务模板及视频请求中。
- 图片服务适合图片，不具备本地视频所需的 Range 语义。现有 ZIP 下载已使用流式传输；视频复用 Node 流和现有 HTTP 服务，新增文件响应，不使用图片 Buffer 服务承载视频。
- OpenWrt 通过 procd → `run.sh` → 单文件 Node 后端启动，`DATA_DIR` 重定向到外接存储。现有图片处理可能使用 ffmpeg；新增视频功能不调用 ffmpeg、不解码、不转码。
- 当前项目没有内置账号认证、租户归属或通用 CSRF 系统，只适用于可信网络或有认证的前置代理。视频接口与任务接口处于同一访问边界；新增视频写操作要求 JSON 并校验 Origin / Fetch Metadata。它没有实现多用户隔离，也不能据此声称跨用户鉴权测试通过。
- 没有通用测试入口（`pnpm test` 是占位失败），验证使用 `scripts/test-*.ts`。仓库没有 `.github` CI 配置。本次遵循 AGENTS.md：安装依赖仅 pnpm；不运行 build / eslint；代码完成后仅 `npx tsc --noEmit` 检查类型。

## 分阶段实现

1. 在原 Task 上扩展 `mediaType` / `video`，复用任务记录、目录、通知和图库；工作室新增视频标签、统一任务列表使用视频卡片。建立 provider 接口和显式 mock，支持文生视频、图生视频、参考生成、参数验证、后台轮询和重启恢复。
2. 加入独立取回队列、外接存储检查、受控远端下载、临时文件和 Range 文件服务；前端按实际文件存在情况选择来源。配置与部署说明、安全和失败路径测试一同交付。
3. 真实服务商适配、更多参数、音视频素材上传、可靠断点续传、自动取回、存储清理策略可按确认的接口文档继续扩展。

首尾帧、参考生成和默认收起暂存台是本轮追加的交互要求，已包含在 Phase 1 的模型与界面中。

## 三种统一生成模式

- `text_to_video`：文本生成视频。
- `image_to_video`：首帧或首尾帧。`frameMode` 声明模式，`frames.firstImageUrl` / `lastImageUrl` 保留角色，`inputImages` 按首帧、尾帧排序。能力不支持的模式不能提交。
- `reference_to_video`：H3 Ref2VA、Seedance / Wan 等端点的参考生成共用此入口。`references` 保存有序的图片／视频／音频引用，端点适配器映射到自身字段，按真实模型能力声明素材类型、数量和参数；不能将参考图片隐式作为首帧。

当前图片可通过上传、图库和暂存台输入。参考音频／视频暂时使用公开 HTTPS URL，需管理员将其精确域名加入允许列表；它们不会通过取回接口变成任意 URL 下载。音视频素材的本地上传、时长读取及各真实 provider 的时长限制校验尚待对应适配实现；mock 不会读取这些素材或生成新内容。

参考的公开规范／实现：

- [MiniMax H3 官方仓库：FL2VA 和 Ref2VA](https://github.com/MiniMax-AI/MiniMax-H3#model-variants-and-input-specifications)
- [ComfyUI 官方 Seedance 首尾帧节点说明](https://github.com/Comfy-Org/embedded-docs/blob/main/comfyui_embedded_docs/docs/ByteDanceFirstLastFrameNode/en.md)
- [阿里云 Wan 首尾帧 API 说明](https://www.alibabacloud.com/help/en/model-studio/image-to-video-general-api-reference)

这里只借鉴角色分离与能力约束；未复制外部实现，也没有把不同厂商的生产字段混用。真实 API 尚未配置或验证；没有实际生成调用和费用。

## Provider 接入

`src/server/module/video/providers.ts` 定义 `getCapabilities`、`submitGeneration`、`getGenerationStatus`、`getResult` 和可选 `cancelGeneration`。适配器必须把服务商状态映射到统一状态；提交不能自动重试，以免重复扣费。凭证只保存在服务端。不同模型能力不同时，使用独立的端点／模型适配实例并准确声明能力，不把同一厂商所有模型视为具有相同能力。

新增真实 provider 之前必须确认：生产 API 文档、区域与鉴权、模型 ID、能力、素材上传／公开可访问方式、提交与查询字段、状态映射、URL 获取／刷新与有效期、结果 CDN 域名及重定向、计费和取消行为。云端无法访问路由器内网图片 URL；适配器必须按文档上传图片字节或转换为服务商接受的形式。

未取回时仅支持不需要私密请求头的浏览器可访问视频链接。未来需要私密头的 provider 必须实现受控播放代理或换取短时公开结果链接，再声明为可用；不得把密钥拼进浏览器配置。

## 状态、来源与重启

生成状态与取回状态独立。取回失败不改变生成成功状态。视频 `outputUrls` 保持为空，避免图片组件、图片 ZIP 下载误处理视频；视频卡片提供单独下载按钮。

| 状态 | 播放 | 下载到用户设备 | 取回 |
| --- | --- | --- | --- |
| 成功、未取回 | 浏览器直连有效云端 URL | 同源受控流式 cloud-download（attachment） | 可加入后端队列 |
| 等待／正在取回 | 继续使用有效云端 URL | 继续使用云端下载代理 | 展示字节／百分比，可取消 |
| 已取回且文件存在 | 本地 `/file`，支持 Range | 本地 `/download`，attachment | 已取回 |
| 文件丢失／磁盘离线 | 检查云端可用性后回退 | 有效云端下载代理 | 标记本地不可用，可重试 |
| 云端已过期且本地不可用 | 明确提示错误 | 明确提示错误 | 尝试刷新链接后重试 |

后台启动恢复远端任务查询；提交中但没有远端 ID 的任务标为不确定失败，要求核对云端后手动重试。有远端 ID 的重试沿用 ID 恢复查询。远端 API 最多同时查询两个任务，成功查询后至少间隔 10 秒；查询异常指数退避，连续五次失败停止自动查询。生成队列上限 32。

取回队列默认并发 1（最大 4）。进度最多每 5 秒保存一次，状态边界立即保存，避免逐块写 JSON。重启后正在取回的任务重新排队，从头下载，清理该任务 `.part`。重命名前记录验证后的总字节数；如果服务在 rename 后、任务提交前中断，可以按最终文件大小恢复状态。没有可靠验证条件的完整文件不会被直接信任或覆盖。

播放使用 `preload="none"`，点击预览后才赋予视频 src；离开可视区暂停，播放一个卡片时暂停其他卡片。视频页暂存台复用拼豆的折叠布局，初始收起，切换标签保留折叠状态。

## 存储与网络

详见根目录 `.env.video.example`。默认不启用真实或 mock provider；域名允许列表默认空。

- `VIDEO_STORAGE_DIR`：必须是已存在的绝对目录。程序不会自动创建它，避免外接盘未挂载时误写底层目录。
- `VIDEO_PUBLIC_ORIGIN`：HTTPS 在认证反向代理终止时，设置浏览器实际访问的精确 origin，用于视频写请求的同源校验。开发代理为视频路由保留原 Host；nginx 示例也保留 Host 的端口。
- `VIDEO_STORAGE_MOUNT`：Linux 必须指定实际外接挂载点；每次写入前检查 `/proc/self/mountinfo`、根目录所在设备与文件系统，拒绝根文件系统、overlay、tmpfs。
- `VIDEO_MAX_FILE_BYTES`：默认 1 GiB，硬上限 8 GiB。`VIDEO_MIN_FREE_BYTES` 默认保留 128 MiB。已知 Content-Length 在开始前检查空间，传输每 4 MiB 再检查；磁盘满不应阻止已有本地文件的只读播放或删除。
- `VIDEO_TRANSFER_TIMEOUT_MS`：默认 30 分钟，硬上限 2 小时，另有 30 秒网络空闲超时。
- `VIDEO_GENERATION_TIMEOUT_MS`：生成查询默认最多持续 6 小时，硬上限 24 小时；超时后停止自动查询，手动恢复沿用远端 ID 并开启新等待周期。
- `VIDEO_ALLOWED_HOSTS`：精确域名列表，包含所需 CDN 与重定向目标；只接受 HTTPS / 443，拒绝 URL 凭据和 IP 字面量。解析结果全部必须是允许的公网地址，实际 TLS 请求固定到已验证 IP，每一跳重定向重新验证，最多 4 跳。
- 取回仅接受已存在的任务 ID，从该任务的结果获取地址，不接受客户端传入任意下载 URL。云端设备下载代理另外限制最多两个并发。
- 流经背压控制、大小限制与 MP4/WebM 容器头检查，已知总长度须匹配；视频不整体读入内存，也不存 Base64。验证后 fsync 文件并在同目录 rename。文件 ID 使用 UUID，真实路径不下发；文件访问检查根目录、符号链接并使用 `O_NOFOLLOW`（平台支持时）。
- 本地响应支持完整 GET、HEAD、单个 closed/open/suffix Range；有效 Range 206，不能满足／不支持的多 Range 416。下载使用 attachment 和明确 MIME。
- 本地文件与任务记录可分别删除；保留文件而删除记录会产生只能从磁盘手动访问的归档。删除记录不等于取消云端任务。

任务 ZIP 备份包含视频元数据与参考图片，不含大型视频文件；界面明确提示。恢复会清除本地视频 ID 和取回状态，防止备份指向其他任务文件。长期备份请单独保存视频目录。

## 验证与手动验收

自动化脚本：`pnpm exec tsx scripts/test-video.ts`，以及现有工作室、Civitai、图片文件服务、任务备份／文件夹和流式下载回归脚本。最后运行 `npx tsc --noEmit` 与 `git diff --check`。实际执行结果另见本轮交付说明；这里的命令列表不代表已经执行。

手动验收：

1. 配置一个自己控制的公开 HTTPS MP4/WebM 为 `VIDEO_MOCK_RESULT_URL`，设置域名允许列表；创建外接目录，配置存储并重启服务。mock 明确显示为模拟任务。
2. 工作室 → 视频生成。验证默认收起暂存台、首帧／首尾帧两种 I2V、参考素材顺序与不同类型。mock 不验证模型生成质量或素材时长。
3. 提交后关闭浏览器，再打开任务列表检查后台完成；服务重启后核对远端 ID 与取回状态。
4. 完成后云端预览，浏览器 Network 应直接请求结果域名；下载通过同源流式 attachment。点击取回期间仍能播放，完成后 src 切换本地；拖动检查 Range 206。
5. 关闭浏览器期间取回应继续。磁盘卸载、网络断开、链接 403/404、过期、空间不足应显示错误，不能出现未验证的正式文件；重新挂盘后可重试。
6. 分别验证只删本地文件、只删记录、全部删除；备份恢复不会错误关联旧视频文件。

未验证项：真实服务商生成、真实浏览器编解码／跨域行为、OpenWrt 实机挂载拔插和内存占用、断电恢复，以及多用户访问控制（项目尚无账号体系）。

## 本轮验证记录（2026-10-29）

以下命令均已执行并通过：

| 命令 | 结果 |
| --- | --- |
| `pnpm exec tsx scripts/test-video.ts` | 三种模式、首尾帧、有序混合参考、输入引用保护、恢复、独立状态、取回／取消／重试／并发、来源回退、Range／HEAD／attachment、IP／URL／路径策略、同源写请求、备份恢复隔离通过。200 MiB 模拟远端流写入实际隔离目录文件，本次 RSS 峰值增量约 10.1 MiB。 |
| `pnpm exec tsx scripts/test-studio.ts` | 原工作室素材与上传流程通过。 |
| `pnpm exec tsx scripts/test-civitai-studio.ts` | Civitai 图片任务与恢复流程通过。 |
| `pnpm exec tsx scripts/test-image-serving.ts` | 图片完整性、HEAD、缩略图、流式响应与取消通过。 |
| `pnpm exec tsx scripts/test-task-backup.ts` | 普通及流式任务备份／恢复与回滚通过。 |
| `pnpm exec tsx scripts/test-task-folders.ts` | 文件夹、批量移动、并发与下载路径通过。 |
| `pnpm exec tsx scripts/test-stream-download.ts` | 流式 ZIP 下载、长度、重试、背压与取消通过。 |
| `npx tsc --noEmit` | 最终类型检查通过。 |
| `git diff --check` | 通过；仅有工作区既有换行策略的 LF/CRLF 提示。 |

Edge + Vite 开发服务器使用独立临时 DATA_DIR 核验了工作室入口、暂存台初始收起／展开、首尾帧独立输入、统一参考面板、mock 浏览器提交成功和统一任务列表渲染。没有调用真实生成 API，没有部署、构建、创建 tag、提交或推送。
