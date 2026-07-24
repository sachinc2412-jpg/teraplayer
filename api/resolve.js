// Vercel serverless function: /api/resolve?url=<share link>
// Returns { file_name, size, direct_url, thumbnail }
// Runs SERVER-SIDE -> no CORS. This is the whole reason a backend exists.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

// match on keywords, not exact domains — TeraBox has many rotating mirrors
const TERABOX = ['terabox','1024tera','1024box','4funbox','mirrobox','nephobox','momerybox',
  'teraboxapp','teraboxlink','teraboxshare','teraboxdrive','terasharelink','terafileshare',
  'terafile','tibibox','gibibox','freeterabox','dubox','teraboxdownload'];

function normalize(u){ u = String(u||'').trim(); if(!/^https?:\/\//i.test(u)) u = 'https://'+u; return u; }

function detect(url){
  let h; try{ h = new URL(url).hostname.toLowerCase().replace(/^www\./,''); }catch(e){ return null; }
  if (TERABOX.some(k => h.includes(k))) return 'terabox';
  if (h.includes('diskwala')) return 'diskwala';
  if (h.includes('shortfly') || h.includes('shrtfly')) return 'shortfly';
  return null;
}
const human = b => { if(!b) return ''; const u=['B','KB','MB','GB','TB']; let i=0,n=Number(b);
  while(n>=1024&&i<u.length-1){n/=1024;i++;} return n.toFixed(2)+' '+u[i]; };

// ---------- TeraBox ----------
// Community method. BRITTLE: TeraBox rotates jsToken/sign often and gates many
// links behind the `ndus` cookie. Set env var TERABOX_COOKIE to your cookie string
// (from browser DevTools -> Application -> Cookies, the value containing ndus=...).
async function resolveTerabox(shareUrl){
  const cookie = process.env.TERABOX_COOKIE || '';
  const H = { 'User-Agent': UA, 'Cookie': cookie, 'Referer': 'https://www.terabox.com/' };

  // 1) follow the short link to its canonical /s/ page, grab surl + jsToken
  const r1 = await fetch(shareUrl, { headers: H, redirect: 'follow' });
  const finalUrl = r1.url;
  const html = await r1.text();

  let surl = new URL(finalUrl).searchParams.get('surl');
  if (!surl){ const m = finalUrl.match(/\/s\/1?([A-Za-z0-9_-]+)/); if (m) surl = m[1]; }
  if (!surl) throw new Error('Could not read surl from link (link private/expired or method outdated)');

  let jsToken = '';
  const jm = html.match(/%22jsToken%22%3A%22([^%]+)%22/) ||
             html.match(/jsToken['"]?\s*[:=]\s*['"]([^'"]+)['"]/) ||
             html.match(/fn%28%22([0-9A-F]+)%22%29/);
  if (jm) jsToken = jm[1];

  // 2) list files under the share to get dlink
  const listUrl = 'https://www.terabox.com/share/list?app_id=250528&web=1&channel=dubox'
    + '&clienttype=0&jsToken=' + encodeURIComponent(jsToken)
    + '&shorturl=' + encodeURIComponent(surl.replace(/^1/,'')) + '&root=1';
  let r2 = await fetch(listUrl, { headers: H });
  let j = await r2.json().catch(()=>({}));

  // retry with the leading "1" some links need
  if ((!j.list || !j.list.length) && !/^1/.test(surl)){
    const u2 = listUrl.replace(/shorturl=[^&]*/, 'shorturl='+encodeURIComponent('1'+surl));
    j = await (await fetch(u2, { headers: H })).json().catch(()=>({}));
  }
  if (j.errno && j.errno !== 0) throw new Error('TeraBox errno '+j.errno+(cookie?'':' — try setting TERABOX_COOKIE'));
  const file = (j.list||[]).find(f => f.isdir!=1) || (j.list||[])[0];
  if (!file || !file.dlink) throw new Error('No downloadable file found (folder link or auth needed — set TERABOX_COOKIE)');

  // 3) dlink -> follow once to the real CDN url. Playback/download go through /api/proxy
  //    because the CDN checks UA/cookie/referer and blocks the browser directly.
  return {
    file_name: file.server_filename || 'video.mp4',
    size: human(file.size),
    thumbnail: (file.thumbs && (file.thumbs.url3 || file.thumbs.url2)) || '',
    direct_url: file.dlink
  };
}

// ---------- Diskwala / ShortFly ----------
// No reliable public method. NOT faking endpoints. To implement: open a working
// link in the browser, DevTools -> Network, find the request that returns the
// real .mp4/.m3u8 url, and send me that request (URL + headers + response).
async function notImplemented(name){
  const e = new Error(name+' not implemented — needs a real network trace to reverse. See README.');
  e.status = 501; throw e;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  let url = (req.query && req.query.url) || '';
  if (!url) return res.status(400).json({ error: 'Missing ?url=' });
  url = normalize(url);

  const plat = detect(url);
  if (!plat) return res.status(400).json({ error: 'Unrecognized link. Paste the exact domain to me: '+ (()=>{try{return new URL(url).hostname}catch(e){return url}})() });
  try{
    let out;
    if (plat === 'terabox') out = await resolveTerabox(url);
    else if (plat === 'diskwala') await notImplemented('Diskwala');
    else if (plat === 'shortfly') await notImplemented('ShortFly');
    else throw new Error('Unrecognized platform / link');
    res.status(200).json(out);
  }catch(e){
    res.status(e.status || 500).json({ error: e.message });
  }
};