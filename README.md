# #petitplanet YouTube 最新视频看板

这个文件夹包含一个本地 HTML 看板，用来追踪 YouTube `#petitplanet` 相关的近 24 小时和近 30 天视频。

## 文件

- `dashboard.html`：可直接打开的看板页面，刷新脚本会自动生成
- `index.html`：GitHub Pages 首页，刷新脚本会自动生成
- `template.html`：看板模板页面
- `scripts/update-youtube-dashboard.mjs`：每日更新脚本
- `.github/workflows/update-dashboard.yml`：GitHub Pages 每日自动刷新任务
- `data/latest.json`：看板当前数据
- `data/history-*.json`：每日历史数据
- `snapshots/*.html`：YouTube 搜索结果页面快照

## 手动刷新

```bash
/Users/alisonlyn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/update-youtube-dashboard.mjs
```

刷新后打开 `dashboard.html` 即可查看最新看板。

## GitHub Pages

仓库发布后，公开看板链接为：

```text
https://alisonlynn2026.github.io/petitplanet-dashboard/
```

GitHub Actions 会在每天北京时间 09:00 自动运行刷新脚本，更新 `index.html`，并提交回仓库。

## 采集口径

- 近 24 小时搜索地址：`https://www.youtube.com/results?search_query=%23petitplanet&sp=EgIIAg%253D%253D`
- 近 30 天搜索地址：`https://www.youtube.com/results?search_query=%23petitplanet&sp=EgIIBA%253D%253D`
- 筛选方式：YouTube 搜索结果使用上传日期过滤，再由脚本保留指定时间范围内且文本匹配 Petit Planet 的视频
- 时间范围：24 小时内发布、30 天内发布
- 明细字段：预览封面、视频链接、标题、用户 ID / 频道 ID、视频语言、浏览量
- 排序方式：明细按浏览量从高到低；30 天 Tab 展示浏览量前 10 条
- 时间展示：UTC+8 时区，24 小时制
- 历史趋势：从 `data/history-*.json` 汇总每天最后一次刷新时的 24 小时新增视频数，并在「历史趋势」Tab 展示折线图
- 语言字段优先读取 YouTube 页面元数据；页面未提供时，根据标题和描述做脚本语言推断
