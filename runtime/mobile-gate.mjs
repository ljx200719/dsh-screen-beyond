/**
 * 手机门 · 桌面端（局域网 + TLS + 配对 + 设备凭证 + 权限 + 限流 + 审计）
 *
 * 设计边界（别越过）：
 *   · 默认**关闭**。主服务永远只听 127.0.0.1（桌面面板走它）；只有在「手机连接」里显式打开后，
 *     才会另起一个**独立**的 HTTPS 监听（默认 0.0.0.0:8920）—— 关掉就立刻断开外部连接。
 *   · **没有 TLS 就不允许离开回环**：这里不提供明文模式，避免有人一键把 8900 暴露到公网。
 *   · 这一层只是「网关」：认证/授权/限流/审计之后，把请求**原样转发**给本机主服务（127.0.0.1:主端口）。
 *     业务逻辑一份也不复制，所以权限收紧不会和业务代码走样。
 *   · 手机默认只有「聊天 + 只读」权限（MOBILE-GATE §3.6 的最小能力集）：
 *     设置 / 环境 / VM / 备份恢复 / 截图 / 桌宠 这些接口在局域网模式下**默认拒绝**（403 + 中文说明）。
 *   · 凭证只存 sha256 摘要；短码一次性、5 分钟过期；每台设备独立令牌，可单独撤销。
 *   · 审计日志不含明文令牌。
 *
 * 证书：自己用 DER 拼一张自签 X.509（RSA-2048 / SHA-256 / SAN=本机 IP+主机名），
 * 不依赖 openssl 或第三方包；生成后用 node:crypto 的 X509Certificate 解析自检，坏了直接抛。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNTIME_DIR = path.dirname(fileURLToPath(import.meta.url));
// 手机网页版（纯静态，三件套）：/ = index.html，另有 app.css / app.js
const WEB_DIR = path.join(RUNTIME_DIR, 'mobile-web');
const WEB_FILES = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.css': { file: 'app.css', type: 'text/css; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
};
// 页面自己的 CSP：只有同源 + 内联样式，不给任何外部来源
const WEB_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export const MOBILE_GATE_DEFAULTS = {
  enabled: false,
  port: 8920,          // 故意避开主服务的 8900~8912 扫描段
  bindHost: '0.0.0.0', // 监听所有网卡（局域网可达）
  pairCodeTtlMs: 5 * 60 * 1000,
  deviceIdleDays: 90,  // 90 天没连过就标记过期（不自动删，便于审计）
};

// 手机端允许的接口（MOBILE-GATE §3.6 最小能力集）。不在表里的一律 403。
// 注意：这里只放「手机真的要用」的；桌面端能力（设置/环境/VM/备份/桌宠/截图）故意不放。
const MOBILE_ALLOW = [
  ['GET', /^\/api\/version$/],
  ['GET', /^\/api\/status$/],
  ['GET', /^\/api\/events$/],
  ['GET', /^\/api\/stream$/],
  ['POST', /^\/api\/chat$/],
  ['POST', /^\/api\/chat\/cancel$/],
  ['GET', /^\/api\/characters$/],
  ['GET', /^\/api\/persona$/],
  ['GET', /^\/api\/stage$/],
  ['GET', /^\/api\/stage\/stream$/],
  ['GET', /^\/api\/location$/],
  ['GET', /^\/api\/life\/state$/],
  ['GET', /^\/api\/life\/states$/],
  ['GET', /^\/api\/economy$/],
  ['GET', /^\/api\/diary$/],
  ['GET', /^\/api\/memory$/],
  ['GET', /^\/api\/world\/characters$/],
];

// 图片/语音这类**静态资源**手机也要能看（聊天里的图、她的语音）
const MOBILE_ALLOW_STATIC = [/^\/images\//, /^\/models\//, /^\/avatar\.png$/, /^\/default-avatar\.png$/, /^\/voice\/audio\//];

// ---------- DER / X.509（自签证书，不依赖 openssl） ----------

function derLength(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  let v = n;
  while (v > 0) { bytes.unshift(v & 0xff); v >>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
function tlv(tag, content) {
  const c = Buffer.isBuffer(content) ? content : Buffer.from(content || []);
  return Buffer.concat([Buffer.from([tag]), derLength(c.length), c]);
}
const derSeq = (...items) => tlv(0x30, Buffer.concat(items));
const derSet = (...items) => tlv(0x31, Buffer.concat(items));
const derNull = () => tlv(0x05, Buffer.alloc(0));
const derBool = (b) => tlv(0x01, Buffer.from([b ? 0xff : 0x00]));
/** 正整数（最高位不能是 1，否则前面补 0x00） */
function derInt(buf) {
  let b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  while (b.length > 1 && b[0] === 0x00 && (b[1] & 0x80) === 0) b = b.slice(1);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0x00]), b]);
  return tlv(0x02, b);
}
function derOid(dotted) {
  const parts = String(dotted).split('.').map((x) => Number(x));
  const first = 40 * parts[0] + parts[1];
  const out = [first];
  for (const n of parts.slice(2)) {
    const stack = [n & 0x7f];
    let v = Math.floor(n / 128);
    while (v > 0) { stack.unshift(0x80 | (v & 0x7f)); v = Math.floor(v / 128); }
    for (const s of stack) out.push(s);
  }
  return tlv(0x06, Buffer.from(out));
}
const derUtf8 = (s) => tlv(0x0c, Buffer.from(String(s), 'utf8'));
const derOctet = (b) => tlv(0x04, b);
function derBitString(buf) { return tlv(0x03, Buffer.concat([Buffer.from([0x00]), buf])); }
function derUtcTime(date) {
  const p = (n) => String(n).padStart(2, '0');
  const s = p(date.getUTCFullYear() % 100) + p(date.getUTCMonth() + 1) + p(date.getUTCDate()) +
    p(date.getUTCHours()) + p(date.getUTCMinutes()) + p(date.getUTCSeconds()) + 'Z';
  return tlv(0x17, Buffer.from(s, 'ascii'));
}
const ctxExplicit = (n, content) => tlv(0xa0 + n, content);
// GeneralName：dNSName 是 [2] IMPLICIT IA5String，iPAddress 是 [7] IMPLICIT OCTET STRING(4 bytes)
const gnDns = (name) => tlv(0x82, Buffer.from(String(name), 'ascii'));
const gnIp = (ip) => tlv(0x87, Buffer.from(String(ip).split('.').map((x) => Number(x) & 0xff)));

