# dsh-ollama-autostart

DeepSeek Harness（dsh）插件：随 dsh 启动，在后台**无窗口**（不占任务栏）拉起本地 **Ollama** 服务（`ollama serve`）；退出 dsh 时关掉**本次自己拉起的那个**实例。本地模型（qwen 等）全靠 Ollama 的 11434 端口，没它 dsh 的本地模型整个不可用——这个插件保证"开 dsh 就有 Ollama"。

全程 `try/catch` 包裹，任何失败都静默，**绝不拖垮 dsh 启动**。

---

## 行为

- dsh 启动 → 探测 `127.0.0.1:11434`，没在跑就**无窗口**拉起 `ollama serve`，并等待端口就绪（最多 ~30s）；已在跑则跳过（不重复起，也不会关掉别人起的实例）。
- 退出/禁用插件 → 按 PID + 进程树（`taskkill /T /F`）精确关掉**本次拉起的** Ollama（含其按需派生的 runner 子进程），不误伤其他实例。
- **无窗口启动**：`CREATE_NO_WINDOW` + `windowsHide` + stdio 重定向到日志文件。任务栏不出现图标，不会误触关闭。

## 前提

已安装 Ollama（Windows 版）。插件会按以下顺序查找 `ollama.exe`：

1. 环境变量 `OLLAMA_EXE`（显式指定可执行文件路径）
2. 常见安装位置：`D:\Ollama`、`C:\Ollama`、`%LOCALAPPDATA%\Programs\Ollama`、`%ProgramFiles%\Ollama`、`%USERPROFILE%\Ollama`
3. 兜底：直接以 `ollama` 为名启动（由系统在 PATH 中查找）

## 安装

在 DeepSeek Harness 的插件管理里用 git 地址安装：

```
https://github.com/D-al/dsh-ollama-autostart.git
```

装好后**完整退出并重启 dsh**。

> 手动安装也可：把本仓库克隆到 `~/.dsh/profiles/<profile>/node_modules/dsh-ollama-autostart/`，并在该 profile 的 `package.json` 的 `dsh.profile.bundles` 里加上 `dsh-ollama-autostart`，然后重启 dsh。

## 配置（环境变量）

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `OLLAMA_PORT` | Ollama 服务端口（探测/等待用） | `11434` |
| `OLLAMA_HOST` | 若形如 `host:port`，插件会自动提取其中的端口 | — |
| `OLLAMA_EXE` | `ollama.exe` 的完整路径 | 自动探测（见「前提」） |
| `OLLAMA_RUN_LOG` | Ollama 运行日志路径 | 插件目录旁 `ollama-run.log` |
| `OLLAMA_DEBUG_LOG` | 插件调试日志路径 | 插件目录旁 `ollama-debug.log` |
| `OLLAMA_KV_CACHE_TYPE` | KV cache 量化类型。小显存显卡（如 8GB）跑大上下文必须设 `q8_0`，否则 fp16 KV 在加载时即 OOM；大显存可设 `f16` | `q8_0` |
| `OLLAMA_FLASH_ATTENTION` | flash attention 开关，长上下文更省显存更快 | `1` |

## 调试

- 插件日志：`ollama-debug.log`（记录 apply / 探测 / 启动 / 关闭过程）。
- Ollama 运行日志：`ollama-run.log`（`ollama serve` 的 stdout/stderr，启动排查看这里）。
- 手动验证：`curl http://127.0.0.1:11434/api/version`。

常见问题：

| 现象 | 原因 / 解决 |
| --- | --- |
| dsh 启动后本地模型仍连不上 | 看 `ollama-debug.log`：是否"未找到 Ollama 安装目录"→ 设 `OLLAMA_EXE`；是否 30s 未就绪 → 看 `ollama-run.log` |
| 日志里 "Listening on ..." 但 API 暂时超时 | 首次启动有 GPU 发现阶段，期间端口已 listen 但不响应 API，稍候即可 |
| 大上下文（如 num_ctx 32768）加载即失败 / 生成中断开 | 8GB 显卡上 fp16 KV cache 放不下：确认插件已在传 `OLLAMA_KV_CACHE_TYPE=q8_0`（见 `ollama-debug.log` 的 serve env 行），必要时把模型 `num_ctx` 降到 24576 |
| 任务栏没有 Ollama 图标 | 正常，本插件就是无窗口启动；要看状态用 `ollama --version` 或上面的 curl |
| 改了插件代码不生效 | ESM 按 URL 缓存，需**完整退出重启 dsh** |

## 许可

[MIT](./LICENSE)

---

## English

A DeepSeek Harness (dsh) plugin that starts your local **Ollama** server (`ollama serve`) windowlessly (no taskbar icon) when dsh launches, and stops only the instance it started on exit. Your local models (qwen etc.) depend on Ollama's port 11434 — this plugin makes sure it's always up when dsh is.

Requirements: Ollama installed on Windows. The plugin locates `ollama.exe` via `OLLAMA_EXE` → common install paths → PATH.

Install via dsh's plugin manager with the git URL, then fully restart dsh. Configurable via env vars: `OLLAMA_PORT`, `OLLAMA_HOST`, `OLLAMA_EXE`, `OLLAMA_RUN_LOG`, `OLLAMA_DEBUG_LOG`.

Licensed under MIT.
