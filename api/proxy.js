// Vercel serverless: /api/proxy?url=<cdn url>[&dl=1&name=file.mp4]
// Streams the real CDN file through YOUR server so the browser never hits the
// auth-gated CDN directly. Forwards Range headers -> seeking + partial download work.
const { Readable } = require('stream');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

module.exports = async (req, res) => {
  const target = req.query && req.query.url;
  if (!target) { res.statusCode = 400; return res.end('Missing url'); }

  const headers = { 'User-Agent': UA, 'Referer': 'https://www.terabox.com/' };
  if (process.env.TERABOX_COOKIE) headers['Cookie'] = process.env.TERABOX_COOKIE;
  if (req.headers.range) headers['Range'] = req.headers.range;

  let up;
  try { up = await fetch(target, { headers, redirect: 'follow' }); }
  catch (e) { res.statusCode = 502; return res.end('Upstream fetch failed: ' + e.message); }

  res.statusCode = up.status;
  const pass = ['content-type','content-length','content-range','accept-ranges','last-modified','etag'];
  pass.forEach(h => { const v = up.headers.get(h); if (v) res.setHeader(h, v); });
  if (!up.headers.get('accept-ranges')) res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.query.dl) {
    const name = (req.query.name || 'video.mp4').replace(/[^\w.\-]+/g, '_');
    res.setHeader('Content-Disposition', 'attachment; filename="' + name + '"');
    if (!up.headers.get('content-type')) res.setHeader('Content-Type', 'application/octet-stream');
  }

  if (!up.body) return res.end();
  Readable.fromWeb(up.body).pipe(res);
};