const OID_SHA256_RSA = '1.2.840.113549.1.1.11';
const OID_CN = '2.5.4.3';
const OID_SAN = '2.5.29.17';
const OID_BASIC = '2.5.29.19';
const OID_EKU = '2.5.29.37';
const OID_SERVER_AUTH = '1.3.6.1.5.5.7.3.1';

/** 生成一张自签证书：返回 { keyPem, certPem, fingerprint256, subject, sans } */
export function createSelfSignedCert(opts) {
  const o = opts || {};
  const cn = String(o.commonName || 'dsh-screen-beyond.local').slice(0, 64);
  const ips = Array.isArray(o.ips) ? o.ips.filter(Boolean) : [];
  const days = Math.max(1, Math.min(3650, Number(o.days) || 825));
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const now = new Date();
  const notBefore = new Date(now.getTime() - 60 * 1000);
  const notAfter = new Date(now.getTime() + days * 24 * 3600 * 1000);
  const name = derSeq(derSet(derSeq(derOid(OID_CN), derUtf8(cn))));

  const sanNames = [gnDns('localhost'), gnDns(cn)];
  for (const ip of ips) { try { sanNames.push(gnIp(ip)) } catch {} }
  const san = derSeq(...sanNames);
  const extensions = derSeq(
    derSeq(derOid(OID_SAN), derOctet(san)),
    derSeq(derOid(OID_BASIC), derBool(true), derOctet(derSeq())),
    derSeq(derOid(OID_EKU), derOctet(derSeq(derOid(OID_SERVER_AUTH)))),
  );
  const serial = crypto.randomBytes(16);
  const tbs = derSeq(
    ctxExplicit(0, derInt(Buffer.from([2]))),
    derInt(serial),
    derSeq(derOid(OID_SHA256_RSA), derNull()),
    name,
    derSeq(derUtcTime(notBefore), derUtcTime(notAfter)),
    name,
    publicKey, // SPKI 本身就是 DER SEQUENCE
    ctxExplicit(3, extensions),
  );
  const signature = crypto.sign('sha256', tbs, privateKey);
  const certDer = derSeq(tbs, derSeq(derOid(OID_SHA256_RSA), derNull()), derBitString(signature));
  const certPem = '-----BEGIN CERTIFICATE-----\n' +
    certDer.toString('base64').match(/.{1,64}/g).join('\n') + '\n-----END CERTIFICATE-----\n';

  // 自检：解析不出来/指纹对不上就直接抛，宁可启动失败也不给一张坏证书
  const x = new crypto.X509Certificate(certPem);
  if (!x.checkPrivateKey(crypto.createPrivateKey(privateKey))) {
    const err = new Error('自签证书自检失败：私钥和证书不匹配');
    err.code = 'SBC_CERT_MISMATCH';
    throw err;
  }
  return {
    keyPem: privateKey,
    certPem,
    fingerprint256: x.fingerprint256,
    subject: x.subject,
    sans: ['localhost', cn, ...ips],
    notAfter: x.validTo,
  };
}

