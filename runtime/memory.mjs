import fs from 'node:fs';
import path from 'node:path';

// 记忆系统：事实卡 + 遗忘/强化 + 每日日记
// 设计要点：
//  - 核心记忆(pinned / strength>=core) 不衰减，永远在提示词里
//  - 其它事实按半衰期逐渐减弱；提到一次就强化一次（越常提越难忘）
//  - 弱到阈值以下进入"模糊"（不再注入，但保留在档案里，可被用户查阅/恢复）
//  - 每天一篇纯文本日记，用户可读；只有用户主动给她看时她才读得到
export class MemoryStore {
  constructor(cfg) {
    this.dir = cfg.path;
    this.diaryDir = cfg.diaryPath;
    this.cfg = {
      halfLifeDays: cfg.halfLifeDays ?? 5,
      forgetThreshold: cfg.forgetThreshold ?? 0.12,
      reinforceBoost: cfg.reinforceBoost ?? 0.22,
      maxInjected: cfg.maxInjected ?? 8,
      coreStrength: cfg.coreStrength ?? 0.85,
      maxFactChars: cfg.maxFactChars ?? 90,
      maxPromptChars: cfg.maxPromptChars ?? 900,
    };
    fs.mkdirSync(this.dir, { recursive: true });
    fs.mkdirSync(this.diaryDir, { recursive: true });
    this.file = path.join(this.dir, 'facts.json');
    this.facts = this.load();
  }

  load() {
    try { const a = JSON.parse(fs.readFileSync(this.file, 'utf8')); return Array.isArray(a) ? a : []; } catch { return []; }
  }
  save() { fs.writeFileSync(this.file, JSON.stringify(this.facts, null, 1), 'utf8'); }

  setParams(params = {}) {
    for (const k of ['halfLifeDays', 'forgetThreshold', 'reinforceBoost', 'maxInjected', 'coreStrength', 'maxPromptChars']) {
      if (params[k] !== undefined && Number.isFinite(Number(params[k]))) this.cfg[k] = Number(params[k]);
    }
    return this.cfg;
  }

  nextId() { return this.facts.reduce((m, f) => Math.max(m, f.id || 0), 0) + 1; }

  // 时间衰减：strength 按半衰期指数衰减；pinned 不衰减
  decay(now = Date.now()) {
    let changed = false;
    for (const f of this.facts) {
      if (f.pinned) { f.strength = 1; continue; }
      const last = f.lastSeenAt || f.createdAt || now;
      const days = (now - last) / 86400000;
      if (days <= 0) continue;
      const factor = Math.pow(0.5, days / this.cfg.halfLifeDays);
      const next = Math.max(0, (f.strength ?? 0.5) * factor);
      if (Math.abs(next - (f.strength ?? 0)) > 0.001) { f.strength = Number(next.toFixed(4)); changed = true; }
      if (f.strength < this.cfg.forgetThreshold && !f.archived) { f.archived = true; changed = true; }
    }
    if (changed) this.save();
  }

  // 写入/强化：相似事实合并强化，新事实新建
  addFacts(items, now = Date.now()) {
    if (!Array.isArray(items)) return [];
    const added = [];
    for (const it of items) {
      const text = String(it?.text ?? '').trim().slice(0, this.cfg.maxFactChars);
      if (!text) continue;
      const tags = Array.isArray(it?.tags) ? it.tags.map((t) => String(t).slice(0, 12)).slice(0, 6) : [];
      const importance = Math.max(0, Math.min(1, Number(it?.importance) || 0.5));
      const existing = this.findSimilar(text);
      if (existing) {
        existing.hitCount = (existing.hitCount || 1) + 1;
        existing.lastSeenAt = now;
        existing.strength = Math.min(1, (existing.strength ?? 0.3) + this.cfg.reinforceBoost * (0.6 + importance * 0.8));
        existing.importance = Math.max(existing.importance ?? 0, importance);
        existing.archived = existing.strength >= this.cfg.forgetThreshold ? false : existing.archived;
        for (const t of tags) if (!existing.tags.includes(t)) existing.tags.push(t);
        added.push({ merged: true, id: existing.id, text: existing.text, strength: existing.strength });
      } else {
        const f = {
          id: this.nextId(), text, tags,
          importance,
          strength: Math.min(1, 0.35 + importance * 0.5),
          createdAt: now, lastSeenAt: now, hitCount: 1,
          pinned: importance >= 0.95,
          archived: false,
        };
        this.facts.push(f);
        added.push({ merged: false, id: f.id, text: f.text, strength: f.strength });
      }
    }
    this.save();
    return added;
  }

