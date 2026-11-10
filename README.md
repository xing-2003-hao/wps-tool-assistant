# WPS 工具助手

> **架构路线：JS 加载项做壳 + 本地/云端 LLM 做脑 + JSA 宏工具箱做兜底**
>
> 参考项目：[wps-plugin-deepseek](https://github.com/chezhiliang/wps-plugin-deepseek)（工程结构）、[local-wps-ai](https://github.com/qhdhao13/local-wps-ai)（功能清单）、WPS 社区 JSA 工具箱（实用功能集）

## 架构

```
┌──────────────────────────────────────────────┐
│                 WPS Office 宿主               │
│   Writer(wps) / 表格(et) / 演示(wpp) 三端     │
└──────┬───────────────────────────┬───────────┘
       │ JS 加载项（壳）            │ JSA 宏（兜底）
│  ribbon.xml 功能区按钮       │  单文件分发、离线可用
│  panel.html 侧边栏 UI        │  无网络也能用
└──────┬───────────────────────────┘
       │ fetch（OpenAI-compatible）
┌──────▼───────────────────────────────────────┐
│              LLM 适配层（脑）                  │
│  Ollama 本机 / vLLM / DeepSeek / 通义 / GPT   │
└──────────────────────────────────────────────┘
```

## 目录结构

```
wps工具助手/
├── package.json          # wpsjs 工具链（debug / build / build:exe / install:local）
├── jsplugins.xml         # 加载项注册清单（三端）
├── scripts/install.js    # 本地一键部署/卸载脚本（jsaddons 目录 + publish.xml）
├── common/               # 三端共用源码（构建时复制到各宿主目录）
│   ├── panel.html        # 侧边栏页面（工具 / 功能 / 模板 / 知识库 / 设置）
│   ├── panel.js          # UI 逻辑 + LLM 适配层（流式）+ 动作注册表
│   ├── rag.js            # RAG 模块（切块 / embeddings / 检索注入）
│   ├── tools.js          # 工具清单（36 个入口，功能区与卡片页共用）
│   ├── toolui.js         # 弹窗表单 / 原生选文件 / 保存产物
│   ├── imagetools.js     # 图片：转换压缩 / 转 PDF / 水印 / 九宫格 / 去水印
│   ├── pdftools.js       # PDF：合并 / 拆分 / 页面管理 / 水印 / 尺寸
│   ├── pdftext.js        # PDF 文本抽取引擎（内容流词法 + ToUnicode CMap + 定位）
│   ├── pdfconvert.js     # PDF 转换：Word / Excel / PPT / Markdown / 去水印
│   ├── ooxml.js          # DOCX / XLSX / PPTX 生成器（自带 ZIP 打包，无第三方依赖）
│   ├── docgen.js         # 组织架构图 / 思维导图 / 千字稿纸（canvas → PNG → 插入文档）
│   ├── webtools.js       # 短视频链接解析（提取链接 + 自定义解析接口）
│   ├── officetools.js    # 表格合并拆分 / 座位牌生成
│   ├── images/           # 功能区 + 面板卡片图标（38 枚 PNG，gen-icons.js 生成）
│   ├── vendor/pdf-lib.min.js  # PDF 引擎（本地内置，离线可用）
│   └── panel.css
├── wps/                  # Writer 端（index/main/ribbon/panel/rag）
├── et/                   # 表格端
├── wpp/                  # 演示端
└── jsa-macros/           # JSA 宏工具箱（兜底层，7 个实用宏）
```

## 快速开始（加载项）

前置：Windows + 支持 JS 加载项的 WPS Office（2019+ / 个人版均可）+ Node.js ≥ 18

```bash
npm install
npm run debug     # 注册加载项到 WPS 并启动调试服务（保持窗口运行）
```

启动后打开 WPS：

1. 文字 / 表格 / 演示 三个组件顶部都会多一个 **「工具助手」** 功能区选项卡
2. 点击 **「助手面板」** 打开右侧边栏
3. 先到 **「设置」** 页配置模型（内置 Ollama / vLLM / DeepSeek / 通义预设），点 **测试连接**
4. 回到功能页使用：选中文字 → 点「润色 / 纠错 / 翻译…」；表格里选单元格 → 「生成公式 / 解释公式 / 数据清洗建议」；演示里 → 「生成大纲 / 润色本页」

发布构建：`npm run build`（生成可分发的加载项包）

## LLM 配置说明

统一走 OpenAI-compatible 的 `/v1/chat/completions` 接口：

| 服务 | 服务地址 | 模型示例 | 备注 |
|---|---|---|---|
| Ollama | `http://localhost:11434/v1` | `qwen2.5:7b` | 跨域报错时设环境变量 `OLLAMA_ORIGINS=*` |
| vLLM | `http://localhost:8000/v1` | `Qwen2.5-7B-Instruct` | 启动加 `--allowed-origins "*"` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` | 需填 API Key |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` | 需填 API Key |

配置保存在浏览器 localStorage（每台机器各自一份），不会上传。

## 快速开始（JSA 宏工具箱）

见 [jsa-macros/README.md](jsa-macros/README.md)。核心价值：**不装插件、不联网也能用**——AI 服务不可用时的兜底，也是向其他用户分发工具的最低门槛形态。

## 离线工具（不依赖大模型，开箱即用）

全部在本地完成，文件不出本机。产物统一保存到 **`下载\WPS工具助手\`**（同名自动加 `(1)(2)` 不覆盖），完成后可一键「打开所在文件夹」。

| 工具 | 能力 | 技术实现 |
|---|---|---|
| 图片转换 / 压缩 | JPG / PNG / WebP 互转，质量可调，最大边长限制 | canvas 重绘 |
| 图片转 PDF | 多图按顺序合并，A4 纵向/横向/跟随图片，页边距可调 | pdf-lib `embedJpg` |
| 图片加水印 | 文字水印：平铺 / 居中 / 右下，透明度、字号（占宽百分比）、颜色 | canvas 绘制 |
| 图片九宫格 | 切图（一张 → N×N 块，先居中裁方）/ 拼贴（多图 → 网格） | canvas 切分与合成 |
| PDF 合并 | 多份按顺序合并，输出文件名可自定义 | pdf-lib `copyPages` |
| PDF 拆分 | 每页一份 / 每 N 页一份 / 自定义范围（`1-3,4-6,7`） | pdf-lib |
| PDF 页面管理 | 重排、剔除不要的页、统一旋转 90/180/270 | pdf-lib |
| PDF 水印 | 每页叠加文字水印（**支持中文**，先用 canvas 转 PNG 再叠加） | pdf-lib `embedPng` |
| PDF 尺寸调整 | 统一到 A4/A3/Letter，缩放不变形，可横版自动转横 | `scaleContent` + `setSize` |
| 表格合并 | 当前工作簿所有工作表纵向合并到新表，可跳过重复表头、追加来源表名 | WPS ET JSAPI |
| 表格拆分 | 按某列唯一值拆成多张工作表（最多 60 个分组） | WPS ET JSAPI |
| 座位牌生成 | 名单每行一个姓名 → 每页一个超大姓名，支持对折双面 | WPS Writer JSAPI |
| Word 批量替换 | 多组 `旧=>新` 规则，走 Find/Replace，保留原格式 | WPS Writer JSAPI |
| Word 转 PDF | 调 WPS 原生排版引擎导出（ExportAsFixedFormat），字体/页眉页脚/图文位置与原文一致；支持当前文档与多选文件批量 | WPS JSAPI + 启动器 `/target` |
| PDF 转 Word | 逐行还原文档，按字号自动识别标题层级、符号识别为项目符号，可保留分页 | 自研 `pdftext.js` + `ooxml.js` |
| PDF 转 Excel | 按文字坐标聚类还原行列，可选同时导出 CSV 便于核对 | 自研 `pdftext.js` + `ooxml.js` |
| PDF 转 PPT | 每页文字生成一页 16:9 幻灯片，行数多时自动缩字号 | 自研 `ooxml.js` |
| PDF 转 Markdown | 标题层级 + 列表 + 段落合并（中文折行自动粘回） | 自研 `pdftext.js` |
| PDF 去水印 | ① 内容流剔除（删掉水印文字绘制指令，正文不受影响）② 白色遮盖；支持自动识别跨页重复文字 | 自研 `pdftext.js` |
| 图片去水印 | 拖框圈选水印 → 拉普拉斯扩散修复 / 邻域纹理克隆，可连续修多处 | 自研修复算法（纯 JS） |
| 组织架构图 | 缩进 / 编号（1.1.1）/ 路径（A>B>C）/ 两列（上级\t下级）四种写法 → 层级框图 PNG | canvas 绘制 + 自动树布局 |
| 思维导图 | 同一份层级文本 → 右侧发散结构，分支自动配色 | canvas 贝塞尔连线 |
| 千字模板 | 文字 → 田字格 / 横线稿纸（A4 150dpi），自动分页、手写体 | canvas 网格渲染 |
| 短视频去水印 | 从分享文案提取链接 → 调用你自己的解析接口拿无水印直链（接口可配） | /proxy 转发 + 递归挖链 |

**为什么选文件要走原生对话框**：WPS webview 里 `<input type=file>` 行为不一致，所以由本地服务（exe）弹出 Windows 原生「打开/浏览文件夹」对话框，再把路径和内容交给面板处理——这条链路在所有 WPS 版本上表现一致。

## 路线图

- [x] 三端加载项骨架 + LLM 适配层 + 侧边栏 UI
- [x] 7 个实用 JSA 宏
- [x] 流式输出（stream: true，SSE 解析，结果实时刷新；内核不支持时自动降级非流式）
- [x] 表格端：选区数据直接交给 LLM 分析并回写（结果 CSV 表写入选区下方）
- [x] 长文档分块处理（Writer 全文润色：按段落分块依次润色，失败块保留原文，结果生成到新文档）
- [x] RAG：本地知识库检索后注入提示词（Ollama/vLLM embeddings 向量检索，关键词检索兜底）
- [x] 打包部署：`build:exe`（wpsjs --exe）+ `scripts/install.js` 本地一键部署 / 卸载
- [x] 图片工具批次（转换压缩 / 转 PDF / 水印 / 九宫格）
- [x] PDF 工具批次（合并 / 拆分 / 页面管理 / 水印 / 尺寸调整）
- [x] 表格批次（多表合并 / 按列拆分 / 座位牌）
- [x] PDF 转 Word / Excel / PPT / Markdown（自研内容流 + ToUnicode 文本抽取，不依赖 pdf.js）
- [x] 图片去水印（扩散修复 / 纹理克隆）、PDF 去水印（内容流剔除 / 遮盖）
- [x] 组织架构图 / 思维导图 / 千字稿纸（canvas 生成并插入文档）
- [x] AI 工具卡片独立提示词（会议纪要 / 金句提炼 / 文档排版 / 秒笔生花…）
- [ ] 流式输出上屏到文档（目前先在侧边栏预览）
- [ ] 知识库存储升级 IndexedDB / 本地向量库（当前 localStorage 上限约 300 片段）

## RAG 知识库用法

1. Ollama 拉取向量模型：`ollama pull nomic-embed-text`（vLLM 用户把 Embedding 服务地址改成对应 /v1）
2. 侧边栏 → **知识库** 页：填 Embedding 服务地址与模型 → 保存设置
3. 粘贴文档内容（自动按段落切块、块间带重叠）→ **添加到知识库**
4. 打开 **启用知识库检索** 开关后，功能页所有动作都会先检索 top-k 相关片段注入提示词
5. Embedding 接口不可用时自动降级为关键词检索，不阻塞主流程

## 打包与部署

| 方式 | 命令 | 说明 |
|---|---|---|
| 开发调试 | `npm run debug` | 注册开发模式加载项，支持热更新 |
| 标准构建 | `npm run build` | 产出 publish 目录，按 WPS 开放平台流程分发 |
| **自研启动 exe** | `npm run build:exe2` | **推荐**：产出 `dist/WPS工具助手-安装启动.exe`（单文件约 1.9MB，含 PDF 引擎） |
| exe 打包（wpsjs） | `npm run build:exe` | 依赖 wpsjs 版本支持 --exe |
| 卸载 | `node scripts/install.js --remove` | 清理 publish.xml 注册项与残留目录 |
| 同步源码 | `npm run sync` | 把 `common/` 复制到 wps / et / wpp 三端 |
| 重新生成功能区 | `npm run ribbon` | 按脚本里的分组表重写三端 `ribbon.xml` |

### 三端（文字 / 表格 / 演示）兼容说明

WPS 各版本注入的宿主对象并不统一，入口脚本不能写死：

- Office 全局对象统一叫 **`wps`**，通过 `wps.WpsApplication()` / `wps.EtApplication()` / `wps.WppApplication()` 取对应进程的 Application（非本进程的方法会抛错，需要 try/catch 跳过）
- 部分版本另有 VBA 风格的全局 `Application`
- 顶层 `et` / `wpp` 在多数版本里**不存在** —— 直接 `et.CreateTaskPane()` 会报 `et is not defined`

`wps|et|wpp/main.js` 里的 `paneCandidates()` 会把 `wps`、`Application`、`wps.EtApplication()` 等候选逐个试，谁有 `CreateTaskPane`（含小写 p 的 `CreateTaskpane`）就用谁；全都没有时报警里会带诊断串（`wps=object Application=undefined et=undefined`），而不是一句 `et is not defined`。

面板内部同理：`detectHost()` 不认名字，按 Application 对象的特征判断宿主（有 `ActiveSheet` → 表格，有 `Presentations` → 演示，有 `ActiveDocument` → 文字）。

### 排版指令（本地执行，不经过模型）

面板「功能」页顶部的指令框，输入排版要求后点「执行」会在文档里直接生效 —— 这类操作本来就不该问模型：模型只能生成文字，改不了格式。

支持写法（可组合）：

| 类别 | 例子 |
|---|---|
| 字体颜色 | 改成红色字体 / 设为蓝色 / #FF6600 / 标红 |
| 高亮底色 | 高亮 / 用蓝色高亮 / 高亮成黄色 / 取消高亮 |
| 字号 | 小四号 / 字号 12 磅 / 三号字 |
| 字体 | 字体改成微软雅黑 / 宋体 / 仿宋 / 黑体 |
| 样式 | 加粗 / 取消加粗 / 斜体 / 下划线 / 删除线 |
| 段落 | 居中 / 两端对齐 / 1.5 倍行距 / 首行缩进 2 字符 / 段前 6 磅 |
| 清除 | 清除格式 |

范围规则：**选中文字 → 只改选区；没选中 → 改当前段落；句子里带「全文」→ 改整篇**；写成「把『合同』改成红色」时会全文查找该词并逐处改。

实现见 `common/docops.js`：正则解析 → 映射成 `Font.Color`（BGR 整数）、`Font.Size`、`ParagraphFormat.*` 等 JSAPI 调用。

### 本地服务接口（启动器 127.0.0.1:3889）

| 接口 | 作用 |
|---|---|
| `GET /ping` | 健康检查；面板每 6 秒探一次，挂了会在状态栏提示「本地服务未连接」 |
| `POST /pick` | 原生文件/文件夹选择框 |
| `GET /file` | 读取本地文件（送进 webview 处理） |
| `POST /save` | 存二进制产物到「下载\WPS工具助手\」 |
| `POST /target` | 只算唯一输出路径、不建文件，给 WPS 原生导出用 |
| `POST /reveal` | 资源管理器定位文件 |
| 其他 `/proxy` | 转发云端大模型请求，规避 webview 跨域 |

> 服务没起时所有 fetch 都会抛 `Failed to fetch`。面板已把这句翻译成「连不上本地服务 —— 请双击 WPS工具助手-安装启动.exe」，并在状态栏持续提示。

### 图标

功能区和面板卡片的图标是 `common/images/*.png`（64×64 透明底），由 `scripts/gen-icons.js` 用 SVG 绘制 → 无头 Edge 渲染 → Pillow 裁切生成，**没有引用任何外部图标库**。

- 改图标：编辑 `scripts/gen-icons.js` 里的 `ICONS` 数组（SVG 片段），然后 `npm run icons && npm run sync`
- 加按钮图标：在 `common/tools.js` 的 `WTA_ICON_MAP`（功能区按钮 id → 文件名）和 `WTA_TOOL_ICON`（工具 key → 文件名）里登记
- 功能区取图标走 `ribbon.xml` 的 `getImage="OnGetImage"`，`main.js` 里按按钮 id 返回 `images/xxx.png`（相对加载项根目录）

### 更新已安装的版本（重要）

exe 里的面板文件是**直接以资源形式提供给本地服务**的，不会解压到磁盘，所以：

1. 右键任务栏托盘里的「工具助手」图标 → **退出**（必须先停掉旧实例，否则双击新 exe 只会打开旧服务）
2. 双击新的 `dist/WPS工具助手-安装启动.exe`
3. **重启 WPS**（功能区按钮是启动时读的 `ribbon.xml`，重启后才会出现新分组：PDF 转换 / 图形生成 / 网络）

### 自研 exe 的工作方式（重要）

WPS 的 JS 加载项**必须通过 HTTP url 加载**（`publish.xml` 里的 `<jspluginonline>` 元素），单纯把文件复制到 `jsaddons` 目录不会被加载。因此 exe 是这样工作的：

1. 内置一个极简静态 HTTP 服务（`127.0.0.1:3889`，端口占用会自动往后找，实际端口写入 `%TEMP%\wta-port.txt`），从 exe 内存中直接供应三端加载项文件（无需解压到磁盘）
2. 写入 `%APPDATA%\kingsoft\WPS\jsaddons\publish.xml` 三条 `<jspluginonline>` 记录（wps / et / wpp）
3. 通过注册表 `HKLM|HKCU\SOFTWARE\Kingsoft\Office\6.0\Common` 的 `InstallRoot` 探测 WPS 主程序（兼容 `office6` 子目录与自定义安装盘，如 `C:\app\WPS`）
4. **常驻系统托盘**：双击托盘图标打开助手面板；右键可启动 WPS / 退出。退出时会自动移除注册项（因为服务随之停止）

### 双击 exe 的行为（单实例）

| 场景 | 行为 |
|---|---|
| 助手**未启动** | 起本地服务 → 注册加载项 → 自动拉起 WPS（若没开）→ WPS 右侧自动弹出助手面板 |
| 助手**已启动** | 不再起第二个副本，直接激活 WPS 窗口（面板在 WPS 右侧，不打开浏览器） |
| WPS 已在运行 | 气泡提示：需完全退出 WPS 再打开，选项卡与自动面板才会加载 |

面板是 WPS 的 **taskpane（内置侧边栏）**，不依赖外部浏览器；加载项 `main.js` 里 `AUTO_OPEN_PANEL = true` 会在载入后自动显示面板（同一会话只自动弹一次）。托盘菜单里的「在浏览器中打开面板（调试用）」仅供调试 UI 用。

> 测试用：`WPS工具助手-安装启动.exe /silent`（不弹窗、不启动 WPS，只起服务并注册，便于脚本校验）

构建原理：`scripts/build-exe.js` 用 Windows 自带的 .NET Framework csc.exe 编译 `scripts/launcher.cs` + 三端文件为单文件 exe，无需安装任何编译工具（csc 不支持中文路径，脚本会先在 ASCII 临时目录编译再移回 dist；`/res` 别名必须用逗号分隔）。

## 常见问题

**Q：侧边栏空白 / 打不开？**
确认 `npm run debug` 窗口保持运行；WPS 需支持 jsaddons（个人版 2019+ 一般都支持）。

**Q：测试连接报 CORS 错误？**
本地模型服务放行来源：Ollama 设 `OLLAMA_ORIGINS=*`，vLLM 加 `--allowed-origins "*"`。

**Q：修改了 common/ 下的代码没生效？**
`common/` 是源码，实际运行的是各宿主目录里的副本，改完需重新复制：
`for d in wps et wpp; do cp common/*.{js,html,css} $d/; done`（或改成构建脚本）。

**Q：知识库检索没生效？**
确认「知识库」页开关已打开且已入库片段；首次用向量检索需 Embedding 服务可用（Ollama：`ollama pull nomic-embed-text`）。检索失败会自动降级为关键词匹配，功能页状态栏会提示。
