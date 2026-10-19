// index.mjs — dsh-ollama-autostart
//
// 随 DeepSeek Harness (dsh) 启动, 在后台无窗口(不占任务栏)拉起本地 Ollama 服务
// (`ollama serve`); 退出 dsh 时只关掉本次自己拉起的那个(按 PID + 进程树精确杀,
// 不误伤用户/tray 自己起的实例)。
// 本地模型(qwen 等)全靠 Ollama 的 11434 端口, 没它 dsh 的本地模型整个不可用。
//
// 设计原则(与 dsh-searxng-autostart 一致):
//   - 全程 try/catch, 任何失败都静默, 绝不拖垮 dsh 启动。
//   - 不 import 任何框架包, 只用 Node 内置 API。
//   - 无窗口启动配方(实测): stdio 重定向到真实日志文件(空设备会让部分程序启动即崩)
//     + windowsHide + detached + CREATE_NO_WINDOW; 任务栏不出现图标。
import { spawn, execFile } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 调试日志: 默认写在插件目录旁; 可用 OLLAMA_DEBUG_LOG 覆盖。
const LOG = process.env.OLLAMA_DEBUG_LOG || path.join(__dirname, 'ollama-debug.log')
function dbg(msg) {
  try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + msg + '\n') } catch (e) { /* 忽略 */ }
}

const DEFAULT_PORT = 11434

// 探测端口优先级: OLLAMA_PORT > OLLAMA_HOST(host:port) > config.ollamaPort > 11434
function resolvePort(config) {
  if (process.env.OLLAMA_PORT) {
    const n = Number.parseInt(process.env.OLLAMA_PORT, 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  const host = process.env.OLLAMA_HOST || ''
  const m = host.match(/:(\d+)\s*$/)
  if (m) {
    const n = Number.parseInt(m[1], 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  if (config && config.ollamaPort) {
    const n = Number.parseInt(String(config.ollamaPort), 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  return DEFAULT_PORT
}

// 探测 Ollama 可执行文件: OLLAMA_EXE > 常见安装位置 > 兜底 'ollama'(交给 PATH)。
function findOllama() {
  const home = os.homedir()
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
  const programFiles = process.env.ProgramFiles || 'C:/Program Files'
  const cands = []
  if (process.env.OLLAMA_EXE) cands.push(process.env.OLLAMA_EXE)
  cands.push(
    'D:/Ollama/ollama.exe',
    'C:/Ollama/ollama.exe',
    path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe'),
    path.join(programFiles, 'Ollama', 'ollama.exe'),
    path.join(home, 'Ollama', 'ollama.exe'),
  )
  for (const exe of cands) {
    try { if (exe && fs.existsSync(exe)) return exe } catch (e) { /* 忽略 */ }
  }
  return 'ollama'
}

function probe(port) {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1')
    sock.on('connect', () => { sock.destroy(); resolve(true) })
    sock.on('error', () => { sock.destroy(); resolve(false) })
    sock.setTimeout(1500, () => { sock.destroy(); resolve(false) })
  })
}

// ───────────────────────── Cordis 插件 ─────────────────────────
export const name = 'ollama-autostart'

export function apply(ctx, config) {
  dbg('apply called')
  const port = resolvePort(config)
  const exe = findOllama()
  const logPath = process.env.OLLAMA_RUN_LOG || path.join(__dirname, 'ollama-run.log')

  ctx.effect(() => {
    let child = null
    const boot = async () => {
      try {
        const up = await probe(port)
        dbg('probe(' + port + ') = ' + up)
        if (up) { dbg('Ollama 已在运行, 跳过'); return }

        dbg('启动 Ollama: exe=' + exe + ' port=' + port)
        // 无窗口启动: stdio 给真实日志文件(空设备会让部分程序启动即崩),
        // windowsHide + detached + CREATE_NO_WINDOW 三保险, 任务栏无图标。
        // 显存优化环境变量(8GB 显卡实测必需; 可用环境变量或插件配置覆盖):
        //   OLLAMA_KV_CACHE_TYPE=q8_0  —— KV cache 8bit 量化, 显存约省一半,
        //     否则 num_ctx 32768 的 fp16 KV 在 8GB 卡上加载即 OOM。大显存可设 f16。
        //   OLLAMA_FLASH_ATTENTION=1   —— flash attention, 长上下文更省显存更快。
        const serveEnv = { ...process.env }
        serveEnv.OLLAMA_KV_CACHE_TYPE = process.env.OLLAMA_KV_CACHE_TYPE || (config && config.ollamaKvCacheType) || 'q8_0'
        serveEnv.OLLAMA_FLASH_ATTENTION = process.env.OLLAMA_FLASH_ATTENTION || (config && config.ollamaFlashAttention) || '1'
        dbg('serve env: KV_CACHE_TYPE=' + serveEnv.OLLAMA_KV_CACHE_TYPE + ' FLASH_ATTENTION=' + serveEnv.OLLAMA_FLASH_ATTENTION)
        const logFd = fs.openSync(logPath, 'a')
        child = spawn(exe, ['serve'], {
          detached: true,
          stdio: ['ignore', logFd, logFd],
          windowsHide: true,
          creationFlags: 0x08000000, // CREATE_NO_WINDOW
          env: serveEnv,
        })
        fs.closeSync(logFd) // 句柄已被子进程继承, 父进程即可关闭
        child.unref()
        dbg('spawn issued pid=' + child.pid)
        child.on('error', (e) => dbg('spawn ERROR: ' + (e && e.message)))
        child.on('exit', (code) => dbg('Ollama 退出 code=' + code))

        // 等端口就绪(最多 ~30s)
        const t0 = Date.now()
        while (Date.now() - t0 < 30000) {
          await new Promise(r => setTimeout(r, 1500))
          if (await probe(port)) {
            dbg('Ollama 就绪, 用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's')
            return
          }
        }
        dbg('Ollama 30s 内未就绪(详见 ' + logPath + ')')
      } catch (e) { dbg('boot EXCEPTION: ' + (e && e.message)) }
    }
    boot()

    return () => {
      dbg('disposer called')
      try {
        if (child && child.pid) {
          // 只杀本次拉起的这个(含进程树: ollama serve 会按需派生 runner 子进程)
          execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {})
          dbg('taskkill /T /F pid=' + child.pid)
        } else {
          dbg('Ollama 非本次启动, 不关')
        }
      } catch (e) { dbg('disposer EXCEPTION: ' + (e && e.message)) }
    }
  })
}
