import { message } from 'antd'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { studioFileUrl, type StudioItem } from '../../../../shared/studio'
import { studioJson, studioRequest, uploadStudioFile } from './api'
import {
  findActivePhotopeaDocumentIndex,
  type PhotopeaDocumentSnapshot,
} from './photopea-documents'

const ORIGIN = 'https://www.photopea.com'
const SIGNAL = 'LINAI:'
const photopeaConfig = {
  environment: {
    lang: 'zh',
    theme: 2,
    customIO: {
      new: 'app.echoToOE("LINAI:new");',
      open: 'app.echoToOE("LINAI:open");',
      save: 'app.echoToOE("LINAI:save:png");',
      saveAsPSD: 'app.echoToOE("LINAI:save:psd");',
    },
  },
}
export const PHOTOPEA_URL = `${ORIGIN}/#${encodeURIComponent(JSON.stringify(photopeaConfig))}`

type PendingCommand = {
  marker?: string
  markerReceived?: boolean
  messages: unknown[]
  resolve: (messages: unknown[]) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export function usePhotopea(options: {
  onSaved: (item: StudioItem) => void
  onNew: () => void
  onOpen: () => void
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const callbacks = useRef(options)
  callbacks.current = options
  const pending = useRef<PendingCommand | null>(null)
  const readyRef = useRef(false)
  const failedRef = useRef(false)
  const busyRef = useRef(false)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [connectionError, setConnectionError] = useState('')
  const [recovery, setRecovery] = useState<{
    file: File
    documentId: string
  } | null>(null)
  const [hasDocuments, setHasDocuments] = useState(false)
  const saveRef = useRef<(format: 'png' | 'psd') => Promise<void>>(
    async () => {},
  )

  useLayoutEffect(() => {
    const startupTimer = setTimeout(() => {
      if (!readyRef.current)
        setConnectionError('Photopea 尚未连接，请检查网络后重新加载编辑器。')
    }, 45000)
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== ORIGIN ||
        event.source !== iframeRef.current?.contentWindow
      )
        return
      if (event.data === 'done' && !readyRef.current && !failedRef.current) {
        readyRef.current = true
        setReady(true)
        setConnectionError('')
        clearTimeout(startupTimer)
      }
      if (
        typeof event.data === 'string' &&
        [
          'LINAI:new',
          'LINAI:open',
          'LINAI:save:png',
          'LINAI:save:psd',
        ].includes(event.data)
      ) {
        if (busyRef.current) {
          message.info('正在处理上一次操作，请稍候')
          return
        }
        if (event.data === 'LINAI:new') callbacks.current.onNew()
        else if (event.data === 'LINAI:open') callbacks.current.onOpen()
        else void saveRef.current(event.data.endsWith('psd') ? 'psd' : 'png')
        return
      }
      const command = pending.current
      if (!command) return
      if (command.marker && event.data === command.marker)
        command.markerReceived = true
      const finished =
        event.data === 'done' && (!command.marker || command.markerReceived)
      if (finished) {
        clearTimeout(command.timer)
        pending.current = null
        const error = command.messages.find(
          (value) =>
            typeof value === 'string' && value.startsWith('LINAI:error:'),
        )
        if (typeof error === 'string')
          command.reject(new Error(error.slice('LINAI:error:'.length)))
        else command.resolve(command.messages)
      } else if (
        event.data instanceof ArrayBuffer ||
        (typeof event.data === 'string' && event.data.startsWith(SIGNAL))
      )
        command.messages.push(event.data)
    }
    window.addEventListener('message', receive)
    return () => {
      clearTimeout(startupTimer)
      window.removeEventListener('message', receive)
      if (pending.current) {
        clearTimeout(pending.current.timer)
        pending.current.reject(new Error('编辑器已关闭'))
        pending.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!hasDocuments) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasDocuments])

  function command(data: string | ArrayBuffer) {
    if (!readyRef.current || !iframeRef.current?.contentWindow)
      return Promise.reject(new Error('Photopea 尚未就绪'))
    if (pending.current) return Promise.reject(new Error('编辑器正在处理请求'))
    const marker =
      typeof data === 'string' ? `LINAI:end:${uuidv4()}` : undefined
    const payload =
      typeof data === 'string'
        ? `try { ${data} } catch(e) { app.echoToOE("LINAI:error:" + e.toString()); } app.echoToOE(${JSON.stringify(marker)});`
        : data
    return new Promise<unknown[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.current = null
        readyRef.current = false
        failedRef.current = true
        setReady(false)
        setConnectionError(
          '编辑器响应超时。请先在 Photopea 中导出未保存的作品，再重新加载。',
        )
        reject(new Error('Photopea 响应超时'))
      }, 90000)
      pending.current = { marker, resolve, reject, messages: [], timer }
      iframeRef.current!.contentWindow!.postMessage(payload, ORIGIN)
    })
  }

  function waitForReady() {
    if (readyRef.current) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const started = Date.now()
      const check = () => {
        if (readyRef.current) resolve()
        else if (failedRef.current || Date.now() - started > 45000)
          reject(new Error('Photopea 尚未连接，请重新加载编辑器后再试'))
        else setTimeout(check, 100)
      }
      check()
    })
  }

  async function withBusy(work: () => Promise<void>) {
    if (busyRef.current) {
      message.info('正在处理上一次操作，请稍候')
      return
    }
    busyRef.current = true
    setBusy(true)
    try {
      await work()
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : 'Photopea 操作失败',
      )
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  async function open(item: StudioItem) {
    await withBusy(async () => {
      const response = await fetch(studioFileUrl(item.id))
      if (!response.ok) throw new Error('素材读取失败，可能已被清理')
      const bytes = await response.arrayBuffer()
      const document = await studioRequest<{ id: string }>(
        '/documents',
        studioJson('POST', { itemId: item.id }),
      )
      await command(bytes)
      await command(
        `app.activeDocument.source=${JSON.stringify(`linai:${document.id}`)};app.activeDocument.name=${JSON.stringify(item.name.replace(/\.[^.]+$/, ''))};`,
      )
      setHasDocuments(true)
    })
  }

  async function addAsLayer(item: StudioItem) {
    await withBusy(async () => {
      const targetInfo = await command(
        'if(!app.documents.length) throw new Error("请先新建或打开 Photopea 文档");var identify=function(d){return {name:String(d.name||""),source:String(d.source||""),width:String(d.width),height:String(d.height)};};var docs=[];for(var i=0;i<app.documents.length;i++)docs.push(identify(app.documents[i]));app.echoToOE("LINAI:target:"+JSON.stringify({active:identify(app.activeDocument),documents:docs}));',
      )
      const target = targetInfo.find(
        (value) => typeof value === 'string' && value.startsWith('LINAI:target:'),
      )
      const snapshot = typeof target === 'string'
        ? JSON.parse(target.slice('LINAI:target:'.length)) as PhotopeaDocumentSnapshot
        : null
      const targetIndex = snapshot?.active && Array.isArray(snapshot.documents)
        ? findActivePhotopeaDocumentIndex(snapshot)
        : -1
      if (targetIndex < 0)
        throw new Error('无法确定当前 Photopea 文档')
      const documentCount = snapshot!.documents.length

      const response = await fetch(studioFileUrl(item.id))
      if (!response.ok) throw new Error('素材读取失败，可能已被清理')
      await command(await response.arrayBuffer())
      await command(
        `var source=app.documents[${documentCount}];var target=app.documents[${targetIndex}];if(app.documents.length!==${documentCount + 1}||!target||!source) throw new Error("图片未能载入为临时文档");try{app.activeDocument=source;source.selection.selectAll();source.selection.copy(true);app.activeDocument=target;var layer=target.paste();layer.name=${JSON.stringify(item.name.replace(/\.[^.]+$/, ''))};}finally{source.close(SaveOptions.DONOTSAVECHANGES);app.activeDocument=target;}`,
      )
      message.success('已作为新图层加入 Photopea')
    })
  }

  async function openManualComposite(item: StudioItem) {
    await withBusy(async () => {
      await waitForReady()
      const [base, overlay] = await Promise.all(
        (['base', 'overlay'] as const).map((layer) =>
          fetch(`/api/studio/items/${encodeURIComponent(item.id)}/manual-composite/${layer}`)),
      )
      for (const response of [base, overlay]) {
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { error?: string } | null
          throw new Error(body?.error || '手动合成图层准备失败')
        }
      }
      const document = await studioRequest<{ id: string }>(
        '/documents', studioJson('POST', { itemId: item.id }),
      )
      const baseBytes = await base.arrayBuffer()
      const overlayBytes = await overlay.arrayBuffer()
      await command(baseBytes)
      setHasDocuments(true)
      const documentSource = `linai:${document.id}`
      await command(
        `app.activeDocument.source=${JSON.stringify(documentSource)};app.activeDocument.name=${JSON.stringify(item.name.replace(/\.[^.]+$/, '').replace(/-上游原始结果$/, '') + '-手动合成')};`,
      )
      await command(overlayBytes)
      await command(
        `var source=app.activeDocument;var target=null;try{for(var i=0;i<app.documents.length;i++){if(String(app.documents[i].source||"")===${JSON.stringify(documentSource)}){target=app.documents[i];break;}}if(!target||target===source)throw new Error("无法找到原图文档");if(String(source.width)!==String(target.width)||String(source.height)!==String(target.height))throw new Error("重绘图层尺寸与原图不一致");source.selection.selectAll();source.selection.copy(true);app.activeDocument=target;var layer=target.paste();if(!layer)throw new Error("重绘图层粘贴失败");layer.name="完整上游结果（擦除周边）";}finally{if(source&&source!==target)source.close(SaveOptions.DONOTSAVECHANGES);if(target)app.activeDocument=target;}`,
      )
      message.success('完整上游结果已盖在原图上，可擦除周边内容')
    })
  }

  async function create(width: number, height: number) {
    await withBusy(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) =>
            value ? resolve(value) : reject(new Error('画布创建失败')),
          'image/png',
        ),
      )
      const source = await studioRequest<{ id: string }>(
        '/documents',
        studioJson('POST', {}),
      )
      await command(await blob.arrayBuffer())
      await command(
        `app.activeDocument.source=${JSON.stringify(`linai:${source.id}`)};app.activeDocument.name="未命名";`,
      )
      setHasDocuments(true)
    })
  }

  async function save(format: 'png' | 'psd') {
    await withBusy(async () => {
      if (recovery)
        throw new Error('还有未写入暂存台的文件，请先重试保存或下载备份')
      const output = await command(
        `if(!app.documents.length) throw new Error("请先新建或打开文档");var d=app.activeDocument;app.echoToOE("LINAI:meta:"+JSON.stringify({source:d.source,name:d.name}));d.saveToOE(${JSON.stringify(format)});`,
      )
      const metadata = output.find(
        (value) => typeof value === 'string' && value.startsWith('LINAI:meta:'),
      )
      const bytes = output.find((value) => value instanceof ArrayBuffer)
      if (typeof metadata !== 'string' || !(bytes instanceof ArrayBuffer))
        throw new Error('Photopea 没有返回完整文件，请重试保存')
      const info = JSON.parse(metadata.slice('LINAI:meta:'.length)) as {
        source?: string
        name?: string
      }
      let documentId = /^linai:([\da-f-]{36})$/i.exec(info.source || '')?.[1]
      if (!documentId) {
        // Unmanaged files (e.g. native drops) are edits, never invented AI generations.
        documentId = (
          await studioRequest<{ id: string }>(
            '/documents',
            studioJson('POST', { external: true }),
          )
        ).id
      }
      const file = new File(
        [bytes],
        `${(info.name || '未命名').replace(/\.[^.]+$/, '')}.${format}`,
        { type: format === 'png' ? 'image/png' : 'image/vnd.adobe.photoshop' },
      )
      setRecovery({ file, documentId })
      const item = await uploadStudioFile(file, documentId)
      setRecovery(null)
      callbacks.current.onSaved(item)
      message.success('已保存到暂存台')
    })
  }
  saveRef.current = save

  const retrySave = () =>
    withBusy(async () => {
      if (!recovery) return
      const item = await uploadStudioFile(recovery.file, recovery.documentId)
      setRecovery(null)
      callbacks.current.onSaved(item)
      message.success('已保存到暂存台')
    })

  return {
    iframeRef,
    ready,
    busy,
    connectionError,
    recovery,
    open,
    addAsLayer,
    openManualComposite,
    create,
    save,
    retrySave,
    dismissRecovery: () => setRecovery(null),
  }
}