  // 强化已有事实（检索命中/被使用时调用）
  reinforce(id, now = Date.now()) {
    const f = this.facts.find((x) => x.id === id);
    if (!f) return;
    f.hitCount = (f.hitCount || 1) + 1;
    f.lastSeenAt = now;
    f.strength = Math.min(1, (f.strength ?? 0.3) + this.cfg.reinforceBoost * 0.5);
    if (f.archived && f.strength >= this.cfg.forgetThreshold) f.archived = false;
    this.save();
  }

  bigrams(s) {
    const clean = String(s).toLowerCase().replace(/[\s，。！？、,.!?；;：:""''（）()【】\[\]]+/g, ' ');
    const set = new Set();
    for (const seg of clean.split(/\s+/)) {
      if (!seg) continue;
      if (seg.length === 1) { set.add(seg); continue; }
      for (let i = 0; i < seg.length - 1; i++) set.add(seg.slice(i, i + 2));
    }
    return set;
  }
  similarity(a, b) {
    const A = this.bigrams(a), B = this.bigrams(b);
    if (!A.size || !B.size) return 0;
    let inter = 0;
    for (const x of A) if (B.has(x)) inter++;
    return inter / Math.min(A.size, B.size);
  }
  findSimilar(text) {
    let best = null, bestScore = 0;
    for (const f of this.facts) {
      if (f.archived) continue;
      const s = this.similarity(text, f.text + ' ' + (f.tags || []).join(' '));
      if (s > bestScore) { bestScore = s; best = f; }
    }
    return bestScore >= 0.55 ? best : null;
  }

  // 检索：相关度 + 强度 + 新近度；核心记忆永远带上
  retrieve(query, now = Date.now()) {
    this.decay(now);
    const core = this.facts.filter((f) => f.pinned || (f.strength ?? 0) >= this.cfg.coreStrength);
    const rest = this.facts.filter((f) => !core.includes(f) && !f.archived);
    const scored = [];
    for (const f of rest) {
      const rel = this.similarity(query, f.text + ' ' + (f.tags || []).join(' '));
      const strength = f.strength ?? 0.3;
      const ageDays = (now - (f.lastSeenAt || now)) / 86400000;
      const recency = Math.max(0, 1 - ageDays / 30);
      const score = rel * 0.55 + strength * 0.3 + recency * 0.15 + (f.importance || 0.5) * 0.05;
      scored.push({ f, score, rel });
    }
    scored.sort((a, b) => b.score - a.score);
    const picked = [];
    const used = new Set();
    for (const c of core) { used.add(c.id); picked.push(c); }
    for (const s of scored) {
      if (picked.length >= this.cfg.maxInjected) break;
      if (used.has(s.f.id)) continue;
      if (s.score < 0.28) break;
      used.add(s.f.id);
      picked.push(s.f);
    }
    for (const f of picked) this.reinforce(f.id, now);
    return picked;
  }

  promptBlock(query) {
    const picked = this.retrieve(query);
    if (!picked.length) return '';
    const lines = [];
    let chars = 0;
    for (const f of picked) {
      const s = (f.strength ?? 0.3);
      const m = s >= 0.85 ? '很清楚' : s >= 0.6 ? '记得' : s >= 0.3 ? '有点印象' : '模糊记得';
      const line = `- （${m}）${f.text}`;
      if (chars + line.length > this.cfg.maxPromptChars) break;
      lines.push(line);
      chars += line.length;
    }
    return lines.length ? '## 你记得的事（越清楚越重要，模糊的可能是快忘了）\n' + lines.join('\n') : '';
  }

  stats() {
    const now = Date.now();
    this.decay(now);
    const live = this.facts.filter((f) => !f.archived);
    const archived = this.facts.filter((f) => f.archived);
    return {
      total: this.facts.length,
      live: live.length,
      archived: archived.length,
      core: this.facts.filter((f) => f.pinned || (f.strength ?? 0) >= this.cfg.coreStrength).length,
      strongest: [...live].sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0)).slice(0, 5).map((f) => ({ text: f.text, strength: f.strength })),
    };
  }

  // ---------- 日记 ----------
  diaryPath(date) { return path.join(this.diaryDir, `${date}.md`); }
  hasDiary(date) { return fs.existsSync(this.diaryPath(date)); }
  readDiary(date) { try { return fs.readFileSync(this.diaryPath(date), 'utf8'); } catch { return ''; } }
  writeDiary(date, text) {
    fs.writeFileSync(this.diaryPath(date), String(text).trim() + '\n', 'utf8');
    return this.diaryPath(date);
  }
  listDiaries(limit = 60) {
    try {
      return fs.readdirSync(this.diaryDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
        .sort().reverse().slice(0, limit).map((f) => f.replace('.md', ''));
    } catch { return []; }
  }
}
