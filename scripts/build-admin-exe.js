/* ============================================================
 * WPS 工具助手 · 管理台 exe 构建脚本
 * 产出 dist/WPS工具助手-管理台.exe（单文件，约 20KB）
 * 顺带在 dist 生成 admin-url.txt 模板（写远程地址即可切到公网服务端）
 * 用法：node scripts/build-admin-exe.js
 * 注意：csc.exe 不支持中文路径 → 先复制到 ASCII 临时目录编译
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const outExe = path.join(distDir, 'WPS工具助手-管理台.exe');

const stage = path.join(os.tmpdir(), 'wta-admin-build');
const outExeStage = path.join(stage, 'WTAAdmin.exe');

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

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
const src = path.join(root, 'scripts', 'admin-launcher.cs');
fs.copyFileSync(src, path.join(stage, 'admin-launcher.cs'));

// 应用图标（csc 不支持中文路径，先复制到 ASCII 工作区）
const icoSrc = path.join(root, 'assets', 'app.ico');
if (!fs.existsSync(icoSrc)) throw new Error('缺少 assets/app.ico（先运行 scripts/make-icon.ps1）');
const icoStage = path.join(stage, 'app.ico');
fs.copyFileSync(icoSrc, icoStage);

const args = [
  '/nologo',
  '/target:winexe',
  '/platform:anycpu',
  '/optimize+',
  '/out:' + outExeStage,
  '/win32icon:' + icoStage,
  '/r:System.dll',
  '/r:System.Drawing.dll',
  '/r:System.Windows.Forms.dll',
  path.join(stage, 'admin-launcher.cs')
];
execFileSync(findCsc(), args, { stdio: 'inherit' });

fs.mkdirSync(distDir, { recursive: true });
fs.copyFileSync(outExeStage, outExe);

// 远程地址模板（存在即生效，注释行忽略）
const urlFile = path.join(distDir, 'admin-url.txt');
if (!fs.existsSync(urlFile)) {
  fs.writeFileSync(urlFile,
    '# 管理台地址：留空/删除本文件 = 本机 http://127.0.0.1:3910/admin\n' +
    '# 服务端部署到云服务器后，改成：https://你的域名/admin\n',
    'utf8');
}

const kb = (fs.statSync(outExe).size / 1024).toFixed(1);
console.log(`\n[OK] 已生成 ${outExe}（${kb} KB）`);
console.log('[OK] 双击即打开管理台；本机服务未启动时会自动拉起');
console.log('[OK] 可编辑 dist/admin-url.txt 指向远程服务端');
