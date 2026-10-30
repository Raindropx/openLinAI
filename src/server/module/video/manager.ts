import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import type {
  VideoResult,
  VideoSources,
  VideoTask,
} from '../../../shared/video'
import { taskManager, type Task } from '../../common/task-manager'
import { syncVideoEndpoints } from './endpoint-registry'
import {
  getVideoProvider,
  validateVideoRequest,
  videoProviders,
  videoRequestSchema,
} from './providers'
import { openRemoteVideo, validateVideoUrl } from './remote'
import { retrieveVideoPart } from './retrieval'
import {
  hashVideoFile,
  openLocalVideo,
  openPartialVideo,
  positiveEnv,
  videoFilePath,
  videoStorageRoot,
  videoTimeoutMs,
} from './storage'

type Run = { controller: AbortController; done: Promise<void> }
const activeGeneration = (video: VideoTask) =>
  ['queued', 'submitting', 'processing'].includes(video.generationStatus)
const activeRetrieval = (video: VideoTask) =>
  ['queued', 'downloading'].includes(video.retrievalStatus)
const generationTimeout = () =>
  positiveEnv(
    'VIDEO_GENERATION_TIMEOUT_MS',
    6 * 60 * 60 * 1000,
    24 * 60 * 60 * 1000,
  )

export class VideoManager {
  constructor(
    private network: {
      open: typeof openRemoteVideo
      validate: typeof validateVideoUrl
    } = { open: openRemoteVideo, validate: validateVideoUrl },
  ) {}
  private generating = new Map<string, Run>()
  private retrieving = new Map<string, Run>()
  private deleting = new Set<string>()
  private cancellingRetrieval = new Set<string>()
  private actions = new Map<string, Promise<unknown>>()
  private timer?: ReturnType<typeof setTimeout>
  private ticking?: Promise<void>
  private stopped = false

