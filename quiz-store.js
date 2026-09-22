/**
 * 进度存档（业务文件 1/3）
 * 只负责：抽问进度的本地持久化、规则稳定身份同步、单局成绩锁定与开新局。
 * 不碰 DOM，也不知道抽题顺序。
 */
(function (global) {
  "use strict";

  const STORAGE_KEY = "zfl18-boardgame-quiz-progress";
  const RULE_KEYS = ["forgets", "disputes", "setup", "scoring"];

  function load() {
    let raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch {
      raw = null;
    }
    const data = {
      playerCount: 2,
      games: {},
      ...(raw || {})
    };
    if (!data.games || typeof data.games !== "object") data.games = {};
    if (!Number.isInteger(data.playerCount)) data.playerCount = 2;
    return data;
  }

  function save(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* 本地存档失败不影响当次抽问 */
    }
  }

  function blankRecord() {
    return {
      refs: [], // [{ id, key, text }] 规则的稳定身份，不随列表顺序漂移
      streak: {}, // refId -> 累计答对次数（0/1，达到 2 即掌握）
      mastered: {}, // refId -> true
      session: null, // { startedAt, correct, wrong }
      locked: false,
      lockedAt: null,
      lockedSummary: null, // 锁定瞬间的成绩快照
      dirty: false // 锁局后规则又被改动，改动留给下一局
    };
  }

  /**
   * 用收藏库里的最新规则同步存档：
   * - 同分类同文字的规则沿用旧 id（重复文字按出现顺序配对）
   * - 新增规则发新 id；删除规则清掉它的进度
   * - 锁局后的增删只标 dirty，不动已锁定的成绩
   */
  function syncGame(data, game) {
    const rec = data.games[game.id] || (data.games[game.id] = blankRecord());
    const oldIds = new Set(rec.refs.map((r) => r.id));
    const used = new Set();
    const nextRefs = [];
    let added = false;

    RULE_KEYS.forEach((key) => {
      (game[key] || []).forEach((text) => {
        let hit = rec.refs.find((r) => !used.has(r.id) && r.key === key && r.text === text);
        if (!hit) {
          added = true;
          hit = { id: crypto.randomUUID(), key, text };
        }
        used.add(hit.id);
        nextRefs.push(hit);
      });
    });

    const nextIds = new Set(nextRefs.map((r) => r.id));
    let removed = false;
    oldIds.forEach((id) => {
      if (!nextIds.has(id)) {
        removed = true;
        delete rec.streak[id];
        delete rec.mastered[id];
      }
    });

    rec.refs = nextRefs;
    if (rec.locked && (added || removed)) rec.dirty = true;
    return rec;
  }

  function startNewSession(data, game) {
    const rec = syncGame(data, game);
    rec.streak = {};
    rec.mastered = {};
    rec.locked = false;
    rec.lockedAt = null;
    rec.lockedSummary = null;
    rec.dirty = false;
    rec.session = {
      startedAt: new Date().toISOString(),
      correct: 0,
      wrong: 0
    };
    return rec;
  }

  /** 记录一次作答。累计两次答对 -> 掌握退场；答错只计数，不清零累计。 */
  function recordAnswer(data, gameId, refId, isCorrect) {
    const rec = data.games[gameId];
    if (!rec || rec.locked) return { mastered: false, locked: false };
    if (!rec.session) {
      rec.session = { startedAt: new Date().toISOString(), correct: 0, wrong: 0 };
    }

    if (isCorrect) {
      rec.session.correct += 1;
      const next = (rec.streak[refId] || 0) + 1;
      if (next >= 2) {
        rec.mastered[refId] = true;
        delete rec.streak[refId];
        return { mastered: true, locked: evaluateLock(data, gameId) };
      }
      rec.streak[refId] = next;
    } else {
      rec.session.wrong += 1;
    }
    return { mastered: false, locked: false };
  }

  /** 某游戏的题全部掌握 -> 锁定这局成绩，之后规则改动留给下一局。 */
  function evaluateLock(data, gameId) {
    const rec = data.games[gameId];
    if (!rec || rec.locked || !rec.session || rec.refs.length === 0) return false;
    if (!rec.refs.every((r) => rec.mastered[r.id])) return false;

    rec.locked = true;
    rec.lockedAt = new Date().toISOString();
    rec.lockedSummary = {
      total: rec.refs.length,
      correct: rec.session.correct,
      wrong: rec.session.wrong,
      startedAt: rec.session.startedAt,
      lockedAt: rec.lockedAt
    };
    return true;
  }

  global.QuizStore = {
    STORAGE_KEY,
    RULE_KEYS,
    load,
    save,
    syncGame,
    startNewSession,
    recordAnswer,
    evaluateLock
  };
})(window);
