/**
 * @name 长青SVIP音源(多源聚合版)
 * @description kw/tx 双平台四层回退 | 怡红院+聆澜真QQ直链 | 长青haitangw核心 | 念心兜底
 * @version v1.2.1
 * @author asice999 (整合)
 * @homepage https://github.com/asice999/lxmusic-sources
 * @update_url https://raw.githubusercontent.com/asice999/lxmusic-sources/master/source.js
 *
 * 可用性实测 (2026-09-23)：
 *   kw: 长青haitangw → 念心maflya → 怡红院HYW → 聆澜    四层全活
 *   tx: 怡红院HYW   → 聆澜       → 长青haitangw → 念心maflya   四层全活
 *   mg/kg/wy: 5个后端全熔断，不注册（点了必失败）
 * 关键修复：所有后端返回的 URL 用 $ 作参数分隔符，必须替换为 = 才可播放
 */
'use strict';

const { EVENT_NAMES, request, on, send } = globalThis.lx;

// ============ 后端配置 ============
const HT = {
  api: 'https://musicserver.haitangw.cc/v1/music/resolve-url',
  levelMap: { '128k': 'standard', '320k': 'exhigh', '192k': 'exhigh', 'flac': 'lossless', 'flac24bit': 'lossless', 'master': 'lossless', 'hires': 'lossless' }
};
const HYW = {
  api: 'http://103.79.184.97/api/music/url',
  key: 'PYPW-QFRL-3DBF-95O6'
};
const LL = {
  api: 'https://source.shiqianjiang.cn/api/music/url',
  key: 'CERU_KEY-F4A5F0A7-F612-4676-A8F2-4A13DD0FA4E5'
};
const NF = 'http://mcp.nianxinxz.com/share/ceshi';

const TIMEOUT = 10000;
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

// ============ 后端调用 ============
async function btHaitangw(platform, songId, quality) {
  const body = JSON.stringify({ source: platform, rid: String(songId), level: HT.levelMap[quality] || 'exhigh' });
  const s = await httpReq(HT.api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body });
  const j = jParse(s);
  const u = (j && ((j.data && j.data.url) || j.url || (j.data && j.data.playUrl))) || '';
  if (!u) throw new Error('ht: no url');
  return fixUrl(u);
}

async function btHyw(platform, songId, quality) {
  const q = 'source=' + encodeURIComponent(platform) + '&songId=' + encodeURIComponent(String(songId)) + '&quality=' + encodeURIComponent(quality || '320k') + '&key=' + encodeURIComponent(HYW.key);
  const s = await httpReq(HYW.api + '?' + q, { headers: { 'X-Card-Key': HYW.key } });
  const j = jParse(s);
  if (!j || j.code !== 200 || !j.url) throw new Error('hyw: ' + ((j && (j.message || j.msg)) || 'no url'));
  return fixUrl(j.url);
}

async function btLinlan(platform, songId, quality) {
  const q = 'source=' + encodeURIComponent(platform) + '&songId=' + encodeURIComponent(String(songId)) + '&quality=' + encodeURIComponent(quality || '320k');
  const s = await httpReq(LL.api + '?' + q, { headers: { 'X-API-Key': LL.key } });
  const j = jParse(s);
  if (!j || j.code !== 200 || !j.url) throw new Error('linlan: ' + ((j && (j.message || j.msg)) || 'no url'));
  return fixUrl(j.url);
}

async function btMaflya(platform, songId) {
  const s = await httpReq(NF + '/' + platform + '.php?id=' + encodeURIComponent(String(songId)));
  const j = jParse(s);
  const u = (j && (((j.data && j.data.url) || j.url) || '')) || '';
  if (!u || u === 'None') throw new Error('nf: no url');
  return fixUrl(u);
}

// ============ ID 提取 ============
function txMid(mi) {
  return mi && (mi.meta && (mi.meta.qq && mi.meta.qq.mid || mi.meta.mid)) || mi.songmid || mi.strMediaMid ||
    (typeof mi.id === 'string' && !/^\d+$/.test(mi.id) ? mi.id : '') || '';
}
function kwRid(mi) {
  return (mi && (mi.rid || mi.id || mi.songId || mi.musicId)) || '';
}

// ============ 链路 ============
// kw: 长青→念心→怡红院→聆澜
const KW_CHAIN = [
  function (id, q) { return btHaitangw('kw', id, q); },
  function (id) { return btMaflya('kw', id); },
  function (id, q) { return btHyw('kw', id, q); },
  function (id, q) { return btLinlan('kw', id, q); }
];
// tx: 怡红院→聆澜→长青→念心（真QQ直链优先）
const TX_CHAIN = [
  function (id, q) { return btHyw('tx', id, q); },
  function (id, q) { return btLinlan('tx', id, q); },
  function (id, q) { return btHaitangw('tx', id, q); },
  function (id) { return btMaflya('tx', id); }
];

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
  const id = platform === 'tx' ? txMid(mi) : kwRid(mi);
  if (!id) return Promise.reject(new Error(platform + ': 无可用 songId'));
  const q = quality || '320k';
  const ck = platform + ':' + id + ':' + q;
  const hit = getCache(ck);
  if (hit) return hit;
  const chain = platform === 'tx' ? TX_CHAIN : KW_CHAIN;
  const errs = [];
  for (const fn of chain) {
    try {
      const u = await fn(id, q);
      if (u && /^https?:\/\//.test(u)) {
        setCache(ck, u);
        return u;
      }
      errs.push(platform + ':bad-url');
    } catch (e) {
      errs.push((e && e.message) || 'err');
    }
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
    }
  }
});