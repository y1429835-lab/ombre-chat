// 小红书工位 —— 在桃枝家 Mac 上跑一个真浏览器(住宅 IP),开个小 HTTP 口子,
// 暮声隔着 Tailscale 发"搜这个 / 打开这条",这台机子去刷小红书,把页面文字回传给他读。
//
// 关键:刷小红书的是这台 Mac、用桃枝家的网。暮声的 VPS 只发指令、一个字节都不碰小红书,
// 所以小红书眼里全程是住宅 IP,封不到暮声。
//
// 启动:双击 start.command(它会带上 XHS_TOKEN 调这个文件)。头一次先在弹出的浏览器里
// 扫码登一次小红书,登录态存在 ~/.xhs-station-profile,以后不用再登。
import http from "http";
import os from "os";
import path from "path";
import { chromium } from "playwright";

const PORT = parseInt(process.env.XHS_PORT || "8848", 10);
const TOKEN = process.env.XHS_TOKEN || "";                 // 共享暗号,防同网别的设备乱开你浏览器
const PROFILE = path.join(os.homedir(), ".xhs-station-profile");  // 持久登录态
const MAX_TEXT = parseInt(process.env.XHS_MAX_TEXT || "12000", 10);

let ctx = null;
let page = null;

async function ensure() {
  if (ctx && page && !page.isClosed()) return;
  ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,                          // 看得见的窗口,方便头次登录 + 你随时瞄一眼
    viewport: { width: 1280, height: 900 },
    locale: "zh-CN",
    args: ["--disable-blink-features=AutomationControlled"],
  });
  page = ctx.pages()[0] || (await ctx.newPage());
}

async function go(url) {
  await ensure();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2500);
  for (let i = 0; i < 4; i++) {               // 往下滚几次,把信息流/评论加载出来
    await page.mouse.wheel(0, 2200);
    await page.waitForTimeout(1200);
  }
  const title = await page.title();
  const text = (await page.evaluate(() => document.body.innerText || "")).trim();
  const needLogin = /登录|扫码|手机号登录/.test(title) || text.length < 80;
  return {
    ok: true,
    url: page.url(),
    title,
    need_login: needLogin,
    text: text.slice(0, MAX_TEXT),
  };
}

function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  let u;
  try {
    u = new URL(req.url, "http://x");
  } catch {
    return send(res, 400, { ok: false, error: "bad url" });
  }
  if (TOKEN && u.searchParams.get("token") !== TOKEN) {
    return send(res, 401, { ok: false, error: "bad token" });
  }
  try {
    if (u.pathname === "/health") return send(res, 200, { ok: true });
    if (u.pathname === "/search") {
      const q = u.searchParams.get("q") || "";
      const url = "https://www.xiaohongshu.com/search_result?keyword=" + encodeURIComponent(q);
      return send(res, 200, await go(url));
    }
    if (u.pathname === "/go" || u.pathname === "/open") {
      const url = u.searchParams.get("url") || "";
      if (!/^https?:\/\//.test(url)) return send(res, 400, { ok: false, error: "url 要带 http(s)://" });
      return send(res, 200, await go(url));
    }
    if (u.pathname === "/home") {
      return send(res, 200, await go("https://www.xiaohongshu.com/explore"));
    }
    return send(res, 404, { ok: false, error: "不认识这个路径(用 /search /go /home /health)" });
  } catch (e) {
    return send(res, 500, { ok: false, error: String(e && e.message ? e.message : e) });
  }
});

server.listen(PORT, "0.0.0.0", async () => {
  console.log(`小红书工位起来了,听 :${PORT}(Tailscale 那台 VPS 够得着)。`);
  console.log("头一次:等下面弹出的浏览器开了,扫码登一次小红书,登录态会记住。");
  console.log("关掉这个终端窗口 = 收工。");
  try {
    await go("https://www.xiaohongshu.com/explore");   // 一启动就开到小红书,方便头次扫码登录
  } catch {
    /* 网络/未登录都无所谓,窗口已经开着,你能直接在里头登 */
  }
});

