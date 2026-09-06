import { GAME_REGISTRY } from "./game-registry.mjs";

const baseUrl = new URL("../", import.meta.url);
const COMPANION_GAMES = Object.freeze([
  { name: "Assemble Human", href: "https://assemble-human.pages.dev/" },
  { name: "Abyssal Hunt", href: "https://abyssal-hunt.pages.dev/" },
]);

class PlatformNav extends HTMLElement {
  connectedCallback() {
    const current = document.body.dataset.game || "home";
    const gameLinks = GAME_REGISTRY.map((game) => {
      const active = current === game.id;
      return `<a class="platform-game-link${active ? " is-active" : ""}" href="${new URL(game.route, baseUrl).href}"${active ? ' aria-current="page"' : ""}>${game.name}</a>`;
    }).join("");
    const companionLinks = COMPANION_GAMES.map(
      (game) => `<a class="platform-external-link" href="${game.href}" target="_blank" rel="noopener noreferrer" aria-label="前往 ${game.name}（另開新分頁）"><span>${game.name}</span><span aria-hidden="true">↗</span></a>`,
    ).join("");
    const homeActive = current === "home";
    this.innerHTML = `
      <nav class="platform-nav" aria-label="原木棋社主導覽">
        <a class="platform-brand" href="${baseUrl.href}"${homeActive ? ' aria-current="page"' : ""}>
          <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
            <rect x="2" y="2" width="28" height="28" rx="8"></rect>
            <path d="M9 10h14M9 16h14M9 22h14M10 9v14M16 9v14M22 9v14"></path>
          </svg>
          <span><strong>原木棋社</strong><small>WOODGRAIN BOARD CLUB</small></span>
        </a>
        <div class="platform-game-links" aria-label="切換遊戲">${gameLinks}</div>
        <div class="platform-external-links" aria-label="其他遊戲">${companionLinks}</div>
        <span class="platform-mode"><i aria-hidden="true"></i>本機對局</span>
      </nav>`;
  }
}

if (!customElements.get("game-platform-nav")) {
  customElements.define("game-platform-nav", PlatformNav);
}
