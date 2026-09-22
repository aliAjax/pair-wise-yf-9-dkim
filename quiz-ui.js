// 桌游规则抽问台 —— 页面接入
// 负责视图切换、抽问卡片渲染与事件绑定；
// 抽题判断交给 QuizEngine，进度存档交给 QuizStore，收藏数据来自卡片库 app.js
(function () {
  "use strict";

  const Engine = window.QuizEngine;
  const Store = window.QuizStore;

  let session = Store.loadSession();

  const els = {
    tabs: document.querySelector("#viewTabs"),
    cardsView: document.querySelector("#cardsView"),
    quizView: document.querySelector("#quizView"),
    players: document.querySelector("#quizPlayers"),
    startBtn: document.querySelector("#quizStartBtn"),
    abandonBtn: document.querySelector("#quizAbandonBtn"),
    status: document.querySelector("#quizStatus"),
    stage: document.querySelector("#quizStage")
  };

  function getGames() {
    const shared = window.__boardgameState__;
    return Array.isArray(shared && shared.games) ? shared.games : [];
  }

  function ruleCount(game) {
    return Engine.CATEGORIES.reduce((sum, { key }) => sum + (Array.isArray(game[key]) ? game[key].length : 0), 0);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function persist() {
    if (session) Store.saveSession(session);
  }

  function switchView(view) {
    els.tabs.querySelectorAll(".tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.view === view);
    });
    els.cardsView.hidden = view !== "cards";
    els.quizView.hidden = view !== "quiz";
    if (view === "quiz") render();
  }

  function formatDuration(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    if (minutes === 0) return `${seconds}秒`;
    return `${minutes}分${seconds.toString().padStart(2, "0")}秒`;
  }

  function formatDateTime(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "-";
    const pad = (value) => value.toString().padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function accuracy(correct, answered) {
    if (!answered) return "0%";
    return `${Math.round((correct / answered) * 100)}%`;
  }

  function renderStatus() {
    if (!session) {
      els.status.innerHTML = `<span class="status-pill">未开始</span>`;
      els.players.disabled = false;
      els.startBtn.textContent = "开始这一局";
      els.abandonBtn.hidden = true;
      return;
    }
    if (session.locked) {
      els.status.innerHTML = `<span class="status-pill done">本局已锁定 · ${escapeHtml(session.players)}人局</span>`;
      els.players.disabled = true;
      els.startBtn.textContent = "开始下一局";
      els.abandonBtn.hidden = true;
      return;
    }
    const eligible = Engine.eligibleQuestions(session).length;
    els.status.innerHTML = `
      <span class="status-pill">第 ${session.rounds} 趟</span>
      <span class="status-pill">已掌握 ${session.masteredCount}/${eligible}</span>
      <span class="status-pill ok">答对 ${session.stats.correct}</span>
      <span class="status-pill bad">答错 ${session.stats.wrong}</span>
    `;
    els.players.disabled = false;
    els.startBtn.textContent = "重开一局";
    els.abandonBtn.hidden = false;
  }

  function renderGameChips(sessionOrNull) {
    const players = sessionOrNull ? sessionOrNull.players : Number(els.players.value);
    return getGames()
      .map((game) => {
        const fit = players >= game.minPlayers && players <= game.maxPlayers;
        let masteredInfo = "";
        if (sessionOrNull) {
          const group = Engine.adaptedGames(sessionOrNull).find((item) => item.gameId === game.id);
          if (group) masteredInfo = `<span class="chip-score">${group.mastered}/${group.total}</span>`;
        }
        return `
          <li class="${fit ? "" : "unfit"}">
            <span>${escapeHtml(game.name)}</span>
            <span class="chip-meta">
              ${masteredInfo}
              <span class="mini-pill">${game.minPlayers}-${game.maxPlayers}人 · ${ruleCount(game)}题</span>
              ${fit ? `<span class="mini-pill fit">适配</span>` : `<span class="mini-pill">不适配</span>`}
            </span>
          </li>
        `;
      })
      .join("");
  }

  function renderHistory() {
    const history = Store.loadHistory();
    if (history.length === 0) {
      return `<p class="empty">还没有锁定的成绩。</p>`;
    }
    return `
      <ul class="history-list">
        ${history
          .map(
            (item) => `
              <li>
                <div>
                  <strong>${formatDateTime(item.lockedAt)}</strong>
                  <span>${item.players}人局 · ${item.rounds}趟 · ${formatDuration(item.durationMs)}</span>
                </div>
                <span class="mini-pill">${item.masteredCount}/${item.eligibleTotal}掌握 · 正确率${accuracy(item.correct, item.answered)}</span>
              </li>
            `
          )
          .join("")}
      </ul>
    `;
  }

  function renderSetup() {
    const players = Number(els.players.value);
    const fits = getGames().filter((game) => players >= game.minPlayers && players <= game.maxPlayers);
    const questionTotal = fits.reduce((sum, game) => sum + ruleCount(game), 0);

    els.stage.innerHTML = `
      <div class="quiz-grid">
        <section class="panel quiz-panel">
          <h2>${players}人局准备</h2>
          <p class="empty">
            ${
              fits.length > 0
                ? `适配 ${fits.length} 款游戏，共 ${questionTotal} 条规则待抽问。每道题累计答对两次即掌握退场。`
                : "这个人数没有适配的游戏，换个人数再开局。"
            }
          </p>
          <ul class="game-chips">${renderGameChips(null)}</ul>
          <p class="quiz-rule-note">同一趟每道题只出现一次；答错回到队尾，下一趟再见。锁定成绩后再改动规则，留给下一局。</p>
        </section>
        <section class="panel quiz-panel">
          <div class="panel-head">
            <h2>历史成绩</h2>
          </div>
          ${renderHistory()}
        </section>
      </div>
    `;
  }

  function renderProgressDots() {
    return Engine.eligibleQuestions(session)
      .map((question) => {
        const record = session.progress[question.key];
        const stateClass = record.mastered ? "done" : question.key === session.current ? "current" : "pending";
        return `<span class="dot ${stateClass}" title="${escapeHtml(question.gameName)} · 答对${record.correct}/2"></span>`;
      })
      .join("");
  }

  function renderCard() {
    const question = Engine.getQuestion(session, session.current);
    if (!question) {
      els.stage.innerHTML = `
        <section class="panel quiz-panel quiz-empty">
          <h2>${session.players} 人局没有适配的游戏</h2>
          <p class="empty">切换当晚人数即可继续，已答对的进度都会保留，这次换题不计成绩。</p>
          <ul class="game-chips">${renderGameChips(session)}</ul>
        </section>
      `;
      return;
    }

    const record = Engine.getProgress(session, session.current);
    const category = Engine.CATEGORY_MAP[question.category];

    els.stage.innerHTML = `
      <div class="quiz-grid card-grid">
        <section class="panel quiz-panel card-panel">
          <div class="card-meta">
            <span class="mini-pill fit">${escapeHtml(question.gameName)}</span>
            <span class="mini-pill">${escapeHtml(category.label)}</span>
            <span class="mini-pill">答对 ${record.correct}/2</span>
          </div>
          <div class="flashcard" id="flashcard">
            <div class="flash-face flash-front">
              <p class="flash-prompt">${escapeHtml(category.prompt)}</p>
              <button type="button" class="primary" data-action="reveal">翻面核对规则</button>
            </div>
            <div class="flash-face flash-back">
              <p class="flash-answer">${escapeHtml(question.text)}</p>
              <div class="grade-row">
                <button type="button" class="wrong-btn" data-action="wrong">答错，回队尾</button>
                <button type="button" class="correct-btn" data-action="correct">答对</button>
              </div>
            </div>
          </div>
        </section>
        <aside class="panel quiz-panel">
          <h2>本局进度</h2>
          <div class="dots">${renderProgressDots()}</div>
          <ul class="round-stats">
            <li><span>本趟剩余</span><strong>${Engine.remainingInRound(session)} 题</strong></li>
            <li><span>已掌握</span><strong>${session.masteredCount}/${Engine.eligibleQuestions(session).length}</strong></li>
            <li><span>作答次数</span><strong>${session.stats.answered}</strong></li>
            <li><span>答对 / 答错</span><strong>${session.stats.correct} / ${session.stats.wrong}</strong></li>
          </ul>
          <h3>各游戏掌握情况</h3>
          <ul class="game-chips compact">${renderGameChips(session)}</ul>
        </aside>
      </div>
    `;
  }

  function renderLocked() {
    const result = session.result;
    Store.archiveResult(result);
    els.stage.innerHTML = `
      <div class="quiz-grid">
        <section class="panel quiz-panel result-panel">
          <p class="eyebrow">本局完成</p>
          <h2>${result.players}人局规则全部掌握，成绩已锁定</h2>
          <div class="result-stats">
            <div><span>用时</span><strong>${formatDuration(result.durationMs)}</strong></div>
            <div><span>趟数</span><strong>${result.rounds}</strong></div>
            <div><span>掌握规则</span><strong>${result.masteredCount}/${result.eligibleTotal}</strong></div>
            <div><span>作答次数</span><strong>${result.answered}</strong></div>
            <div><span>答对 / 答错</span><strong>${result.correct} / ${result.wrong}</strong></div>
            <div><span>正确率</span><strong>${accuracy(result.correct, result.answered)}</strong></div>
          </div>
          <ul class="result-games">
            ${result.games
              .map(
                (game) => `
                  <li>
                    <span>${escapeHtml(game.name)}</span>
                    <span class="mini-pill fit">${game.mastered}/${game.total} 全部掌握</span>
                  </li>
                `
              )
              .join("")}
          </ul>
          <button type="button" class="primary" data-action="next">选人数，开始下一局</button>
          <p class="quiz-rule-note">这局之后改动或新增的规则，会在开局时重新拍快照，留给下一局。</p>
        </section>
        <section class="panel quiz-panel">
          <div class="panel-head"><h2>历史成绩</h2></div>
          ${renderHistory()}
        </section>
      </div>
    `;
  }

  function render() {
    els.players.value = session ? String(session.players) : els.players.value;
    renderStatus();
    if (getGames().length === 0) {
      els.stage.innerHTML = `
        <section class="panel quiz-panel quiz-empty">
          <h2>收藏里还没有游戏</h2>
          <p class="empty">先到卡片库加入桌游和规则卡片，再来开局抽问。</p>
        </section>
      `;
      return;
    }
    if (!session) {
      renderSetup();
    } else if (session.locked) {
      renderLocked();
    } else {
      renderCard();
    }
  }

  function startSession() {
    const games = getGames();
    if (games.length === 0) return;
    session = Engine.createSession(games, Number(els.players.value));
    persist();
    render();
  }

  function grade(isCorrect) {
    if (!session || session.locked) return;
    Engine.answer(session, isCorrect);
    if (session.locked) Store.archiveResult(session.result);
    persist();
    render();
  }

  els.tabs.addEventListener("click", (event) => {
    const tab = event.target.closest(".tab");
    if (tab) switchView(tab.dataset.view);
  });

  els.players.addEventListener("change", () => {
    if (!session) {
      render();
      return;
    }
    if (session.locked) {
      els.players.value = String(session.players);
      return;
    }
    // 切人数：当前题不适配则引擎直接换题，且不改动任何成绩
    Engine.changePlayers(session, Number(els.players.value));
    persist();
    render();
  });

  els.startBtn.addEventListener("click", () => {
    if (session && !session.locked && session.stats.answered > 0) {
      const confirmed = window.confirm("当前这一局还没锁定，确定重开吗？成绩会清空。");
      if (!confirmed) return;
    }
    Store.clearSession();
    session = null;
    startSession();
  });

  els.abandonBtn.addEventListener("click", () => {
    const confirmed = window.confirm("放弃当前这一局？已作答的进度会清空。");
    if (!confirmed) return;
    Store.clearSession();
    session = null;
    render();
  });

  els.stage.addEventListener("click", (event) => {
    const actionNode = event.target.closest("[data-action]");
    if (!actionNode) return;
    const action = actionNode.dataset.action;
    if (action === "reveal") {
      const card = document.querySelector("#flashcard");
      if (card) card.classList.add("flipped");
      return;
    }
    if (action === "correct" || action === "wrong") {
      grade(action === "correct");
      return;
    }
    if (action === "next") {
      Store.clearSession();
      session = null;
      render();
    }
  });

  render();
})();
