/* ============================================================
 * WPS 工具助手 · exe 构建脚本
 * 用 Windows 自带的 .NET Framework csc.exe 编译单文件 exe：
 *   - 全部加载项文件（wps/et/wpp 三端）作为资源嵌入 exe
 *   - 双击 exe = 解压安装到 %APPDATA%\kingsoft\WPS\jsaddons
 *     + 注册 publish.xml + 自动启动 WPS
 * 用法：npm run build:exe2   （输出 dist/WPS工具助手-安装启动.exe）
 * 注意：csc.exe 不支持中文路径，故先复制到 ASCII 临时目录编译
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const outExe = path.join(distDir, 'WPS工具助手-安装启动.exe');

// csc.exe 不支持中文路径 → 使用 ASCII 临时目录作为编译工作区
const stage = path.join(os.tmpdir(), 'wta-build');
const outExeStage = path.join(stage, 'WTASetup.exe');

function findCsc() {
  const candidates = [
    'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
    'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
    'C:\\Windows\\Microsoft.NET\\Framework64\\v3.5\\csc.exe',
    'C:\\Windows\\Microsoft.NET\\Framework\\v3.5\\csc.exe'
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('未找到 csc.exe（.NET Framework 编译器）。请在 Windows 上运行本脚本。');
}

const COMMON_FILES = [
  "index.html", "main.js", "ribbon.xml",
  "panel.html", "panel.js", "panel.css",
  "rag.js", "tools.js", "toolui.js", "imagetools.js", "pdftools.js", "officetools.js",
  "pdftext.js", "ooxml.js", "pdfconvert.js", "docgen.js", "webtools.js", "docops.js",
  "license.js",
  "templates.js",
  "vendor/pdf-lib.min.js"
];
// 图标（每个 host 目录下 images/*.png）
function imageFiles() {
  const dir = path.join(root, 'common', 'images');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.png')).sort().map(f => 'images/' + f);
}
const ALL_FILES = COMMON_FILES.concat(imageFiles());
const HOST_FILES = { wps: ALL_FILES, et: ALL_FILES, wpp: ALL_FILES };

// ---- 准备 ASCII 编译工作区 ----
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, 'scripts'), { recursive: true });
fs.copyFileSync(path.join(root, 'scripts', 'launcher.cs'), path.join(stage, 'scripts', 'launcher.cs'));

// 应用图标（csc 不支持中文路径，先复制到 ASCII 工作区）
const icoSrc = path.join(root, 'assets', 'app.ico');
if (!fs.existsSync(icoSrc)) throw new Error('缺少 assets/app.ico（先运行 scripts/make-icon.ps1）');
const icoStage = path.join(stage, 'app.ico');
fs.copyFileSync(icoSrc, icoStage);

const resArgs = [];
let fileCount = 0;
for (const [host, files] of Object.entries(HOST_FILES)) {
  fs.mkdirSync(path.join(stage, host), { recursive: true });
  for (const f of files) {
    const src = path.join(root, host, f);
    if (!fs.existsSync(src)) throw new Error(`缺少文件：${host}/${f}（先运行同步命令）`);
    const dst = path.join(stage, host, f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    // 资源名：WTA__wps__panel.js → 安装时还原为 wps\panel.js（子目录用 __ 连接）
    // 注意：csc /res 语法为 /res:文件,资源名（逗号分隔，等号会报 CS1566）
    const resName = 'WTA__' + host + '__' + f.replace(/[\/\\]/g, '__');
    resArgs.push(`/res:${dst},${resName}`);
    fileCount++;
  }
}

// ---- 编译 ----
const csc = findCsc();
const args = [
  '/nologo',
  '/target:winexe',
  '/platform:anycpu',
  '/out:' + outExeStage,
  '/win32icon:' + icoStage,
  '/r:System.dll',
  '/r:System.Drawing.dll',
  '/r:System.Windows.Forms.dll',
  path.join(stage, 'scripts', 'launcher.cs'),
  ...resArgs
];
execFileSync(csc, args, { stdio: 'inherit' });

// ---- 产物移回项目 dist 目录 ----
fs.mkdirSync(distDir, { recursive: true });
fs.copyFileSync(outExeStage, outExe);

const size = (fs.statSync(outExe).size / 1024).toFixed(1);
console.log(`\n[OK] 已生成 ${outExe}`);
console.log(`[OK] 嵌入 ${fileCount} 个加载项文件，体积 ${size} KB`);
console.log('[OK] 双击 exe 即可安装并启动 WPS（卸载见 scripts/install.js --remove）');
