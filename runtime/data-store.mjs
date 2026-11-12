/**
 * 数据层（最小版）：
 * - 所有 JSON 写入改成“临时文件 + 替换”，避免写一半把文件写坏
 * - 关键实体写入时记录 revision（实体级递增版本）
 * - 为以后手机端同步 / 冲突提示提供版本的统一入口
 *
 * 这一层不改变现有文件布局，也不把 JSON 搬去数据库；
 * 它是现有读写路径的薄包装，后续可以逐步替换存储实现。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

function cleanRel(root, file) {
  try { return path.relative(root, file).replace(/\\/g, '/'); } catch { return String(file); }
}

export class DataStore {
  constructor(root, options = {}) {
    this.root = path.resolve(String(root));
    this.deviceId = String(options.deviceId || '');
    this.revisionsPath = path.join(this.root, 'sync', 'revisions.json');
    fs.mkdirSync(path.dirname(this.revisionsPath), { recursive: true });
  }

  readJson(file, dflt) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return dflt; }
  }

  writeJson(file, obj, meta) {
    this.#atomicWrite(file, JSON.stringify(obj, null, 1));
    if (meta && meta.entity) {
      try { this.track(meta.entity, meta.entityId, file, obj); } catch {}
    }
    return true;
  }

  writeText(file, text) {
    this.#atomicWrite(file, String(text));
    return true;
  }

  #atomicWrite(file, text) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      fs.writeFileSync(tmp, text, 'utf8');
      try { fs.renameSync(tmp, file); }
      catch {
        try { fs.copyFileSync(tmp, file); } finally { try { fs.unlinkSync(tmp); } catch {} }
      }
    } catch (e) {
      try { console.error('[data] write failed:', file, e && e.message); } catch {}
      throw e;
    }
  }

  #loadRevisions() {
    const d = this.readJson(this.revisionsPath, null);
    if (!d || typeof d !== 'object') return { version: 1, deviceId: this.deviceId, entities: {} };
    if (!d.entities || typeof d.entities !== 'object') d.entities = {};
    return d;
  }

  #saveRevisions(d) {
    try {
      fs.mkdirSync(path.dirname(this.revisionsPath), { recursive: true });
      const tmp = this.revisionsPath + '.tmp-' + process.pid + '-' + Date.now();
      fs.writeFileSync(tmp, JSON.stringify(d, null, 1), 'utf8');
      try { fs.renameSync(tmp, this.revisionsPath); }
      catch { try { fs.copyFileSync(tmp, this.revisionsPath); } finally { try { fs.unlinkSync(tmp); } catch {} } }
    } catch {}
  }

  /** 记录实体版本；file 只用于追溯，不参与读。 */
  track(entity, entityId, file, value) {
    return this.trackMany([[entity, entityId, file, value]])[0] || null;
  }

  /** 批量记录版本，只写一次 revision 表（地图地点/道路用）。 */
  trackMany(entries) {
    const list = Array.isArray(entries) ? entries : [];
    if (!list.length) return [];
    const d = this.#loadRevisions();
    const now = new Date().toISOString();
    const out = [];
    for (const it of list) {
      const ent = String((it && it[0]) || '');
      if (!ent) continue;
      const entityId = it[1] === undefined || it[1] === null ? '' : String(it[1]);
      const file = it[2] || null;
      const value = it[3];
      const key = ent + ':' + entityId;
      const prev = d.entities[key] || { rev: 0 };
      const body = JSON.stringify(value === undefined ? null : value);
      const entry = {
        rev: (Number(prev.rev) || 0) + 1,
        updatedAt: now,
        updatedBy: this.deviceId,
        file: file ? cleanRel(this.root, file) : (prev.file || ''),
        hash: createHash('sha1').update(body).digest('hex').slice(0, 16),
      };
      d.entities[key] = entry;
      out.push({ entity: ent, entityId, ...entry });
    }
    if (!out.length) return [];
    d.version = 1;
    d.deviceId = this.deviceId;
    d.updatedAt = now;
    this.#saveRevisions(d);
    return out;
  }

  revisionFor(entity, entityId) {
    const key = String(entity || '') + ':' + (entityId === undefined || entityId === null ? '' : String(entityId));
    return this.#loadRevisions().entities[key] || null;
  }

  getRevisions() {
    const d = this.#loadRevisions();
    return { ok: true, version: 1, deviceId: d.deviceId || this.deviceId, updatedAt: d.updatedAt || '', entities: d.entities || {} };
  }
}
