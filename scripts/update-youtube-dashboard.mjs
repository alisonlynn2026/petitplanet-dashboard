import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");
const SNAPSHOT_DIR = path.join(ROOT, "snapshots");
const TEMPLATE_PATH = path.join(ROOT, "template.html");
const HASHTAG = "petitplanet";
const TODAY_SEARCH_URL = `https://www.youtube.com/results?search_query=%23${encodeURIComponent(HASHTAG)}&sp=EgIIAg%253D%253D`;
const MONTH_SEARCH_URL = `https://www.youtube.com/results?search_query=%23${encodeURIComponent(HASHTAG)}&sp=EgIIBA%253D%253D`;
const MAX_24H_DETAILS = Number(process.env.MAX_24H_DETAILS || 80);
const MAX_30D_DETAILS = Number(process.env.MAX_30D_DETAILS || 140);
const MAX_CONTINUATION_PAGES = Number(process.env.MAX_CONTINUATION_PAGES || 6);
const DETAIL_CONCURRENCY = Number(process.env.DETAIL_CONCURRENCY || 8);

const headers = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
  "accept-language": "en-US,en;q=0.9",
};

function timestampId(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function stripEmbeddedDataScript(html) {
  return html.replace(
    /\s*<script>\n\s*window\.__DASHBOARD_DATA__ = [\s\S]*?\n\s*<\/script>\n(?=\s*<script>\n\s*const fmt)/,
    "\n",
  );
}

async function fetchText(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Request failed ${res.status} ${res.statusText}: ${url}`);
  return await res.text();
}

async function writeSnapshotViewer({ label, searchUrl, snapshotPath, viewerPath, generatedAt }) {
  const rawName = path.basename(snapshotPath);
  const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(label)} - YouTube 页面快照</title>
    <style>
      body {
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #172026;
        background: #f5f8fa;
      }
      header {
        padding: 22px 24px;
        border-bottom: 1px solid #dbe3e8;
        background: #fff;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 24px;
        letter-spacing: 0;
      }
      p {
        margin: 0;
        color: #63707a;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 16px;
      }
      a {
        color: #9f1721;
      }
      .button {
        display: inline-flex;
        align-items: center;
        min-height: 38px;
        padding: 0 14px;
        border: 1px solid #dbe3e8;
        border-radius: 6px;
        background: #fff;
        color: #172026;
        font-weight: 700;
        text-decoration: none;
      }
      .button.primary {
        color: #fff;
        border-color: #d61f2c;
        background: #d61f2c;
      }
      main {
        padding: 18px 24px 24px;
      }
      .note {
        max-width: 960px;
        padding: 14px 16px;
        border: 1px solid #dbe3e8;
        border-radius: 8px;
        background: #fff;
        color: #4b5963;
        line-height: 1.55;
      }
      iframe {
        width: 100%;
        height: calc(100vh - 220px);
        min-height: 520px;
        margin-top: 16px;
        border: 1px solid #dbe3e8;
        border-radius: 8px;
        background: #fff;
      }
    </style>
  </head>
  <body>
    <header>
      <h1>${escapeHtml(label)}页面快照</h1>
      <p>采集时间：${escapeHtml(generatedAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }))} UTC+8</p>
      <div class="actions">
        <a class="button primary" href="${escapeHtml(rawName)}" target="_blank" rel="noreferrer">打开原始快照</a>
        <a class="button" href="${escapeHtml(searchUrl)}" target="_blank" rel="noreferrer">打开 YouTube 搜索</a>
      </div>
    </header>
    <main>
      <div class="note">下方是本地保存的 YouTube 搜索结果 HTML。YouTube 原始页面依赖大量在线脚本，离线打开时可能无法完全还原交互，但这个文件就是当天刷新时保存下来的页面快照。</div>
      <iframe src="${escapeHtml(rawName)}" sandbox=""></iframe>
    </main>
  </body>
</html>`;
  await fs.writeFile(viewerPath, html);
}

async function fetchJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...headers,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Request failed ${res.status} ${res.statusText}: ${url}`);
  return await res.json();
}

function extractJsonAssignment(html, marker) {
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const jsonStart = html.indexOf("{", start);
  if (jsonStart === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = jsonStart; i < html.length; i += 1) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(html.slice(jsonStart, i + 1));
    }
  }
  return null;
}

function walk(value, visitor) {
  if (!value || typeof value !== "object") return;
  visitor(value);
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visitor);
  } else {
    for (const item of Object.values(value)) walk(item, visitor);
  }
}

function textOf(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value.simpleText) return value.simpleText;
  if (Array.isArray(value.runs)) return value.runs.map((run) => run.text || "").join("");
  return "";
}

function bestThumbnail(thumbnails) {
  const list = thumbnails?.thumbnails || thumbnails || [];
  if (!Array.isArray(list) || !list.length) return "";
  const sorted = [...list].sort((a, b) => (b.width || 0) - (a.width || 0));
  return sorted[0]?.url || "";
}

function parseViewCount(text) {
  if (!text) return null;
  const compact = text.toLowerCase().replace(/,/g, "");
  const match = compact.match(/([\d.]+)\s*([kmb])?/);
  if (!match) return null;
  const n = Number(match[1]);
  const scale = { k: 1_000, m: 1_000_000, b: 1_000_000_000 }[match[2]] || 1;
  return Math.round(n * scale);
}

function parseRelativeAge(text) {
  if (!text) return null;
  const s = text.toLowerCase();
  if (/(minute|minutes|min|mins|second|seconds|sec|secs)/.test(s)) return 0.01;
  const hour = s.match(/(\d+)\s*(hour|hours|hr|hrs)/);
  if (hour) return Number(hour[1]) / 24;
  const day = s.match(/(\d+)\s*(day|days)/);
  if (day) return Number(day[1]);
  if (/yesterday/.test(s)) return 1;
  const week = s.match(/(\d+)\s*(week|weeks)/);
  if (week) return Number(week[1]) * 7;
  const month = s.match(/(\d+)\s*(month|months)/);
  if (month) return Number(month[1]) * 30;
  const year = s.match(/(\d+)\s*(year|years)/);
  if (year) return Number(year[1]) * 365;
  return null;
}

function inferLanguage(text) {
  const sample = text || "";
  if (/[\u3040-\u30ff]/.test(sample)) return { language: "Japanese", source: "inferred from title/description" };
  if (/[\u4e00-\u9fff]/.test(sample)) return { language: "Chinese", source: "inferred from title/description" };
  if (/[\uac00-\ud7af]/.test(sample)) return { language: "Korean", source: "inferred from title/description" };
  if (/[\u0400-\u04ff]/.test(sample)) return { language: "Cyrillic-script language", source: "inferred from title/description" };
  if (/[a-zA-Z]/.test(sample)) return { language: "English or Latin-script language", source: "inferred from title/description" };
  return { language: "Unknown", source: "not available from page metadata" };
}

function normalizeLanguage(code) {
  if (!code) return "";
  const names = new Intl.DisplayNames(["zh-CN"], { type: "language" });
  try {
    return `${names.of(code) || code} (${code})`;
  } catch {
    return code;
  }
}

function isPetitPlanetRelevant(video) {
  return /#?petit\s*planet/i.test(`${video.title}\n${video.descriptionSnippet || ""}`);
}

function sortByViews(videos) {
  return [...videos].sort((a, b) => (Number(b.views) || 0) - (Number(a.views) || 0));
}

function parsePublishedAt(video) {
  const parsed = Date.parse(video.publishedText);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function isWithinDays(video, days) {
  const parsed = Date.parse(video.publishedText);
  if (Number.isFinite(parsed)) return Date.now() - parsed < days * 24 * 60 * 60 * 1000;
  if (video.ageDays !== null && video.ageDays !== undefined) return video.ageDays < days;
  return false;
}

function dateKeyShanghai(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

async function buildHistoryTrend(currentData) {
  const entries = [];
  try {
    const files = await fs.readdir(DATA_DIR);
    for (const file of files.filter((name) => /^history-.*\.json$/.test(name))) {
      try {
        const parsed = JSON.parse(await fs.readFile(path.join(DATA_DIR, file), "utf8"));
        entries.push(parsed);
      } catch {
        // Ignore malformed historical backups so one bad file does not block daily refresh.
      }
    }
  } catch {
    // The first run may not have a data directory yet.
  }
  entries.push(currentData);

  const byDate = new Map();
  for (const item of entries) {
    const generatedAt = item.generatedAt;
    const date = dateKeyShanghai(generatedAt);
    if (!date) continue;
    const point = {
      date,
      generatedAt,
      totalWithin24Hours: Number(item.totalWithin24Hours ?? item.sections?.last24Hours?.totalVideos ?? 0),
      totalViewsWithin24Hours: Number(item.totalViewsWithin24Hours ?? item.sections?.last24Hours?.totalViews ?? 0),
    };
    const existing = byDate.get(date);
    if (!existing || Date.parse(point.generatedAt) > Date.parse(existing.generatedAt)) {
      byDate.set(date, point);
    }
  }

  return [...byDate.values()].sort((a, b) => Date.parse(a.generatedAt) - Date.parse(b.generatedAt));
}

function extractYtcfg(html) {
  const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
  const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1];
  return { apiKey, clientVersion };
}

function continuationFrom(data) {
  let token = "";
  walk(data, (node) => {
    if (token) return;
    token =
      node.continuationCommand?.token ||
      node.nextContinuationData?.continuation ||
      node.reloadContinuationData?.continuation ||
      "";
  });
  return token;
}

function collectSearchVideos(initialData) {
  const found = new Map();
  walk(initialData, (node) => {
    const renderer = node.videoRenderer || node.reelItemRenderer;
    if (!renderer?.videoId || found.has(renderer.videoId)) return;
    const channelRun = renderer.ownerText?.runs?.[0] || renderer.shortBylineText?.runs?.[0] || {};
    const browse = channelRun.navigationEndpoint?.browseEndpoint || {};
    const publishedText = textOf(renderer.publishedTimeText || renderer.publishedTimeTextRun);
    found.set(renderer.videoId, {
      videoId: renderer.videoId,
      title: textOf(renderer.title?.runs ? renderer.title : renderer.headline),
      url: `https://www.youtube.com/watch?v=${renderer.videoId}`,
      channelName: textOf(renderer.ownerText || renderer.shortBylineText),
      userId: browse.canonicalBaseUrl || browse.browseId || "",
      channelId: browse.browseId || "",
      publishedText,
      ageDays: parseRelativeAge(publishedText),
      viewsText: textOf(renderer.viewCountText || renderer.viewCountTextRun),
      views: parseViewCount(textOf(renderer.viewCountText || renderer.viewCountTextRun)),
      thumbnailUrl: bestThumbnail(renderer.thumbnail),
      source: "search page",
    });
  });
  return [...found.values()];
}

