# P53｜GIS Converter QGIS 桌面、KML 与真实设备发布验收

本阶段补强已有的 P43 自动化：运行器安装实际 QGIS 桌面及 Qt 画布，而不是只调用 GDAL CLI。QGIS 的 Qt 截图仍不等于人类实际操作软件。

## 自动化证据

1. 浏览器真实转换 Shapefile：QGIS 分别检查两幅面、一个内环洞、多部件图形、UTF-8 中文 DBF 和数字字段。
2. QGIS 检查原生 CP1252 Shapefile、浏览器转换的 UTF-8 GeoJSON，以及 EPSG:3857 投影到 WGS84 的输出。
3. **P53 新增：** 两条不同名字和 Code 的 GIS 线要素，浏览器执行 GeoJSON → KML → GeoJSON。安装版 QGIS 实际加载两份浏览器下载文件，逐条以唯一坐标匹配每条线的 3 个顶点和 Name、Code，阻止仅凭要素数断言属性没有串行。
4. **P53 新增：** QGIS `QgsMapCanvas` 在 Qt offscreen 绘制真实输出图层，实际 PNG 除尺寸/字节数外，还必须拥有真实非白地图样本像素。
5. 浏览器模拟低内存、真实 GDAL/WASM、19 条线上转换路线、19 份预览、Cloudflare 精确 SHA、noindex 保持独立检查。

## P54｜下载与核对可复现的 QGIS 验收数据

P53 原有工作流只上传 JSON 和截图，**没有归档实际 Shapefile、KML 和 GeoJSON 文件**。P54 在独立 QGIS Qt 验收成功后，新增只含合成数据的验收工件：

1. 打开 [GIS Converter GitHub Actions](https://github.com/garrison2025/GIS-Converter/actions)，选择 **GIS Converter P53 QGIS Qt KML desktop interoperability and release boundary** 工作流，进入与要复核的提交 SHA 对应且成功的运行。
2. 在该运行 **Artifacts** 下载 **gis-p53-real-qgis-qt-kml-interoperability**。其中 **p54-qgis-release-artifacts/qgis-fixtures/** 保存被真实浏览器转换、并经实际安装 PyQGIS Qt 验证的 SHP/SHX/DBF/PRJ、存在时的 CPG/QPJ、KML、GeoJSON 和 Qt 截图；不要把它们误认为真人操作记录。
3. 打开 **p54-qgis-release-artifacts/manifest.json**，先确认 status 为 **AUTOMATED_QGIS_PASSED_MANUAL_NOT_TESTED**，expectedCommit 与 GitHub 运行提交 SHA 一致，manualQgisInteraction、physicalDevice 均为 **NOT_TESTED**。
4. 用 SHA-256 工具逐个核对 manifest.json 中每个文件的 bytes 与 sha256。例如 Windows PowerShell 可用命令 Get-FileHash -Algorithm SHA256 加上实际文件路径；若文件缺失、散列不一致或 SHA 与部署版本不符，**不得签核**。
5. Shapefile 文件应保持同名 SHP/SHX/DBF/PRJ 及实际生成的 CPG 放在同一文件夹中再用 QGIS 打开。按下面的人工操作步骤逐项核对并留存独立真人证据。

本阶段归档程序只打包**明确列出的合成测试文件**，不会递归上传整个工作目录或用户转换文件。仅有自动化截图、仿真设备通过或 GitHub 工作流绿灯，仍不代表 Windows/macOS 真人 QGIS 或实体手机通过。

## P55｜QGIS 验收文件与实际归档字节强绑定

P54 已提供 SHA-256 文件清单，但其清单原先由归档时计算；如果数据文件在独立 QGIS 读入后、归档之前被替换，单纯计算归档哈希不能证明它是 **QGIS 实际验收过的同一文件**。

P55 使独立 PyQGIS Qt 验收在读取测试数据前后分别计算限定合成 GIS 文件的 SHA-256，并检查测试期间没有变化；完成地图截图后再对截图计算哈希。成功时 `qgis-desktop-evidence.json` 记录 `hashAlgorithm: SHA-256` 和 `acceptedFileSHA256`，**不包含任何真实用户上传内容**。P54 归档器针对每一份受验收文件重新计算 SHA-256，并严格比对 QGIS 记录，连 DBF/SHX/PRJ/CPG 文件也不例外；任何缺项、文件集合不一致、字节被替换都会拒绝生成验收包。

`manifest.json` 增加 `qgisByteBound: true`，表示已做此项一致性检查；它仍**不表示**真实 Windows/macOS 人工操作、实体 Android/iPhone 测试或生产可上线。QGIS 的哈希与浏览器特定 KML/GeoJSON 下载哈希各自独立，不能互相代替。

## QGIS 手动操作｜NOT_TESTED

- 在 Windows 或 macOS 安装正式 QGIS Desktop，并记录版本、操作系统、日期和执行者。
- 用从此项目 GitHub Actions 产物中取得的**实际** `p43-browser-polygon.shp` 及相关 `.shx/.dbf/.prj/.cpg` 打开图层，查看两个要素、一个孔洞和多个面部件。人工打开属性表，核对中文 Label 和 Count。
- 再打开 `p53-browser-survey-lines.kml` 与 `p53-browser-survey-lines-roundtrip.geojson`，对比两条线各 3 个顶点和 Name/Code 是否与几何正确配对。
- 实际缩放、选取要素、保存 QGIS 项目文件，关闭软件、重启并重新打开；收集截图或录屏，记录任何失败的复现步骤。
- **没有真人桌面操作证据之前，不得标记通过。**

## 真实手机｜NOT_TESTED

- 至少用真实 Android 低内存设备和 iPhone Safari（若具备设备），记录设备型号、操作系统、浏览器版本和可核验的设备内存信息；Playwright `deviceMemory=1` 不代表真实手机硬件。
- 在 `https://gis-converter.pages.dev/` 上传合成、非隐私文件，转换 KML、GeoJSON 和 Shapefile，实际把下载保存到手机文件管理器并重新导入检查。
- 验证节省内存模式、取消→重试、重复转换、页面切后台后返回、屏幕旋转和三文件批量 ZIP。
- 保存成功/失败截图与人工签名。**无真实设备证据则仍为 NOT_TESTED。**

## Release 判定

**分别记录三类状态**，不得以一个自动化绿灯替代所有发布条件：

1. **代码合并：** 当前 `main` 精确提交 SHA、完整 Hosted CI 以及 P53 Qt QGIS 验证结果。
2. **工程预览发布：** Cloudflare 必须返回相同 SHA；19 条真实在线转换、19 份预览及 noindex 全部核验通过。
3. **面向正式用户的 Release：** QGIS 手动操作及真实手机均有有效真人证据；未确认的边界、数据丢失风险和失败问题被解决或明确披露。正式域名 SEO 开放和 Pancake 收款需另外获得明确授权。

截至本 P53 自动化项目设计，人工 QGIS GUI 与物理设备两项均保持 **NOT_TESTED**。自动生成的 QGIS 地图 PNG 只证明程序能调用安装版 QGIS Qt 画布。所有测试样本均为合成数据，避免上传用户或客户真实 GIS 文件。

本阶段不修改既有 19 转换路线、原有 DATA_LOSS 质量拦截和 Cloudflare 工程预览 `robots.txt Disallow: /`、`X-Robots-Tag: noindex`。
