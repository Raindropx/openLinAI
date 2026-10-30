# 视频端点管理与协议

入口：**工作室 → 视频生成 → 生成参数右上角「视频端点设置」**。

设置界面沿用图片端点的「选择端点 / 新增 / 从预设新增 / 更新」结构。已有端点与连接预设分开；预设只填入连接配置和一个起始模型，不直接创建已保存端点。填写 Key 后更新或保存，才会出现在端点列表和视频页中。每个端点保存一个模型及其能力，可为同一服务商添加多个模型端点。

服务商预设合并为 14 项，同一协议和 API Base 下仅模型 ID 不同的合并为一项。老张的 Seedance/Wan、OpenLux 的 MiniMax/Seedance/Wan/Omni 使用不同协议或地址，所以分别保留。原有 67 项模型资料仅用于模型候选与参数默认值；不会改动已经保存的端点。

填写 API 地址和 Key 后自动探测视频模型目录，无需先填写端点名称或模型 ID。模型输入框可搜索、选择、手填；目录请求失败也可手填保存。Civitai 无视频模型目录接口，使用内置候选和手填。通用 `/models` 目录会过滤明确的聊天/图片模型，识别视频元数据或常见视频模型 ID。参数区默认展开，可编辑生成模式、关键帧、时长、分辨率、比例和素材上限；选择目录模型时使用返回的参数。已有端点不会因自动刷新而覆盖保存的参数。

保存配置不会强制访问模型目录，也不会提交付费生成；SpicyAPI 在实际生成前仍会检查当前模型定义。

模型和接口资料核对日期：2026-10-30。预设是配置起点，账号权限、令牌分组和供应商变更仍以其当前目录为准。没有使用真实凭证提交付费生成任务。

