import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let target = path.resolve(root, `.${pathname}`);
    if (target !== root && !target.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    let status = 200;
    try { if ((await fs.stat(target)).isDirectory()) target = path.join(target, 'index.html'); }
    catch { target = path.join(root, '404.html'); status = 404; }
    const body = await fs.readFile(target);
    res.writeHead(status, { 'content-type': types[path.extname(target)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch { res.writeHead(500).end('Unable to serve this page.'); }
});
server.listen(Number(process.env.PORT || 4321), '127.0.0.1', () => console.log(`Quillgon website: http://127.0.0.1:${server.address().port}`));
