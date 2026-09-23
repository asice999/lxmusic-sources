/**
 * @name 长青SVIP音源(多源聚合版)
 * @description kw/tx/kg/wy 四平台多链路回退 | yinyue.haitangw.net 直链核心 | HYW+聆澜真QQ直链 | 念心+留云兜底
 * @version v1.3.0
 * @author asice999 (整合)
 * @homepage https://github.com/asice999/lxmusic-sources
 * @update_url https://raw.githubusercontent.com/asice999/lxmusic-sources/master/source.js
 *
 * 可用性实测 (2026-09-23)：
 *   kw: yinyue直链(4.6MB ID3) → 念心maflya → 怡红院 → 聆澜
 *   tx: 怡红院(真QQ直链) → 聆澜(真QQ直链) → yinyue直链(4.3MB ID3) → 留云
 *   kg: yinyue直链(kg_song_kw.php, 4.3MB ID3 三连测稳定) → 留云        ← 新增
 *   wy: 留云(liuyunidc, 200 ID3) → yinyue wy.php(兜底)                ← 新增
 *   mg: 已剔除 —— haitangw migu.php 全500/ID错配返回错歌, 搜索API已死, 5后端全军覆没
 * 关键修复：JSON 后端返回 URL 用 $ 作参数分隔符，经 fixUrl() 替换 = 才可播放
 * 已剔除失效源：cenguigui/netease(会员到期)、bugpk(官方外链返回百度验证码HTML)
 */
'use strict';

const { EVENT_NAMES, request, on, send } = globalThis.lx;

// ============ 后端配置 ============
const HT_STREAM = 'http://yinyue.haitangw.net';
const HT_PATH = {
  kw: '/kw/kw.php',
  tx: '/qq/qq_kw.php',
  kg: '/kg/kg_song_kw.php',
  wy: '/wy/wy.php'
};
const LEVEL_MAP = {
  '128k': 'standard', '192k': 'exhigh', '320k': 'exhigh',
  'flac': 'lossless', 'flac24bit': 'lossless', 'master': 'lossless',
  'hires': 'lossless', 'atmos': 'lossless'
};
const HYW = { api: 'http://103.79.184.97/api/music/url', key: 'PYPW-QFRL-3DBF-95O6' };
const LL = { api: 'https://source.shiqianjiang.cn/api/music/url', key: 'CERU_KEY-F4A5F0A7-F612-4676-A8F2-4A13DD0FA4E5' };
const LY = 'https://api.liuyunidc.cn/baimusic/musicurl.php';
const NF = 'http://mcp.nianxinxz.com/share/ceshi';

const TIMEOUT = 12000;
const CACHE_TTL = 3 * 60 * 1000;
const urlCache = new Map();

// ============ HTTP ============
function httpReq(url, opts) {
  return new Promise((resolve, reject) => {
    request(url, {
      timeout: TIMEOUT,
      method: (opts && opts.method) || 'GET',
      headers: (opts && opts.headers) || {},
      body: (opts && opts.body) !== undefined ? opts.body : undefined
    }, (err, resp, body) => {
      if (err) return reject(new Error('req: ' + (err.message || err)));
      const st = resp && resp.statusCode;
      if (!st || st >= 400) return reject(new Error('HTTP ' + st));
      const b = (resp && resp.body !== undefined) ? resp.body : body;
      if (!b) return reject(new Error('empty body'));
      resolve(typeof b === 'string' ? b : JSON.stringify(b));
    });
  });
}

function jParse(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}

// 关键修复：$ → =
function fixUrl(u) {
  return String(u || '').replace(/\$/g, '=');
}

// GET+Range 探测 URL 存活（lxmusic request 不一定支持 HEAD，直链多返回 405 会误杀）
function verifyUrl(url) {
  return new Promise((resolve) => {
    request(url, {
      method: 'GET',
      timeout: 6000,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Range': 'bytes=0-0' },
      body: undefined
    }, (err, resp) => {
      if (err) return resolve(false);
      const st = resp && resp.statusCode;
      // 200/206 资源存在；416 Range 不满足也说明资源存在；405 服务器限制方法不代表资源不存在
      // 3xx 重定向说明资源存在（lxmusic 播放器会跟随 301/302，本处 request 不跟随故需放行）
      resolve(!!st && (st === 200 || st === 206 || st === 416 || st === 405 ||
        (st >= 300 && st <= 308 && st !== 304)));
    });
  });
}

// ============ 后端调用 ============
// yinyue.haitangw.net 直链：端点直接输出音频流，无需解析 JSON
async function btHtStream(platform, id, quality) {
  const path = HT_PATH[platform];
  if (!path) throw new Error('ht: 不支持平台 ' + platform);
  return HT_STREAM + path + '?type=mp3&id=' + encodeURIComponent(String(id)) +
    '&level=' + (LEVEL_MAP[quality] || 'exhigh');
}

async function btHyw(platform, id, quality) {
  const q = 'source=' + encodeURIComponent(platform) +
    '&songId=' + encodeURIComponent(String(id)) +
    '&quality=' + encodeURIComponent(quality || '320k') +
    '&key=' + encodeURIComponent(HYW.key);
  const s = await httpReq(HYW.api + '?' + q, { headers: { 'X-Card-Key': HYW.key } });
  const j = jParse(s);
  if (!j || j.code !== 200 || !j.url) throw new Error('hyw: ' + ((j && (j.message || j.msg)) || 'no url'));
  return fixUrl(j.url);
}

