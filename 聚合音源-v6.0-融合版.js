/*!
 * @name 聚合音源 v6.0
 * @description 星海v3.2.13核心 + 溯音系列 + 长青IP直连，多层回退
 * @version v6.0
 * @build 2026-09-21
 */
const { EVENT_NAMES, request, on, send, env } = globalThis.lx;

// ==================== 用户配置 ====================
const CHKSZ_CONFIG = {
  apikey: '',
  enableNetease: true,
  enableQQ: true
};
const KW_DECRYPT_PROXY = {
  url: '',
  allowEncryptedLossless: false,
  urlParamName: 'url',
  ekeyParamName: 'ekey'
};

// ==================== URL配置 ====================
const URL_CONFIG = {
  domains: {
    backend: 'yy.zddyr.top',
    fallback: 'zrcdy.dpdns.org',
    gdStudio: 'music-api.gdstudio.xyz',
    chkszNew: 'api.chksz.com'
  },
  paths: {
    backend: '/lx/api/',
    version: '/lx/versionh2.php',
    update: '/lx/vers.php',
    gdApi: '/api.php'
  },
  gdParams: 'use_xbridge3=true&loader_name=forest&need_sec_link=1&sec_link_scene=im&theme=light'
};

const SCRIPT_VERSION = 'v6.0';
const SCRIPT_NAME = 'AggregatedMusicSource';

// 溯音API
const SUYIN_KUWO_API = 'https://oiapi.net/api/Kuwo';
const SUYIN_MIGU_API = 'https://api.xcvts.cn/api/music/migu';
const SUYIN_163_API = 'https://oiapi.net/api/Music_163';

// 长青IP直连
const CHANGQING_TEMPLATES = {
  tx: 'http://175.27.166.236/kgqq/qq.php?type=mp3&id={id}&level={level}',
  wy: 'http://175.27.166.236/wy/wy.php?type=mp3&id={id}&level={level}',
  kw: 'https://musicapi.haitangw.net/music/kw.php?type=mp3&id={id}&level={level}',
  kg: 'https://music.haitangw.cc/kgqq/kg.php?type=mp3&id={id}&level={level}',
  mg: 'https://music.haitangw.cc/musicapi/mg.php?type=mp3&id={id}&level={level}'
};

// 平台配置
const PLATFORM_NAMES = { wy: '网易云音乐', tx: 'QQ音乐', kw: '酷我音乐', kg: '酷狗音乐', mg: '咪咕音乐' };
const MUSIC_QUALITIES = {
  wy: ['128k','320k','flac','hires'],
  tx: ['128k','320k','flac','hires'],
  kw: ['128k','320k','flac'],
  kg: ['128k','320k','flac'],
  mg: ['128k','320k','flac']
};
const SOURCE_MAP = { tx: 'qq', mg: 'migu', kw: 'kw', kg: 'kg' };
const GD_BR_MAP = { '128k':'128', '320k':'320', 'flac':'740', 'hires':'999' };
const GD_SUPPORTED = new Set(['128k','320k','flac','hires']);

const CHKSZ_NETEASE_LEVEL_MAP = {
  '128k': 'standard', '320k': 'exhigh', 'flac': 'lossless', 'hires': 'hires'
};
const CHKSZ_QQ_SIZE_MAP = {
  '128k': '128k', '320k': '320k', 'flac': 'flac', 'hires': 'hires'
};

const QUALITY_PRIORITY = ['hires','flac','320k','128k'];
const TOKEN_TTL = 5 * 60 * 1000;
const HTTP_URL_REGEX = /^https?:\/\//i;
const CACHE_TTL_MS = 21600000;
const CACHE_MAX_SIZE = 500;
const urlCache = new Map();
const extraCache = new Map();
const extraCacheMax = 500;

// ==================== 工具 ====================
let userIp = null, userToken = '', tokenTimestamp = 0, clientHeader = '', deviceId = '';
let backendAggBlocked = false;

