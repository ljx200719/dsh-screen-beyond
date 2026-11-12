/**
 * 手机端地基：设备身份 + 追加式事件日志 + 本机令牌。
 *
 * 这一版**不做**多端合并，只把“以后能同步”所需的最小结构落下来：
 * - 每台设备有稳定 deviceId + 本机访问令牌
 * - 所有关键写操作追加到 events.jsonl，事件有单调递增 seq 和稳定 id
 * - 手机端可以通过受令牌保护的 API 拉取 / 推送事件
 *
 * 事件只是“发生了什么”，不是最终状态。真正的合并策略、快照、
 * 冲突提示和加密传输留到后续版本。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, randomBytes } from 'node:crypto';

export const SYNC_API_VERSION = 1;

export class SyncStore {
  constructor(dir, options = {}) {
    this.dir = path.resolve(String(dir));
    fs.mkdirSync(this.dir, { recursive: true });
    this.devicePath = path.join(this.dir, 'device.json');
    this.eventsPath = path.join(this.dir, 'events.jsonl');
    this.device = this.#loadDevice(options.deviceName);
    this.appendQueue = [];
    this.appending = false;
  }

  #loadDevice(name) {
    try {
      const d = JSON.parse(fs.readFileSync(this.devicePath, 'utf8'));
      if (d && d.deviceId && d.token) return d;
    } catch {}
    const d = {
      version: SYNC_API_VERSION,
      deviceId: randomUUID(),
      deviceName: String(name || os.hostname() || 'dsh-screen-beyond'),
      token: randomBytes(24).toString('hex'),
      createdAt: new Date().toISOString(),
    };
    try { fs.writeFileSync(this.devicePath, JSON.stringify(d, null, 2), 'utf8'); } catch {}
    return d;
  }

  get deviceId() { return this.device.deviceId; }
  get deviceName() { return this.device.deviceName; }
  get token() { return this.device.token; }

  verifyToken(token) {
    return Boolean(token) && String(token) === this.device.token;
  }

  getInfo() {
    const events = this.#readEvents();
    const last = events.length ? events[events.length - 1] : null;
    return {
      ok: true,
      apiVersion: SYNC_API_VERSION,
      device: { id: this.device.deviceId, name: this.device.deviceName },
      cursor: last ? Number(last.seq) || 0 : 0,
      eventCount: events.length,
      eventTypes: ['message.append', 'character.switch', 'character.meta.upsert', 'maps.replace', 'location.set', 'economy.set', 'life.set'],
      authRequired: true,
      merge: 'not-implemented-yet',
    };
  }

  #readEvents() {
    try {
      const text = fs.readFileSync(this.eventsPath, 'utf8');
      const out = [];
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          if (ev && Number.isFinite(Number(ev.seq))) out.push(ev);
        } catch {}
      }
      return out;
    } catch { return []; }
  }

  eventsSince(since = 0, limit = 500) {
    const cursor = Math.max(0, Number(since) || 0);
    const max = Math.max(1, Math.min(1000, Number(limit) || 500));
    return this.#readEvents().filter((ev) => Number(ev.seq) > cursor).slice(0, max);
  }

  record(type, entity, entityId, payload) {
    const events = this.#readEvents();
    const seq = events.length ? (Number(events[events.length - 1].seq) || 0) + 1 : 1;
    const ev = {
      id: randomUUID(),
      seq,
      at: new Date().toISOString(),
      deviceId: this.device.deviceId,
      type: String(type || 'unknown'),
      entity: String(entity || ''),
      entityId: entityId === undefined || entityId === null ? '' : String(entityId),
      payload: payload === undefined ? null : payload,
    };
    fs.appendFileSync(this.eventsPath, JSON.stringify(ev) + '\n', 'utf8');
    return ev;
  }

  /** 接受另一台设备推来的事件；按事件 id 去重，不做业务合并。 */
  acceptRemote(rawEvents) {
    const list = Array.isArray(rawEvents) ? rawEvents.slice(0, 200) : [];
    const existing = new Map(this.#readEvents().map((ev) => [ev.id, ev]));
    let accepted = 0;
    for (const raw of list) {
      if (!raw || typeof raw !== 'object' || !raw.id || existing.has(raw.id)) continue;
      if (!raw.type || raw.payload === undefined) continue;
      const events = this.#readEvents();
      const seq = events.length ? (Number(events[events.length - 1].seq) || 0) + 1 : 1;
      const ev = {
        ...raw,
        seq,
        receivedAt: new Date().toISOString(),
        deviceId: raw.deviceId || 'remote',
        type: String(raw.type),
        entity: String(raw.entity || ''),
        entityId: raw.entityId === undefined || raw.entityId === null ? '' : String(raw.entityId),
      };
      fs.appendFileSync(this.eventsPath, JSON.stringify(ev) + '\n', 'utf8');
      existing.set(ev.id, ev);
      accepted++;
    }
    const events = this.#readEvents();
    return {
      accepted,
      cursor: events.length ? Number(events[events.length - 1].seq) || 0 : 0,
      eventCount: events.length,
      duplicates: list.length - accepted,
    };
  }
}