/**
 * 本机所有非回环 IPv4（给证书 SAN 和面板展示用）。
 * kind：vpn（Tailscale/ZeroTier/OpenVPN 这类虚拟局域网，出门也能用）/ lan（家里 Wi-Fi/有线）/ other。
 */
export function lanIPv4List() {
  const out = [];
  const isVpnName = (n) => /tailscale|zerotier|wireguard|openvpn|tap|tun|vpn|wintun/i.test(String(n || ''));
  const isCgnat = (ip) => {
    const m = /^100\.(\d+)\./.exec(String(ip));
    return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127; // 100.64.0.0/10（Tailscale 就这么发地址）
  };
  try {
    const ifs = os.networkInterfaces();
    for (const name of Object.keys(ifs)) {
      for (const it of ifs[name] || []) {
        if (!it || it.family !== 'IPv4' || it.internal) continue;
        const kind = (isVpnName(name) || isCgnat(it.address)) ? 'vpn' : 'lan';
        out.push({ iface: name, address: it.address, netmask: it.netmask, kind });
      }
    }
  } catch {}
  // 虚拟局域网排前面：出门要靠它
  out.sort((a, b) => (a.kind === 'vpn' ? 0 : 1) - (b.kind === 'vpn' ? 0 : 1));
  return out;
}

// ---------- 设备存储 ----------

function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }

class DeviceStore {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'devices.json');
    this.devices = [];
    this.lastSaveAt = 0;
    fs.mkdirSync(dir, { recursive: true });
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && Array.isArray(raw.devices)) this.devices = raw.devices;
    } catch { this.devices = []; }
  }

  save(force) {
    const now = Date.now();
    if (!force && now - this.lastSaveAt < 2000) return;
    this.lastSaveAt = now;
    try {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, devices: this.devices }, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch {}
  }

  list() {
    return this.devices.map((d) => ({
      id: d.id, name: d.name || '', scope: d.scope || 'chat',
      createdAt: d.createdAt || 0, lastSeenAt: d.lastSeenAt || 0,
      revokedAt: d.revokedAt || 0, lastIp: d.lastIp || '',
    }));
  }

  add(name, scope) {
    const token = crypto.randomBytes(32).toString('hex');
    const dev = {
      id: crypto.randomUUID(),
      name: String(name || '手机').slice(0, 40),
      scope: scope === 'readonly' ? 'readonly' : 'chat',
      tokenHash: sha256(token),
      createdAt: Date.now(),
      lastSeenAt: 0,
      revokedAt: 0,
      lastIp: '',
    };
    this.devices.push(dev);
    this.save(true);
    return { device: dev, token };
  }

  /** 用请求带来的明文令牌找设备（只比摘要） */
  findByToken(token) {
    const t = String(token || '').trim();
    if (!t) return null;
    const h = sha256(t);
    return this.devices.find((d) => d.tokenHash === h && !d.revokedAt) || null;
  }

  touch(dev, ip) {
    if (!dev) return;
    dev.lastSeenAt = Date.now();
    if (ip) dev.lastIp = String(ip);
    this.save(false);
  }

  revoke(id) {
    const dev = this.devices.find((d) => d.id === String(id || ''));
    if (!dev) return null;
    dev.revokedAt = Date.now();
    this.save(true);
    return dev;
  }

  revokeAll() {
    let n = 0;
    for (const d of this.devices) { if (!d.revokedAt) { d.revokedAt = Date.now(); n++ } }
    this.save(true);
    return n;
  }
}

// ---------- 限流（滑动窗口） ----------

class RateLimiter {
  constructor() { this.hits = new Map(); }
  hit(key, limit, windowMs) {
    const now = Date.now();
    const arr = (this.hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= limit) { this.hits.set(key, arr); return { ok: false, retryAfterMs: windowMs - (now - arr[0]) }; }
    arr.push(now);
    this.hits.set(key, arr);
    if (this.hits.size > 500) { for (const [k, v] of this.hits) { if (!v.length || now - v[v.length - 1] > windowMs) this.hits.delete(k) } }
    return { ok: true, remaining: limit - arr.length };
  }
}

