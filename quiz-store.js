// 桌游规则抽问台 —— 进度存档
// 只负责本局会话的持久化和锁定成绩历史，不参与抽题判断
(function (global) {
  "use strict";

  const storageKey = "zfl18-boardgame-quiz-session";
  const historyKey = "zfl18-boardgame-quiz-history";
  const historyLimit = 20;

  function canUseStorage() {
    try {
      const probe = "__quiz_probe__";
      localStorage.setItem(probe, probe);
      localStorage.removeItem(probe);
      return true;
    } catch {
      return false;
    }
  }

  function readJson(key, fallback) {
    if (!canUseStorage()) return fallback;
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    if (!canUseStorage()) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // 存储空间不足等情况：放弃持久化，不影响当前页面流程
    }
  }

  function isValidSession(data) {
    return Boolean(
      data &&
        typeof data === "object" &&
        data.version === 1 &&
        Array.isArray(data.questions) &&
        data.progress &&
        typeof data.players === "number"
    );
  }

  function loadSession() {
    const session = readJson(storageKey, null);
    return isValidSession(session) ? session : null;
  }

  function saveSession(session) {
    if (!isValidSession(session)) return;
    writeJson(storageKey, session);
  }

  function clearSession() {
    if (!canUseStorage()) return;
    localStorage.removeItem(storageKey);
  }

  // 锁定后把成绩存入历史；同一局只归档一次（按开始时间去重）
  function archiveResult(result) {
    if (!result) return loadHistory();
    const history = loadHistory();
    if (history.some((item) => item.startedAt === result.startedAt)) return history;
    const record = {
      id: `r-${result.startedAt.replace(/[^\d]/g, "")}`,
      startedAt: result.startedAt,
      lockedAt: result.lockedAt,
      players: result.players,
      rounds: result.rounds,
      eligibleTotal: result.eligibleTotal,
      masteredTotal: result.masteredTotal,
      answered: result.answered,
      correct: result.correct,
      wrong: result.wrong,
      durationMs: result.durationMs,
      games: result.games || []
    };
    const next = [record, ...history].slice(0, historyLimit);
    writeJson(historyKey, next);
    return next;
  }

  function loadHistory() {
    const history = readJson(historyKey, []);
    return Array.isArray(history) ? history : [];
  }

  function clearHistory() {
    if (!canUseStorage()) return;
    localStorage.removeItem(historyKey);
  }

  function resetAll() {
    clearSession();
    clearHistory();
  }

  global.QuizStore = {
    loadSession,
    saveSession,
    clearSession,
    archiveResult,
    loadHistory,
    clearHistory,
    resetAll
  };
})(typeof window !== "undefined" ? window : globalThis);
