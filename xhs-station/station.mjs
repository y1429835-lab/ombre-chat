// 小红书工位 v8 —— 在桃枝家 Mac 上跑真浏览器(住宅 IP)刷小红书,暮声隔着 SSH 通道读。
//
// v8 突破防爬:不再扒页面/状态(那里没有 token),改成『截小红书自己的 API 返回』——
//   /api/sns/web/.../search/notes(搜索)、homefeed(首页)里每条笔记都带 id + xsec_token,
//   直接拼成完整链接,暮声就能 go 进任意一条看干货。
// 详情页仍用 meta(标题/正文)+ 文字节选(评论);按页面类型裁剪省 token;锁串行 + 硬超时。
import http from "http";
import os from "os";
import path from "path";
import { chromium } from "playwright";

const VERSION = 8;
const PORT = parseInt(process.env.XHS_PORT || "8848", 10);
const TOKEN = process.env.XHS_TOKEN || "";
const PROFILE = path.join(os.homedir(), ".xhs-station-profile");
const MAX_TEXT = parseInt(process.env.XHS_MAX_TEXT || "6000", 10);

let ctx = null;
let page = null;
let apiItems = [];   // 本次导航从小红书 API 截到的笔记(带 token)

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

// 从小红书 API 返回里抽笔记(id + xsec_token + 标题/作者/赞)
function harvest(json) {
  try {
    const items = (json && json.data && (json.data.items || json.data.notes)) || [];
    for (const it of items) {
      const nc = it.note_card || it.noteCard || {};
      const id = it.id || it.note_id || it.noteId;
      const tok = it.xsec_token || it.xsecToken || nc.xsec_token || nc.xsecToken || "";   // 用笔记的 token,不是作者的
      if (!id || !tok) continue;
      const ii = nc.interact_info || nc.interactInfo || {};
      apiItems.push({
        id,
        token: tok,
        title: String(nc.display_title || nc.title || "").replace(/\s+/g, " ").trim().slice(0, 80),
        author: String((nc.user || {}).nickname || (nc.user || {}).nick_name || "").trim(),
        likes: String(ii.liked_count || ii.likedCount || ""),
        comments: String(ii.comment_count || ii.commentCount || ""),
      });
    }
  } catch {}
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
  // 挂一次:截住小红书的搜索/首页 API,拿带 token 的笔记
  page.on("response", async (resp) => {
    try {
      const url = resp.url();
      if (!/\/api\/sns\/web\/.*(search\/notes|homefeed|feed)/.test(url)) return;
      if (!/json/.test(resp.headers()["content-type"] || "")) return;
      harvest(JSON.parse(await resp.text()));
    } catch {}
  });
}

async function go(url) {
  console.error("[go] →", url);
  await ensure();
  apiItems = [];                       // 清空,准备截这次导航的 API
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
  } catch (e) {
    console.error("[go] goto 没等到加载完,直接读现有内容:", e.message);
  }
  await page.waitForTimeout(2500);
  for (let i = 0; i < 4; i++) {         // 滚几下:加载更多结果(更多 API)+ 信息流
    try { await page.mouse.wheel(0, 2200); } catch {}
    await page.waitForTimeout(1000);
  }

  // 详情页用的 meta + 文字
  let meta = { pageTitle: "", ogTitle: "", desc: "", text: "" };
  try {
    meta = await withTimeout(page.evaluate((MAX) => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const metaC = (sel) => clean(document.querySelector(sel)?.getAttribute("content"));
      const bodyText = (document.body ? document.body.innerText : "").replace(/\n{3,}/g, "\n\n").trim();
      return {
        pageTitle: document.title,
        ogTitle: metaC('meta[property="og:title"]'),
        desc: metaC('meta[name="description"]'),
        text: bodyText.slice(0, MAX),
      };
    }, MAX_TEXT), 10000, "读页面");
  } catch (e) {
    console.error("[go] 读页面失败:", e.message);
  }

  // 笔记列表:用截到的 API(带 token),拼完整链接
  const seen = new Set();
  const notes = [];
  for (const n of apiItems) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    notes.push({
      title: n.title || "(无题)",
      author: n.author,
      likes: n.likes,
      comments: n.comments,
      url: "https://www.xiaohongshu.com/explore/" + n.id + "?xsec_token=" + encodeURIComponent(n.token) + "&xsec_source=pc_search",
    });
    if (notes.length >= 15) break;
  }

  let curUrl = url;
  try { curUrl = page.url(); } catch {}
  const isNote = /\/(explore|discovery\/item)\/[0-9a-fA-F]{8,}/.test(curUrl);
  let text = cleanText(meta.text);
  let outNotes = notes;
  if (isNote) {
    const idx = text.search(/共\s*[\d.万]+\s*条评论/);
    if (idx >= 0) text = text.slice(idx);     // 详情页:从"共N条评论"起 = 只留评论
    text = text.slice(0, 2800);
    outNotes = notes.slice(0, 5);             // 详情页:相关笔记留几条
  } else {
    text = outNotes.length ? "" : text.slice(0, 1500);   // 列表页:有清单就不发正文
  }

  const needLogin = /登录|扫码|手机号登录/.test(meta.pageTitle) || /当前笔记暂时无法浏览/.test(meta.text)
    || (text.length < 60 && outNotes.length === 0 && !meta.desc);
  console.error("[go] ←", JSON.stringify(meta.pageTitle), "| 笔记", outNotes.length, "条 | 正文", text.length, "字", needLogin ? "(疑似没登录)" : "");
  return {
    ok: true, url: curUrl, need_login: needLogin,
    pageTitle: meta.pageTitle, ogTitle: meta.ogTitle, desc: meta.desc,
    notes: outNotes, text,
  };
}

function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

async function handleGo(res, url) {
  try {
    const data = await locked(() => withTimeout(go(url), 55000, "整次读取"));
    if (!data) return send(res, 500, { ok: false, error: "内部异常:读取没返回结果" });
    return send(res, 200, data);
  } catch (e) {
    console.error("[handleGo] 报错:", e && e.stack ? e.stack : e);
    return send(res, 500, { ok: false, error: String(e && e.message ? e.message : e) });
  }
}

// 截图:导航到笔记,截一张 PNG 直接回二进制(给暮声 Read 看图里的内容)
async function handleShot(res, url) {
  try {
    const buf = await locked(() => withTimeout((async () => {
      await ensure();
      try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 }); } catch {}
      await page.waitForTimeout(2800);
      return await page.screenshot({ type: "png" });
    })(), 45000, "截图"));
    res.writeHead(200, { "Content-Type": "image/png" });
    res.end(buf);
  } catch (e) {
    return send(res, 500, { ok: false, error: String(e && e.message ? e.message : e) });
  }
}

const server = http.createServer((req, res) => {
  let u;
  try { u = new URL(req.url, "http://x"); } catch { return send(res, 400, { ok: false, error: "bad url" }); }
  if (TOKEN && u.searchParams.get("token") !== TOKEN) return send(res, 401, { ok: false, error: "bad token" });

  if (u.pathname === "/health") return send(res, 200, { ok: true, v: VERSION });
  if (u.pathname === "/shot") {
    const url = u.searchParams.get("url") || "";
    if (!/^https?:\/\//.test(url)) return send(res, 400, { ok: false, error: "url 要带 http(s)://" });
    return handleShot(res, url);
  }
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
