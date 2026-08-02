# openLinAI 项目记忆

> 用途：把本项目的关键决策、已验证结果和续作注意事项带到另一台机器或新的 Codex 任务中。
> 
> 快照日期：2026-08-03

## 当前状态

- 项目：openLinAI，版本 `1.2.0`。
- 当前分支：`v1.2.0`。
- 当前提交：`4d1ce33 Enforce character card size limits and serialize image mutations`。
- 工作区：导出本文件前无未提交改动。
- 远端：`origin/v1.2.0` 与当前提交一致；当前分支相对 `origin/main` 为 `0` 个远端领先、`3` 个本地领先提交。
- 最近工作重点：角色卡尺寸限制与图片变更串行化；此前已完成图片生成引擎和 Nano Banana 图片比例兼容。

## 项目约束

这些约束来自仓库 `AGENTS.md`，在新环境继续工作前应先重新确认：

- 安装依赖使用 `pnpm`。
- 日常开发、检查和验证不要运行 `build`。
- 只有用户明确要求 Release 或部署产物时，才运行对应的 `pnpm build:*SkipTag`，不要运行会自动创建 Git Tag 的构建命令。
- 所有代码编写完成后，类型检查只使用 `npx tsc --noEmit`；不要运行 eslint。
- Windows 若 PowerShell 执行策略阻止 `npx.ps1`，可使用等价的 `npx.cmd tsc --noEmit`，不修改执行策略。

## 已完成的关键工作

### 1. OpenRouter 专用图片引擎

- 保留原有 chat 图片路径，同时新增专用 `openrouter-images` 引擎。
- OpenRouter 图片接口是 `POST /api/v1/images`；模型能力可从 `/api/v1/images/models` 和 endpoint 记录获取。
- `resolution`、`aspect_ratio`、`quality`、`n`、`input_references` 都是模型相关能力，不能假设所有模型都支持。
- 引擎会查询并缓存能力，将参考图映射到 `input_references`，按模型的 `n` 上限拆分请求，并保存 base64/URL 输出。
- `src/server/module/gpt-image/chat-image.ts` 通过 `image_config` 传递图片配置。
- Recraft 向量模型会返回 SVG，相关持久化不能只按栅格图片处理。
- 相关历史提交：`813c002`（OpenRouter 图片接口支持）。

### 2. `recraftV` 鉴权问题

- 历史诊断中，目录接口 `/api/v1/images/models` 可以返回 200，但同一保存端点的 `/api/v1/credits` 报 `Missing Authentication header`；对比端点的 credits 请求正常。
- 现有证据更支持保存的 `recraftV` API key 无效、错误或过期，而不是模型不支持或应用丢失 Authorization。
- 继续处理时应替换为有效 key 后重测额度和实际生成；任何日志、摘要或截图都不得输出完整 key。
- 历史本地服务地址为 `192.168.8.1:3000`，迁移到其他机器后必须重新确认，不能把它当作永久配置。

### 3. Nano Banana 图片比例兼容

- 兼容逻辑位于 `src/server/module/gpt-image/chat-image.ts`。
- 对 Nano Banana/Gemini 图片系列，仅在发送 `image_config.aspect_ratio` 前做最小映射：
  - `2:1` -> `16:9`
  - `1:2` -> `9:16`
  - `9:21` -> `9:16`
- `auto` 仍然省略；非 Nano Banana 模型的原始比例保持不变。
- 当前匹配覆盖整组系列及别名，包括 `nano-banana`、`gemini-2.5-flash-image`、`gemini-3-pro-image`、`gemini-3.1-flash-image`、`gemini-3.1-flash-lite-image`。
- 对完全不透明的自定义别名，不要继续猜名字；如果服务返回 `aspect_ratio invalid_value`，更稳妥的是基于错误响应做一次兼容重试。
- 历史相关提交：`e1c11b8`、`d2fd098`。

## 当前代码续作提示

- 近期角色卡改动涉及：
  - `src/server/api/common/character-card.ts`
  - `src/server/common/character-card-manager/index.ts`
  - `src/server/index.ts`
- 角色卡与图片相关的大范围前端改动已在 `990636e` 引入；继续修改前应先阅读当前实现和 `git log`，不要按旧记忆盲目套补丁。
- 任何图片模型能力、OpenRouter provider 行为、端点额度和远端分支状态都可能变化；记忆只提供方向，当前代码、当前配置和实时接口结果优先。

## 推荐续作流程

1. 先检查 `AGENTS.md`、当前分支、工作区和远端差异。
2. 只阅读与目标功能直接相关的模块和历史提交。
3. 小范围修改保持现有引擎、前端选项、超时和输出行为不变。
4. 不打印 API key；网络诊断只保留脱敏后的状态码、错误码、provider/model 和请求 ID。
5. 所有代码完成后运行 `npx tsc --noEmit`，必要时再运行 `git diff --check`；日常任务不要运行 build 或 eslint。
6. 发布或同步前重新确认远端分支，不要假设历史中的 `main` 状态仍然成立。

## 不要当作已验证的事项

- 未来部署产物是否可用。
- 当前端点 key 是否仍有效。
- 真实 OpenRouter 图片生成、编辑和 SVG 持久化在迁移后是否通过。
- 完全不透明模型别名的比例兼容。
- 当前 `v1.2.0` 最近角色卡改动在所有浏览器/并发场景下的行为。

## 迁移时可直接提供给新任务的上下文

```text
这是 openLinAI 项目。先读仓库根目录 AGENTS.md 和 PROJECT_MEMORY.md。
保留现有 chat 图片路径，并把 OpenRouter 专用图片路径视为独立引擎。
图片模型能力必须按当前 endpoint/model 能力判断；不要暴露 API key。
Nano Banana/Gemini 图片系列的比例兼容仅限历史记录的最小映射，非目标模型行为不要改变。
Windows 依赖使用 pnpm；完成修改后只做 npx tsc --noEmit，不运行日常 build 或 eslint。
历史结论必须以当前代码、当前配置和实时接口结果重新验证。
```