// ---------- 审计日志 ----------

class AuditLog {
  constructor(dir) {
    this.file = path.join(dir, 'audit.jsonl');
    this.maxBytes = 2 * 1024 * 1024;
    fs.mkdirSync(dir, { recursive: true });
  }
  add(entry) {
    try {
      try { if (fs.statSync(this.file).size > this.maxBytes) fs.renameSync(this.file, this.file + '.1') } catch {}
      const rec = Object.assign({ at: new Date().toISOString() }, entry || {});
      fs.appendFileSync(this.file, JSON.stringify(rec) + '\n', 'utf8');
    } catch {}
  }
  tail(n) {
    const limit = Math.max(1, Math.min(200, Number(n) || 50));
    try {
      const lines = fs.readFileSync(this.file, 'utf8').split(/\r?\n/).filter(Boolean);
      return lines.slice(-limit).map((ln) => { try { return JSON.parse(ln) } catch { return { raw: ln.slice(0, 200) } } });
    } catch { return []; }
  }
}

// ---------- 网关本体 ----------

export class MobileGate {
  /**
   * @param {{root:string, config:object, loopbackPort:number, apiToken:string, version:string, log?:Function, onConfigChange?:Function}} opts
   */
  constructor(opts) {
    const o = opts || {};
    this.root = path.resolve(String(o.root || '.'));
    this.dir = path.join(this.root, 'mobile-gate');
    this.loopbackPort = Number(o.loopbackPort) || 8900;
    this.apiToken = String(o.apiToken || '');
    this.version = String(o.version || '0.0.0');
    this.log = typeof o.log === 'function' ? o.log : () => {};
    this.onConfigChange = typeof o.onConfigChange === 'function' ? o.onConfigChange : () => {};
    this.cfg = Object.assign({}, MOBILE_GATE_DEFAULTS, o.config || {});
    this.devices = new DeviceStore(this.dir);
    this.audit = new AuditLog(this.dir);
    this.limiter = new RateLimiter();
    this.server = null;
    this.cert = null;
    this.startedAt = 0;
    this.pairCodes = new Map(); // code -> {expiresAt, createdAt, used}
    this.lastError = '';
    this.requests = 0;
    this.denied = 0;
  }

