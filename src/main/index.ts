import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
import { join } from 'path'
import { writeFile } from 'fs/promises'
import { generateImage, editImage, listModels, downloadToBase64 } from './providers/openaiImage'
import { generateText, visionGenerate } from './providers/openaiText'
import { generateVideo } from './providers/video'
import { imageChat } from './providers/imageChat'
import { task521Image, task521Video, cancelTask521 } from './providers/task521'
import { getMachineId, loadStatus, activate as activateLicense, isActivated } from './licensing'

let mainWindow: BrowserWindow | null = null

// 未激活时拒绝一切生成调用（防止有人绕过前端激活界面直接调 IPC）。dev 模式放行，方便开发。
function guard(): void {
  if (process.env['ELECTRON_RENDERER_URL']) return
  if (!isActivated()) throw new Error('未激活：请先在软件内输入激活码')
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'AI 画布',
    backgroundColor: '#1a1a1e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  mainWindow = win

  // electron-vite 在 dev 下注入 ELECTRON_RENDERER_URL
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    win.loadURL(devUrl)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// 自动更新（仅打包后生效；发布配置见 electron-builder.yml 的 publish: github）
function setupAutoUpdate(): void {
  if (process.env['ELECTRON_RENDERER_URL']) return // dev 不更新
  const send = (ch: string, data?: unknown): void => mainWindow?.webContents.send(ch, data)
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-available', (info) => send('update:available', info.version))
  autoUpdater.on('download-progress', (p) => send('update:progress', Math.round(p.percent)))
  autoUpdater.on('update-downloaded', (info) => send('update:downloaded', info.version))
  autoUpdater.on('error', (e) => send('update:error', String(e?.message || e)))
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 3000)
}

app.whenReady().then(() => {
  // 把 URL 结果在主进程下载为 b64：避免渲染层跨域，并让图片内嵌画布、随画布持久化
  async function fillBase64(items: { b64?: string; url?: string }[]) {
    for (const it of items) {
      if (!it.b64 && it.url) {
        try {
          it.b64 = await downloadToBase64(it.url)
        } catch {
          // 下载失败保留 url，渲染层仍可显示
        }
      }
    }
    return items
  }

  // 激活：状态查询 / 提交激活码
  ipcMain.handle('license:status', () => loadStatus())
  ipcMain.handle('license:machineId', () => getMachineId())
  ipcMain.handle('license:activate', (_e, code: string) => activateLicense(code))
  // 自动更新：手动检查 / 立即重启安装
  ipcMain.handle('update:check', () => autoUpdater.checkForUpdates().catch(() => null))
  ipcMain.handle('update:install', () => autoUpdater.quitAndInstall())

  ipcMain.handle('image:generate', async (_e, params) => {
    guard()
    return fillBase64(await generateImage(params))
  })
  ipcMain.handle('image:edit', async (_e, params) => {
    guard()
    return fillBase64(await editImage(params))
  })
  ipcMain.handle('text:generate', (_e, params) => {
    guard()
    return generateText(params)
  })
  ipcMain.handle('text:vision', (_e, params) => {
    guard()
    return visionGenerate(params)
  })
  ipcMain.handle('video:generate', (e, params) => {
    guard()
    return generateVideo(params, (pct) => e.sender.send('video:progress', pct))
  })
  ipcMain.handle('image:chat', async (_e, params) => {
    guard()
    const r = await imageChat(params)
    if (!r.b64 && r.url) {
      try {
        r.b64 = await downloadToBase64(r.url)
      } catch {
        /* 保留 url */
      }
    }
    return r
  })
  ipcMain.handle('task521:image', async (_e, params) => {
    guard()
    return task521Image(params)
  })
  ipcMain.handle('task521:video', (e, params) => {
    guard()
    return task521Video(params, (pct) => e.sender.send('video:progress', pct))
  })
  ipcMain.handle('task521:cancel', (_e, runId) => cancelTask521(runId))
  ipcMain.handle('models:list', (_e, params) => listModels(params))
  ipcMain.handle('image:save', async (_e, { b64, url, defaultName }) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: defaultName || 'image.png',
      filters: [{ name: 'PNG', extensions: ['png'] }]
    })
    if (canceled || !filePath) return null
    let buf: Buffer
    if (b64) {
      buf = Buffer.from(b64, 'base64')
    } else if (url) {
      const r = await fetch(url)
      buf = Buffer.from(await r.arrayBuffer())
    } else {
      return null
    }
    await writeFile(filePath, buf)
    return filePath
  })

  loadStatus() // 启动即读取激活状态，填充内存缓存（生成接口用它兜底）
  createWindow()
  setupAutoUpdate()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
