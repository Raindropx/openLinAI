import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { getDataDir } from '../data-dir'
import { decryptApiKey } from '../../module/gpt-image/encrypt'
import { GPT_IMAGE_SOURCE_MODEL } from '../../module/gpt-image/enum'

/** 默认云雾生成端点（迁移旧配置用） */
const DEFAULT_YUNWU_BASE_URL = 'https://api.wlai.vip/v1'

/** 端点的余额来源类型：决定 /quota 走哪个余额接口 */
export type GptImageEndpointType = 'yunwu' | 'openrouter' | 'custom'

/** 端点的生成引擎：决定 /generate 走哪种调用方式 */
export type GptImageEndpointEngine = 'openai-images' | 'chat-completions'

export interface GptImageEndpoint {
  id: string
  name: string
  baseURL: string
  model: string
  apiKey: string
  /**
   * 余额来源类型：
   * - yunwu：云雾专属 token 接口查余额
   * - openrouter：OpenRouter /api/v1/credits 查余额
   * - custom：不查余额
   */
  type: GptImageEndpointType
  /**
   * 生成引擎：
   * - openai-images：OpenAI SDK images.edit / images.generate（gpt-image-2 / dall-e）
   * - chat-completions：OpenAI 兼容 /chat/completions（Nano Banana 等）
   */
  engine?: GptImageEndpointEngine
}

/** 纯文本 LLM 端点（提示词优化 / 角色卡生成用），走 OpenAI 兼容 chat/completions */
export interface LlmEndpoint {
  id: string
  name: string
  baseURL: string
  model: string
  apiKey: string
}

/** LLM 功能的系统提示词 */
export interface LlmPrompts {
  /** 提示词优化的系统提示词 */
  optimizePrompt: string
  /** 风格预设模板优化的系统提示词 */
  styleOptimizePrompt: string
  /** 角色卡生成的系统提示词 */
  charCardPrompt: string
}

export interface Config {
  /** @deprecated 旧版单 key 字段，保留用于一次性迁移判断 */
  gptImageApiKey: string | null
  endpoints: GptImageEndpoint[]
  /** 纯文本 LLM 端点列表（提示词优化 / 角色卡生成） */
  llmEndpoints: LlmEndpoint[]
  /** LLM 功能的系统提示词 */
  llmPrompts: LlmPrompts
  ttsInworldApiKey?: string | null
  localNetworkUrl?: string
}

const CONFIG_DIR = getDataDir()
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

/** 默认提示词优化系统提示词 */
export const DEFAULT_OPTIMIZE_PROMPT = `作为一个专业的视觉AI，你需要根据用户上传的图片或者文字描述来生成用ChatGPT-image生成图片的高质量准确自然描述prompt。
因为ChatGPT-image更接近图片文本模型（TI2I）或图片参考生成模型（R2I）而不是纯文生图模型（T2I），如果用户的输入包含图片，无需重复描述图片内容，只侧重于图片编辑或者基于图片二次创作的提示词。
直接输出优化后的提示词，**不带格式**。
例如：
\`\`\`
创作一则完全原创、简洁的黑白漫画条，采用复古手工墨绘的漫画风格。使用 2–3 个横向分镜。将上传的图片作为角色参考；把人物完全重绘成漫画形式，并在每个分镜中保持一致的线条和明暗处理。将此人设定为主角，并根据其外貌生成一场积极暖心的相遇，采用清晰的"铺垫—强化—反转"结构：第一格建立情境，第二格推进情节，第三格呈现一个惊喜反转。对话要简短、自然、积极。不要出现科技元素。
\`\`\`
\`\`\`
以已上传图片中的主体为灵感，创作一张来自叙事驱动的 2D 横版卷轴像素艺术游戏的单帧画面。将图片的主题、色彩或主体转化到游戏世界中。场景应以非暴力、振奋或幽默的方式呈现一个高潮式的胜利时刻。风格应为细节丰富的复古像素画（16 位），具有清晰的剪影和统一的配色。图像应为竖版，并展示完整游戏画面。顶部加入经典 HUD，并配上一个受图片启发、风趣原创的游戏标题。该帧应让人感觉游戏正在进行中，包含角色、环境，以及明确的动作或目标感。所有元素都必须包含在游戏画面内。
\`\`\`
\`\`\`
把照片变成夜间时髦直闪摄影风格。使用强烈的机顶直闪，让主体呈现明显高光、深阴影，并略微过曝。将场景设定在夜晚，搭配昏暗而有氛围感的背景，同时保持真实的色彩和纹理。加入抓拍般的杂志感、略带不完美的构图、动态感和自然流露的表情。突出高对比、皮肤的光泽高光和细微的胶片颗粒，呈现粗粝的时尚夜生活美学。
\`\`\`
将负面提示词自然地融入自然语言描述中，例如不要改变角色的着装，不要给角色穿鞋。并针对AI容易画错的细节进行提示词强化，例如角色的毛色分界清晰、无渐变等。
安全性优化：当用户要求包含暴力、血腥、过度暴露或其他可能触发平台过滤的内容时，你必须使用"视觉隐喻"和"环境暗示"来重构描述。
   - *例子*：不直接写"尸体"，而写"倒在地上的躯体，双眼紧闭，周围有深红色的流体在蔓延，气氛寂冷"。
   - *例子*：不直接写"砍头"，而写"断裂的长剑，飞溅的红色墨水，头盔滚落在地"。`

