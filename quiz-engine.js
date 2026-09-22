// 桌游规则抽问台 —— 抽题判断
// 纯逻辑模块，不碰 DOM 与 localStorage：
// - 只抽当晚人数适配游戏的未掌握规则
// - 答错回队尾；累计答对两次才掌握退场
// - 队列中带“趟标记”，保证同一趟每道待掌握题只出现一次，走完再洗一轮
// - 切换人数时当前题不适配则直接换题，不改动任何成绩
// - 当前适配游戏的题全部掌握后锁定本局成绩
(function (global) {
  "use strict";

  const PASS_TOKEN = "__pass__";
  const MASTERY_REQUIRED = 2;

  const CATEGORIES = [
    { key: "forgets", label: "易忘规则", prompt: "这条最容易漏掉的规则要点是什么？" },
    { key: "disputes", label: "常见争议", prompt: "遇到这条争议时按规则该怎么处理？" },
    { key: "setup", label: "开局准备", prompt: "开局准备时这一步该怎么做？" },
    { key: "scoring", label: "计分提醒", prompt: "这一项分数该怎么计算？" }
  ];
  const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((item) => [item.key, item]));

  function randomOf(session) {
    return session.random || Math.random;
  }

  function shuffle(list, random) {
    const result = list.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  // 开局时给收藏库拍快照：之后改动规则只影响下一局
  function buildQuestions(games) {
    const questions = [];
    (games || []).forEach((game) => {
      CATEGORIES.forEach(({ key: category }) => {
        (Array.isArray(game[category]) ? game[category] : []).forEach((text) => {
          questions.push({
            key: `q${questions.length}`,
            gameId: game.id,
            gameName: game.name,
            category,
            text: String(text),
            minPlayers: Number(game.minPlayers),
            maxPlayers: Number(game.maxPlayers)
          });
        });
      });
    });
    return questions;
  }

  function isEligible(question, players) {
    return players >= question.minPlayers && players <= question.maxPlayers;
  }

  function eligibleQuestions(session) {
    return session.questions.filter((question) => isEligible(question, session.players));
  }

  function pendingQuestions(session) {
    return eligibleQuestions(session).filter((question) => !session.progress[question.key].mastered);
  }

  function startRound(session) {
    const keys = pendingQuestions(session).map((question) => question.key);
    session.queue = shuffle(keys, randomOf(session)).concat(PASS_TOKEN);
    session.rounds += 1;
  }

  // 从队首取下一道题；遇到趟标记说明本趟走完，重新洗牌进入下一趟
  function drawNext(session) {
    if (session.queue[0] === PASS_TOKEN) {
      if (pendingQuestions(session).length === 0) {
        session.current = null;
        return;
      }
      startRound(session);
    }
    session.current = session.queue[0] || null;
  }

  function summarize(session) {
    return {
      startedAt: session.startedAt,
      lockedAt: session.lockedAt,
      players: session.players,
      rounds: session.rounds,
      eligibleTotal: eligibleQuestions(session).length,
      masteredTotal: session.masteredCount,
      answered: session.stats.answered,
      correct: session.stats.correct,
      wrong: session.stats.wrong,
      durationMs: new Date(session.lockedAt).getTime() - new Date(session.startedAt).getTime(),
      games: adaptedGames(session).map((group) => ({ name: group.name, total: group.total, mastered: group.mastered }))
    };
  }

  function lock(session) {
    session.locked = true;
    session.lockedAt = new Date().toISOString();
    session.current = null;
    session.queue = [PASS_TOKEN];
    session.result = summarize(session);
  }

  // 锁定条件：当前人数下有适配题目，且这些题已全部掌握
  function tryLock(session) {
    const eligible = eligibleQuestions(session);
    if (eligible.length === 0) return false;
    if (!eligible.every((question) => session.progress[question.key].mastered)) return false;
    lock(session);
    return true;
  }

  function createSession(games, players, options) {
    const settings = options || {};
    const questions = buildQuestions(games);
    const progress = {};
    questions.forEach((question) => {
      progress[question.key] = { correct: 0, wrong: 0, mastered: false };
    });

    const session = {
      version: 1,
      startedAt: new Date().toISOString(),
      players: Number(players),
      questions,
      progress,
      queue: [PASS_TOKEN],
      current: null,
      rounds: 0,
      masteredCount: 0,
      stats: { answered: 0, correct: 0, wrong: 0 },
      locked: false,
      lockedAt: null,
      result: null
    };
    Object.defineProperty(session, "random", { value: settings.random || Math.random, enumerable: false });

    const keys = pendingQuestions(session).map((question) => question.key);
    const shuffled = shuffle(keys, randomOf(session));
    session.queue = shuffled.concat(PASS_TOKEN);
    if (shuffled.length > 0) session.rounds = 1;
    session.current = shuffled[0] || null;
    return session;
  }

  // 作答：答对累计一次（两次掌握退场），答错连同只答对一次的都回到趟标记之后
  function answer(session, isCorrect) {
    if (session.locked || !session.current) return { type: "idle", locked: false };
    const key = session.queue.shift();
    const record = session.progress[key];
    let mastered = false;

    session.stats.answered += 1;
    if (isCorrect) {
      session.stats.correct += 1;
      record.correct += 1;
      if (record.correct >= MASTERY_REQUIRED) {
        record.mastered = true;
        session.masteredCount += 1;
        mastered = true;
      } else {
        session.queue.push(key);
      }
    } else {
      session.stats.wrong += 1;
      record.wrong += 1;
      session.queue.push(key);
    }

    if (tryLock(session)) {
      return { type: "locked", key, correct: isCorrect, mastered, locked: true };
    }
    drawNext(session);
    return { type: "answered", key, correct: isCorrect, mastered, locked: false, rounds: session.rounds };
  }

  // 切换当晚人数：不适配的题静默出队，当前题不适配则直接换题且不计成绩
  function changePlayers(session, players) {
    const next = Number(players);
    if (session.locked || session.players === next) return { replaced: false, locked: false };

    session.players = next;
    const eligiblePending = new Set(pendingQuestions(session).map((question) => question.key));

    // 保留趟标记与仍然适配、未掌握的题，顺序不变
    session.queue = session.queue.filter((item) => item === PASS_TOKEN || eligiblePending.has(item));

    // 因换人数新进入适配集合的题，插到趟标记之前，本趟还会轮到一次
    const queued = new Set(session.queue);
    const missing = shuffle(
      [...eligiblePending].filter((key) => !queued.has(key)),
      randomOf(session)
    );
    session.queue.splice(session.queue.indexOf(PASS_TOKEN), 0, ...missing);

    const currentKept = session.current && session.queue[0] === session.current;
    if (currentKept) return { replaced: false, locked: false };

    // 当前题已不适配：不写任何成绩，直接取下一道
    session.current = null;
    if (tryLock(session)) return { replaced: true, locked: true };
    drawNext(session);
    return { replaced: true, locked: false };
  }

  function getQuestion(session, key) {
    return session.questions.find((question) => question.key === key) || null;
  }

  function getProgress(session, key) {
    return session.progress[key] || null;
  }

  // 本趟还没露面的题数（含当前题）
  function remainingInRound(session) {
    return Math.max(0, session.queue.indexOf(PASS_TOKEN));
  }

  function adaptedGames(session) {
    const groups = new Map();
    eligibleQuestions(session).forEach((question) => {
      let group = groups.get(question.gameId);
      if (!group) {
        group = {
          gameId: question.gameId,
          name: question.gameName,
          minPlayers: question.minPlayers,
          maxPlayers: question.maxPlayers,
          total: 0,
          mastered: 0
        };
        groups.set(question.gameId, group);
      }
      group.total += 1;
      if (session.progress[question.key].mastered) group.mastered += 1;
    });
    return [...groups.values()];
  }

  global.QuizEngine = {
    PASS_TOKEN,
    MASTERY_REQUIRED,
    CATEGORIES,
    CATEGORY_MAP,
    createSession,
    answer,
    changePlayers,
    eligibleQuestions,
    pendingQuestions,
    adaptedGames,
    getQuestion,
    getProgress,
    remainingInRound
  };
})(typeof window !== "undefined" ? window : globalThis);
