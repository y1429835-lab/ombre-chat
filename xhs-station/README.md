# 小红书工位 —— 给暮声一双看当下小红书的眼睛

暮声跑在 VPS 上。小红书查得严,**VPS 直接刷会封号**。所以浏览器放到桃枝家 Mac 上跑(住宅 IP),
暮声隔着 Tailscale 只发指令、不碰小红书。全程小红书眼里是住宅 IP,封不到暮声。

```
桃枝家 Mac(住宅IP,跑浏览器) ←— Tailscale —→ 暮声 VPS(只发指令,用 Bash 够过来)
        └ 刷小红书的是这台、用家里网,安全
```

**按需,不常驻**:想看了 → 开 Mac、双击 start.command;看完关掉终端窗口 = 收工。Mac 不用一直开。
不走 MCP 连接器(那个得重启暮声),走 Bash —— 暮声那一窗永远不用重启。

---

## 第一段 · Mac 上装好(一次性,单机可验)

1. 装 **Node.js**:去 https://nodejs.org 下载 LTS 版,装上(一路下一步)。
2. 把工位文件拉到一个文件夹(开"终端"App,粘这段):
   ```bash
   mkdir -p ~/xhs-station && cd ~/xhs-station
   for f in package.json station.mjs setup.command start.command; do
     curl -fsSL "https://raw.githubusercontent.com/y1429835-lab/ombre-chat/main/xhs-station/$f" -o "$f"
   done
   chmod +x setup.command start.command
   ```
3. 双击 **setup.command**(装浏览器内核,等它说"✅ 装好了")。
4. 双击 **start.command** → 弹出一个浏览器窗口 + 终端显示"工位起来了"。
5. **头一次登录**:让暮声/你访问一下首页,浏览器里会出现小红书 —— 点登录、**手机扫码**登一次。登录态记在 `~/.xhs-station-profile`,以后不用再登。
6. **单机自测**(开另一个终端窗口):
   ```bash
   curl -s "http://127.0.0.1:8848/search?token=taozhi-musheng-xhs-2026&q=上海+周末" | python3 -m json.tool
   ```
   能打出带 `text` 的一坨小红书文字 = 工位成了。`need_login:true` 就是还没登,去第 5 步扫码。

## 第二段 · 接到暮声(Tailscale + VPS 一次性)

1. Mac 装 **Tailscale**(和 iPad/手机/VPS 同一个账号登录),记下 Mac 的 Tailscale IP(`100.x.x.x`)。
2. VPS 上放暮声的"小红书手"和配置:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/y1429835-lab/ombre-chat/main/xhs-station/xhs.sh -o ~/xhs.sh
   printf '%s\n%s\n' '你Mac的Tailscale_IP' 'taozhi-musheng-xhs-2026' > ~/musheng/.bridge/xhs.txt
   ```
3. VPS 上验通(Mac 的 start.command 得开着):
   ```bash
   bash ~/xhs.sh search 上海 周末
   ```
   读到小红书正文 = 打通了。

## 第三段 · 日常 + 告诉暮声

- 想看 → 开 Mac、双击 **start.command**。跟暮声说"搜下小红书 XX"。
- 暮声怎么用(写进他的醒来卡/或你直接说):
  - 搜:`bash ~/xhs.sh search 关键词`
  - 打开某条:`bash ~/xhs.sh go 小红书链接`
  - 首页推荐:`bash ~/xhs.sh home`
  - 没开机时命令会温和报"工位没应声",不影响别的。
- 看完关掉 Mac 上那个终端窗口 = 收工。

## 安全 / 注意

- `token`(暗号)两边要一致;同一个 WiFi 别的设备没暗号开不了你浏览器。
- 浏览器是**看得见**的窗口、用你真账号:暮声只读,别让它替你点赞/发评论那种(工位也没给这些口子)。
- 小红书改版可能让取到的文字变样;真不对把结果发晖,微调取数逻辑。