async function btLinlan(platform, id, quality) {
  const q = 'source=' + encodeURIComponent(platform) +
    '&songId=' + encodeURIComponent(String(id)) +
    '&quality=' + encodeURIComponent(quality || '320k');
  const s = await httpReq(LL.api + '?' + q, { headers: { 'X-API-Key': LL.key } });
  const j = jParse(s);
  if (!j || j.code !== 200 || !j.url) throw new Error('linlan: ' + ((j && (j.message || j.msg)) || 'no url'));
  return fixUrl(j.url);
}

async function btLiuyun(source, id) {
  const s = await httpReq(LY + '?source=' + encodeURIComponent(source) +
    '&musicId=' + encodeURIComponent(String(id)));
  const j = jParse(s);
  if (!j || !j.url) throw new Error('liuyun: ' + ((j && (j.msg || j.message)) || 'no url'));
  return fixUrl(j.url);
}

async function btMaflya(platform, id) {
  const s = await httpReq(NF + '/' + platform + '.php?id=' + encodeURIComponent(String(id)));
  const j = jParse(s);
  const u = (j && (((j.data && j.data.url) || j.url) || '')) || '';
  if (!u || u === 'None') throw new Error('nf: no url');
  return fixUrl(u);
}

// ============ ID 提取 ============
function txMid(mi) {
  if (!mi) return '';
  return (mi.meta && (mi.meta.qq && mi.meta.qq.mid || mi.meta.mid)) ||
    mi.songmid || mi.strMediaMid ||
    (typeof mi.id === 'string' && !/^\d+$/.test(mi.id) ? mi.id : '') || '';
}
function kwRid(mi) {
  if (!mi) return '';
  return mi.rid || mi.id || mi.songId || mi.musicId || '';
}
function kgHash(mi) {
  if (!mi) return '';
  return mi.hash || mi.albumAudioId || mi.audioId || '';
}
function wyId(mi) {
  if (!mi) return '';
  return mi.songmid || mi.id || mi.songId || mi.musicId || '';
}
const ID_FN = { tx: txMid, kw: kwRid, kg: kgHash, wy: wyId };

// ============ 链路 ============
// kw: 直链优先 → mafeiya → HYW → 聆澜
// tx: 真QQ直链(HYW/聆澜)优先 → 直链 → 留云
// kg: 直链 → 留云
// wy: 留云 → 直链兜底
const CHAINS = {
  kw: [
    (id, q) => btHtStream('kw', id, q),
    (id) => btMaflya('kw', id),
    (id, q) => btHyw('kw', id, q),
    (id, q) => btLinlan('kw', id, q)
  ],
  tx: [
    (id, q) => btHyw('tx', id, q),
    (id, q) => btLinlan('tx', id, q),
    (id, q) => btHtStream('tx', id, q),
    (id) => btLiuyun('tx', id)
  ],
  kg: [
    (id, q) => btHtStream('kg', id, q),
    (id) => btLiuyun('kg', id)
  ],
  wy: [
    (id) => btLiuyun('wy', id),
    (id, q) => btHtStream('wy', id, q)
  ]
};

// ============ 缓存 ============
function getCache(k) {
  const e = urlCache.get(k);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL) { urlCache.delete(k); return null; }
  return e.u;
}
function setCache(k, u) {
  if (urlCache.size > 200) urlCache.clear();
  urlCache.set(k, { u: u, ts: Date.now() });
}

// ============ 主处理 ============
async function resolve(platform, mi, quality) {
  const idFn = ID_FN[platform];
  const chain = CHAINS[platform];
  if (!idFn || !chain) return Promise.reject(new Error('不支持的平台: ' + platform));
  const id = idFn(mi);
  if (!id) return Promise.reject(new Error(platform + ': 无可用 songId'));
  const q = quality || '320k';
  const ck = platform + ':' + id + ':' + q;
  const hit = getCache(ck);
  if (hit) return hit;
  const errs = [];
  for (const fn of chain) {
    let u = '';
    try {
      u = await fn(id, q);
    } catch (e) {
      errs.push((e && e.message) || 'err');
      continue;
    }
    if (!u || !/^https?:\/\//.test(u)) { errs.push(platform + ':bad-url'); continue; }
    let alive = false;
    for (let i = 0; i < 2 && !alive; i++) { alive = await verifyUrl(u); }
    if (!alive) { errs.push(platform + ':dead-url'); continue; }
    setCache(ck, u);
    return u;
  }
  return Promise.reject(new Error(platform + ' 全部音源失败: ' + errs.join(' | ')));
}

// ============ 事件 ============
on(EVENT_NAMES.request, ({ action, source, info }) => {
  if (action !== 'musicUrl') {
    return Promise.reject(new Error('不支持的 action: ' + action));
  }
  const mi = info && info.musicInfo;
  if (!mi) return Promise.reject(new Error('请求参数不完整'));
  return resolve(source, mi, info && info.type).then(u => Promise.resolve(u));
});

// ============ 初始化 ============
send(EVENT_NAMES.inited, {
  openDevTools: false,
  sources: {
    kw: {
      name: '酷我音乐(多源聚合)',
      type: 'music',
      actions: ['musicUrl'],
      qualitys: ['128k', '320k', 'flac']
    },
    tx: {
      name: 'QQ音乐(真直链·多源聚合)',
      type: 'music',
      actions: ['musicUrl'],
      qualitys: ['128k', '320k', 'flac']
    },
    kg: {
      name: '酷狗音乐(多源聚合)',
      type: 'music',
      actions: ['musicUrl'],
      qualitys: ['128k', '320k', 'flac']
    },
    wy: {
      name: '网易云音乐(多源聚合)',
      type: 'music',
      actions: ['musicUrl'],
      qualitys: ['128k', '320k', 'flac']
    }
  }
});
