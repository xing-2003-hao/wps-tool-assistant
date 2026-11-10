/* ============================================================
 * WPS 工具助手 · 工具清单（功能区 + 面板卡片页共用）
 * status:
 *   ready  → 已实现，点击直接执行
 *   ai     → 走大模型（面板功能页）
 *   todo   → 入口已就位，功能待实现
 *   link   → 打开外部站点（系统浏览器）
 * ============================================================ */
(function () {
  'use strict';

  window.WTA_TOOLS = [
    {
      cat: '智能 AI',
      desc: '写作 · 润色 · 知识检索',
      items: [
        { key: 'ai-assistant', name: 'AI 智能助手', desc: '选中内容直接处理', icon: '🤖', status: 'ai', ai: { input: '输入要处理的内容或指令，如：把这段改成正式公文语气（也可先选中文字再点）', sys: '你是中文办公文档助手，输出可直接使用的结果，不要解释过程。', user: '{text}' } },
        { key: 'ai-writing', name: 'AI 写作台', desc: '扩写 / 缩写 / 续写', icon: '✍️', status: 'ai', ai: { input: '输入写作主题 / 开头，如：写一份关于设备检修的通知', sys: '你是资深中文写作助手，直接输出成稿，不要解释。', user: '根据以下要求写一篇完整的中文文稿（结构清晰、语气得体），要求：{text}' } },
        { key: 'kb-search', name: '知识库检索', desc: '本地文档问答素材', icon: '📚', status: 'ai', ai: { input: '输入问题，如：产品保修期是多久（先在「知识库」页导入资料）', sys: '你是知识库问答助手。只依据提供的资料回答；资料不足时明确说明缺什么。', user: '问题：{text}' } }
      ]
    },
    {
      cat: '图片工具',
      desc: '转换 · 水印 · 切图',
      items: [
        { key: 'img-convert', name: '图片转换/压缩', desc: '格式转换、批量压缩', icon: '🖼️', status: 'ready' },
        { key: 'img-to-pdf', name: '图片转 PDF', desc: '多图合并成 PDF', icon: '📄', status: 'ready' },
        { key: 'img-watermark-add', name: '图片添加水印', desc: '文字 / 图片水印', icon: '💧', status: 'ready' },
        { key: 'img-grid', name: '图片九宫格', desc: '切图 / 网格拼贴', icon: '🔲', status: 'ready' },
        { key: 'img-watermark-remove', name: '图片去水印', desc: '本地修复引擎', icon: '🧽', status: 'ready' }
      ]
    },
    {
      cat: 'PDF 工具',
      desc: '转换 · 拆分合并 · 页面处理',
      items: [
        { key: 'word-to-pdf', name: 'Word 转 PDF', desc: '原生导出，版式不变', icon: '📄', status: 'ready' },
        { key: 'pdf-to-word', name: 'PDF 转 Word', desc: '提取文字生成文档', icon: '📝', status: 'ready' },
        { key: 'pdf-to-excel', name: 'PDF 转 Excel', desc: '表格结构导出', icon: '📊', status: 'ready' },
        { key: 'pdf-to-ppt', name: 'PDF 转 PPT', desc: '整页图像形式', icon: '📽️', status: 'ready' },
        { key: 'pdf-to-md', name: 'PDF 转 Markdown', desc: '保留标题与列表', icon: '📋', status: 'ready' },
        { key: 'pdf-merge', name: 'PDF 合并', desc: '多份合并', icon: '🔗', status: 'ready' },
        { key: 'pdf-split', name: 'PDF 拆分', desc: '按页或成组拆开', icon: '✂️', status: 'ready' },
        { key: 'pdf-watermark-add', name: '添加 PDF 水印', desc: '文字 / 图片水印', icon: '💧', status: 'ready' },
        { key: 'pdf-watermark-remove', name: '移除 PDF 水印', desc: '剔除文字水印', icon: '🧽', status: 'ready' },
        { key: 'pdf-page-manage', name: 'PDF 页面管理', desc: '旋转 / 删除 / 重排', icon: '🗂️', status: 'ready' },
        { key: 'pdf-resize', name: 'PDF 尺寸调整', desc: '缩放 / 页面尺寸', icon: '📐', status: 'ready' }
      ]
    },
    {
      cat: '文档 · 写作 · 素材',
      desc: '批量处理 · 排版 · 生成',
      items: [
        { key: 'word-replace', name: 'Word 批量替换', desc: '多组规则批量替换', icon: '🔁', status: 'ready' },
        { key: 'word-format', name: 'Word 文档排版', desc: '文章自动排版', icon: '🧾', status: 'ai', ai: { sys: '你是中文公文/报告排版专家。把原文整理成规范排版版本：标题独占一行、层级清晰、项目符号统一、语句通顺；只输出整理后的正文。', user: '请规范排版以下内容：\n\n{text}' } },
        { key: 'sheet-merge', name: '表格合并', desc: '纵向 / 横向合并', icon: '🧩', status: 'ready' },
        { key: 'sheet-split', name: '表格拆分', desc: '按条件拆成多表', icon: '🔪', status: 'ready' },
        { key: 'doc-outline', name: '组织架构图', desc: '层级结构导出', icon: '🏢', status: 'ready' },
        { key: 'doc-mindmap', name: '思维导图', desc: '结构化整理', icon: '🧠', status: 'ready' },
        { key: 'doc-seatcard', name: '座位牌生成', desc: '批量生成姓名牌', icon: '💳', status: 'ready' },
        { key: 'doc-thousand', name: '千字模板', desc: '文字转手写体图片', icon: '📃', status: 'ready' },
        { key: 'doc-minutes', name: '会议纪要', desc: '整理成结构化纪要', icon: '🎙️', status: 'ai', ai: { sys: '你是会议纪要整理专家。输出结构：会议主题、时间地点、参会人、讨论要点（分条）、决议事项、待办（负责人/时间）。信息缺失的留「待补充」。', user: '根据以下记录整理会议纪要：\n\n{text}' } },
        { key: 'doc-quotes', name: '金句提炼', desc: '提取 / 打磨金句', icon: '✨', status: 'ai', ai: { sys: '你是文案专家。提炼 5~8 条金句：短、有力、可独立引用；每条一行，不加编号解释。', user: '从以下内容提炼金句：\n\n{text}' } },
        { key: 'doc-hotnews', name: '新闻热点', desc: '写作素材参考', icon: '🔥', status: 'link', url: 'https://www.baidu.com/s?wd=%E7%83%AD%E7%82%B9%E6%96%B0%E9%97%BB' },
        { key: 'doc-writer', name: '秒笔生花', desc: 'AI 智能写作系统', icon: '🖋️', status: 'ai', ai: { input: '输入主题与要求，如：写一篇 800 字的产品介绍，面向中小企业老板', sys: '你是「秒笔生花」长文写作系统。按「标题 / 导语 / 分层正文 / 结尾」输出，语言自然，不堆砌形容词。', user: '写作任务：{text}' } },
        { key: 'doc-toolbox', name: '大佬工具箱', desc: '外部实用工具集', icon: '🧰', status: 'link', url: 'https://tool.lu/' },
        { key: 'doc-video-nowm', name: '短视频去水印', desc: '一键解析下载', icon: '🎬', status: 'ready' }
      ]
    },
    {
      cat: '休闲区',
      desc: '在线内容',
      items: [
        { key: 'fun-music', name: '音乐', desc: '在线音乐播放', icon: '🎵', status: 'link', url: 'https://music.163.com/' },
        { key: 'fun-movie', name: '影视欣赏', desc: '在线影视', icon: '🎞️', status: 'link', url: 'https://www.bilibili.com/' },
        { key: 'fun-audio', name: '有声小说', desc: '在线听书', icon: '🎧', status: 'link', url: 'https://www.ximalaya.com/' },
        { key: 'fun-anime', name: '动漫专区', desc: '在线动漫', icon: '🎨', status: 'link', url: 'https://www.bilibili.com/anime/' }
      ]
    }
  ];

  // 功能区按钮 id → 工具 key（ribbon.xml 与 main.js 共用）
  window.WTA_RIBBON_MAP = {
    wtaToolWordPdf: 'word-to-pdf',
    wtaToolAiAssistant: 'ai-assistant',
    wtaToolAiWriter: 'ai-writing',
    wtaToolImgPdf: 'img-to-pdf',
    wtaToolImgConvert: 'img-convert',
    wtaToolImgWm: 'img-watermark-add',
    wtaToolImgGrid: 'img-grid',
    wtaToolImgDewm: 'img-watermark-remove',
    wtaToolPdfMerge: 'pdf-merge',
    wtaToolPdfSplit: 'pdf-split',
    wtaToolPdfPage: 'pdf-page-manage',
    wtaToolPdfWm: 'pdf-watermark-add',
    wtaToolPdfSize: 'pdf-resize',
    wtaToolPdfToWord: 'pdf-to-word',
    wtaToolPdfToExcel: 'pdf-to-excel',
    wtaToolPdfToPpt: 'pdf-to-ppt',
    wtaToolPdfToMd: 'pdf-to-md',
    wtaToolPdfDewm: 'pdf-watermark-remove',
    wtaToolDocOutline: 'doc-outline',
    wtaToolDocMind: 'doc-mindmap',
    wtaToolDocGrid: 'doc-thousand',
    wtaToolVideoNowm: 'doc-video-nowm',
    wtaToolWordReplace: 'word-replace',
    wtaToolSheetMerge: 'sheet-merge',
    wtaToolSheetSplit: 'sheet-split',
    wtaToolSeatcard: 'doc-seatcard'
  };

  window.WTA_STATUS_LABEL = {
    ready: '可用',
    ai: 'AI 驱动',
    todo: '待实现',
    link: '外部站点'
  };

  // 功能区按钮 id → 图标文件名（images/ 下，main.js 的 OnGetImage 用）
  window.WTA_ICON_MAP = {
    wtaToolWordPdf: 'ic-word-pdf.png',
    wtaBtnPanel: 'ic-panel.png',
    wtaBtnAbout: 'ic-about.png',
    wtaToolAiAssistant: 'ic-ai.png',
    wtaToolAiWriter: 'ic-ai-write.png',
    wtaToolImgPdf: 'ic-img-pdf.png',
    wtaToolImgConvert: 'ic-img-convert.png',
    wtaToolImgWm: 'ic-img-wm.png',
    wtaToolImgDewm: 'ic-img-dewm.png',
    wtaToolImgGrid: 'ic-img-grid.png',
    wtaToolPdfMerge: 'ic-pdf-merge.png',
    wtaToolPdfSplit: 'ic-pdf-split.png',
    wtaToolPdfPage: 'ic-pdf-page.png',
    wtaToolPdfWm: 'ic-pdf-wm.png',
    wtaToolPdfSize: 'ic-pdf-size.png',
    wtaToolPdfToWord: 'ic-pdf-word.png',
    wtaToolPdfToExcel: 'ic-pdf-excel.png',
    wtaToolPdfToPpt: 'ic-pdf-ppt.png',
    wtaToolPdfToMd: 'ic-pdf-md.png',
    wtaToolPdfDewm: 'ic-pdf-dewm.png',
    wtaToolWordReplace: 'ic-word-replace.png',
    wtaToolSheetMerge: 'ic-sheet-merge.png',
    wtaToolSheetSplit: 'ic-sheet-split.png',
    wtaToolSeatcard: 'ic-seatcard.png',
    wtaToolDocOutline: 'ic-doc-outline.png',
    wtaToolDocMind: 'ic-doc-mind.png',
    wtaToolDocGrid: 'ic-doc-grid.png',
    wtaToolVideoNowm: 'ic-video-dewm.png'
  };

  // 面板卡片：工具 key → 图标文件名（没有的退回 emoji）
  window.WTA_TOOL_ICON = {
    'word-to-pdf': 'ic-word-pdf.png',
    'ai-assistant': 'ic-ai.png',
    'ai-writing': 'ic-ai-write.png',
    'kb-search': 'ic-kb.png',
    'img-convert': 'ic-img-convert.png',
    'img-to-pdf': 'ic-img-pdf.png',
    'img-watermark-add': 'ic-img-wm.png',
    'img-grid': 'ic-img-grid.png',
    'img-watermark-remove': 'ic-img-dewm.png',
    'pdf-to-word': 'ic-pdf-word.png',
    'pdf-to-excel': 'ic-pdf-excel.png',
    'pdf-to-ppt': 'ic-pdf-ppt.png',
    'pdf-to-md': 'ic-pdf-md.png',
    'pdf-merge': 'ic-pdf-merge.png',
    'pdf-split': 'ic-pdf-split.png',
    'pdf-watermark-add': 'ic-pdf-wm.png',
    'pdf-watermark-remove': 'ic-pdf-dewm.png',
    'pdf-page-manage': 'ic-pdf-page.png',
    'pdf-resize': 'ic-pdf-size.png',
    'word-replace': 'ic-word-replace.png',
    'word-format': 'ic-format.png',
    'sheet-merge': 'ic-sheet-merge.png',
    'sheet-split': 'ic-sheet-split.png',
    'doc-seatcard': 'ic-seatcard.png',
    'doc-outline': 'ic-doc-outline.png',
    'doc-mindmap': 'ic-doc-mind.png',
    'doc-thousand': 'ic-doc-grid.png',
    'doc-minutes': 'ic-minutes.png',
    'doc-quotes': 'ic-quotes.png',
    'doc-hotnews': 'ic-hotnews.png',
    'doc-writer': 'ic-writer.png',
    'doc-toolbox': 'ic-toolbox.png',
    'doc-video-nowm': 'ic-video-dewm.png',
    'fun-music': 'ic-music.png',
    'fun-movie': 'ic-movie.png',
    'fun-audio': 'ic-audio.png',
    'fun-anime': 'ic-anime.png'
  };
})();
