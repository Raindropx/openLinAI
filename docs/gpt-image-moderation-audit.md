# GPT 图片审核参数核对

核对日期：2026-11-01。范围是项目全部图片预设和 9 种图片引擎的审核选项、生成/编辑请求传参，不是服务商生成效果评测。本次没有提交真实付费生成请求。

仓库本地 `data/config.json` 的端点列表为空，本机 3000 端口没有可访问的配置接口。因此下表不表示已验证用户部署中的实际配置或密钥权限。

## 引擎与线路

| 引擎/线路           | 检查结果及项目行为                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openai-images`     | [OpenAI 生成](https://developers.openai.com/api/reference/resources/images/methods/generate)和[编辑](https://developers.openai.com/api/reference/resources/images/methods/edit)均支持 `moderation: auto/low`。项目只对实际模型 ID 含 GPT（不区分大小写）的请求发送，默认 `low`。第三方兼容接口是否落实参数仍需区分服务商。                                                                                                                                                                                       |
| `laozhang-images`   | 修复原先遗漏的设置显示与 JSON/表单传参。GPT 线路的生成、编辑默认 `low`，可选 `auto` 或不发送；Gemini、Seedream、Grok 分支不附带此字段。[GPT Image 2](https://docs.laozhang.ai/en/api-capabilities/gpt-image-2)和[2.5](https://docs.laozhang.ai/en/api-capabilities/gpt-image-2-5)文档区分官转、VIP、Web 线路，但未明确保证所有线路都执行该参数。因此目前是可选透传，不能承诺效果。旧的老张地址配合聊天式引擎会自动转到老张适配器，也覆盖这个入口。                                                               |
| `apimart-images`    | [GPT Image 1/1.5 官转](https://docs.apimart.ai/en/api-reference/images/gpt-image-1/generation)、[GPT Image 2 官转](https://docs.apimart.ai/en/api-reference/images/gpt-image-2/official)、[GPT Image 2.5 Flare/Sunburst](https://docs.apimart.ai/en/api-reference/images/gpt-image-2.5/generation)明确列出 `moderation`，现已接入设置和请求，默认 `low`。普通 `gpt-image-2`、`gpt-image-2-ext`、`gpt-image-2.5-ext` 不套用官转参数。原有尺寸、画质、参考图及模型目录校验继续适用；本次未扩展这些模型的其他能力。 |
| `openrouter-images` | [当前 OpenAPI](https://openrouter.ai/openapi.json)的 `ImageGenerationRequest` 没有统一的 `moderation` 属性。服务商特有透传需另核对路由允许列表；当前隐藏这个 GPT 选项，不向 `/images` 盲传。不能据此断言所有下游都不支持。                                                                                                                                                                                                                                                                                       |
| `venice-images`     | [生成](https://docs.venice.ai/api-reference/endpoint/image/generate)、[编辑](https://docs.venice.ai/api-reference/endpoint/image/edit)和[多图编辑](https://docs.venice.ai/api-reference/endpoint/image/multi-edit)使用原生 `safe_mode`。现有代码已经在三条请求里传 `false`，本次不改为 GPT `moderation`。该字段控制 Venice 自身的安全模式，不等同于关闭模型的全部审核。                                                                                                                                          |
| `spicyapi-images`   | [官方概览](https://docs.spicyapi.ai/docs/overview)明确说明没有必需的内容模式请求开关。项目按模型 `inputSchema` 校验原生任务输入，不插入 GPT `moderation`。                                                                                                                                                                                                                                                                                                                                                       |
| `gemini-images`     | 使用自己的分类阈值 `safetySettings`，[Google 安全设置](https://ai.google.dev/gemini-api/docs/safety-settings)与 GPT 的两个档位不是相同接口。保留现有 Gemini 安全过滤控件，不显示 GPT 选项。                                                                                                                                                                                                                                                                                                                      |
| `novelai-images`    | 使用 [NovelAI Diffusion](https://docs.novelai.net/en/image/)及原生请求体，不使用 GPT 图片模型，不显示或传递 GPT 审核参数。                                                                                                                                                                                                                                                                                                                                                                                       |
| `chat-completions`  | 普通聊天式图片接口的现有请求使用消息和 `image_config`，没有已接入的统一 GPT `moderation` 契约，隐藏选项。已识别的老张旧配置例外：实际走老张适配器，按上述老张规则处理。                                                                                                                                                                                                                                                                                                                                          |

## 项目内服务商预设

老张 GPT Image 2 VIP、2.5 Web、2.5 Flare VIP、2.5 Sunburst VIP 显示选项；老张 Nano Banana、Seedream、Grok 不显示。APImart 默认 GPT Image 2 预设属于普通线路，不显示；手动选用文档明确支持的官转模型时显示。APImart Nano Banana、OpenRouter Gemini、SpicyAPI Seedream/Qwen、NovelAI、Gemini 原生和 Pollinations Zimage 不显示。

OpenLux、Dragon3API 和 New API 自定义 GPT 端点走 `openai-images`，项目提供参数透传，但仍不能保证服务商执行。[OpenLux 文档入口](https://doc.openlux.ai/)和[Dragon3API 网站](https://dragon3api.com/)本次未取得可核对的具体参数契约，支持状态保留为未确认，不等同于不支持。

## 默认值、失败与验证

- 适用线路的文生图和参考图编辑默认 `low`；选择“不发送”时，请求里没有 `moderation` 字段。服务商仍可能自行设置默认值，例如 APImart 2.5 文档说明未传时它也会向上游发送 `low`。
- 任一生成/编辑模型适用时显示端点选项；实际传参以当前请求使用的模型和适配器为准，避免切换到非 GPT 模型后误带残留设置。
- 不通过付费生图自动探测支持情况，不在参数错误后自动重提。接受请求不等于实际执行审核档位。
- 本地模拟测试覆盖引擎显示矩阵、默认/auto/low/不发送、JSON 和 multipart、混合生成/编辑模型、非 GPT 分支无污染、参数拒绝不自动重试，以及老张与 APImart 的两个生成入口。
