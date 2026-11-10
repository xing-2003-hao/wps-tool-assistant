/* 临时静态服务：用于无头浏览器验证面板 JS（不参与打包） */
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'common');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  // 测试用：允许读本机任意文件（仅本地测试脚本，不进打包）
  if (p === '/__file') {
    const q = new URL(req.url, 'http://x').searchParams.get('p');
    if (!q || !fs.existsSync(q)) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.end(fs.readFileSync(q));
    return;
  }
  if (p === '/') p = '/panel.html';
  if (p === '/__uitest.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(__dirname, 'uitest.html')));
    return;
  }
  // 其它自测页：/__t/<文件名> 从 scripts/ 目录取
  if (p.startsWith('/__t/')) {
    const f = path.join(__dirname, p.slice(5));
    if (!f.startsWith(__dirname) || !fs.existsSync(f)) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(f));
    return;
  }
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}).listen(39001, '127.0.0.1', () => console.log('ui-test server on 39001'));