  /** 读/建证书（指纹固定写进 cert.json，面板展示同一份） */
  ensureCert(forceNew) {
    const metaPath = path.join(this.dir, 'cert.json');
    const keyPath = path.join(this.dir, 'tls-key.pem');
    const certPath = path.join(this.dir, 'tls-cert.pem');
    const currentIps = lanIPv4List().map((x) => x.address);
    if (!forceNew) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        if (meta && meta.fingerprint256 && fs.existsSync(keyPath) && fs.existsSync(certPath)) {
          const certPem = fs.readFileSync(certPath, 'utf8');
          const keyPem = fs.readFileSync(keyPath, 'utf8');
          const x = new crypto.X509Certificate(certPem);
          if (!x.checkPrivateKey(crypto.createPrivateKey(keyPem))) throw new Error('证书与私钥不匹配');
          const left = Date.parse(x.validTo) - Date.now();
          if (!Number.isFinite(left) || left <= 7 * 24 * 3600 * 1000) {
            this.log('[mobile-gate] 证书快到期，重新生成');
          } else {
            // 网卡变了（比如刚装好 Tailscale 拿到 100.x 地址）：旧证书的 SAN 里没有这个地址，
            // 手机按 IP 访问会报"证书名字不匹配"。这里自动重签一次（指纹会变，需要重新信任）。
            const hadIps = Array.isArray(meta.ipSans) ? meta.ipSans : [];
            const missing = currentIps.filter((ip) => hadIps.indexOf(ip) < 0);
            if (!currentIps.length || !missing.length) {
              this.cert = { keyPem, certPem, fingerprint256: x.fingerprint256, subject: x.subject, notAfter: x.validTo, sans: meta.sans || [] };
              return this.cert;
            }
            this.log('[mobile-gate] 检测到新网卡地址（' + missing.join(', ') + '），重新签发证书');
            this.audit.add({ type: 'cert.renew', reason: 'new-ip', missing });
          }
        }
      } catch (e) {
        this.log('[mobile-gate] 证书不可用，重新生成：' + ((e && e.message) || e));
      }
    }
    fs.mkdirSync(this.dir, { recursive: true });
    const ips = currentIps;
    const made = createSelfSignedCert({ commonName: os.hostname() || 'screen-beyond', ips });
    fs.writeFileSync(keyPath, made.keyPem, { encoding: 'utf8', mode: 0o600 });
    fs.writeFileSync(certPath, made.certPem, 'utf8');
    fs.writeFileSync(metaPath, JSON.stringify({
      fingerprint256: made.fingerprint256, subject: made.subject, sans: made.sans, ipSans: ips,
      notAfter: made.notAfter, createdAt: new Date().toISOString(),
    }, null, 2), 'utf8');
    this.cert = made;
    this.audit.add({ type: 'cert.create', fingerprint: made.fingerprint256, sans: made.sans });
    return made;
  }

  status() {
    const ips = lanIPv4List();
    const enabled = !!this.cfg.enabled && !!this.server;
    return {
      ok: true,
      enabled,
      port: Number(this.cfg.port) || MOBILE_GATE_DEFAULTS.port,
      tls: true,
      pairing: 'code',
      scopes: ['chat', 'readonly'],
      fingerprint: this.cert ? this.cert.fingerprint256 : '',
      certSubject: this.cert ? this.cert.subject : '',
      certNotAfter: this.cert ? this.cert.notAfter : '',
      addresses: ips.map((x) => ({
        iface: x.iface,
        ip: x.address,
        kind: x.kind,
        url: 'https://' + x.address + ':' + (Number(this.cfg.port) || MOBILE_GATE_DEFAULTS.port),
        note: x.kind === 'vpn' ? '虚拟局域网（不在同一个 Wi-Fi 也能连）' : '局域网（同一 Wi-Fi）',
      })),
      // 手机网页版就在这个地址上（浏览器打开即可，不用装 App）
      web: { path: '/', title: '屏幕彼端 · 手机' },
      // 手机端最小能力集（面板上写清楚手机能干什么）；不依赖任何 DSH 专属字段
      allow: MOBILE_ALLOW.map(([m, re]) => m + ' ' + re.source.replace(/\\\//g, '/').replace(/^\^|\$$/g, '')),
      devices: this.devices.list(),
      activeDevices: this.devices.list().filter((d) => !d.revokedAt).length,
      requests: this.requests,
      denied: this.denied,
      startedAt: this.startedAt,
      lastError: this.lastError,
      version: this.version,
    };
  }

  /** 生成一次性配对短码（只能从回环面板调用） */
  issuePairCode() {
    const now = Date.now();
    // 清掉旧的
    for (const [code, v] of this.pairCodes) { if (v.used || now > v.expiresAt) this.pairCodes.delete(code) }
    if (this.pairCodes.size >= 5) {
      const err = new Error('同时最多 5 个未使用配对码，先等一下（5 分钟过期）');
      err.code = 'SBC_PAIR_BUSY';
      throw err;
    }
    let code = '';
    for (let i = 0; i < 20; i++) {
      const c = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      if (!this.pairCodes.has(c)) { code = c; break; }
    }
    if (!code) code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const expiresAt = now + (Number(this.cfg.pairCodeTtlMs) || MOBILE_GATE_DEFAULTS.pairCodeTtlMs);
    this.pairCodes.set(code, { createdAt: now, expiresAt, used: false });
    this.audit.add({ type: 'paircode.issue', expiresAt });
    return { ok: true, code, expiresAt, ttlMs: expiresAt - now };
  }

  /** 手机用短码换设备令牌（局域网网关上的公开接口） */
  pair(code, deviceName, ip, scope) {
    const now = Date.now();
    const raw = String(code || '').trim();
    const rec = this.pairCodes.get(raw);
    const fail = (error) => {
      this.denied++;
      this.audit.add({ type: 'pair.fail', ip: ip || '', reason: error });
      const err = new Error(error);
      err.code = 'SBC_PAIR_FAIL';
      return { ok: false, error };
    };
    if (!rec) return fail('配对码不对，或者已经过期了（在电脑面板上重新生成一个）');
    if (rec.used) return fail('这个配对码已经用过了，请在电脑面板上重新生成');
    if (now > rec.expiresAt) { this.pairCodes.delete(raw); return fail('配对码已过期，请在电脑面板上重新生成'); }
    rec.used = true;
    this.pairCodes.delete(raw);
    const made = this.devices.add(deviceName, scope);
    this.audit.add({ type: 'pair.ok', deviceId: made.device.id, name: made.device.name, scope: made.device.scope, ip: ip || '' });
    return {
      ok: true,
      deviceId: made.device.id,
      name: made.device.name,
      scope: made.device.scope,
      token: made.token,
      fingerprint: this.cert ? this.cert.fingerprint256 : '',
      stopAfterRevoke: true,
      allow: MOBILE_ALLOW.map(([m, re]) => m + ' ' + re.source.replace(/\\\//g, '/').replace(/^\^|\$$/g, '')),
      apiVersion: 2,
    };
  }

  revoke(deviceId) {
    const dev = this.devices.revoke(deviceId);
    if (!dev) return { ok: false, error: '没有这台设备' };
    this.audit.add({ type: 'device.revoke', deviceId: dev.id, name: dev.name });
    return { ok: true, devices: this.devices.list() };
  }

  revokeAll() {
    const n = this.devices.revokeAll();
    this.audit.add({ type: 'device.revoke-all', count: n });
    return { ok: true, revoked: n, devices: this.devices.list() };
  }

  /** 判定一次请求是否放行：{ok:true, device?} 或 {ok:false, status, error} */
  authorize(req, urlObj) {
    const method = String(req.method || 'GET').toUpperCase();
    const p = String(urlObj.pathname || '');
    const ip = String((req.socket && (req.socket.remoteAddress || '')) || '');

    // 公开：版本协商 + 配对（都限流）
    if (method === 'GET' && p === '/api/version') {
      const rl = this.limiter.hit('pub:' + ip, 60, 60 * 1000);
      if (!rl.ok) return { ok: false, status: 429, error: '请求太频繁，稍后再试', retryAfterMs: rl.retryAfterMs };
      return { ok: true, device: null };
    }
    if (method === 'POST' && p === '/api/mobile-gate/pair') {
      const rl = this.limiter.hit('pair:' + ip, 5, 5 * 60 * 1000);
      if (!rl.ok) { this.denied++; this.audit.add({ type: 'pair.ratelimited', ip }); return { ok: false, status: 429, error: '配对尝试太频繁，等几分钟再试', retryAfterMs: rl.retryAfterMs }; }
      return { ok: true, device: null };
    }

    const auth = String((req.headers && req.headers.authorization) || '');
    const bearer = /^Bearer\s+(.+)$/i.exec(auth);
    const dev = bearer ? this.devices.findByToken(bearer[1]) : null;
    if (!dev) {
      this.denied++;
      this.audit.add({ type: 'auth.fail', ip, method, path: p });
      return { ok: false, status: 401, error: '手机没配对，或者这个令牌已失效（在电脑面板撤销后会立刻失效）' };
    }

    // 网关自己的自检接口：已配对设备都能读（只回自己的信息，不暴露其它设备）
    if (method === 'GET' && p === '/api/mobile-gate/self') {
      const rlSelf = this.limiter.hit('dev:' + dev.id, 300, 60 * 1000);
      if (!rlSelf.ok) return { ok: false, status: 429, error: '请求太频繁，稍后再试' };
      this.devices.touch(dev, ip);
      return { ok: true, device: dev };
    }

    // 静态资源：直接放行（图片/语音）
    if (method === 'GET' && MOBILE_ALLOW_STATIC.some((re) => re.test(p))) {
      const rl = this.limiter.hit('dev:' + dev.id, 600, 60 * 1000);
      if (!rl.ok) return { ok: false, status: 429, error: '请求太频繁，稍后再试' };
      this.devices.touch(dev, ip);
      return { ok: true, device: dev };
    }

    const allowed = MOBILE_ALLOW.some(([m, re]) => m === method && re.test(p));
    if (!allowed) {
      this.denied++;
      this.audit.add({ type: 'perm.deny', deviceId: dev.id, method, path: p, ip });
      return { ok: false, status: 403, error: '手机端没有这个权限：' + method + ' ' + p + '（设置/环境/虚拟机/备份这些只在电脑面板里做）' };
    }
    if (dev.scope === 'readonly' && method === 'POST') {
      this.denied++;
      this.audit.add({ type: 'perm.deny.readonly', deviceId: dev.id, method, path: p, ip });
      return { ok: false, status: 403, error: '这台设备是「只读」权限，不能发消息' };
    }
    const isChat = method === 'POST' && p === '/api/chat';
    const rl = isChat ? this.limiter.hit('send:' + dev.id, 20, 60 * 1000) : this.limiter.hit('dev:' + dev.id, 300, 60 * 1000);
    if (!rl.ok) {
      this.denied++;
      this.audit.add({ type: 'rate.limited', deviceId: dev.id, path: p, ip });
      return { ok: false, status: 429, error: isChat ? '发得太快了，等她回完再发' : '请求太频繁，稍后再试', retryAfterMs: rl.retryAfterMs };
    }
    this.devices.touch(dev, ip);
    return { ok: true, device: dev };
  }

  /** 把请求原样转发给本机主服务（含 SSE） */
  proxy(req, res, device) {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers || {})) {
      const key = k.toLowerCase();
      // 转发时去掉来源相关头，避免主服务的回环 Host/Origin 校验误拦
      if (key === 'host' || key === 'origin' || key === 'referer' || key.startsWith('sec-fetch-') || key === 'x-forwarded-for' || key === 'authorization' || key === 'x-companion-token') continue;
      headers[k] = v;
    }
    headers.host = '127.0.0.1:' + this.loopbackPort;
    // 网关已经认证过；主服务若开了 API token，这里补上（回环内部信任）
    if (this.apiToken) headers['x-companion-token'] = this.apiToken;
    if (device) headers['x-sbc-mobile-device'] = device.id;

    let settled = false;
    const up = http.request({
      host: '127.0.0.1',
      port: this.loopbackPort,
      method: req.method,
      path: req.url,
      headers,
    }, (upRes) => {
      settled = true;
      this.requests++;
      const outHeaders = {};
      for (const [k, v] of Object.entries(upRes.headers || {})) {
        const key = k.toLowerCase();
        if (key === 'set-cookie' || key === 'connection' || key === 'transfer-encoding' || key === 'keep-alive') continue;
        outHeaders[k] = v;
      }
      try { res.writeHead(upRes.statusCode || 502, outHeaders) } catch { try { res.destroy() } catch {} return }
      upRes.pipe(res);
      upRes.on('error', () => { try { res.destroy() } catch {} });
    });
    up.on('error', (e) => {
      if (settled) return;
      settled = true;
      this.lastError = 'proxy: ' + String((e && e.message) || e);
      this.audit.add({ type: 'proxy.fail', msg: this.lastError });
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: '运行时没响应（本机主服务没在跑？）' }));
      } else { try { res.end() } catch {} }
    });
    req.pipe(up);
  }

  start() {
    if (this.server) return { ok: true, already: true, port: this.cfg.port };
    const cert = this.ensureCert(false);
    const port = Number(this.cfg.port) || MOBILE_GATE_DEFAULTS.port;
    const host = String(this.cfg.bindHost || MOBILE_GATE_DEFAULTS.bindHost);
    return new Promise((resolve) => {
      let srv;
      try {
        srv = https.createServer({ key: cert.keyPem, cert: cert.certPem, minVersion: 'TLSv1.2' }, (req, res) => this.handle(req, res));
      } catch (e) {
        this.lastError = String((e && e.message) || e);
        this.audit.add({ type: 'gate.start.fail', msg: this.lastError });
        resolve({ ok: false, error: '证书加载失败：' + this.lastError });
        return;
      }
      srv.on('tlsClientError', (e) => { this.log('[mobile-gate] TLS 握手失败：' + ((e && e.message) || e)) });
      srv.once('error', (e) => {
        this.lastError = (e && e.code === 'EADDRINUSE') ? ('端口 ' + port + ' 被占用了，换一个') : String((e && e.message) || e);
        this.audit.add({ type: 'gate.start.fail', msg: this.lastError });
        try { srv.close() } catch {}
        this.server = null;
        this.cfg.enabled = false;
        this.onConfigChange();
        resolve({ ok: false, error: this.lastError });
      });
      srv.listen(port, host, () => {
        this.server = srv;
        this.cfg.enabled = true;
        this.cfg.port = port;
        this.startedAt = Date.now();
        this.lastError = '';
        this.audit.add({ type: 'gate.start', port, host, fingerprint: cert.fingerprint256 });
        this.log('[mobile-gate] 已监听 https://' + host + ':' + port + '（手机配对后才能用）');
        resolve({ ok: true, port, host, fingerprint: cert.fingerprint256, addresses: this.status().addresses });
      });
    });
  }

  async stop() {
    this.cfg.enabled = false;
    const srv = this.server;
    this.server = null;
    if (!srv) return { ok: true, already: true };
    await new Promise((resolve) => { try { srv.close(() => resolve()) } catch { resolve() } });
    this.audit.add({ type: 'gate.stop' });
    return { ok: true };
  }

  async setEnabled(enabled) {
    if (enabled) return this.start();
    const r = await this.stop();
    return Object.assign({ ok: true }, r);
  }

  /** 手机网页版：纯静态，公开（但限流）；不需要令牌，配对在页面里做 */
  serveWeb(req, res, pathname) {
    const page = WEB_FILES[pathname];
    if (!page) return false;
    const rl = this.limiter.hit('web:' + (String((req.socket && req.socket.remoteAddress) || '')), 120, 60 * 1000);
    if (!rl.ok) { this.sendJson(res, 429, { ok: false, error: '请求太频繁，稍后再试' }); return true }
    let buf = null;
    try { buf = fs.readFileSync(path.join(WEB_DIR, page.file)) } catch (e) { buf = null }
    if (!buf) {
      this.sendJson(res, 500, { ok: false, error: '手机页文件缺失（安装包不完整）' });
      return true;
    }
    const headers = {
      'content-type': page.type,
      'content-length': buf.length,
      'cache-control': 'no-cache',
      'content-security-policy': WEB_CSP,
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
      'x-content-type-options': 'nosniff',
    };
    try { res.writeHead(200, headers); res.end(buf) } catch (e) {}
    return true;
  }

  /** 网关请求入口：公开接口本地处理，其余认证 + 转发 */
  handle(req, res) {
    const ip = String((req.socket && req.socket.remoteAddress) || '');
    let urlObj;
    try { urlObj = new URL(req.url, 'https://127.0.0.1') } catch { try { res.writeHead(400); res.end() } catch {} return }
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('cache-control', 'no-store');

    // 手机网页版（GET / /app.css /app.js）：公开静态，配对在页面里做
    if (req.method === 'GET' && this.serveWeb(req, res, urlObj.pathname)) return;

    // CORS：手机应用一般没有 Origin；如果浏览器调试带了，就回显（网关已强制 TLS + 令牌）
    const origin = String((req.headers && req.headers.origin) || '');
    if (origin) { res.setHeader('access-control-allow-origin', origin); res.setHeader('vary', 'Origin'); }
    if (req.method === 'OPTIONS') {
      res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
      res.setHeader('access-control-allow-headers', 'authorization,content-type');
      res.setHeader('access-control-max-age', '600');
      try { res.writeHead(204); res.end() } catch {}
      return;
    }

    const pathname = urlObj.pathname;

    // 配对：本地处理（不转发，避免主服务的回环校验/令牌干扰）
    if (req.method === 'POST' && pathname === '/api/mobile-gate/pair') {
      this.readJson(req, 8 * 1024).then((body) => {
        if (!body) { this.sendJson(res, 400, { ok: false, error: '请求格式不正确' }); return }
        const verdict = this.authorize(req, urlObj);
        if (!verdict.ok) { this.sendJson(res, verdict.status, { ok: false, error: verdict.error, retryAfterMs: verdict.retryAfterMs }); return }
        const r = this.pair(body.code, body.deviceName, ip, body.scope);
        this.sendJson(res, r.ok ? 200 : 401, r);
      }).catch(() => { this.sendJson(res, 400, { ok: false, error: '请求格式不正确' }) });
      return;
    }

    // 网关自己的状态：只给已配对设备看（不暴露设备列表）
    if (req.method === 'GET' && pathname === '/api/mobile-gate/self') {
      const verdict = this.authorize(req, urlObj);
      if (!verdict.ok) { this.sendJson(res, verdict.status, { ok: false, error: verdict.error }); return }
      this.sendJson(res, 200, {
        ok: true,
        device: verdict.device ? { id: verdict.device.id, name: verdict.device.name, scope: verdict.device.scope } : null,
        version: this.version,
        fingerprint: this.cert ? this.cert.fingerprint256 : '',
      });
      return;
    }

    const verdict = this.authorize(req, urlObj);
    if (!verdict.ok) {
      this.sendJson(res, verdict.status, { ok: false, error: verdict.error, retryAfterMs: verdict.retryAfterMs });
      return;
    }
    this.proxy(req, res, verdict.device);
  }

  readJson(req, maxBytes) {
    return new Promise((resolve) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > (maxBytes || 64 * 1024)) { req.destroy(); resolve(null); return }
        chunks.push(c);
      });
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '').trim();
        if (!raw) { resolve({}); return }
        try { resolve(JSON.parse(raw)) } catch { resolve(null) }
      });
      req.on('error', () => resolve(null));
    });
  }

  sendJson(res, code, obj) {
    try {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(obj));
    } catch {}
  }
}

export function createMobileGate(opts) { return new MobileGate(opts); }
