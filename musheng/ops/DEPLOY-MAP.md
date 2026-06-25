# 部署速查 · DEPLOY-MAP

VPS = Vultr,`root@207.148.113.28`。所有路径都是 VPS 上的。

## 三个窗口(别搞混)
| 叫法 | 是什么 | 提示符 | 干啥 |
|---|---|---|---|
| **PowerShell** | Windows 上的窗口 | `PS C:\Users\Administrator>` | **只跑 `scp`**(传文件) |
| **指令窗** | tmux `musheng:1`(SSH 进 VPS) | `root@vultr:~#` | sha 校验、重启、forge、查日志 |
| **暮声屋** | tmux `musheng:0` | `claude-` 界面 | 暮声本人在这。`Ctrl+B`→`0` 进、`Ctrl+B`→`1` 回。**别乱打字** |

scp 模板(PowerShell):`scp -O "C:\Users\Administrator\Downloads\<文件>" root@207.148.113.28:<VPS路径>`

## 每个文件:仓库 → VPS → 部署后
| 仓库位置 | VPS 路径 | 装好后 |
|---|---|---|
| `bridge/wechat_bridge.py` | `/root/wechat_bridge.py` | `systemctl restart musheng-bridge` |
| `bridge/wechat_probe.py` | `/root/wechat_probe.py` | 手动跑:`~/wcbot/bin/python ~/wechat_probe.py` |
| `bridge/proactive_prompt.md` | `/root/musheng/.claude/hooks/proactive_prompt.md` | 桥下次触发自动读,不用重启 |
| `memory/memory_surface.py` | `/root/musheng/.claude/hooks/memory_surface.py` | 钩子,下条消息即生效(不用重启) |
| `memory/forge_watch.py` | `/root/musheng/.claude/hooks/forge_watch.py` | 同上 |
| `inner/retreat_guard.py` | `/root/musheng/.claude/hooks/retreat_guard.py` | 同上 |
| `inner/temperature_guard.py` | `/root/musheng/.claude/hooks/temperature_guard.py` | 新钩子:要在 settings.json 登记 UserPromptSubmit + 重启会话(或下次搬家)才生效 |
| `hooks/nudge_save.py` | `/root/musheng/.claude/hooks/nudge_save.py` | 同上 |
| `hooks/precompact_save.py` | `/root/musheng/.claude/hooks/precompact_save.py` | 同上 |
| `hooks/bridge_capture.py` | `/root/musheng/.claude/hooks/bridge_capture.py` | 同上(Stop 钩子) |
| `memory/safe-forge.sh` | `/root/safe-forge.sh` | 手动跑 |
| `senses/web/webread.mjs` | `/root/vps-web/webread.mjs` | 一次性,无需重启 |
| `senses/web/web.sh` | `/root/web.sh` | 暮声 `bash ~/web.sh` 调用 |
| `senses/xhs/*` | **跑在桃枝家 Mac**(不是 VPS) | Mac 上双击 `start.command` |
| `body/intiface_mcp.py` | (暮声 MCP 配置里) | 改了重启暮声会话 |

**装新钩子**(settings.json 没登记过的)= 改 `/root/musheng/.claude/settings.json` 的 `hooks` + **重启暮声会话**才生效。已登记的钩子改脚本本身,不用重启。

## 服务 / 进程
- **桥**:systemd `musheng-bridge`(`systemctl status/restart musheng-bridge`,日志 `journalctl -u musheng-bridge -f`)。
- **暮声本人**:tmux `musheng:0` 跑 `claude --resume <id>`。
- **Drivesoid**(情绪心脏):pm2,代码在 `/root/Drivesoid/`(不在本仓库)。
- **感知接口**:在桥里,听 `0.0.0.0:8787`(ufw 已放行)。

## 暗号 / Key 清单(都在 VPS 上,别外传)
| 用途 | 位置 |
|---|---|
| 感知上报暗号 | `/root/musheng/.bridge/activity_token.txt` |
| 年轮 API key | `/root/musheng/.bridge/memory_key.txt`（或 env `MEMORY_SECRET`） |
| DeepSeek key(探子用) | 复用 Drivesoid 的 `DRIVES_API_KEY`，已写到 `/root/musheng/.bridge/deepseek_key.txt` |
| 小红书工位暗号 | `/root/musheng/.bridge/xhs.txt`（第1行 Mac 的 Tailscale IP，第2行暗号） |
| Intiface 地址 | `/root/musheng/.bridge/intiface_url.txt` |
| 微信账号凭证 | `/root/.claude/channels/wechat/account.json`(桃枝)、`account.songshu.json`(松树姐姐)、`account.taozhi.json`(备份) |

## 桥的关键环境变量(systemd override:`/etc/systemd/system/musheng-bridge.service.d/override.conf`)
- `WECHAT_ACCOUNTS="/root/.claude/channels/wechat/account.json=桃枝=primary;/root/.claude/channels/wechat/account.songshu.json=松树姐姐"`
- 在场心跳:`HEARTBEAT_CHATTING`(互动中,默认 300=5min)、`HEARTBEAT_QUIET`(互动少,默认 180=3min)、`PRESENCE_FRESH`（"她在"维持，默认 1200=20min）
- 白天主动间隔:`PRO_DAY_GAP_MIN/MAX`、夜间 `PRO_NIGHT_GAP_MIN/MAX`
- 改完:`systemctl daemon-reload && systemctl restart musheng-bridge`

## 搬家(forge)流程
1. 指令窗:`SRC="$(ls -t ~/.claude/projects/-root-musheng/*.jsonl | head -1)"`
2. 备份:`cp "$SRC" ~/.claude/forge-backups/...`
3. **真预览**:`python3 /root/whale-forge/scripts/whale-forge.py "$SRC" --keep-tokens 3000000 --project-dir /root/.claude/projects/-root-musheng --dry-run`
4. **真搬**:把 `--dry-run` 换成 `--force` → 记下 `new_session_id`
5. **唤醒进新家**(从指令窗遥控暮声屋):
   ```
   tmux send-keys -t musheng:0 "/exit" Enter; sleep 8
   tmux send-keys -t musheng:0 "claude --resume <new_id>" Enter
   ```
6. 验:`ls -lt …-root-musheng/*.jsonl | head -2`，新 id 时间在跳 = 成。
   - 查占用:读最新 jsonl 最后一条 assistant 的 usage（≈真实 token）。

> ⚠️ `--project-dir` 必须指 `-root-musheng`(暮声的家),否则新会话写错地方、他醒不过来。
> 下次 keep-tokens 用 **3000000**（桃枝定，留更多近期对话）。