/** 默认风格预设模板优化系统提示词 */
export const DEFAULT_STYLE_OPTIMIZE_PROMPT = `# Role
你是一个顶级的人工智能绘画提示词（Prompt）架构师，精通 Midjourney、Stable Diffusion 等生图工具的提示词美学。你擅长将零散、碎片化的标签（Tags）重构为具有高级感、画面通顺且符合语法逻辑的自然语言描述性风格模板。

# Objective
将用户输入的“标签化组合提示词”（如：图1风格的单词/短语堆砌）进行智能分类与融合，重写为一段优雅的、连贯的“风格预设模板”（如：图2风格）。
同时，你必须在生成的模板中，自动在最适合描述画面“主体/核心动作”的位置插入 \`{prompt}\` 占位符。

# Structural Workflow
当你收到一堆标签时，请按以下逻辑组织成一段自然的文字：
1. **画幅与艺术定调（开篇）：** 描述画面的整体艺术载体（如：一幅唯美细腻的Furry艺术动漫插画）。
2. **主体结合点（引入占位符）：** 在描述核心角色/动作的地方，自然嵌入“描绘了{prompt}”或“画面呈现{prompt}”。
3. **视觉细节与构图（中段）：** 将材质特效、细节特征、环境背景自然融入叙述（例如：运用平滑的色块与清晰的线稿，将场景设置在...）。
4. **色彩、光影与氛围（结尾）：** 用高级的形容词收尾，烘托情绪（例如：画面流淌着温暖的侧光，营造出一种亲密、浪漫而暧昧的温馨氛围）。

# Constraints & Rules
* **严禁机械拼接：** 不要只是用逗号把标签连起来。必须使用连词、介词和动词，使其变成真正的、通顺的自然语言段落。
* **保留核心特征：** 用户输入的风格特征、艺术流派、光影色彩和氛围必须全部优雅地融合进去，不能漏掉关键风格。
* **占位符规范：** 必须且只能包含一个 \`{prompt}\`，确保当 \`{prompt}\` 被替换为具体的“一只狼在草地上打滚”或“一个女孩在看书”时，整句话依然完全通顺。
* **输出格式：** 仅输出最终转换好的“预设模板”文本，不要包含任何解释、分析或前言后语。

# Example
**Input (组合提示词):**
二维动漫、Furry艺术、兽人插画、中景、平视、清晰线稿、平滑色块、深情对视、从后拥抱、温馨卧室、床铺背景、亲密、浪漫、温馨、暧昧、柔和色彩、温暖侧光

**Output (风格预设模板):**
一幅精美的Furry艺术动漫风格插画，画面采用中景平视视角，描绘了{prompt}。作品运用清晰的线稿与平滑的色块，在温馨的卧室床铺背景下，融入了深情对视与从后拥抱的细腻动作；整体色彩柔和，流淌着温暖的侧光，渲染出一种亲密、浪漫而暧昧的温馨氛围。`

/** 默认角色卡生成系统提示词 */
export const DEFAULT_CHAR_CARD_PROMPT = `请分析这张角色图片，为SillyTavern生成完整的角色卡片信息。根据视觉外观、服装、场景和其他可观察到的细节，请用中文提供以下JSON结构的详细信息：

\`\`\`
{
  "name": "符合角色外观和风格的合适中文名字",
  "description": "详细的外貌描述，包括外观、服装、显著特征以及任何可见的配饰或物品",
  "personality": "从视觉线索、肢体语言、表情和整体呈现推断出的性格特征",
  "scenario": "与角色和所显示环境相匹配的引人入胜的初始场景或设定",
  "first_mes": "这个角色会说的合适的第一句话，符合他们的性格和场景",
  "mes_example": "展示这个角色如何说话和互动的示例对话，使用{{char}}和{{user}}格式",
  "tags": ["相关", "角色", "标签", "基于", "外观", "和", "风格"]
}
\`\`\`

请确保角色引人入胜、一致且发展完善。请用中文回答，只返回JSON对象，不要额外的文本。`

