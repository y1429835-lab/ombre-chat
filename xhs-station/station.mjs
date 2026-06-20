// 小红书工位 v3 —— 在桃枝家 Mac 上跑一个真浏览器(住宅 IP),开个小 HTTP 口子,
// 暮声隔着 Tailscale 发"搜这个 / 打开这条",这台机子去刷小红书,把页面文字回传给他读。
//
// 关键:刷小红书的是这台 Mac、用桃枝家的网。暮声的 VPS 只发指令、一个字节都不碰小红书,
// 所以小红书眼里全程是住宅 IP,封不到暮声。
//
// v3 改动:① 加锁,所有导航排队、不再互相撞(开机自动导航 vs 搜索撞车会导致空回);
//          ② /health 带版本号 v,方便确认跑的是新代码;③ go() 全程打日志进 station-log.txt。
import http from "http";
import os from "os";
import path from "path";
import { chromium } from "playwright";

const VERSION = 3;
const PORT = parseInt(process.env.XHS_PORT || "8848", 10);
const TOKEN = process.env.XHS_TOKEN || "";                 // 共享暗号,防同网别的设备乱开你浏览器
const PROFILE = path.join(os.homedir(), ".xhs-station-profile");  // 持久登录态
const MAX_TEXT = parseInt(process.env.XHS_MAX_TEXT || "12000", 10);

let ctx = null;
let page = null;

// —— 一把锁:让所有浏览器操作排队,绝不并发动同一个页面 ——
let chain = Promise.resolve();
function locked(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(() => {}, () => {});
  return run;
}

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

// 真去刷一个 url,把页面文字读回来。已被 locked() 串行化,内部不会和别的导航撞。
async function go(url) {
  console.error("[go] →", url);
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
  console.error("[go] ←", JSON.stringify(title), "正文长度", text.length, needLogin ? "(疑似没登录)" : "");
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

async function handleGo(res, url) {
  try {
    const data = await locked(() => go(url));   // 排队执行,绝不并发
    if (!data) return send(res, 500, { ok: false, error: "内部异常:读取没返回结果" });
    return send(res, 200, data);
  } catch (e) {
    console.error("[go] 报错:", e && e.stack ? e.stack : e);
    return send(res, 500, { ok: false, error: String(e && e.message ? e.message : e) });
  }
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
  if (u.pathname === "/health") return send(res, 200, { ok: true, v: VERSION });
  if (u.pathname === "/search") {
    const q = u.searchParams.get("q") || "";
    return handleGo(res, "https://www.xiaohongshu.com/search_result?keyword=" + encodeURIComponent(q));
  }
  if (u.pathname === "/go" || u.pathname === "/open") {
    const url = u.searchParams.get("url") || "";
    if (!/^https?:\/\//.test(url)) return send(res, 400, { ok: false, error: "url 要带 http(s)://" });
    return handleGo(res, url);
  }
  if (u.pathname === "/home") return handleGo(res, "https://www.xiaohongshu.com/explore");
  return send(res, 404, { ok: false, error: "不认识这个路径(用 /search /go /home /health)" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`小红书工位 v${VERSION} 起来了,听 :${PORT}(Tailscale 那台 VPS 够得着)。`);
  console.log("头一次:等下面弹出的浏览器开了,扫码登一次小红书,登录态会记住。");
  console.log("关掉这个终端窗口 = 收工。");
  locked(() => go("https://www.xiaohongshu.com/explore")).catch(() => {});  // 开机开到小红书,方便头次登录;排队执行
});
