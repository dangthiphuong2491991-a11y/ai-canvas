import { contextBridge, ipcRenderer } from 'electron'

const api = {
  generateImage: (params: {
    baseURL: string
    apiKey: string
    model: string
    prompt: string
    size?: string
    n?: number
  }) => ipcRenderer.invoke('image:generate', params),

  editImage: (params: {
    baseURL: string
    apiKey: string
    model: string
    prompt: string
    size?: string
    n?: number
    imageSrc: string
  }) => ipcRenderer.invoke('image:edit', params),

  textGenerate: (params: { baseURL: string; apiKey: string; model: string; prompt: string }) =>
    ipcRenderer.invoke('text:generate', params),

  visionGenerate: (params: {
    baseURL: string
    apiKey: string
    model: string
    prompt: string
    images: string[]
  }) => ipcRenderer.invoke('text:vision', params),

  videoGenerate: (params: { baseURL: string; apiKey: string; model: string; prompt: string }) =>
    ipcRenderer.invoke('video:generate', params),

  onVideoProgress: (cb: (pct: number) => void) => {
    const h = (_e: unknown, pct: number): void => cb(pct)
    ipcRenderer.on('video:progress', h)
    return () => ipcRenderer.removeListener('video:progress', h)
  },

  imageChat: (params: {
    baseURL: string
    apiKey: string
    model: string
    prompt: string
    images: string[]
  }) => ipcRenderer.invoke('image:chat', params),

  task521Image: (params: {
    baseURL: string
    apiKey: string
    model: string
    prompt: string
    aspectRatio?: string
    imageUrls?: string[]
    runId?: string
  }) => ipcRenderer.invoke('task521:image', params),

  task521Cancel: (runId: string) => ipcRenderer.invoke('task521:cancel', runId),

  task521Video: (params: {
    baseURL: string
    apiKey: string
    model: string
    prompt: string
    seconds?: number
    aspectRatio?: string
    resolution?: string
    inputReference?: string
    inputReferences?: string[]
    references?: { url: string; role: 'reference_image' | 'first_frame' | 'last_frame' }[]
    generateAudio?: boolean
    audioUrls?: string[]
    videoUrls?: string[]
    runId?: string
  }) => ipcRenderer.invoke('task521:video', params),

  listModels: (params: { baseURL: string; apiKey: string }) =>
    ipcRenderer.invoke('models:list', params),

  saveImage: (params: { b64?: string; url?: string; defaultName?: string }) =>
    ipcRenderer.invoke('image:save', params),

  // 激活
  license: {
    status: (): Promise<{
      activated: boolean
      machineId: string
      name?: string
      exp?: number | null
      reason?: string
    }> => ipcRenderer.invoke('license:status'),
    machineId: (): Promise<string> => ipcRenderer.invoke('license:machineId'),
    activate: (
      code: string
    ): Promise<{ ok: boolean; reason?: string; name?: string; exp?: number | null }> =>
      ipcRenderer.invoke('license:activate', code)
  },

  // 自动更新
  update: {
    check: (): Promise<unknown> => ipcRenderer.invoke('update:check'),
    install: (): Promise<void> => ipcRenderer.invoke('update:install'),
    on: (
      cb: (ev: { type: 'available' | 'progress' | 'downloaded' | 'error'; data: unknown }) => void
    ): (() => void) => {
      const mk =
        (type: 'available' | 'progress' | 'downloaded' | 'error') =>
        (_e: unknown, data: unknown): void =>
          cb({ type, data })
      const a = mk('available')
      const p = mk('progress')
      const d = mk('downloaded')
      const er = mk('error')
      ipcRenderer.on('update:available', a)
      ipcRenderer.on('update:progress', p)
      ipcRenderer.on('update:downloaded', d)
      ipcRenderer.on('update:error', er)
      return () => {
        ipcRenderer.removeListener('update:available', a)
        ipcRenderer.removeListener('update:progress', p)
        ipcRenderer.removeListener('update:downloaded', d)
        ipcRenderer.removeListener('update:error', er)
      }
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
