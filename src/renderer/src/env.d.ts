export {}

declare global {
  interface Window {
    api: {
      generateImage: (params: {
        baseURL: string
        apiKey: string
        model: string
        prompt: string
        size?: string
        n?: number
      }) => Promise<{ b64?: string; url?: string }[]>
      editImage: (params: {
        baseURL: string
        apiKey: string
        model: string
        prompt: string
        size?: string
        n?: number
        imageSrc: string
      }) => Promise<{ b64?: string; url?: string }[]>
      textGenerate: (params: {
        baseURL: string
        apiKey: string
        model: string
        prompt: string
      }) => Promise<string>
      visionGenerate: (params: {
        baseURL: string
        apiKey: string
        model: string
        prompt: string
        images: string[]
      }) => Promise<string>
      videoGenerate: (params: {
        baseURL: string
        apiKey: string
        model: string
        prompt: string
      }) => Promise<{ url: string }>
      onVideoProgress: (cb: (pct: number) => void) => () => void
      imageChat: (params: {
        baseURL: string
        apiKey: string
        model: string
        prompt: string
        images: string[]
      }) => Promise<{ b64?: string; url?: string }>
      task521Image: (params: {
        baseURL: string
        apiKey: string
        model: string
        prompt: string
        aspectRatio?: string
        imageUrls?: string[]
        runId?: string
      }) => Promise<{ url: string }>
      task521Cancel: (runId: string) => Promise<void>
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
      }) => Promise<{ url: string }>
      listModels: (params: { baseURL: string; apiKey: string }) => Promise<string[]>
      saveImage: (params: {
        b64?: string
        url?: string
        defaultName?: string
      }) => Promise<string | null>
      license?: {
        status: () => Promise<{
          activated: boolean
          machineId: string
          name?: string
          exp?: number | null
          reason?: string
        }>
        machineId: () => Promise<string>
        activate: (
          code: string
        ) => Promise<{ ok: boolean; reason?: string; name?: string; exp?: number | null }>
      }
      update?: {
        check: () => Promise<unknown>
        install: () => Promise<void>
        on: (
          cb: (ev: { type: 'available' | 'progress' | 'downloaded' | 'error'; data: unknown }) => void
        ) => () => void
      }
    }
  }
}
