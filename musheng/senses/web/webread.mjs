// 暮声的 VPS 网页阅读器（一次性）—— 直接从 VPS 读「不封 VPS IP」的站：维基、谷歌、论坛直链、英文博客。
// 小红书不走这（它封 VPS、要登录），继续走 xhs.sh（你家 Mac 的住宅 IP）。
//
// 一次一页：开 chromium → 读 → 抽正文 → 砍到上限 → 关掉。这样在 2G 小 VPS 上内存只瞬间冒一下；
// 图片/字体/媒体一律不加载（只要文字），省内存、省流量、也省 token（只把正文节选喂给暮声）。
//
// 用法：  node webread.mjs go <url>        # 读某一页
//         node webread.mjs search <关键词…> # 搜索（默认谷歌，结果带可点链接）
import { chromium } from "playwright";

const MAX = parseInt(process.env.WEB_MAX_TEXT || "5000", 10);   // 正文最多多少字（token 闸）
const ENGINE = (process.env.WEB_ENGINE || "google").toLowerCase();  // google | duckduckgo
const NAV_TIMEOUT = parseInt(process.env.WEB_NAV_TIMEOUT || "25000", 10);

const mode = (process.argv[2] || "go").toLowerCase();
const arg = process.argv.slice(3).join(" ").trim();

if (!arg) { console.log("用法: web go <url> | web search <关键词>"); process.exit(0); }

let url = arg;
if (mode === "search") {
  url = ENGINE === "duckduckgo"
    ? "https://duckduckgo.com/html/?q=" + encodeURIComponent(arg)
    : "https://www.google.com/search?q=" + encodeURIComponent(arg) + "&hl=en";
} else if (!/^https?:\/\//.test(url)) {
  url = "https://" + url;
}

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function clean(raw) {
  // 行首命中这些 = 界面词/信息框标签/维基样板，整行丢
  const badStart = /^(Skip to|Jump to|Privacy|Cookie|Accept|Sign ?in|Log ?in|Subscribe|Advertisement|Menu|Share this|Related Articles?|Navigation|Toggle|From Wikipedia|This article is about|For other uses|For the |.+ redirects here|Retrieved from|Categories:|Hidden categories|Authority control|Kingdom:|Phylum:|Class:|Order:|Family:|Genus:|Species:|Subfamily:|Superfamily:|Tribe:|Subspecies:|Domain:|Clade:|Conservation status|Scientific classification|Temporal range|Binomial name|Synonyms|Edit links?|Contents$|Talk$|Read$|View (source|history)|Tools$|Download|Print\/export)/i;
  const out = [];
  for (let line of String(raw || "").split("\n")) {
    line = line.trim();
    if (!line) continue;
    if (line.length < 3) continue;                         // 单字/碎渣（地质年代表那种 N、Pg…）
    if (/^[\p{Lu}\p{P}\s]{1,4}$/u.test(line)) continue;    // 全大写/符号的短碎块
    if (badStart.test(line)) continue;
    if (out.length && out[out.length - 1] === line) continue;   // 去连续重复
    out.push(line);
  }
  return out.join("\n");
}

(async () => {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",                          // root 跑必须关沙箱
        "--disable-dev-shm-usage",               // 小 VPS 的 /dev/shm 太小
        "--disable-blink-features=AutomationControlled",
        "--disable-gpu",
      ],
    });
    const ctx = await browser.newContext({ locale: "en-US", userAgent: UA, viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    // 只要文字：图片/字体/媒体一律拦掉（省内存/流量/时间）
    await page.route("**/*", (route) => {
      const t = route.request().resourceType();
      if (t === "image" || t === "media" || t === "font") return route.abort();
      return route.continue();
    });
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    } catch (e) {
      console.error("[goto] 没等到完全加载，读现有内容：", e.message);
    }
    await page.waitForTimeout(1800);

    const data = await page.evaluate(({ MAX, mode }) => {
      const clip = (s) => (s || "").replace(/\s+/g, " ").trim();
      const title = document.title || "";
      const desc = document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
      let results = [];
      if (mode === "search") {
        const seen = new Set();
        document.querySelectorAll("a").forEach((a) => {
          const h = a.querySelector("h3");
          const href = a.href || "";
          if (!h || !/^https?:\/\//.test(href)) return;
          if (/google\.|duckduckgo\.|gstatic|youtube\.com\/redirect|\/aclk\?/.test(href)) return; // 跳过引擎自身/广告
          const t = clip(h.textContent);
          if (!t || seen.has(href)) return;
          seen.add(href);
          results.push({ title: t.slice(0, 120), url: href });
        });
        results = results.slice(0, 12);
      }
      let text = "";
      try {
        // 先锁定"正文区"，而不是整页（维基/多数文章站都有这些容器）
        const root = document.querySelector("#mw-content-text .mw-parser-output")
          || document.querySelector("article")
          || document.querySelector("main")
          || document.querySelector('[role="main"]')
          || document.querySelector("#bodyContent, #content")
          || document.body;
        const b = root.cloneNode(true);
        // 把信息框/表格/侧栏/导航/引用角标/编辑链接等噪音整块剥掉
        b.querySelectorAll(
          "script,style,noscript,nav,header,footer,aside,form,svg,button,iframe," +
          "table,figure,sup,.infobox,.navbox,.navbox-inner,.hatnote,.sidebar,.reference," +
          ".reflist,.mw-editsection,.toc,#toc,.thumb,.metadata,.ambox,.shortdescription," +
          ".mw-jump-link,[role=\"navigation\"],[role=\"complementary\"]"
        ).forEach((n) => n.remove());
        text = (b.innerText || "").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX);
      } catch {}
      return { title: clip(title), desc: clip(desc), results, text };
    }, { MAX, mode });

    const lines = [];
    if (data.title) lines.push("【标题】" + data.title);
    if (data.desc) lines.push("【摘要】" + data.desc);
    const body = clean(data.text);
    if (mode === "search" && data.results.length) {
      lines.push("\n【搜索结果】（想看哪条就 web go <链接>）");
      data.results.forEach((r, i) => lines.push(`${i + 1}. ${r.title}\n   ${r.url}`));
    } else if (mode === "search") {
      lines.push("\n（没抓到结构化结果，可能被挡/需要验证——下面是页面文字，自己挑）");
      lines.push(body.slice(0, 1500));
    } else if (body) {
      lines.push("\n【正文·节选】");
      lines.push(body);
    }
    console.log(lines.join("\n") || "（这页没读到内容）");
    await browser.close();
  } catch (e) {
    if (browser) { try { await browser.close(); } catch {} }
    console.log("（读取失败：" + (e && e.message ? e.message : e) + "）");
  }
})();
