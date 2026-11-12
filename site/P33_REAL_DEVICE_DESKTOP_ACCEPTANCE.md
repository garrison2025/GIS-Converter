# P33｜GIS Converter：原生 GDAL 兼容性与真实设备验收单

**项目**：https://gis-converter.pages.dev/  
**当前发布策略**：工程预览，`noindex`；19 个免费浏览器本地转换页面。没有正式 .com 域名、Search Console 发布，也没有启用 Pancake/Waffo 收费。  
**证据原则**：原生 GDAL 读取通过 ≠ QGIS 桌面界面已验证；Linux Playwright WebKit ≠ 真实 iPhone Safari；KML 时间标签一致 ≠ Google Earth Pro 动画已实际播放。

## A. 本轮可以自动完成的专业文件互操作性

使用 GitHub Actions `P33 independent native GDAL/OGR desktop-reader compatibility`，安装操作系统的 `gdal-bin`，让原生 `ogr2ogr/ogrinfo` 作为**独立进程、单独安装的本地 GIS 文件生产者/消费者**。网站仍在浏览器内运行 GDAL/WebAssembly。注意二者共享 GDAL 项目算法，因此是独立运行环境互操作性，不是两个完全不同厂商的解析器交叉证明。

| 编号 | 网站页面（浏览器实际文件下载） | 原生桌面格式验收 | 成功判据 |
| --- | --- | --- | --- |
| N1 | GeoJSON → SHP ZIP | 原生 `ogr2ogr` 解压后读取 Shapefile 和 DBF | 2 条要素、3 个多边形部件、1 个内孔、面积 20、UTF-8 中文属性及整数未丢失 |
| N2 | 先原生 `ogr2ogr` 生成 EPSG:3857 Shapefile → 网站 SHP → GeoJSON | 原生 GDAL 先投影、再读取网站输出 | 数百万量级米制坐标正确还原到 116.4/39.9 经纬度；文本、整数属性一致 |
| N3 | KML → KMZ | 解压网站 KMZ 中的 `doc.kml`，原生 KML 驱动读取 | 两个点 116.4/39.9、114.1/22.5 都存在 |
| N4 | CSV → KML | 原生 `ogr2ogr` KML 驱动读取 | 两条点要素和经纬度均一致 |
| N5 | KML → GPX | 原生 OGR GPX 驱动的 `waypoints` 图层读取 | 两个航点经纬度均一致 |
| N6 | Apache-2.0 公开 GPS 样本 GPX → KMZ | 原生 `ogrinfo` 打开来源 GPX，解压下载 KMZ 并单独对照 KML 的 `gx:Track` | 源文件 104 点的时间、经纬度、海拔逐项对应；**不称为 Google Earth Pro 播放通过** |

运行环境是 Linux Ubuntu GitHub Runner；下载文件、构造测试输入都在临时目录中，脚本结束后删除；验收 JSON 只保留统计、哈希及结果，不写入原始 GPS 路线/时间。

**运行状态**：以对应 GitHub Actions 成功结果为准。只有 `6/6` 且正式分支 CI 成功，才算自动验收完成。

## B. 真正的 QGIS 桌面软件验收（待实际人工操作）

测试文件都在仓库目录 `site/test-fixtures/manual-acceptance/`，可通过 GitHub 下载原始文件：

- `p33-polygon-with-hole.geojson`：有一个 4×4 正方形和 1×1 内孔，净面积 15（坐标单位的平方）；网页转换后的 SHP 应在 QGIS 中保留该内孔
- `p33-two-points.kml`：2 个点（116.4,39.9）和（114.1,22.5）
- `p33-two-points.csv`：两个经纬度、名称的表格
- 公开 GPX：`site/test-fixtures/public-gpx/etrex20x-real-track.gpx`（104 点）

按照下面场景在**用户实际电脑的 QGIS**中操作，逐项记录 QGIS 版本、系统、截图与通过/失败：