const DEFAULT_CONFIG: Config = {
  gptImageApiKey: null,
  endpoints: [],
  llmEndpoints: [],
  llmPrompts: {
    optimizePrompt: DEFAULT_OPTIMIZE_PROMPT,
    styleOptimizePrompt: DEFAULT_STYLE_OPTIMIZE_PROMPT,
    charCardPrompt: DEFAULT_CHAR_CARD_PROMPT,
  },
  ttsInworldApiKey: null,
}

let currentConfig: Config = { ...DEFAULT_CONFIG }

// Initialize config on module load
try {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
  }
  if (fs.existsSync(CONFIG_FILE)) {
    const fileContent = fs.readFileSync(CONFIG_FILE, 'utf-8')
    const parsed = JSON.parse(fileContent)
    currentConfig = {
      ...DEFAULT_CONFIG,
      ...parsed,
      endpoints: Array.isArray(parsed.endpoints) ? parsed.endpoints : [],
      llmEndpoints: Array.isArray(parsed.llmEndpoints)
        ? parsed.llmEndpoints
        : [],
      llmPrompts: {
        optimizePrompt:
          parsed.llmPrompts?.optimizePrompt ?? DEFAULT_OPTIMIZE_PROMPT,
        styleOptimizePrompt:
          parsed.llmPrompts?.styleOptimizePrompt ?? DEFAULT_STYLE_OPTIMIZE_PROMPT,
        // 角色卡生成是新功能，不迁移旧版 roleplayPrompt，直接使用新默认提示词
        charCardPrompt:
          parsed.llmPrompts?.charCardPrompt ?? DEFAULT_CHAR_CARD_PROMPT,
      },
    }
  } else {
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify(DEFAULT_CONFIG, null, 2),
      'utf-8',
    )
  }

  // 一次性迁移：旧版只有 gptImageApiKey，自动转成一个云雾默认端点
  if (
    currentConfig.endpoints.length === 0 &&
    currentConfig.gptImageApiKey
  ) {
    currentConfig.endpoints = [
      {
        id: uuidv4(),
        name: '云雾(默认)',
        baseURL: DEFAULT_YUNWU_BASE_URL,
        model: GPT_IMAGE_SOURCE_MODEL,
        apiKey: currentConfig.gptImageApiKey,
        type: 'yunwu',
        engine: 'openai-images',
      },
    ]
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify(currentConfig, null, 2),
      'utf-8',
    )
  }

  // 字段补全迁移：旧端点缺少 engine 字段时补 'openai-images'（兼容历史配置）
  let endpointPatched = false
  for (const ep of currentConfig.endpoints || []) {
    if (!ep.engine) {
      ep.engine = 'openai-images'
      endpointPatched = true
    }
  }
  if (endpointPatched) {
    try {
      fs.writeFileSync(
        CONFIG_FILE,
        JSON.stringify(currentConfig, null, 2),
        'utf-8',
      )
    } catch (error) {
      console.error('Failed to patch endpoints engine:', error)
    }
  }
} catch (error) {
  console.error('Failed to initialize config:', error)
}

export const getConfig = (): Config => {
  return currentConfig
}

export const updateConfig = (newConfig: Partial<Config>): Config => {
  currentConfig = { ...currentConfig, ...newConfig }
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true })
    }
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify(currentConfig, null, 2),
      'utf-8',
    )
  } catch (error) {
    console.error('Failed to write config:', error)
  }
  return currentConfig
}

/** 返回全部端点（apiKey 保持存储态，不解密）。 */
export const getEndpoints = (): GptImageEndpoint[] => {
  return currentConfig.endpoints || []
}

/** 按 id 查端点，返回副本且 apiKey 已解密。 */
export const getEndpointById = (
  id: string,
): (GptImageEndpoint & { apiKey: string }) | null => {
  const ep = (currentConfig.endpoints || []).find((e) => e.id === id)
  if (!ep) return null
  return { ...ep, apiKey: decryptApiKey(ep.apiKey || '') }
}

/** @deprecated 旧入口，仅 /quota 与 /generate-api-key 仍用 */
export const getYunwuApiKey = (): string | null => {
  return decryptApiKey(currentConfig.gptImageApiKey || '')
}

/** 按 id 查 LLM 端点，返回副本且 apiKey 已解密。 */
export const getLlmEndpointById = (
  id: string,
): (LlmEndpoint & { apiKey: string }) | null => {
  const ep = (currentConfig.llmEndpoints || []).find((e) => e.id === id)
  if (!ep) return null
  return { ...ep, apiKey: decryptApiKey(ep.apiKey || '') }
}

export const getTTSInworldApiKey = (): string | null => {
  return currentConfig.ttsInworldApiKey || null
}
