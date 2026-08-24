export const LEADERBOARD_LEVELS = Object.freeze([6, 7, 8, 9, 10]);

const GAME_NAMES = Object.freeze({
  gomoku: "五子棋",
  chess: "西洋棋",
  xiangqi: "中國象棋",
});

export function isLeaderboardLevel(level) {
  return Number.isInteger(Number(level)) && LEADERBOARD_LEVELS.includes(Number(level));
}

function required(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`排行榜缺少必要元件：#${id}`);
  return element;
}

function errorMessage(status) {
  if (status === 409) return "這盤棋已經登記過了。";
  if (status === 400) return "棋譜未通過規則驗證，沒有寫入排行榜。";
  if (status === 403) return "請從原木棋社正式頁面提交。";
  if (status === 503) return "排行榜資料庫暫時無法使用，請稍後再試。";
  return "登記失敗，請稍後再試。";
}

export function createLeaderboardController({ game, initialLevel = 6 }) {
  if (!Object.hasOwn(GAME_NAMES, game)) throw new Error(`未知遊戲：${game}`);

  const els = {
    recordPanel: required("record-panel"),
    recordSummary: required("record-summary"),
    recordForm: required("record-form"),
    recordName: required("record-name"),
    recordSubmit: required("record-submit"),
    recordSkip: required("record-skip"),
    recordStatus: required("record-status"),
    leaderboardLevels: required("leaderboard-levels"),
    leaderboardStatus: required("leaderboard-status"),
    leaderboardBody: required("leaderboard-body"),
  };

  let currentLevel = isLeaderboardLevel(initialLevel) ? Number(initialLevel) : 6;
  let pending = null;
  let submitting = false;
  let submitted = false;

  function setSubmitState() {
    const nickname = els.recordName.value.trim();
    els.recordSubmit.disabled = !pending || submitting || submitted || nickname.length === 0;
    els.recordSubmit.textContent = submitting
      ? "登記中…"
      : submitted
        ? "已完成登記"
        : `登記到 L${pending?.level ?? currentLevel} 榜`;
  }

  function syncLevelButtons() {
    for (const button of els.leaderboardLevels.querySelectorAll("button")) {
      const active = Number(button.dataset.level) === currentLevel;
      button.setAttribute("aria-pressed", String(active));
      if (active) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    }
  }

  async function load(level = currentLevel) {
    if (isLeaderboardLevel(level)) currentLevel = Number(level);
    syncLevelButtons();
    els.leaderboardStatus.textContent = `正在載入 L${currentLevel}…`;
    els.leaderboardBody.replaceChildren();
    try {
      const query = new URLSearchParams({ game, level: String(currentLevel) });
      const response = await fetch(`/api/leaderboard?${query}`);
      if (!response.ok) throw new Error(`http ${response.status}`);
      const data = await response.json();
      const entries = Array.isArray(data.entries) ? data.entries : [];
      if (entries.length === 0) {
        els.leaderboardStatus.textContent = `L${currentLevel} 尚無紀錄，等你成為第一名。`;
        return;
      }
      els.leaderboardStatus.textContent = `L${currentLevel} 共顯示 ${entries.length} 筆，總步數越少排名越前。`;
      const fragment = document.createDocumentFragment();
      for (const entry of entries) {
        const row = document.createElement("tr");
        const values = [
          entry.rank,
          entry.displayName,
          `L${entry.level}`,
          `${entry.plyCount} 步`,
          entry.dateOnly,
        ];
        for (const value of values) {
          const cell = document.createElement("td");
          cell.textContent = String(value);
          row.appendChild(cell);
        }
        fragment.appendChild(row);
      }
      els.leaderboardBody.appendChild(fragment);
    } catch {
      els.leaderboardStatus.textContent = location.protocol === "file:"
        ? "本機檔案模式無法讀取排行榜；請使用已發布的 Pages 網址。"
        : "排行榜載入失敗，請稍後再試。";
    }
  }

  function revealPanel() {
    els.recordPanel.hidden = false;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    window.setTimeout(() => {
      els.recordPanel.scrollIntoView?.({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
      if (window.matchMedia?.("(pointer: fine)")?.matches) {
        els.recordName.focus({ preventScroll: true });
      }
    }, 0);
  }

  function showWin({ level, moves, summary }) {
    const numericLevel = Number(level);
    if (!isLeaderboardLevel(numericLevel) || !Array.isArray(moves)) return false;
    pending = { level: numericLevel, moves: structuredClone(moves) };
    submitted = false;
    submitting = false;
    els.recordName.value = "";
    els.recordSummary.textContent = summary || `你擊敗了 L${numericLevel} AI，可登記這場勝局。`;
    els.recordForm.hidden = false;
    els.recordStatus.textContent = "只會公開暱稱、AI 等級、總步數與日期。";
    currentLevel = numericLevel;
    syncLevelButtons();
    setSubmitState();
    revealPanel();
    load(numericLevel);
    return true;
  }

  function showBlocked({ level, summary, reason }) {
    pending = null;
    submitted = false;
    submitting = false;
    els.recordSummary.textContent = summary || `本局為 L${Number(level)} 勝局。`;
    els.recordForm.hidden = true;
    els.recordStatus.textContent = reason;
    revealPanel();
  }

  function reset() {
    pending = null;
    submitting = false;
    submitted = false;
    els.recordName.value = "";
    els.recordStatus.textContent = "";
    els.recordPanel.hidden = true;
    els.recordForm.hidden = false;
    setSubmitState();
  }

  async function submit() {
    if (!pending || submitting || submitted) return;
    const displayName = els.recordName.value.trim();
    if (!displayName) {
      setSubmitState();
      return;
    }
    submitting = true;
    setSubmitState();
    els.recordStatus.textContent = "正在驗證棋譜並登記…";
    try {
      const response = await fetch("/api/leaderboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          game,
          level: pending.level,
          displayName,
          moves: pending.moves,
        }),
      });
      if (response.status !== 201) {
        els.recordStatus.textContent = errorMessage(response.status);
        return;
      }
      const data = await response.json();
      submitted = true;
      els.recordStatus.textContent = `已登記到 ${GAME_NAMES[game]} L${data.level} 榜，目前第 ${data.rank} 名。`;
      currentLevel = data.level;
      await load(data.level);
    } catch {
      els.recordStatus.textContent = location.protocol === "file:"
        ? "本機檔案模式不能送出；請在已發布的 Pages 網址完成登記。"
        : "網路連線失敗，勝局仍保留在畫面上，可以稍後重試。";
    } finally {
      submitting = false;
      setSubmitState();
    }
  }

  function buildLevelFilters() {
    els.leaderboardLevels.replaceChildren();
    for (const level of LEADERBOARD_LEVELS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "leaderboard-level";
      button.dataset.level = String(level);
      button.textContent = `L${level}`;
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => load(level));
      els.leaderboardLevels.appendChild(button);
    }
    syncLevelButtons();
  }

  els.recordName.addEventListener("input", setSubmitState);
  els.recordName.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !els.recordSubmit.disabled) submit();
  });
  els.recordSubmit.addEventListener("click", submit);
  els.recordSkip.addEventListener("click", () => {
    els.recordPanel.hidden = true;
    els.recordStatus.textContent = "";
  });

  buildLevelFilters();
  setSubmitState();
  load(currentLevel);

  return Object.freeze({ showWin, showBlocked, reset, load });
}