1. 在网站 `/converter/geojson-to-shp/` 上传带孔 GeoJSON，下载 ZIP，在 QGIS 中直接加载 ZIP 或解压后的 `.shp`；放大后确认洞没有被填充，属性表 `Label`、`Count` 正确，图层坐标系可识别。
2. 在 `/converter/kml-to-kmz/` 上传两点 KML，下载 KMZ，QGIS 加载其中 `doc.kml`（必要时先解压），确认两点与原 KML 叠加。
3. 对转换生成的 Shapefile 进行一次 QGIS 内部另存为 GeoJSON，用另外的 GIS Viewer 比较数量、几何和坐标，避免单靠同一个转换器回环认证。
4. **判定**：实际 QGIS 加载和坐标/属性人工检查全部通过才能把「QGIS 桌面验收」改为 `PASS`，目前保持 `PENDING`。

## C. Google Earth Pro 时间轴验收（PENDING）

1. 从 GitHub 下载公开的 `etrex20x-real-track.gpx`，上传到网站 `/converter/gpx-to-kmz/`，下载生成的 `.kmz`。
2. 在 **Google Earth Pro 桌面版**中用「文件 → 打开」导入 KMZ。展开轨迹对象，确认实际渲染为线路而不是仅有文件名。
3. 检查是否有时间轴控件和播放按钮；实际拖动、播放，观察轨迹随时间移动，并与 GPX 的起止时间、104 个点及高程位置对照。
4. 若时间轴未出现、显示为空或无法播放，即使自动程序中的 `gx:Track` 标签和 104 对时间坐标都正确，也标记 **FAIL**，保存 Earth Pro 版本、操作系统、问题截图和 KMZ。
5. 仅在真实软件操作通过之后才标记 `EARTH_PRO_PLAYBACK=PASS`。不拿原生 OGR 的普通 KML 点读取替代时间轨迹播放。

## D. 真正手机浏览器验收（PENDING）

| 设备 | 必测内容 | 通过条件 |
| --- | --- | --- |
| iPhone + Safari | 「文件」应用选择 `p33-two-points.kml` → KML→GeoJSON → 下载 → 「文件」中查看，重复第二次转换 | 无 Safari 内存重载、无文件选择失败，GeoJSON 2 个点，经纬度正确；新文件取代旧结果 |
| iPhone + Safari | GPX→KMZ → 保存到「文件」→ 与 Mac/PC 地图工具互传 | 真实生成 KMZ 可找到、可保存和分享，大小非零 |
| Android + Chrome | 两点 CSV → KML → 系统下载列表 → 打开/分享 | 有效 KML、2 个点、无空白下载，第二次转换可以完成 |
| Android + Firefox（可选） | KML→GeoJSON，取消与重试 | 页面无横向溢出、按钮有反馈、旧下载清理、生成的新文件正确 |

记录每台设备的真实机型、系统版本、浏览器版本、网络环境、两个文件的下载及截图；其中任何一项缺失，不写「真机全部通过」。

## E. 屏幕阅读器（PENDING）

- Windows NVDA + Firefox/Chrome：Tab 是否首先找到 Skip link，文件选择描述是否读出，Convert 按钮、状态变化、错误提示和下载链接能否按键操作。
- macOS/iOS VoiceOver + Safari：对文件输入、错误公告、结果焦点和质量检查的读屏次序逐项核对。
- Android TalkBack + Chrome：点击目标大小、表单提示、转换结果的可达性及下载操作。

自动化测试只验证焦点和 DOM 语义，不代替 NVDA/VoiceOver/TalkBack 的真实语音播报。

## 记录模板

| 验收类别 | 当前状态 | 设备/版本/证据 |
| --- | --- | --- |
| Native OGR on CI | `PENDING`，以 P33 CI 和公网验收为准 | `p33-native-*-results.json` |
| Real QGIS desktop | `PENDING` | 待记录 |
| Real Google Earth Pro time playback | `PENDING` | 待记录 |
| Physical iOS Safari | `PENDING` | 待记录 |
| Physical Android Chrome | `PENDING` | 待记录 |
| NVDA / VoiceOver / TalkBack | `PENDING` | 待记录 |

### 后续 SEO 上线门槛

真正购买并绑定 `.com` 正式域名，确认 HTTP/HTTPS、www 301、Pages production commit、20 个 canonical 和 sitemap 实站 200/XML 后，再明确批准将 `GIS_SEO_LAUNCH=approved` 写入生产变量，单独提交 GSC。P33 不会开放索引、不购买域名，也不启用 SaaS 收费。真正商业化支付平台仍计划使用 **Pancake/Waffo**。
