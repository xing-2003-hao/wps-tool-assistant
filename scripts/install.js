/* ============================================================
 * WPS 工具助手 · 卸载 / 部署说明脚本
 *
 * 安装：请用 dist/WPS工具助手-安装启动.exe（托盘版：内置本地静态服务
 *       + 自动注册 publish.xml + 启动 WPS），或开发用 npm run debug。
 *       注意：WPS 的 JS 加载项是通过 HTTP url 加载的（publish.xml 里
 *       的 <jspluginonline>），单纯把文件复制到 jsaddons 目录不会生效，
 *       必须有服务承载 —— 这也是本脚本不再做"复制安装"的原因。
 *
 * 卸载：node scripts/install.js --remove
 *       清理 publish.xml 中本加载项的条目（jsplugin / jspluginonline 都清）
 *       并删除历史版本复制到 jsaddons 的文件夹。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const os = require('os');

const ADDIN_NAME = 'wps-tool-assistant';
const jsaddonsDir = path.join(os.homedir(), 'AppData', 'Roaming', 'kingsoft', 'WPS', 'jsaddons');
const targetDir = path.join(jsaddonsDir, ADDIN_NAME);
const publishXml = path.join(jsaddonsDir, 'publish.xml');

if (!process.argv.includes('--remove')) {
  console.log('本脚本只负责卸载。安装请任选一种：');
  console.log('  1) 双击 dist\\WPS工具助手-安装启动.exe  —— 推荐，托盘常驻，自带本地服务');
  console.log('  2) npm run debug                        —— 开发调试，改代码热更新');
  console.log('\n原因：WPS 的 JS 加载项通过 HTTP url 加载（publish.xml 的 <jspluginonline>），');
  console.log('      仅复制文件到 jsaddons 目录不会被加载。');
  console.log('\n卸载：node scripts/install.js --remove');
  process.exit(0);
}

let removed = 0;

// 1) 清理 publish.xml 条目
if (fs.existsSync(publishXml)) {
  const before = fs.readFileSync(publishXml, 'utf8');
  const after = before
    .split('\n')
    .filter((l) => !l.includes(`name="${ADDIN_NAME}"`))
    .join('\n');
  if (after !== before) {
    fs.writeFileSync(publishXml, after, 'utf8');
    console.log('[OK] 已从 publish.xml 移除注册项');
    removed++;
  } else {
    console.log('[SKIP] publish.xml 中没有本加载项条目');
  }
} else {
  console.log('[SKIP] 未找到 publish.xml');
}

// 2) 删除历史复制目录
if (fs.existsSync(targetDir)) {
  fs.rmSync(targetDir, { recursive: true, force: true });
  console.log('[OK] 已删除 ' + targetDir);
  removed++;
}

console.log(removed ? 'Done. 请重启 WPS 生效。' : '没有需要清理的内容。');