function mergeVideos(existing, incoming) {
  const byId = new Map(existing.map((video) => [video.videoId, video]));
  for (const video of incoming) {
    if (!byId.has(video.videoId)) byId.set(video.videoId, video);
  }
  return [...byId.values()];
}

async function collectSearchVideosWithContinuations(initialData, ytcfg, maxVideos) {
  let videos = collectSearchVideos(initialData);
  let token = continuationFrom(initialData);
  let page = 0;

  while (token && videos.length < maxVideos && page < MAX_CONTINUATION_PAGES && ytcfg.apiKey && ytcfg.clientVersion) {
    const data = await fetchJson(`https://www.youtube.com/youtubei/v1/search?key=${ytcfg.apiKey}`, {
      context: {
        client: {
          clientName: "WEB",
          clientVersion: ytcfg.clientVersion,
        },
      },
      continuation: token,
    });
    videos = mergeVideos(videos, collectSearchVideos(data));
    token = continuationFrom(data);
    page += 1;
  }

  return videos.slice(0, maxVideos);
}

function enrichFromWatchPage(video, html) {
  const player = extractJsonAssignment(html, "ytInitialPlayerResponse");
  const initial = extractJsonAssignment(html, "ytInitialData");
  const details = player?.videoDetails || {};
  const micro = player?.microformat?.playerMicroformatRenderer || {};
  let publishedText = video.publishedText;
  let views = video.views;
  let viewsText = video.viewsText;
  let channelName = video.channelName;
  let userId = video.userId;
  let channelId = video.channelId;
  let description = details.shortDescription || "";
  let thumbnailUrl = video.thumbnailUrl;

  if (micro.publishDate || micro.uploadDate) publishedText = micro.publishDate || micro.uploadDate;
  if (details.viewCount) {
    views = Number(details.viewCount);
    viewsText = Number(details.viewCount).toLocaleString("en-US");
  }
  if (details.author) channelName = details.author;
  if (micro.ownerProfileUrl) userId = micro.ownerProfileUrl.replace("https://www.youtube.com/", "");
  if (micro.externalChannelId) channelId = micro.externalChannelId;
  if (micro.thumbnail) thumbnailUrl = bestThumbnail(micro.thumbnail);

  if (initial) {
    walk(initial, (node) => {
      const header = node.videoOwnerRenderer;
      if (!header) return;
      channelName ||= textOf(header.title);
      const browse = header.navigationEndpoint?.browseEndpoint || {};
      userId ||= browse.canonicalBaseUrl || browse.browseId || "";
      channelId ||= browse.browseId || "";
    });
  }

  const declaredLanguage =
    details.language ||
    details.defaultAudioLanguage ||
    player?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.[0]?.languageCode ||
    "";
  const language = declaredLanguage
    ? { language: normalizeLanguage(declaredLanguage), source: "YouTube metadata" }
    : inferLanguage(`${video.title}\n${description}`);

  return {
    ...video,
    title: details.title || video.title,
    publishedText,
    views,
    viewsText,
    channelName,
    userId,
    channelId,
    language: language.language,
    languageSource: language.source,
    thumbnailUrl,
    publishedAt: parsePublishedAt({ publishedText }),
    descriptionSnippet: description.slice(0, 240),
  };
}

