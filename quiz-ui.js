/**
 * 页面接入（业务文件 3/3）
 * 只负责：把抽题判断和进度存档接到现有页面上——渲染抽问台、绑定按钮、
 * 监听收藏库变化。收藏库的依赖与后端维持原样（无依赖、纯静态）。
 */
(function () {
  "use strict";

  const mount = document.querySelector("#quizMount");
  if (!mount || typeof state === "undefined" || !window.QuizEngine) return;

  const station = window.QuizEngine.createStation(() => state.games);

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function render() {
    const snap = station.snapshot();
    const options = [1, 2, 3, 4, 5]
      .map(
        (n) =>
          `<option value="${n}" ${n === snap.playerCount ? "selected" : ""}>今晚 ${n} 人</option>`
      )
      .join("");

    const chips = snap.gameCards
      .map((g) => {
        if (!g.fits) {
          return `<span class="quiz-chip off">${escapeHtml(g.name)}（${g.minPlayers}-${g.maxPlayers}人）不适配</span>`;
        }
        if (g.locked) {
          return `<span class="quiz-chip locked">✓ ${escapeHtml(g.name)} 已通关</span>`;
        }
        return `<span class="quiz-chip">${escapeHtml(g.name)}（${g.minPlayers}-${g.maxPlayers}人）· 待掌握 ${g.pending}/${g.total}</span>`;
      })
      .join("");

    mount.innerHTML = `
      <div class="quiz-head">
        <div>
          <p class="eyebrow">聚会前快速复习</p>
          <h2>规则抽问台</h2>
        </div>
        <label class="quiz-players">
          今晚人数
          <select id="quizPlayerCount">${options}</select>
        </label>
      </div>
      <div class="quiz-chips">${chips || `<span class="quiz-empty">收藏为空</span>`}</div>
      ${renderCard(snap)}
      ${renderBoards(snap)}
    `;
  }

  function renderCard(snap) {
    if (!snap.current) {
      // 是全通关还是压根没有适配游戏
      const fitting = snap.gameCards.filter((g) => g.fits);
      const lockedAll = fitting.length > 0 && fitting.every((g) => g.locked);
      const message =
        fitting.length === 0
          ? "这个人数没有适配的游戏，换个今晚人数试试。"
          : lockedAll
            ? "适配游戏的规则已全部掌握，本局成绩已锁定。可以在下方为某款游戏开下一局。"
            : "题库同步中……";
      return `<div class="quiz-card quiz-done"><p>${message}</p></div>`;
    }

    const c = snap.current;
    const gameCard = snap.gameCards.find((g) => g.id === c.gameId);
    const session = gameCard?.session;
    const pips = [0, 1]
      .map((i) => `<span class="pip ${i < c.streak ? "on" : ""}"></span>`)
      .join("");

    return `
      <div class="quiz-card">
        <div class="quiz-card-head">
          <span class="quiz-tag">${escapeHtml(c.label)}</span>
          <span class="quiz-game">${escapeHtml(c.gameName)}</span>
          <span class="quiz-trip">第 ${snap.tripNo} 趟 · 本趟 ${snap.tripSeen}/${snap.tripTotal} · 队尾 ${snap.queueLength} 题</span>
        </div>
        <p class="quiz-question">${escapeHtml(c.text)}</p>
        <div class="quiz-progress">
          <span class="quiz-streak">累计答对 ${pips} <em>连续两次答对即掌握退场</em></span>
          <span class="quiz-score">本局 答对 ${session?.correct || 0} · 答错 ${session?.wrong || 0}</span>
        </div>
        ${snap.swapped ? `<p class="quiz-notice">已按新人数直接换题，刚才这道不计成绩。</p>` : ""}
        <div class="quiz-actions">
          <button type="button" class="quiz-wrong" data-quiz-answer="wrong">答错（回队尾）</button>
          <button type="button" class="quiz-right" data-quiz-answer="right">答对（累计 ${c.streak + 1}/2）</button>
        </div>
      </div>
    `;
  }

  function renderBoards(snap) {
    const boards = snap.gameCards
      .map((g) => {
        const pct = g.total ? Math.round((g.masteredCount / g.total) * 100) : 0;
        let body;
        if (g.locked && g.lockedSummary) {
          const s = g.lockedSummary;
          body = `
            <p class="board-locked">本局已锁定 ✓ ${s.total} 题全掌握 · 答对 ${s.correct} · 答错 ${s.wrong}</p>
            <p class="board-time">${formatTime(s.startedAt)} → ${formatTime(s.lockedAt)}${g.dirty ? " · 规则有改动，留给下一局" : ""}</p>
            <button type="button" data-quiz-new="${g.id}" ${g.fits ? "" : "disabled"}>开下一局</button>
          `;
        } else if (!g.session) {
          body = `
            <p class="board-hint">尚未开始抽问${g.fits ? "" : "（当前人数不适配）"}</p>
            <button type="button" data-quiz-new="${g.id}" ${g.fits ? "" : "disabled"}>开始本局</button>
          `;
        } else {
          body = `
            <div class="board-bar"><i style="width:${pct}%"></i></div>
            <p class="board-hint">已掌握 ${g.masteredCount}/${g.total}${g.fits ? "" : " · 当前人数不适配，换题不计成绩"}</p>
            <button type="button" data-quiz-new="${g.id}">重开本局</button>
          `;
        }
        return `
          <article class="quiz-board ${g.fits ? "" : "off"} ${g.locked ? "locked" : ""}">
            <h3>${escapeHtml(g.name)} <small>${g.minPlayers}-${g.maxPlayers}人</small></h3>
            ${body}
          </article>
        `;
      })
      .join("");
    return `<div class="quiz-boards">${boards}</div>`;
  }

  function formatTime(iso) {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  mount.addEventListener("click", (event) => {
    const answerBtn = event.target.closest("[data-quiz-answer]");
    const newBtn = event.target.closest("[data-quiz-new]");
    if (answerBtn) {
      station.answer(answerBtn.dataset.quizAnswer === "right");
      render();
    } else if (newBtn) {
      station.startNew(newBtn.dataset.quizNew);
      render();
    }
  });

  mount.addEventListener("change", (event) => {
    if (event.target.id === "quizPlayerCount") {
      station.setPlayerCount(Number(event.target.value));
      render();
    }
  });

  // 收藏库任何增删改都会走 saveState；在它后面同步题库，
  // 筛选/排序等不改数据的操作不会触发误刷新。
  const originalSaveState = window.saveState;
  if (typeof originalSaveState === "function") {
    window.saveState = function () {
      originalSaveState.apply(this, arguments);
      station.refresh();
      render();
    };
  }

  render();
})();
