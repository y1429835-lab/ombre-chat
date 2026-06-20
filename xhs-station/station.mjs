// 小红书工位 v4 —— 在桃枝家 Mac 上跑一个真浏览器(住宅 IP),开个小 HTTP 口子,
// 暮声隔着 Tailscale 发"搜这个 / 打开这条",这台机子去刷小红书,把页面文字回传给他读。
//
// 关键:刷小红书的是这台 Mac、用桃枝家的网。暮声的 VPS 只发指令、一个字节都不碰小红书。
//
// v4 改动:① 去掉开机自动刷 explore(那一步会卡死、把搜索也堵住);
//          ② go() 全程封顶 —— goto / 读正文都带硬超时,卡了就读现有内容、绝不无限等;
//          ③ 仍加锁串行,/health 带版本号 v=4,go() 打日志进 station-log.txt。
import http from "http";
import os from "os";
import path from "path";
import { chromium } from "playwright";

const VERSION = 4;
const PORT = parseInt(process.env.XHS_PORT || "8848", 10);
const TOKEN = process.env.XHS_TOKEN || "";
const PROFILE = path.join(os.homedir(), ".xhs-station-profile");
const MAX_TEXT = parseInt(process.env.XHS_MAX_TEXT || "12000", 10);

let ctx = null;
let page = null;

// —— 锁:所有浏览器操作排队,绝不并发动同一个页面 ——
let chain = Promise.resolve();
function locked(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(() => {}, () => {});
  return run;
}

// —— 硬超时:任何一步卡过 ms 就放弃,绝不无限等 ——
function withTimeout(p, ms, label) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(label + " 超时(" + ms + "ms)")), ms); });
  return Promise.race([Promise.resolve(p).finally(() => clearTimeout(t)), timeout]);
}

async function ensure() {
  if (ctx && page && !page.isClosed()) return;
  ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    locale: "zh-CN",
    args: ["--disable-blink-features=AutomationControlled"],
  });
  page = ctx.pages()[0] || (await ctx.newPage());
}

async function go(url) {
  console.error("[go] →", url);
  await ensure();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
  } catch (e) {
    console.error("[go] goto 没等到加载完,直接读现有内容:", e.message);  // 不抛,继续读
  }
  await page.waitForTimeout(2000);
  for (let i = 0; i < 3; i++) {                 // 滚几下加载信息流,每步都容错
    try { await page.mouse.wheel(0, 2000); } catch {}
    await page.waitForTimeout(1000);
  }
  let title = "";
  try { title = await withTimeout(page.title(), 5000, "取标题"); } catch (e) { console.error("[go]", e.message); }
  let text = "";
  try {
    text = (await withTimeout(page.evaluate(() => (document.body ? document.body.innerText : "")), 10000, "读正文")).trim();
  } catch (e) {
    console.error("[go] 读正文失败:", e.message);
  }
  let curUrl = url;
  try { curUrl = page.url(); } catch {}
  const needLogin = /登录|扫码|手机号登录/.test(title) || text.length < 80;
  console.error("[go] ←", JSON.stringify(title), "正文长度", text.length, needLogin ? "(疑似没登录)" : "");
  return { ok: true, url: curUrl, title, need_login: needLogin, text: text.slice(0, MAX_TEXT) };
}

function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

async function handleGo(res, url) {
  try {
    const data = await locked(() => withTimeout(go(url), 45000, "整次读取"));
    if (!data) return send(res, 500, { ok: false, error: "内部异常:读取没返回结果" });
    return send(res, 200, data);
  } catch (e) {
    console.error("[handleGo] 报错:", e && e.stack ? e.stack : e);
    return send(res, 500, { ok: false, error: String(e && e.message ? e.message : e) });
  }
}

const server = http.createServer((req, res) => {
  let u;
  try { u = new URL(req.url, "http://x"); } catch { return send(res, 400, { ok: false, error: "bad url" }); }
  if (TOKEN && u.searchParams.get("token") !== TOKEN) return send(res, 401, { ok: false, error: "bad token" });

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

server.listen(PORT, "0.0.0.0", async () => {
  console.log(`小红书工位 v${VERSION} 起来了,听 :${PORT}。`);
  console.log("浏览器这就弹出来。没登录的话,在那个窗口里登一次小红书(小号),登录态会记住。");
  console.log("关掉这个终端窗口 = 收工。");
  try { await ensure(); } catch (e) { console.error("开浏览器失败:", e.message); }  // 只开窗口,不自动导航(避免卡)
});