| 服务商 | 实现的协议与资料 |
| --- | --- |
| SpicyAPI | Jobs createTask / recordInfo、实时模型 schema、沿用已有的签名上传流程。覆盖 H3、H3 HighSpeed、Seedance 2.0 / Fast / 2.5、Wan 3.0，各模式分别使用模型 ID。[H3](https://spicyapi.ai/models/minimax-h3)、[HighSpeed](https://spicyapi.ai/models/minimax-h3-highspeed)、[参考模式](https://spicyapi.ai/models/minimax-h3/reference-to-video) |
| OpenRouter | `/videos` 创建、查询和受控内容读取。采用实时视频目录中的 ID（例如 `minimax/hailuo-3`），不把页面显示名直接当作 ID。[协议](https://openrouter.ai/docs/guides/overview/multimodal/video-generation)、[实时视频目录](https://openrouter.ai/api/v1/videos/models) |
| Venice | `/video/queue` 与 `/video/retrieve`，`delete_media_on_completion=false`。参考图与固定首尾帧分别映射。[创建](https://docs.venice.ai/api-reference/endpoint/video/queue)、[取回](https://docs.venice.ai/api-reference/endpoint/video/retrieve) |
| OpenLux | MiniMax V2 `content` 多模态任务；Ark 原生 Seedance 路由；`alibailian` Wan 路由；Omni 统一 create/query 路由。[MiniMax](https://doc.openlux.ai/en/reference/v1/minimax/v2/video_generation)、[Omni](https://doc.openlux.ai/en/reference/omni) |
| 老张 | Seedance `/seedance/api/v3/contents/generations/tasks`（需要 SeeDance2 分组）；Wan 创建 `/wan/api/v1/services/aigc/video-generation/video-synthesis`，查询 `/v1/tasks/{id}`。[Seedance](https://docs.laozhang.ai/api-capabilities/seedance2-video-generation)、[Wan](https://docs.laozhang.ai/api-capabilities/wan-video-generation) |
| Google 官方 | Gemini Omni Flash Interactions，显式 `delivery: uri`，保留文件 ID，轮询文件状态并通过服务端带 Key 读取文件。响应只接受有大小上限的元数据，不将大型 Base64 视频写入任务 JSON。时长通过提示词表达，以实际输出为准。Veo 3.1 Preview 已于 2026-10-22 停用。[官方说明](https://ai.google.dev/gemini-api/docs/video)、[URI delivery](https://ai.google.dev/gemini-api/docs/omni#retrieving-videos-with-an-uri) |
| Grok 官方 | xAI `/videos/generations` → `/videos/{request_id}`；图生视频、参考图片及支持模型的首尾帧。[官方说明](https://docs.x.ai/developers/model-capabilities/video/generation) |
| Civitai red | 复用官方 Orchestration v2 服务，`videoGen` 工作流，H3、H3 HighSpeed、H3 Comfy Turbo、Seedance、Wan 引擎。red 不是另一个臆造的 REST 地址，成熟内容开关独立选择；Seedance `images` 作为参考素材，不宣称是首尾帧。[当前 OpenAPI](https://orchestration.civitai.com/openapi/v2-consumers.json)、[官方开发文档源码](https://github.com/civitai/civitai-developer-docs) |
| LeaderAI | 提供默认停用的待配置预设。尚无可核验的视频提交/查询合同，需确认实际 API Base、协议与模型 ID 后启用；不声称其聊天接口天然兼容视频。 |
| FastH3 | 单独提供 FastVideo 协议的待配置预设，默认停用。FastH3 不等于 H3 HighSpeed，也不把 Civitai Turbo 自动标为 FastH3。填写真实 HTTPS 服务地址及模型 ID；请求使用服务端默认采样、时长和尺寸，不套用 Sora 的尺寸和时长。[FastVideo 协议](https://github.com/hao-ai-lab/FastVideo/blob/main/docs/cookbook/openai-api.md) |

## 凭证、任务与媒体

- 设置独立保存在 `DATA_DIR/video-endpoints.json`，不会混入图片或 LLM 端点配置。Key 保留在服务端，GET 设置仅返回是否已保存及掩码；编辑时留空保留原 Key。修改 API 地址或协议需要重新输入 Key。
- 有关联任务时不能改协议、地址、模型或能力，也不能直接删除端点；可停用、改名或轮换 Key。需要改协议时新增端点，保留旧端点用于历史任务查询和取回。
- API 使用 HTTPS、公网 DNS/IP 验证与固定解析地址连接，不将 Key 随重定向发送给 CDN。结果需要鉴权时，由服务端从配置端点读取，浏览器拿不到 Key。
- 「视频与参考素材域名」填写精确域名，不支持通配符。原 `VIDEO_ALLOWED_HOSTS` 环境变量继续生效。新 CDN 未批准时，生成成功记录仍保留；来源区提示需要添加的域名，再到端点设置补充。所有实际媒体访问仍检查允许列表、DNS 和每一跳重定向。
- 本地参考图片转换为服务商接受的 Data URL，SpicyAPI 使用已实现的签名上传流程；不把内网图片路径直接交给云端。
- 不自动重试提交生成任务。SpicyAPI 使用本地任务 ID 作为幂等键，Civitai 使用 `externalId`；超时或响应丢失后仍要求先核对云端任务。

## Fake-IP 代理兼容

正常网络仍使用系统 DNS，不访问额外解析服务。仅当系统返回 `198.18.0.0/15` 的 Fake-IP 地址，且未混入其他内网地址时，视频 API 和媒体请求才使用加密 DNS 获取真实地址。固定公网 IP 引导 Cloudflare / Google DoH，避免解析服务自身也被 Fake-IP 替换；发送的只有域名，不包含 API Key、路径、提示词或视频签名参数，并关闭客户端子网信息。接口依据 [Cloudflare JSON DoH](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/) 和 [Google JSON DoH](https://developers.google.com/speed/public-dns/docs/doh/json)。

回退查询最多 8 秒，成功结果按 DNS TTL 缓存且不超过 60 秒。取得真实地址后继续检查所有 IP，并固定实际连接地址；不会直接放行 Fake-IP、内网地址或关闭 TLS 证书验证。回退服务不可用时显示具体原因；公网解析正常的连接不依赖这些服务。已有代理仍通过操作系统或路由器的网络路由处理，本功能不设置或更改系统代理。

## 本地验证

`scripts/test-video-endpoints.ts` 使用独立临时目录和假传输，验证预设 schema、Key 不回显与留空保留、地址变更、任务绑定保护、各协议参数角色、状态映射、Google URI 恢复、受控下载标记及 Hono 设置接口。已有 `scripts/test-video.ts` 和 `scripts/test-video-resume.ts` 用于视频队列、范围请求、媒体边界、恢复与断点续传回归。

`scripts/test-video-network.ts` 使用假 DNS 和 HTTPS 传输，验证正常网络不触发回退、Fake-IP 解析、私网和混合地址拒绝、重定向拦截、固定 IP 连接、密钥隔离、DoH 响应与缓存，以及回退不可用时普通公网连接仍可工作。

这些测试不代表已验证各服务商的真实计费生成、账号权限或视频质量。