function safeParseBody(body) {
  if (typeof body === 'string') {
    const t = body.trim();
    if (/^[{["]/.test(t)) { try { return JSON.parse(t); } catch(e){} }
    return body;
  }
  if (typeof body === 'object' && body !== null) {
    try {
      if (typeof body.toString === 'function' && body.toString() !== '[object Object]')
        body = body.toString('utf-8');
    } catch(e){}
    if (typeof body === 'object') return body;
  }
  try {
    if (body && typeof body === 'object' && body.constructor && body.constructor.name === 'Buffer') {
      if (globalThis.lx?.utils?.buffer?.bufToString) body = globalThis.lx.utils.buffer.bufToString(body, 'utf-8');
      else if (typeof Buffer !== 'undefined') body = Buffer.from(body).toString('utf-8');
    }
  } catch(e){}
  if (typeof body === 'string') {
    const t = body.trim();
    if (/^[{["]/.test(t)) { try { return JSON.parse(t); } catch(e){} }
  }
  return body;
}

function safeBase64Encode(str) {
  try {
    if (globalThis.lx?.utils?.buffer?.from) {
      return globalThis.lx.utils.buffer.bufToString(globalThis.lx.utils.buffer.from(str, 'utf-8'), 'base64');
    }
    if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf-8').toString('base64');
    return btoa(unescape(encodeURIComponent(str)));
  } catch(e) { return str; }
}

function buildUrl(domainKey, pathKey, extra) {
  const d = URL_CONFIG.domains[domainKey], p = URL_CONFIG.paths[pathKey];
  if (!d || !p) throw new Error('URL配置错误: ' + domainKey);
  let url = 'https://' + d + p;
  if (extra) url += (extra.startsWith('&') && !p.includes('?') ? '?' + extra.substring(1) : extra);
  return url;
}

function generateDeviceId() {
  return 'lx-online-' + Math.random().toString(36).substring(2, 8) + Date.now().toString(36).slice(-4);
}

function buildClientHeader() {
  let t = 'unknown';
  try {
    const p = (env?.platform || '').toLowerCase();
    if (p.includes('android')) t = 'Android';
    else if (p.includes('ios')) t = 'iOS';
    else if (p.includes('win')) t = 'Windows';
    else if (p.includes('mac')) t = 'macOS';
    else if (p.includes('linux')) t = 'Linux';
  } catch(e){}
  return SCRIPT_NAME + '/' + SCRIPT_VERSION + ' (' + t + ')';
}

function generateToken(ip) {
  if (!deviceId) deviceId = generateDeviceId();
  return safeBase64Encode(JSON.stringify({
    device_id: deviceId, ip: ip || '0.0.0.0',
    timestamp: Math.floor(Date.now()/1000),
    random: Math.random().toString(36).substring(2, 12)
  }));
}

function ensureTokenFresh() {
  if (!userToken || (Date.now() - tokenTimestamp) > TOKEN_TTL) userToken = generateToken(userIp);
}

const httpFetch = (url, options = {}) => new Promise((resolve, reject) => {
  if (!options.noAuth) ensureTokenFresh();
  const h = { ...(options.headers || {}) };
  if (!options.noAuth) {
    if (userToken) h['X-Token'] = userToken;
    if (clientHeader) h['X-Client'] = clientHeader;
  }
  if (!h['User-Agent']) h['User-Agent'] = 'lx-music';
  request(url, { ...options, headers: h }, (err, resp) => {
    if (err) return reject(err);
    resolve({ body: safeParseBody(resp.body), statusCode: resp.statusCode, headers: resp.headers || {} });
  });
});

function mapQuality(target, avail) {
  const pm = { '臻品母带':'jymaster','臻品音质2.0':'sky','臻品音质AI':'jyeffect','臻品音质':'jyeffect',
    'Hires 无损24-Bit':'hires','Hi-Res':'hires','FLAC':'flac','320k':'320k','192k':'192k','128k':'128k' };
  if (avail.includes(target)) return target;
  const m = pm[target];
  if (m && avail.includes(m)) return m;
  for (const q of QUALITY_PRIORITY) if (avail.includes(q)) return q;
  return avail[0] || '128k';
}

function getMobileUserAgent() {
  return 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
}

function getPlatformSongId(platform, songInfo) {
  if (platform === 'kg') return songInfo?.hash || songInfo?.songmid || songInfo?.id || songInfo?.rid || songInfo?.mid || null;
  if (platform === 'tx') {
    const mid = songInfo?.meta?.qq?.mid || songInfo?.meta?.mid || songInfo?.songmid ||
      (typeof songInfo?.id === 'string' && !/^\d+$/.test(songInfo.id) ? songInfo.id : null);
    if (mid) return mid;
  }
  return songInfo?.songmid || songInfo?.id || songInfo?.songId || songInfo?.rid || songInfo?.hash || null;
}

function getHashOrMid(songInfo) { return songInfo?.hash ?? songInfo?.songmid ?? songInfo?.id ?? null; }

function qualityToNetease(q) {
  const v = String(q || '128k').toLowerCase();
  if (v === 'flac' || v === 'hires') return 'lossless';
  if (v === '320k') return 'exhigh';
  return 'standard';
}

function validateUrl(url, name) {
  if (!url || typeof url !== 'string') throw new Error(name + '返回空URL');
  if (!HTTP_URL_REGEX.test(url.trim())) throw new Error(name + '非法URL格式');
  return url.trim();
}

function buildCacheKey(prefix, songInfo, quality='') {
  return prefix + '_' + (songInfo?.name||'') + '_' + (songInfo?.singer||'') + '_' + (quality||'');
}
function getCachedUrl(k) {
  const e = urlCache.get(k);
  if (!e) return null;
  if (Date.now() - e.timestamp >= CACHE_TTL_MS) { urlCache.delete(k); return null; }
  return e.url;
}
function setCachedUrl(k, url) {
  urlCache.set(k, { url, timestamp: Date.now() });
  if (urlCache.size > CACHE_MAX_SIZE) {
    const old = urlCache.keys().next().value;
    if (old !== undefined) urlCache.delete(old);
  }
}

function setExtraCache(id, data) {
  extraCache.set(id, data);
  if (extraCache.size > extraCacheMax) {
    const old = extraCache.keys().next().value;
    if (old !== undefined) extraCache.delete(old);
  }
}

// 酷我加密处理
function processKwEncryptedUrl(data, source) {
  if (source !== 'kw' || !KW_DECRYPT_PROXY.allowEncryptedLossless) return data?.url || '';
  let ekey = null;
  if (data?.ekey) ekey = typeof data.ekey === 'string' ? data.ekey.trim() : String(data.ekey).trim();
  if (!ekey && data?.url && typeof data.url === 'string') {
    const m = data.url.match(/[?&]ekey=([^&]+)/);
    if (m) ekey = m[1];
  }
  if (!ekey || !KW_DECRYPT_PROXY.url) return data?.url || '';
  try {
    return KW_DECRYPT_PROXY.url + '?' + KW_DECRYPT_PROXY.urlParamName + '=' + encodeURIComponent(data.url) + '&' + KW_DECRYPT_PROXY.ekeyParamName + '=' + encodeURIComponent(ekey);
  } catch(e) { return data.url; }
}

// ==================== 星海后端聚合 ====================
async function fetchIp() {
  try {
    const r = await httpFetch(buildUrl('backend', 'ip'), { timeout: 3000 });
    if (r.body?.ip) { userIp = r.body.ip; userToken = generateToken(userIp); }
  } catch(e){}
}

async function getUrlFromBackend(source, musicInfo, quality) {
  const bs = SOURCE_MAP[source] || source;
  const baseUrl = buildUrl('backend', 'backend');
  const params = {};
  if (bs === 'kg') {
    const types = musicInfo._types || {};
    params.source = 'kg'; params.quality = quality || '';
    params.songmid = musicInfo.songmid || musicInfo.id || '';
    params.albumId = musicInfo.albumId || '';
    params.mainHash = musicInfo.hash || '';
    if (types[quality]?.hash) params.hash = types[quality].hash;
  } else {
    params.source = bs; params.name = musicInfo.name || '';
    params.singer = musicInfo.singer || '';
    params.songmid = musicInfo.songmid || musicInfo.id || '';
    params.interval = musicInfo.interval || '';
    params.albumName = musicInfo.albumName || musicInfo.album || '';
    params.quality = quality || '';
  }
  const query = Object.keys(params).map(k => encodeURIComponent(k)+'='+encodeURIComponent(params[k])).join('&');
  const url = baseUrl + '?' + query;
  const resp = await httpFetch(url, { method: 'GET', timeout: 8000 });
  if (resp.statusCode === 403) { backendAggBlocked = true; throw new Error('后端403已屏蔽'); }
  if (resp.statusCode !== 200) throw new Error('后端状态' + resp.statusCode);
  const data = resp.body;
  if (data.code !== 200 || !data.url) throw new Error(data.msg || '后端无链接');
  const finalUrl = processKwEncryptedUrl(data, bs);
  return { url: finalUrl, lyric: data.lrc || null, cover: data.picture || null };
}

// ==================== GD API ====================
async function getWyGDUrl(id, q) {
  const br = GD_BR_MAP[q] || '320';
  const url = buildUrl('gdStudio', 'gdApi', '&' + URL_CONFIG.gdParams + '&types=url&source=netease&id=' + id + '&br=' + br);
  let resp = await httpFetch(url, { headers: {'User-Agent':'LX-Music-Mobile'}, timeout: 8000, noAuth: true });
  if (q === 'hires' && (resp.statusCode !== 200 || !resp.body.url)) {
    const fbUrl = buildUrl('gdStudio', 'gdApi', '&' + URL_CONFIG.gdParams + '&types=url&source=netease&id=' + id + '&br=740');
    resp = await httpFetch(fbUrl, { headers: {'User-Agent':'LX-Music-Mobile'}, timeout: 8000, noAuth: true });
  }
  if (resp.statusCode !== 200 || !resp.body.url) throw new Error('GD状态' + resp.statusCode + '无音频');
  return { url: resp.body.url, lyric: null, cover: null };
}

// ==================== ChKSz ====================
async function getWyChkszUrl(id, quality) {
  const level = CHKSZ_NETEASE_LEVEL_MAP[quality];
  if (!level) throw new Error('chksz不支持该品质');
  const url = 'https://' + URL_CONFIG.domains.chkszNew + URL_CONFIG.paths.chkszNetease + '?id=' + id + '&level=' + level + '&apikey=' + encodeURIComponent(CHKSZ_CONFIG.apikey);
  const resp = await httpFetch(url, { headers: {'User-Agent':'LX-Music-Mobile'}, timeout: 8000, noAuth: true });
  if (resp.statusCode !== 200 || resp.body.code !== 200 || !resp.body.data?.url)
    throw new Error('chksz网易失败(' + resp.statusCode + '): ' + (resp.body?.msg || '无url'));
  return { url: resp.body.data.url, lyric: null, cover: resp.body.data.picUrl || null };
}

async function getTxChkszUrl(musicInfo, quality) {
  const size = CHKSZ_QQ_SIZE_MAP[quality];
  if (!size) throw new Error('chksz不支持该品质');
  const mid = musicInfo.songmid || musicInfo.id;
  if (!mid) throw new Error('缺少QQ mid');
  const url = 'https://' + URL_CONFIG.domains.chkszNew + URL_CONFIG.paths.chkszQQ + '?mid=' + mid + '&size=' + size + '&type=json&apikey=' + encodeURIComponent(CHKSZ_CONFIG.apikey);
  const resp = await httpFetch(url, { headers: {'User-Agent':'LX-Music-Mobile'}, timeout: 8000, noAuth: true });
  if (resp.statusCode !== 200 || resp.body.code !== 200 || !resp.body.url)
    throw new Error('chksz QQ失败(' + resp.statusCode + '): ' + (resp.body?.msg || '无url'));
  return { url: resp.body.url, lyric: resp.body.lrc || null, cover: resp.body.cover || null };
}

// ==================== 溯音酷我 ====================
function normalizeKeyword(kw) {
  if (!kw) return '';
  return String(kw).replace(/\(\s*Live\s*\)/gi,'').replace(/\([^)]*\)/g,'').replace(/\s+/g,'').replace(/[^\w\u4e00-\u9fa5]/g,'').trim().toLowerCase();
}
function titleMatch(a, b) {
  const na = normalizeKeyword(a), nb = normalizeKeyword(b);
  if (!na || !nb) return true;
  return na.includes(nb) || nb.includes(na);
}
function buildSearchKeywords(songInfo) {
  const kws = [], name = songInfo?.name || '', album = songInfo?.albumName || songInfo?.album || '', singer = songInfo?.singer || '';
  if (name && album) { const kw = normalizeKeyword(name+album); if (kw) kws.push({keyword:kw, strict:true}); }
  if (name && singer) { const kw = normalizeKeyword(name+singer); if (kw) kws.push({keyword:kw, strict:true}); }
  if (name) { const kw = normalizeKeyword(name); if (kw) kws.push({keyword:kw, strict:false}); }
  return kws;
}

async function httpGet(url, params = {}) {
  const qs = Object.entries(params).filter(([,v]) => v !== undefined && v !== null)
    .map(([k,v]) => encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&');
  const fullUrl = url + (qs ? (url.includes('?') ? '&' : '?') + qs : '');
  const res = await httpFetch(fullUrl, { method: 'GET', timeout: 5000 });
  if (res.statusCode >= 400) throw new Error('HTTP ' + res.statusCode);
  return res.body;
}

async function suyinKuwoSearch(keyword, br, songInfo) {
  const res = await httpGet(SUYIN_KUWO_API, { msg: keyword, n: 1, br });
  if (res?.data?.url) {
    if (songInfo && !titleMatch(res?.song || res?.data?.song || '', songInfo.name)) throw new Error('酷我歌曲不匹配');
    return res.data.url;
  }
  if (res?.message) {
    const m = String(res.message).match(/音乐链接[：:](\S+)/);
    if (m?.[1]) return m[1];
  }
  throw new Error('酷我未找到链接');
}

async function suyinKuwoGetUrl(platform, songId, quality, songInfo) {
  if (!songInfo?.name) throw new Error('溯音酷我需要歌曲名');
  const cacheKey = buildCacheKey('kw', songInfo, quality);
  const cached = getCachedUrl(cacheKey);
  if (cached) return validateUrl(cached, '溯音酷我');
  const QUALITY_TO_KUWO_BR = { flac: 1, '320k': 5, '128k': 7 };
  const br = QUALITY_TO_KUWO_BR[quality] || 1;
  let lastErr = null;
  for (const item of buildSearchKeywords(songInfo)) {
    try {
      const url = await suyinKuwoSearch(item.keyword, br, item.strict ? songInfo : null);
      setCachedUrl(cacheKey, url);
      return validateUrl(url, '溯音酷我');
    } catch(e) { lastErr = e; }
  }
  throw new Error('溯音酷我失败: ' + (lastErr?.message || 'unknown'));
}

// ==================== 溯音咪咕 ====================
async function suyinMiguGetUrl(platform, songId, quality, songInfo) {
  if (!songInfo?.name) throw new Error('溯音咪咕需要歌曲名');
  const cacheKey = buildCacheKey('mg', songInfo);
  const cached = getCachedUrl(cacheKey);
  if (cached) return validateUrl(cached, '溯音咪咕');
  let lastErr = null;
  for (const item of buildSearchKeywords(songInfo)) {
    try {
      const res = await httpGet(SUYIN_MIGU_API, { gm: item.keyword, n: 1, num: 1, type: 'json' });
      if (res?.code === 200 && res?.musicInfo) {
        setCachedUrl(cacheKey, res.musicInfo);
        return validateUrl(res.musicInfo, '溯音咪咕');
      }
    } catch(e) { lastErr = e; }
  }
  throw new Error('溯音咪咕失败: ' + (lastErr?.message || 'unknown'));
}

// ==================== 溯音163 ====================
async function suyin163GetUrl(platform, songId, quality, songInfo) {
  const id = songInfo?.songmid || songInfo?.id;
  if (!id) throw new Error('溯音163缺少songmid/id');
  const res = await httpGet(SUYIN_163_API, { id });
  if (res?.code === 0 && res?.data) {
    const item = Array.isArray(res.data) ? res.data[0] : res.data;
    if (item?.url) return validateUrl(item.url, '溯音163');
  }
  throw new Error('溯音163获取失败');
}

// ==================== 长青IP直连 ====================
async function changqingGetUrl(platform, songId, quality, songInfo) {
  const template = CHANGQING_TEMPLATES[platform];
  if (!template) throw new Error('长青SVIP不支持该平台');
  const id = getPlatformSongId(platform, songInfo);
  if (!id) throw new Error('长青SVIP缺少songId');
  const level = qualityToNetease(quality);
  return template.replace('{id}', encodeURIComponent(String(id))).replace('{level}', encodeURIComponent(level));
}

// ==================== 核心：获取音乐URL ====================
async function fetchMusicUrl(source, musicInfo, quality) {
  const id = musicInfo.hash ?? musicInfo.songmid ?? musicInfo.id;
  if (!id) throw new Error('缺少 songId');
  let actualQuality = mapQuality(quality, MUSIC_QUALITIES[source] || ['128k','320k','flac']);
  if (source === 'kw' && !KW_DECRYPT_PROXY.allowEncryptedLossless)
    actualQuality = mapQuality(quality, ['128k','320k','flac']);

  const chkszEnabled = !!(CHKSZ_CONFIG.apikey && CHKSZ_CONFIG.apikey.trim());
  let result = { url: '', lyric: null, cover: null };
  let lastError = '';
  const errors = [];

  // 第一梯队: 星海后端聚合
  if (!backendAggBlocked) {
    try {
      result = await getUrlFromBackend(source, musicInfo, actualQuality);
    } catch(e) { lastError = '后端: ' + e.message; errors.push(lastError); }
  }

  // 第二梯队: 平台专属
  if (!result.url) {
    if (source === 'wy') {
      // ChKSz → GD
      if (chkszEnabled && CHKSZ_CONFIG.enableNetease) {
        try { result = await getWyChkszUrl(id, actualQuality); }
        catch(e) { lastError = 'chksz: ' + e.message; errors.push(lastError); }
      }
      if (!result.url && GD_SUPPORTED.has(actualQuality)) {
        try { result = await getWyGDUrl(id, actualQuality); }
        catch(e) { lastError = 'GD: ' + e.message; errors.push(lastError); }
      }
      // 溯音163
      if (!result.url) {
        try { const u = await suyin163GetUrl(source, id, actualQuality, musicInfo); result = { url: u, lyric: null, cover: null }; }
        catch(e) { lastError = '溯音163: ' + e.message; errors.push(lastError); }
      }
    } else if (source === 'tx') {
      if (chkszEnabled && CHKSZ_CONFIG.enableQQ) {
        try { result = await getTxChkszUrl(musicInfo, actualQuality); }
        catch(e) { lastError = 'chksz QQ: ' + e.message; errors.push(lastError); }
      }
    } else if (source === 'kw' || source === 'kg') {
      // 溯音酷我
      try { const u = await suyinKuwoGetUrl(source, id, actualQuality, musicInfo); result = { url: u, lyric: null, cover: null }; }
      catch(e) { lastError = '溯音酷我: ' + e.message; errors.push(lastError); }
    } else if (source === 'mg') {
      // 溯音咪咕
      try { const u = await suyinMiguGetUrl(source, id, actualQuality, musicInfo); result = { url: u, lyric: null, cover: null }; }
      catch(e) { lastError = '溯音咪咕: ' + e.message; errors.push(lastError); }
    }
  }

  // 第三梯队: 长青IP直连
  if (!result.url) {
    try {
      const u = await changqingGetUrl(source, id, actualQuality, musicInfo);
      result = { url: validateUrl(u, '长青SVIP'), lyric: null, cover: null };
    } catch(e) { lastError = '长青: ' + e.message; errors.push(lastError); }
  }

  if (!result.url || typeof result.url !== 'string' || !result.url.trim())
    throw new Error('所有源均失败: ' + (errors.join('; ') || lastError || 'unknown'));

  setExtraCache(id, { lyric: result.lyric, cover: result.cover });
  return result.url.trim();
}

// ==================== 更新检查 ====================
async function checkUpdate() {
  const urls = [
    buildUrl('backend', 'version') + '?ver=' + encodeURIComponent(SCRIPT_VERSION),
    buildUrl('fallback', 'version') + '?ver=' + encodeURIComponent(SCRIPT_VERSION)
  ];
  try {
    const resp = await Promise.any(urls.map(u => httpFetch(u, { timeout: 5000 })));
    if (resp.statusCode === 200 && resp.body?.update_url) {
      send(EVENT_NAMES.updateAlert, {
        log: resp.body.changelog || resp.body.message || '发现新版本 ' + (resp.body.version || ''),
        updateUrl: resp.body.update_url
      });
    }
  } catch(e){}
}

// ==================== 事件处理 ====================
on(EVENT_NAMES.request, async ({ action, source, info }) => {
  if (!source || !MUSIC_QUALITIES[source]) throw new Error('不支持的音乐源: ' + source);
  if (action === 'musicUrl') {
    if (!info?.musicInfo || !info.type) throw new Error('参数不完整');
    return fetchMusicUrl(source, info.musicInfo, info.type);
  }
  const id = info?.musicInfo?.hash ?? info?.musicInfo?.songmid ?? info?.musicInfo?.id;
  const cached = extraCache.get(id);
  if (action === 'lyric') return cached?.lyric ? { lyric: cached.lyric, tlyric: '' } : null;
  if (action === 'pic') return cached?.cover || null;
  throw new Error('不支持的操作: ' + action);
});

// ==================== 启动 ====================
(async () => {
  deviceId = generateDeviceId();
  clientHeader = buildClientHeader();
  userToken = generateToken(null);
  const sources = {};
  Object.keys(MUSIC_QUALITIES).forEach(p => {
    sources[p] = { name: PLATFORM_NAMES[p], type: 'music', actions: ['musicUrl','lyric','pic'], qualitys: MUSIC_QUALITIES[p] };
  });
  send(EVENT_NAMES.inited, { openDevTools: false, status: true, sources });
  fetchIp();
  checkUpdate();
})();