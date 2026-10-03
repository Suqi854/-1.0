// Loopback static demo only; no API, no request-body handling, no storage.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  let name;
  try { name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); res.end(); return; }
  if (name === '/') { res.writeHead(302, { Location: '/ui/index.html' }); res.end(); return; }
  const file = path.resolve(root, '.' + name);
  if (!file.startsWith(root + path.sep) || !['/ui/', '/src/'].some(p => name.startsWith(p))) { res.writeHead(404); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', mime[path.extname(file)] || 'text/plain');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'");
    res.end(data);
  });
}).listen(Number(process.env.DEMO_PORT || 4173), '127.0.0.1', () => console.log('Synthetic demo: http://127.0.0.1:' + (process.env.DEMO_PORT || 4173)));
