/**
 * @name 长青SVIP音源(多源聚合版)
 * @description kw/tx/kg/wy 四平台多链路回退 | QQ官方CDN全音质(s01s) | 酷我官方直链(mobi.kuwo) | 多层兜底
 * @version v1.4.0
 * @author asice999 (整合)
 * @homepage https://github.com/asice999/lxmusic-sources
 * @update_url https://raw.githubusercontent.com/asice999/lxmusic-sources/master/source.js
 *
 * 可用性实测 (2026-09-23)：
 *   tx: s01s(QQ官方CDN 全音质 128k/320k/SQ/PQ FLAC/OGG, 3/3稳定) → HYW → 聆澜 → yinyue直链 → 留云  ← 官源升级
 *   kw: mobi.kuwo.cn官方(jiakong端 官源直链, 3/3稳定 多歌泛化) → yinyue直链 → mafeiya → HYW → 聆澜   ← 官源新增
 *   kg: yinyue直链(kg_song_kw.php, 4.3MB ID3 三连测稳定) → 留云
 *   wy: 留云(liuyunidc, 200 ID3 3/3稳定) → yinyue wy.php(兜底)
 *   mg: 已剔除 —— 咪咕官方 listen-url v2.2 全返 870001(内部错误)、search API 全返SPA HTML已下线,
 *       第三方5后端全军覆没, 版权id格式不可得, 确认无解
 *
 * 关键修复：JSON 后端返回 URL 用 $ 作参数分隔符(如 bitrate$128&format$mp3)，经 fixUrl() 替换 = 才可播放
 * 已剔除失效源：cenguigui/netease(会员到期)、bugpk(官方外链返回百度验证码HTML)、
 *              vkeys(song/link 账号风控)、cyapi(403)、ygking(502)、yaohud(参数禁传)、
 *              nki(403)、apiv2/apiv3.kugou.com(SSL重置)、music.migu.cn(接口下线)
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
// QQ 官方 CDN（s01s 中转，返回 isure.stream.qqmusic.qq.com 直链含 vkey）
const S01S = 'https://tang.api.s01s.cn/music_open_api.php';
const S01S_MAP = {
  '128k': 'song_play_url_standard',
  '192k': 'song_play_url_standard',
  '320k': 'song_play_url',
  'flac': 'song_play_url_sq',
  'flac24bit': 'song_play_url_sq',
  'master': 'song_play_url_sq',
  'hires': 'song_play_url_sq',
  'atmos': 'song_play_url_accom',
  'atmos_plus': 'song_play_url_accom'
};
// 酷我官方 mobi.kuwo.cn（KuwoDES convert_url_with_sign，返回 car-er.kuwo.cn 直链）
const KW_MOBI = 'https://mobi.kuwo.cn/mobi.s';
const KW_UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4';
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

// GET+Range 探测 URL 存活（lxmusic request 未必支持 HEAD，直链多返回 405 会误杀）
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
      // 200/206 资源存在；416 Range 不满足也说明资源存在；405 方法受限不代表资源不存在
      // 3xx 重定向说明资源存在（本处 request 不跟随，播放器会跟随 301/302）
      resolve(!!st && (st === 200 || st === 206 || st === 416 || st === 405 ||
        (st >= 300 && st <= 308 && st !== 304)));
    });
  });
}

// ============ 后端调用 ============
// s01s：QQ 官方 CDN 全音质直链
async function btS01s(id, quality) {
  const key = S01S_MAP[quality] || 'song_play_url';
  const s = await httpReq(S01S + '?mid=' + encodeURIComponent(String(id)));
  const j = jParse(s);
  const u = j && j[key];
  if (!u) throw new Error('s01s: 无 ' + key + ' 直链');
  return fixUrl(u);
}

// 酷我官方 mobi.kuwo.cn：KuwoDES 换取官源直链
async function btKuwoMobi(rid) {
  const u = KW_MOBI + '?f=web&rid=' + encodeURIComponent(String(rid)) +
    '&br=320&source=jiakong&type=convert_url_with_sign&surl=1';
  const s = await httpReq(u, { headers: { 'User-Agent': KW_UA } });
  const j = jParse(s);
  const d = j && j.data;
  if (!j || j.code !== 200 || !d) throw new Error('kuwo mobi: ' + ((j && (j.msg)) || 'no url'));
  const u2 = d.surl || d.url;
  if (!u2) throw new Error('kuwo mobi: no url');
  return fixUrl(u2);
}

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
// tx: 官源全音质优先 → 真QQ直链 → 直链 → 留云
// kw: 官源直链优先 → 直链 → mafeiya → HYW → 聆澜
// kg: 直链 → 留云
// wy: 留云 → 直链兜底
const CHAINS = {
  tx: [
    (id, q) => btS01s(id, q),
    (id, q) => btHyw('tx', id, q),
    (id, q) => btLinlan('tx', id, q),
    (id, q) => btHtStream('tx', id, q),
    (id) => btLiuyun('tx', id)
  ],
  kw: [
    (id) => btKuwoMobi(id),
    (id, q) => btHtStream('kw', id, q),
    (id) => btMaflya('kw', id),
    (id, q) => btHyw('kw', id, q),
    (id, q) => btLinlan('kw', id, q)
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
      name: '酷我音乐(官源直链·多源聚合)',
      type: 'music',
      actions: ['musicUrl'],
      qualitys: ['128k', '320k', 'flac']
    },
    tx: {
      name: 'QQ音乐(官方CDN全音质·多源聚合)',
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
