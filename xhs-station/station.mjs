// 小红书工位 v7 —— 在桃枝家 Mac 上跑真浏览器(住宅 IP)刷小红书,暮声隔着 SSH 通道读。
//
// v7 改动:
//   · 搜索/列表页:从小红书 SPA 的 window.__INITIAL_STATE__ 里挖出每条笔记的 id + xsecToken,
//     拼成"带 token 的完整链接"(卡片 <a> 里没有 token,只有内部状态里有)。这样暮声能直接 go 进去。
//     挖不到就退回抓 <a> / 文字。
//   · 清洗页面文字:滤掉导航/备案/页脚样板噪音 + 去连续重复;
//   · 笔记详情页:正文用 meta(干净),文字节选从"共N条评论"切起 = 只给评论。
import http from "http";
import os from "os";
import path from "path";
import { chromium } from "playwright";

const VERSION = 7;
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

// 滤掉小红书页面里的导航/备案/页脚样板噪音 + 去连续重复行
const BOILER = [
  /创作中心|业务合作|关于我们|意见反馈|网页版|扫码查看|打开小红书App|问题反馈|返回首页/,
  /沪ICP备|营业执照|公网安备|增值电信|医疗器械|互联网药品|网络文化经营|个性化推荐算法|网信算备|行吟信息|违法不良信息|举报电话|举报中心|举报专区|自营经营者|经营许可/,
  /^©|^地址：|^电话：|^\d{4}-\d{4}$|^2014-20/,
  /^(发现|RED|直播|发布|通知|我|更多|登录|首页|全部|图文|视频|用户|筛选|综合|附近推荐|发送|取消|活动|关注|猜你想搜)$/,
];
function cleanText(raw) {
  const out = [];
  for (let line of String(raw || "").split("\n")) {
    line = line.trim();
    if (!line) continue;
    if (BOILER.some((re) => re.test(line))) continue;
    if (out.length && out[out.length - 1] === line) continue;
    out.push(line);
  }
  return out.join("\n");
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

      // ① 从 SPA 状态里挖带 token 的笔记(防爬的真正突破口)
      const notes = [];
      try {
        const seen = new Set();
        const stack = [window.__INITIAL_STATE__];
        let budget = 30000;
        while (stack.length && budget-- > 0) {
          const o = stack.pop();
          if (!o || typeof o !== "object") continue;
          const id = o.id || o.noteId;
          const token = o.xsecToken || o.xsec_token;
          if (id && token && /^[0-9a-fA-F]{20,}$/.test(String(id)) && !seen.has(id)) {
            seen.add(id);
            const card = o.noteCard || o.note_card || o;
            const user = card.user || o.user || {};
            const ii = card.interactInfo || card.interact_info || {};
            notes.push({
              title: clean(card.displayTitle || card.display_title || card.title).slice(0, 80),
              author: clean(user.nickname || user.nickName),
              likes: String(ii.likedCount || ii.liked_count || "").slice(0, 12),
              url: "https://www.xiaohongshu.com/explore/" + id + "?xsec_token=" + encodeURIComponent(token) + "&xsec_source=pc_search",
            });
          }
          for (const k in o) { const v = o[k]; if (v && typeof v === "object") stack.push(v); }
        }
      } catch (e) { /* 没有就退回别的法子 */ }

      // ② 退路:抓 <a> 里的笔记链接(多半没 token,但聊胜于无)
      if (notes.length === 0) {
        const seen = new Set();
        for (const a of document.querySelectorAll("a")) {
          const m = (a.href || "").match(/https?:\/\/(?:www\.)?xiaohongshu\.com\/(?:explore|discovery\/item|search_result)\/[0-9a-fA-F]{8,}[^"'\s]*/);
          if (!m) continue;
          if (seen.has(m[0])) continue;
          seen.add(m[0]);
          const t = clean(a.innerText || a.getAttribute("aria-label"));
          if (t) notes.push({ title: t.slice(0, 80), author: "", likes: "", url: m[0] });
          if (notes.length >= 15) break;
        }
      }

      const bodyText = (document.body ? document.body.innerText : "").replace(/\n{3,}/g, "\n\n").trim();
      return {
        pageTitle: document.title,
        ogTitle: metaC('meta[property="og:title"]'),
        desc: metaC('meta[name="description"]'),
        notes: notes.slice(0, 15),
        text: bodyText.slice(0, MAX),
      };
    }, MAX_TEXT), 10000, "读页面");
  } catch (e) {
    console.error("[go] 读页面失败:", e.message);
  }

  let curUrl = url;
  try { curUrl = page.url(); } catch {}

  // 按页面类型裁剪 + 清洗,省 token 又不丢内容
  const isNote = /\/(explore|discovery\/item)\/[0-9a-fA-F]{8,}/.test(curUrl);
  let text = cleanText(data.text);
  if (isNote) {
    const idx = text.search(/共\s*[\d.万]+\s*条评论/);
    if (idx >= 0) text = text.slice(idx);          // 从"共N条评论"起 = 只留评论,跳过前面导航/标题
    data.notes = data.notes.slice(0, 5);
    data.text = text.slice(0, 2800);
  } else {
    data.text = data.notes.length ? "" : text.slice(0, 1500);
  }

  const needLogin = /登录|扫码|手机号登录/.test(data.pageTitle) || /当前笔记暂时无法浏览/.test(data.text)
    || (data.text.length < 60 && data.notes.length === 0 && !data.desc);
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

// 诊断:搜一下,把 __INITIAL_STATE__ 里 xsecToken 附近的结构 dump 出来,好对症修挖链接的逻辑
async function handleDebug(res) {
  try {
    const out = await locked(() => withTimeout((async () => {
      await ensure();
      try { await page.goto("https://www.xiaohongshu.com/search_result?keyword=美食", { waitUntil: "domcontentloaded", timeout: 25000 }); } catch {}
      await page.waitForTimeout(3500);
      return await page.evaluate(() => {
        const st = window.__INITIAL_STATE__ || {};
        let s = ""; try { s = JSON.stringify(st); } catch (e) { s = ""; }
        const i = s.search(/xsec/i);
        return { keys: Object.keys(st), len: s.length, hasXsec: i >= 0, around: i >= 0 ? s.slice(Math.max(0, i - 700), i + 500) : s.slice(0, 1200) };
      });
    })(), 45000, "debug"));
    return send(res, 200, { ok: true, ...out });
  } catch (e) {
    return send(res, 500, { ok: false, error: String(e && e.message ? e.message : e) });
  }
}

const server = http.createServer((req, res) => {
  let u;
  try { u = new URL(req.url, "http://x"); } catch { return send(res, 400, { ok: false, error: "bad url" }); }
  if (TOKEN && u.searchParams.get("token") !== TOKEN) return send(res, 401, { ok: false, error: "bad token" });

  if (u.pathname === "/health") return send(res, 200, { ok: true, v: VERSION });
  if (u.pathname === "/debug") return handleDebug(res);
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