function isWithin24Hours(video) {
  return isWithinDays(video, 1);
}

async function enrichVideos(videos) {
  const detailed = new Array(videos.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(DETAIL_CONCURRENCY, videos.length) }, async () => {
    while (nextIndex < videos.length) {
      const index = nextIndex;
      nextIndex += 1;
      const video = videos[index];
      try {
        const watchHtml = await fetchText(video.url);
        detailed[index] = enrichFromWatchPage(video, watchHtml);
      } catch (error) {
        detailed[index] = {
          ...video,
          language: "Unknown",
          languageSource: `detail fetch failed: ${error.message}`,
          publishedAt: parsePublishedAt(video),
        };
      }
    }
  });
  await Promise.all(workers);
  return detailed;
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(SNAPSHOT_DIR, { recursive: true });

  const runAt = new Date();
  const id = timestampId(runAt);
  const todayHtml = await fetchText(TODAY_SEARCH_URL);
  const monthHtml = await fetchText(MONTH_SEARCH_URL);
  const todaySnapshotPath = path.join(SNAPSHOT_DIR, `youtube-petitplanet-today-${id}.html`);
  const monthSnapshotPath = path.join(SNAPSHOT_DIR, `youtube-petitplanet-30days-${id}.html`);
  const todaySnapshotViewerPath = path.join(SNAPSHOT_DIR, `viewer-today-${id}.html`);
  const monthSnapshotViewerPath = path.join(SNAPSHOT_DIR, `viewer-30days-${id}.html`);
  await fs.writeFile(todaySnapshotPath, todayHtml);
  await fs.writeFile(monthSnapshotPath, monthHtml);
  await writeSnapshotViewer({
    label: "近 24 小时",
    searchUrl: TODAY_SEARCH_URL,
    snapshotPath: todaySnapshotPath,
    viewerPath: todaySnapshotViewerPath,
    generatedAt: runAt,
  });
  await writeSnapshotViewer({
    label: "近 30 天",
    searchUrl: MONTH_SEARCH_URL,
    snapshotPath: monthSnapshotPath,
    viewerPath: monthSnapshotViewerPath,
    generatedAt: runAt,
  });

  const todayInitialData = extractJsonAssignment(todayHtml, "ytInitialData");
  const monthInitialData = extractJsonAssignment(monthHtml, "ytInitialData");
  if (!todayInitialData || !monthInitialData) throw new Error("Could not read YouTube search data from the page snapshot.");

  const todayCandidates = await collectSearchVideosWithContinuations(
    todayInitialData,
    extractYtcfg(todayHtml),
    MAX_24H_DETAILS,
  );
  const monthCandidates = await collectSearchVideosWithContinuations(
    monthInitialData,
    extractYtcfg(monthHtml),
    MAX_30D_DETAILS,
  );
  const combinedCandidates = mergeVideos(todayCandidates, monthCandidates);
  const detailed = await enrichVideos(combinedCandidates);

  const relevant = detailed.filter(isPetitPlanetRelevant);
  const recent24h = sortByViews(relevant.filter(isWithin24Hours));
  const recent30dAll = sortByViews(relevant.filter((video) => isWithinDays(video, 30)));
  const recent30dTop = recent30dAll.slice(0, 10);
  const viewSum24h = recent24h.reduce((sum, video) => sum + (Number(video.views) || 0), 0);
  const viewSum30d = recent30dAll.reduce((sum, video) => sum + (Number(video.views) || 0), 0);
  const data = {
    hashtag: `#${HASHTAG}`,
    searchUrl: TODAY_SEARCH_URL,
    monthSearchUrl: MONTH_SEARCH_URL,
    filter: "YouTube search filtered by upload date, then narrowed by exact publish time where available",
    generatedAt: runAt.toISOString(),
    displayTimezone: "Asia/Shanghai",
    snapshotFile: path.relative(ROOT, todaySnapshotPath),
    monthSnapshotFile: path.relative(ROOT, monthSnapshotPath),
    snapshotViewerFile: path.relative(ROOT, todaySnapshotViewerPath),
    monthSnapshotViewerFile: path.relative(ROOT, monthSnapshotViewerPath),
    totalWithin24Hours: recent24h.length,
    totalViewsWithin24Hours: viewSum24h,
    totalWithin30Days: recent30dAll.length,
    totalViewsWithin30Days: viewSum30d,
    scannedVideos: detailed.length,
    relevantScannedVideos: relevant.length,
    videos: recent24h,
    videos30Days: recent30dTop,
    all30DayVideos: recent30dAll,
    allScannedVideos: detailed,
    sections: {
      last24Hours: {
        title: "近 24 小时",
        totalVideos: recent24h.length,
        totalViews: viewSum24h,
        videos: recent24h,
      },
      last30Days: {
        title: "近 30 天",
        totalVideos: recent30dAll.length,
        totalViews: viewSum30d,
        videos: recent30dTop,
      },
    },
    notes: [
      "The 24-hour tab uses YouTube's Upload date: Today filter, then the script keeps only videos that mention Petit Planet and fall within the last 24 hours.",
      "The 30-day tab uses YouTube's Upload date: This month filter with continuation pages, then keeps videos that mention Petit Planet and fall within the last 30 days. The table shows the top 10 by views.",
      "Language is taken from YouTube language/caption metadata when available; otherwise it is inferred from title/description text.",
      "Publish times are displayed in UTC+8 using 24-hour time.",
    ],
  };
  data.historyTrend = await buildHistoryTrend(data);

  await fs.writeFile(path.join(DATA_DIR, "latest.json"), JSON.stringify(data, null, 2));
  await fs.writeFile(path.join(DATA_DIR, `history-${id}.json`), JSON.stringify(data, null, 2));
  const templateSource = (await pathExists(TEMPLATE_PATH)) ? TEMPLATE_PATH : path.join(ROOT, "index.html");
  const template = stripEmbeddedDataScript(await fs.readFile(templateSource, "utf8"));
  const embedded = template.replace(
    "    <script>\n      const fmt",
    `    <script>\n      window.__DASHBOARD_DATA__ = ${JSON.stringify(data).replace(/</g, "\\u003c")};\n    </script>\n    <script>\n      const fmt`,
  );
  await fs.writeFile(path.join(ROOT, "index.html"), embedded);
  await fs.writeFile(path.join(ROOT, "dashboard.html"), embedded);
  console.log(
    `Updated dashboard data: ${recent24h.length} videos within 24 hours; ${recent30dAll.length} videos within 30 days.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
