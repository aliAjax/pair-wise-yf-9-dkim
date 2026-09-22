/**
 * 抽题判断（业务文件 2/3）
 * 只负责：按人数筛适配游戏、未掌握题入队、同一趟每道题先出现一次、
 * 答错回队尾、两次答对掌握退场、切换人数不适配则换题不计成绩。
 * 不碰 localStorage 细节（调用 QuizStore），也不碰 DOM。
 */
(function (global) {
  "use strict";

  const RULE_LABELS = {
    forgets: "容易忘的规则",
    disputes: "常见争议",
    setup: "开局准备",
    scoring: "计分提醒"
  };

  function shuffle(items) {
    const list = [...items];
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  function makeToken(gameId, refId) {
    return `${gameId}::${refId}`;
  }

  function parseToken(token) {
    const [gameId, refId] = token.split("::");
    return { gameId, refId };
  }

  function gameFits(game, playerCount) {
    return !!game && game.minPlayers <= playerCount && playerCount <= game.maxPlayers;
  }

  /**
   * station 运行态：
   * { data, getGames(), playerCount, queue, current, tripNo, tripTotal, tripSeen, swapped }
   */
  function createStation(getGames) {
    const data = global.QuizStore.load();
    const station = {
      data,
      getGames,
      playerCount: data.playerCount || 2,
      queue: [],
      current: null,
      tripNo: 0,
      tripTotal: 0,
      tripSeen: 0,
      swapped: false
    };

    function gamesById() {
      return new Map(getGames().map((g) => [g.id, g]));
    }

    function isValidToken(token, byId, playerCount) {
      const { gameId, refId } = parseToken(token);
      const game = byId.get(gameId);
      if (!game || !gameFits(game, playerCount)) return false;
      const rec = data.games[gameId];
      if (!rec || rec.locked) return false;
      return !!rec.refs.find((r) => r.id === refId && !rec.mastered[refId]);
    }

    /** 待掌握题库：当前人数适配的、未锁定游戏的、未掌握的题。 */
    function pendingTokens() {
      const byId = gamesById();
      const tokens = [];
      getGames().forEach((game) => {
        if (!gameFits(game, station.playerCount)) return;
        const rec = data.games[game.id];
        if (!rec || rec.locked) return;
        rec.refs.forEach((ref) => {
          if (!rec.mastered[ref.id]) tokens.push(makeToken(game.id, ref.id));
        });
      });
      return tokens;
    }

    /** 一趟 = 当时所有待掌握题各出现一次，顺序随机。 */
    function seedTrip(keepCurrent) {
      const tokens = shuffle(pendingTokens());
      if (keepCurrent) {
        station.queue = tokens.filter((t) => t !== station.current);
      } else {
        station.queue = tokens;
        station.current = tokens[0] || null;
        station.queue = tokens.slice(1);
        station.tripSeen = station.current ? 1 : 0;
      }
      station.tripNo += 1;
      station.tripTotal = tokens.length;
    }

    function advanceCurrent() {
      // 走完这一趟（期间答错回队尾的都补考过）再抽下一趟
      if (station.tripSeen >= station.tripTotal) {
        seedTrip(false);
        return;
      }
      station.current = station.queue.shift() || null;
      if (station.current) station.tripSeen += 1;
    }

    /** 初始化：同步收藏库 → 恢复运行态，恢复失败则重开一趟。 */
    function init() {
      getGames().forEach((g) => global.QuizStore.syncGame(data, g));
      getGames().forEach((g) => global.QuizStore.evaluateLock(data, g.id));
      if (
        station.current &&
        isValidToken(station.current, gamesById(), station.playerCount)
      ) {
        station.queue = station.queue.filter((t) =>
          isValidToken(t, gamesById(), station.playerCount)
        );
      } else {
        seedTrip(false);
      }
      persist();
    }

    function persist() {
      data.playerCount = station.playerCount;
      data.runtime = {
        queue: station.queue,
        current: station.current,
        tripNo: station.tripNo,
        tripTotal: station.tripTotal,
        tripSeen: station.tripSeen
      };
      global.QuizStore.save(data);
    }

    /**
     * 作答：
     * - 答对 1 次：留在队尾，本趟还要再见；累计第 2 次答对：掌握退场
     * - 答错：回队尾，本趟补考，累计答对不清零
     */
    function answer(isCorrect) {
      const token = station.current;
      if (!token) return null;
      const { gameId, refId } = parseToken(token);
      station.swapped = false;

      const result = global.QuizStore.recordAnswer(data, gameId, refId, isCorrect);

      if (!result.mastered) {
        // 掌握前每次答完都回队尾（答错回队尾；答对一次也要本趟再确认一次）
        station.queue.push(token);
      }
      advanceCurrent();
      persist();
      return result;
    }

    /**
     * 切换今晚人数：
     * - 当前题仍适配：保持当前题和趟次不动
     * - 当前题不适配：直接换题，不计成绩；其余不适配题一并撤出，补成新的一趟
     */
    function setPlayerCount(playerCount) {
      const next = Number(playerCount);
      if (next === station.playerCount) return;
      station.playerCount = next;
      station.swapped = false;

      if (station.current && isValidToken(station.current, gamesById(), next)) {
        station.queue = station.queue.filter((t) =>
          isValidToken(t, gamesById(), next)
        );
        if (station.tripSeen >= station.tripTotal) seedTrip(true);
      } else {
        if (station.current) station.swapped = true;
        seedTrip(false);
      }
      persist();
    }

    /** 收藏库增删改后调用：清掉已经不存在/已掌握的队中题；当前题失效则整趟重开。 */
    function refresh() {
      getGames().forEach((g) => global.QuizStore.syncGame(data, g));
      getGames().forEach((g) => global.QuizStore.evaluateLock(data, g.id));

      if (
        station.current &&
        isValidToken(station.current, gamesById(), station.playerCount)
      ) {
        station.queue = station.queue.filter((t) =>
          isValidToken(t, gamesById(), station.playerCount)
        );
        if (station.tripSeen >= station.tripTotal) seedTrip(true);
      } else {
        seedTrip(false);
      }
      persist();
    }

    function startNew(gameId) {
      const game = getGames().find((g) => g.id === gameId);
      if (!game) return;
      global.QuizStore.startNewSession(data, game);
      seedTrip(false);
      persist();
    }

    /** 给页面用的只读快照。 */
    function snapshot() {
      const byId = gamesById();
      const current = station.current
        ? resolveToken(station.current, byId)
        : null;

      const gameCards = getGames().map((game) => {
        const rec = data.games[game.id];
        const fits = gameFits(game, station.playerCount);
        const total = rec ? rec.refs.length : 0;
        const masteredCount = rec ? rec.refs.filter((r) => rec.mastered[r.id]).length : 0;
        const pending = total - masteredCount;
        return {
          id: game.id,
          name: game.name,
          minPlayers: game.minPlayers,
          maxPlayers: game.maxPlayers,
          fits,
          total,
          masteredCount,
          pending,
          locked: !!rec?.locked,
          dirty: !!rec?.dirty,
          lockedSummary: rec?.lockedSummary || null,
          session: rec?.session || null
        };
      });

      return {
        playerCount: station.playerCount,
        current,
        tripNo: station.tripNo,
        tripTotal: station.tripTotal,
        tripSeen: station.tripSeen,
        queueLength: station.queue.length,
        swapped: station.swapped,
        gameCards
      };
    }

    function resolveToken(token, byId) {
      const { gameId, refId } = parseToken(token);
      const game = byId.get(gameId);
      const rec = data.games[gameId];
      const ref = rec?.refs.find((r) => r.id === refId);
      if (!game || !ref) return null;
      return {
        gameId,
        gameName: game.name,
        refId,
        key: ref.key,
        label: RULE_LABELS[ref.key] || ref.key,
        text: ref.text,
        streak: rec.streak[refId] || 0
      };
    }

    // 恢复上次的运行态（趟次队列会随进度存档一起保存）
    const rt = data.runtime;
    if (rt && Array.isArray(rt.queue)) {
      station.queue = rt.queue;
      station.current = rt.current || null;
      station.tripNo = rt.tripNo || 0;
      station.tripTotal = rt.tripTotal || 0;
      station.tripSeen = rt.tripSeen || 0;
    }
    init();

    return {
      answer,
      setPlayerCount,
      refresh,
      startNew,
      snapshot,
      RULE_LABELS
    };
  }

  global.QuizEngine = { createStation, RULE_LABELS };
})(window);