  private serial<T>(id: string, action: () => Promise<T>): Promise<T> {
    const next = (this.actions.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(action)
    this.actions.set(id, next)
    void next
      .finally(() => {
        if (this.actions.get(id) === next) this.actions.delete(id)
      })
      .catch(() => {})
    return next
  }

  async task(id: string) {
    const task = (await taskManager.getTasks()).find(
      (item) => item.id === id && item.video,
    )
    if (!task?.video) throw new Error('视频任务不存在')
    return task as Task & { video: VideoTask }
  }

  async create(raw: unknown) {
    return this.serial('$create', () => this.createUnlocked(raw))
  }

  private async createUnlocked(raw: unknown) {
    await syncVideoEndpoints()
    const input = videoRequestSchema.parse(raw)
    const provider = getVideoProvider(input.provider)
    if (provider.getCapabilities().enabled === false)
      throw new Error('视频端点已停用')
    validateVideoRequest(input, provider)
    for (const reference of input.references || []) {
      if (reference.type !== 'image')
        await this.network.validate(reference.remoteUrl)
    }
    const all = await taskManager.getTasks()
    if (
      all.filter((task) => task.video && activeGeneration(task.video)).length >=
      32
    )
      throw new Error('视频生成队列已满，请等待现有任务完成')
    const id = randomUUID()
    const task: Task = {
      id,
      mediaType: 'video',
      source: 'studio-video',
      endpointName: `Video · ${input.provider}`,
      rawTemplate: {
        id,
        title: '视频生成',
        prompt: input.prompt,
        images: input.inputImages,
        usageType: 'image',
        aspectRatio: input.aspectRatio,
        createdAt: Date.now(),
      },
      createdAt: Date.now(),
      status: 'pending',
      outputUrls: [],
      video: {
        request: input,
        generationStatus: 'queued',
        retrievalStatus: 'not_retrieved',
        retrievalBytes: 0,
        generationDeadlineAt: Date.now() + generationTimeout(),
      },
    }
    await taskManager.addVideoTask(task)
    return task
  }

  async recover() {
    for (const task of await taskManager.getTasks()) {
      if (!task.video) continue
      if (
        task.video.generationStatus === 'submitting' &&
        !task.video.remoteTaskId
      ) {
        await taskManager.mutateVideoTask(task.id, (video) => {
          video.generationStatus = 'failed'
          video.error =
            '提交时服务中断，云端是否已接单未知。请先核对服务商记录，再手动重试以免重复计费'
        })
      }
      if (task.video.retrievalStatus === 'downloading') {
        await taskManager.mutateVideoTask(task.id, (video) => {
          video.retrievalStatus = 'queued'
          video.retrievalBytes = video.retrievalCheckpoint?.bytes ?? 0
        })
      }
    }
  }

  async start() {
    await syncVideoEndpoints()
    clearTimeout(this.timer)
    this.stopped = false
    await this.recover()
    const schedule = () => {
      if (this.stopped) return
      this.timer = setTimeout(() => {
        void this.tick()
          .catch(() => {})
          .finally(schedule)
      }, 2000)
      this.timer.unref()
    }
    schedule()
  }

  async stop() {
    this.stopped = true
    clearTimeout(this.timer)
    await this.ticking?.catch(() => {})
    const runs = [...this.generating.values(), ...this.retrieving.values()]
    runs.forEach((run) => run.controller.abort())
    await Promise.all(runs.map((run) => run.done))
  }

  /** Independent of browser requests; bounded global polling and retrieval concurrency. */
  tick(): Promise<void> {
    if (this.stopped) return Promise.resolve()
    if (!this.ticking) {
      this.ticking = this.tickOnce().finally(() => {
        this.ticking = undefined
      })
    }
    return this.ticking
  }

  private async tickOnce() {
    for (const task of await taskManager.getTasks()) {
      if (this.stopped) break
      if (!task.video || this.deleting.has(task.id)) continue
      if (
        activeGeneration(task.video) &&
        Date.now() >
          (task.video.generationDeadlineAt ??
            task.createdAt + generationTimeout()) &&
        !this.generating.has(task.id)
      ) {
        await taskManager.mutateVideoTask(task.id, (video) => {
          video.generationStatus = 'failed'
          video.error = '视频生成等待已超时；请核对云端任务后手动恢复查询'
        })
        continue
      }
      if (
        activeGeneration(task.video) &&
        (task.video.nextPollAt ?? 0) <= Date.now() &&
        !this.generating.has(task.id) &&
        this.generating.size < 2
      )
        this.launch(this.generating, task.id, (signal) =>
          this.generate(task.id, signal),
        )
      if (
        task.video.retrievalStatus === 'queued' &&
        !this.cancellingRetrieval.has(task.id) &&
        !this.retrieving.has(task.id) &&
        this.retrieving.size < positiveEnv('VIDEO_RETRIEVAL_CONCURRENCY', 1, 4)
      )
        this.launch(this.retrieving, task.id, (signal) =>
          this.retrieve(task.id, signal),
        )
    }
  }

  private launch(
    map: Map<string, Run>,
    id: string,
    action: (signal: AbortSignal) => Promise<void>,
  ) {
    const controller = new AbortController()
    const done = Promise.resolve()
      .then(() => action(controller.signal))
      .catch(() => {}) // errors are persisted by workers, never log signed URLs/provider secrets
      .finally(() => map.delete(id))
    map.set(id, { controller, done })
  }

  private async checkedResult(result: VideoResult): Promise<VideoResult> {
    if (!result.remoteUrl) throw new Error('服务商未提供可直连的视频地址')
    // Successful generation is retained even when a new CDN still needs approval.
    // The public-address check remains mandatory; playback/retrieval enforce the allowlist.
    await this.network.validate(result.remoteUrl, undefined, [
      new URL(result.remoteUrl).hostname,
    ])
    if (
      result.remoteUrlExpiresAt !== undefined &&
      (!Number.isFinite(result.remoteUrlExpiresAt) ||
        result.remoteUrlExpiresAt <= Date.now())
    )
      throw new Error('云端结果已失效')
    let posterUrl: string | undefined
    if (result.posterUrl) {
      try {
        await this.network.validate(result.posterUrl)
        posterUrl = result.posterUrl
      } catch {
        /* optional cover */
      }
    }
    // Only known result metadata crosses the provider boundary; never arbitrary credentials/paths.
    return {
      remoteUrl: result.remoteUrl,
      providerMedia: result.providerMedia === true,
      remoteUrlExpiresAt: result.remoteUrlExpiresAt,
      posterUrl,
      mimeType:
        result.mimeType === 'video/mp4' || result.mimeType === 'video/webm'
          ? result.mimeType
          : undefined,
      durationSeconds: result.durationSeconds,
      width: result.width,
      height: result.height,
    }
  }

  private async generate(id: string, signal: AbortSignal) {
    const { video: pendingVideo } = await this.task(id)
    const submitTimeout =
      videoProviders.get(pendingVideo.request.provider)?.submitTimeoutMs ||
      60000
    const timeout = AbortSignal.any([
      signal,
      AbortSignal.timeout(submitTimeout),
    ])
    let submitting = false
    try {
      let { video } = await this.task(id)
      timeout.throwIfAborted()
      if (!activeGeneration(video)) return
      const provider = getVideoProvider(video.request.provider)
      if (!video.remoteTaskId) {
        submitting = true
        await taskManager.mutateVideoTask(id, (value) => {
          value.generationStatus = 'submitting'
        })
        const remoteTaskId = await provider.submitGeneration(
          video.request,
          id,
          timeout,
        )
        if (!remoteTaskId || remoteTaskId.length > 500)
          throw new Error('无效远端编号')
        await taskManager.mutateVideoTask(id, (value) => {
          value.remoteTaskId = remoteTaskId
          value.generationStatus = 'processing'
        })
        submitting = false
        video = (await this.task(id)).video
      }
      timeout.throwIfAborted()
      const state = await provider.getGenerationStatus(
        video.remoteTaskId!,
        timeout,
      )
      const result =
        state.status === 'succeeded'
          ? await this.checkedResult(
              await provider.getResult(video.remoteTaskId!, timeout),
            )
          : undefined
      await taskManager.mutateVideoTask(id, (value) => {
        value.generationStatus =
          state.status === 'submitting' ? 'processing' : state.status
        value.pollFailures = 0
        value.nextPollAt = Date.now() + 10000
        value.error =
          state.status === 'failed'
            ? '云端视频生成失败，请检查服务商任务记录'
            : undefined
        if (result) value.result = result
      })
    } catch (error) {
      if (signal.aborted || this.deleting.has(id)) return
      const detail =
        error instanceof Error &&
        /^(视频 API|视频模型|Gemini|Civitai|不支持的 Civitai)/.test(
          error.message,
        )
          ? `；${error.message}`
          : ''
      await taskManager.mutateVideoTask(id, (video) => {
        video.pollFailures = (video.pollFailures || 0) + 1
        video.nextPollAt =
          Date.now() + Math.min(300000, 10000 * 2 ** video.pollFailures)
        if (submitting || video.pollFailures >= 5) {
          video.generationStatus = 'failed'
          video.error = submitting
            ? `提交未确认，请先核对云端任务再重试，避免重复计费${detail}`
            : `视频查询或结果校验失败，已停止自动查询；可手动恢复查询${detail}`
        }
      })
    }
  }

  async retryGeneration(id: string) {
    return this.serial(id, async () => {
      const { video } = await this.task(id)
      if (
        activeGeneration(video) ||
        activeRetrieval(video) ||
        this.generating.has(id)
      )
        throw new Error('任务仍在运行')
      if (video.generationStatus === 'succeeded')
        throw new Error('视频已生成，请使用取回重试')
      await taskManager.mutateVideoTask(id, (value) => {
        value.generationStatus = value.remoteTaskId ? 'processing' : 'queued'
        value.error = undefined
        value.pollFailures = 0
        value.nextPollAt = 0
        value.generationDeadlineAt = Date.now() + generationTimeout()
      })
    })
  }

  async remoteResult(id: string, force = false) {
    return this.serial(id, async () => {
      const { video } = await this.task(id)
      if (video.generationStatus !== 'succeeded')
        throw new Error('视频尚未生成成功')
      let result = video.result
      if (
        force ||
        !result?.remoteUrl ||
        (result.remoteUrlExpiresAt &&
          result.remoteUrlExpiresAt <= Date.now() + 30000)
      ) {
        try {
          const fresh = await this.checkedResult(
            await getVideoProvider(video.request.provider).getResult(
              video.remoteTaskId!,
              AbortSignal.timeout(60000),
            ),
          )
          result = {
            ...result,
            ...fresh,
            mimeType: result?.localFileId ? result.mimeType : fresh.mimeType,
          }
          await taskManager.mutateVideoTask(id, (value) => {
            value.result = result
          })
        } catch {
          throw new Error('云端结果已失效或无法刷新')
        }
      }
      if (!result?.remoteUrl) throw new Error('云端结果已失效')
      await this.network.validate(result.remoteUrl)
      return result
    })
  }

  async sources(id: string): Promise<VideoSources> {
    const { video } = await this.task(id)
    if (video.generationStatus !== 'succeeded') return {}
    if (video.result?.localFileId) {
      try {
        const { handle, stat } = await openLocalVideo(video.result.localFileId)
        await handle.close()
        if (stat.size !== video.result.fileSize) throw new Error('文件大小变化')
        if (video.retrievalStatus !== 'retrieved')
          await taskManager.mutateVideoTask(id, (value) => {
            value.retrievalStatus = 'retrieved'
            value.retrievalError = undefined
          })
        return {
          source: 'local',
          playbackUrl: `/api/studio/videos/${id}/file`,
          downloadUrl: `/api/studio/videos/${id}/download`,
        }
      } catch {
        if (video.retrievalStatus === 'retrieved')
          await taskManager.mutateVideoTask(id, (value) => {
            value.retrievalStatus = 'failed'
            value.retrievalError =
              '本地视频不可用，文件可能已移动或外接磁盘离线'
          })
      }
    }
    try {
      const result = await this.remoteResult(id)
      return {
        source: 'cloud',
        playbackUrl: result.providerMedia
          ? `/api/studio/videos/${id}/cloud-preview`
          : result.remoteUrl,
        downloadUrl: `/api/studio/videos/${id}/cloud-download`,
      }
    } catch (error) {
      return {
        error:
          error instanceof Error &&
          error.message.startsWith('视频域名尚未加入允许列表：')
            ? error.message
            : '云端结果已失效或不可访问；请刷新链接或检查本地存储',
      }
    }
  }

  async queueRetrieval(id: string) {
    const { video } = await this.task(id)
    if (video.generationStatus !== 'succeeded')
      throw new Error('视频尚未生成成功')
    await videoStorageRoot()
    return this.serial(id, async () => {
      const current = (await this.task(id)).video
      if (
        activeRetrieval(current) ||
        this.retrieving.has(id) ||
        this.deleting.has(id) ||
        this.cancellingRetrieval.has(id)
      )
        throw new Error('视频正在取回或删除')
      if (current.retrievalStatus === 'retrieved') throw new Error('视频已取回')
      await taskManager.mutateVideoTask(id, (value) => {
        value.retrievalStatus = 'queued'
        value.retrievalBytes = value.retrievalCheckpoint?.bytes ?? 0
        value.retrievalError = undefined
      })
    })
  }

  private async retrieve(id: string, signal: AbortSignal) {
    const transferSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(videoTimeoutMs()),
    ])
    try {
      const { video: before } = await this.task(id)
      transferSignal.throwIfAborted()
      if (before.retrievalStatus !== 'queued') return
      const root = await videoStorageRoot()
      // A verified final file may survive a crash between rename and catalog commit.
      try {
        const recovered = await openLocalVideo(id)
        let verified = false
        try {
          verified =
            !!before.retrievalCommit &&
            recovered.stat.size === before.retrievalCommit.bytes &&
            (await hashVideoFile(recovered.handle, transferSignal)) ===
              before.retrievalCommit.sha256
        } finally {
          await recovered.handle.close()
        }
        if (verified) {
          await taskManager.mutateVideoTask(id, (value) => {
            value.retrievalStatus = 'retrieved'
            value.retrievalBytes = recovered.stat.size
            value.retrievalCheckpoint = undefined
            value.retrievalError = undefined
            value.result = {
              ...value.result,
              mimeType: before.retrievalCommit!.mimeType,
              localFileId: id,
              fileSize: recovered.stat.size,
              savedAt: Date.now(),
            }
          })
          return
        }
        throw new Error('已有文件无法核实，请先删除本地文件再取回')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      if (before.retrievalCommit) {
        try {
          const part = await openPartialVideo(root, id)
          let verified = false
          try {
            verified =
              part.stat.size === before.retrievalCommit.bytes &&
              (await hashVideoFile(part.handle, transferSignal)) ===
                before.retrievalCommit.sha256
          } finally {
            await part.handle.close()
          }
          if (verified) {
            transferSignal.throwIfAborted()
            await fs.rename(
              videoFilePath(root, id, true),
              videoFilePath(root, id),
            )
            await taskManager.mutateVideoTask(id, (value) => {
              value.retrievalStatus = 'retrieved'
              value.retrievalBytes = before.retrievalCommit!.bytes
              value.retrievalCheckpoint = undefined
              value.retrievalError = undefined
              value.result = {
                ...value.result,
                mimeType: before.retrievalCommit!.mimeType,
                localFileId: id,
                fileSize: before.retrievalCommit!.bytes,
                savedAt: Date.now(),
              }
            })
            return
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      const result = await this.remoteResult(id)
      transferSignal.throwIfAborted()
      const downloaded = await retrieveVideoPart({
        id,
        root,
        url: result.remoteUrl!,
        signal: transferSignal,
        checkpoint: before.retrievalCheckpoint,
        open: result.providerMedia
          ? (_url, signal, range) =>
              getVideoProvider(before.request.provider).openResult!(
                before.remoteTaskId!,
                signal,
                range,
              )
          : this.network.open,
        save: (progress) =>
          taskManager.mutateVideoTask(id, (value) => {
            value.retrievalStatus = 'downloading'
            value.retrievalBytes = progress.bytes
            value.retrievalTotalBytes = progress.total
            value.retrievalCheckpoint = progress.checkpoint
            value.retrievalCommit = undefined
            value.retrievalNotice = progress.notice
            if (progress.mimeType)
              value.result = { ...value.result, mimeType: progress.mimeType }
          }),
      })
      transferSignal.throwIfAborted()
      if (root !== (await videoStorageRoot()))
        throw new Error('视频存储发生变化')
      await taskManager.mutateVideoTask(id, (value) => {
        value.retrievalTotalBytes = downloaded.bytes
        value.retrievalCommit = downloaded
        value.result = { ...value.result, mimeType: downloaded.mimeType }
      })
      await fs.rename(videoFilePath(root, id, true), videoFilePath(root, id))
      await taskManager.mutateVideoTask(id, (value) => {
        value.retrievalStatus = 'retrieved'
        value.retrievalBytes = downloaded.bytes
        value.retrievalCheckpoint = undefined
        value.retrievalError = undefined
        value.result = {
          ...value.result,
          localFileId: id,
          fileSize: downloaded.bytes,
          savedAt: Date.now(),
        }
      })
    } catch {
      if (!this.deleting.has(id))
        await taskManager.mutateVideoTask(id, (value) => {
          value.retrievalStatus = signal.aborted
            ? this.stopped
              ? 'queued'
              : 'paused'
            : 'failed'
          value.retrievalBytes = value.retrievalCheckpoint?.bytes ?? 0
          value.retrievalError = signal.aborted
            ? undefined
            : '取回中断，请检查云端链接、网络和存储；继续取回时将校验断点'
        })
    }
  }

  private async withRetrievalStopped<T>(id: string, action: () => Promise<T>) {
    return this.serial(`retrieval:${id}`, async () => {
      this.cancellingRetrieval.add(id)
      try {
        const run = this.retrieving.get(id)
        run?.controller.abort()
        await run?.done
        return await this.serial(id, action)
      } finally {
        this.cancellingRetrieval.delete(id)
      }
    })
  }

  async pauseRetrieval(id: string) {
    return this.withRetrievalStopped(id, async () => {
      await taskManager.mutateVideoTask(id, (value) => {
        if (activeRetrieval(value) || value.retrievalStatus === 'paused') {
          value.retrievalStatus = 'paused'
          value.retrievalError = undefined
        }
      })
    })
  }

  async cancelRetrieval(id: string) {
    return this.withRetrievalStopped(id, async () => {
      const { video } = await this.task(id)
      if (video.retrievalStatus === 'retrieved') return
      const root = await videoStorageRoot(0, false)
      await fs.rm(videoFilePath(root, id, true), { force: true })
      await taskManager.mutateVideoTask(id, (value) => {
        value.retrievalStatus = 'cancelled'
        value.retrievalBytes = 0
        value.retrievalTotalBytes = undefined
        value.retrievalCheckpoint = undefined
        value.retrievalCommit = undefined
        value.retrievalNotice = undefined
        value.retrievalError = undefined
      })
    })
  }

  async restartRetrieval(id: string) {
    return this.withRetrievalStopped(id, async () => {
      const { video } = await this.task(id)
      if (
        video.generationStatus !== 'succeeded' ||
        video.retrievalStatus === 'retrieved'
      )
        throw new Error('任务状态不支持重新取回')
      const root = await videoStorageRoot()
      await fs.rm(videoFilePath(root, id, true), { force: true })
      await taskManager.mutateVideoTask(id, (value) => {
        value.retrievalStatus = 'queued'
        value.retrievalBytes = 0
        value.retrievalCheckpoint = undefined
        value.retrievalCommit = undefined
        value.retrievalNotice = undefined
        value.retrievalError = undefined
      })
    })
  }

  async deleteLocal(id: string) {
    return this.withRetrievalStopped(id, async () => {
      await this.task(id)
      const root = await videoStorageRoot(0, false)
      await fs.rm(videoFilePath(root, id), { force: true })
      await fs.rm(videoFilePath(root, id, true), { force: true })
      await taskManager.mutateVideoTask(id, (value) => {
        value.retrievalStatus = 'not_retrieved'
        value.retrievalBytes = 0
        value.retrievalTotalBytes = undefined
        value.retrievalError = undefined
        value.retrievalCheckpoint = undefined
        value.retrievalCommit = undefined
        value.retrievalNotice = undefined
        if (value.result) {
          value.result.localFileId = undefined
          value.result.fileSize = undefined
          value.result.savedAt = undefined
        }
      })
    })
  }

  async beforeDelete(ids: string[], removeFiles: boolean) {
    for (const id of ids) this.deleting.add(id)
    try {
      for (const id of ids) {
        const runs = [this.generating.get(id), this.retrieving.get(id)].filter(
          (run): run is Run => !!run,
        )
        runs.forEach((run) => run.controller.abort())
        await Promise.all(runs.map((run) => run.done))
        const task = (await taskManager.getTasks()).find(
          (item) => item.id === id,
        )
        if (task?.video)
          await taskManager.mutateVideoTask(id, (value) => {
            if (activeGeneration(value)) value.generationStatus = 'cancelled'
            if (activeRetrieval(value)) value.retrievalStatus = 'cancelled'
          })
        if (
          task?.video &&
          removeFiles &&
          (task.video.result?.localFileId ||
            task.video.retrievalBytes ||
            task.video.retrievalCheckpoint)
        )
          await this.deleteLocal(id)
      }
    } finally {
      for (const id of ids) this.deleting.delete(id)
    }
  }

  capabilities() {
    return [...videoProviders.values()]
      .map((provider) => provider.getCapabilities())
      .filter((capability) => capability.enabled !== false)
  }

  async openCloud(id: string, signal: AbortSignal) {
    const result = await this.remoteResult(id)
    const { video } = await this.task(id)
    return result.providerMedia
      ? getVideoProvider(video.request.provider).openResult!(
          video.remoteTaskId!,
          signal,
        )
      : this.network.open(result.remoteUrl!, signal)
  }
}

export const videoManager = new VideoManager()
