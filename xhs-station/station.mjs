// 小红书工位 v5 —— 在桃枝家 Mac 上跑真浏览器(住宅 IP)刷小红书,暮声隔着 SSH 通道读。
//
// v5 改动:读取做结构化 ——
//   · 搜索/列表页:抽出"标题 + 笔记链接"清单(暮声能据此 go 进某条);
//   · 笔记详情页:优先用 og:title / meta description 拿这条笔记本身(比扒页面元素稳),
//     再带页面文字节选(含评论);
//   · 仍保留:锁串行、每步硬超时、/health 带版本号、go() 打日志。
import http from "http";
import os from "os";
import path from "path";
import { chromium } from "playwright";

const VERSION = 5;
const PORT = parseInt(process.env.XHS_PORT || "8848", 10);
const TOKEN = process.env.XHS_TOKEN || "";
const PROFILE = path.join(os.homedir(), ".xhs-station-profile");
const MAX_TEXT = parseInt(process.env.XHS_MAX_TEXT || "6000", 10);

let ctx = null;
let page = null;

let chain = Promise.resolve();
function locked(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(() => {}, () => {});
  return run;
}

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
    console.error("[go] goto 没等到加载完,直接读现有内容:", e.message);
  }
  await page.waitForTimeout(2500);
  for (let i = 0; i < 4; i++) {
    try { await page.mouse.wheel(0, 2200); } catch {}
    await page.waitForTimeout(1000);
  }

  let data = { pageTitle: "", ogTitle: "", desc: "", notes: [], text: "" };
  try {
    data = await withTimeout(page.evaluate((MAX) => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const metaC = (sel) => clean(document.querySelector(sel)?.getAttribute("content"));
      // 列表/搜索页:抽"标题 + 笔记链接",去重
      const seen = new Set();
      const notes = [];
      for (const a of document.querySelectorAll("a")) {
        const href = a.href || "";
        const m = href.match(/https?:\/\/(?:www\.)?xiaohongshu\.com\/(?:explore|discovery\/item|search_result)\/[0-9a-fA-F]{8,}/);
        if (!m) continue;
        const u = m[0];
        if (seen.has(u)) continue;
        seen.add(u);
        const t = clean(a.innerText || a.getAttribute("aria-label"));
        if (t) notes.push({ title: t.slice(0, 80), url: u });
        if (notes.length >= 15) break;
      }
      const bodyText = (document.body ? document.body.innerText : "").replace(/\n{3,}/g, "\n\n").trim();
      return {
        pageTitle: document.title,
        ogTitle: metaC('meta[property="og:title"]'),
        desc: metaC('meta[name="description"]'),
        notes,
        text: bodyText.slice(0, MAX),
      };
    }, MAX_TEXT), 10000, "读页面");
  } catch (e) {
    console.error("[go] 读页面失败:", e.message);
  }

  let curUrl = url;
  try { curUrl = page.url(); } catch {}
  const needLogin = /登录|扫码|手机号登录/.test(data.pageTitle) || (data.text.length < 80 && data.notes.length === 0);
  console.error("[go] ←", JSON.stringify(data.pageTitle), "| 笔记", data.notes.length, "条 | 正文", data.text.length, "字", needLogin ? "(疑似没登录)" : "");
  return { ok: true, url: curUrl, need_login: needLogin, ...data };
}

function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

async function handleGo(res, url) {
  try {
    const data = await locked(() => withTimeout(go(url), 50000, "整次读取"));
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
  console.log("浏览器这就弹出来。没登录就在那个窗口里登一次小红书(小号),登录态会记住。");
  console.log("关掉这个终端窗口 = 收工。");
  try { await ensure(); } catch (e) { console.error("开浏览器失败:", e.message); }
});
