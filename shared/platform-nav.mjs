import { GAME_REGISTRY } from "./game-registry.mjs";

const baseUrl = new URL("../", import.meta.url);
const COMPANION_GAMES = Object.freeze([
  {
    id: "anatomy",
    name: "集合吧，人體！",
    href: "https://assemble-human.pages.dev/",
    artwork: `<svg class="platform-link-art" viewBox="0 0 160 64" aria-hidden="true" focusable="false">
      <circle cx="125" cy="30" r="33" fill="#c09955" opacity=".18"/>
      <g fill="none" stroke="#f2d8a7" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M114 22v22m-13-17 13-4 13 4m-24 3q11 8 22 0m-21 6q10 7 20 0m-18 5q8 6 16 0m-16 5 8 5 8-5m-8 5-9 13m9-13 9 13m-22-36-8 12 3 13m31-25 8 12-3 13"/>
        <path d="m43 13 11 10m-14-9a3 3 0 1 1 3-5 3 3 0 1 1 5 3m3 13a3 3 0 1 0 5 3 3 3 0 1 0 3-5" opacity=".45"/>
      </g>
      <path d="M105 12a9 9 0 0 1 18 0v4l-4 5h-10l-4-5z" fill="#f2d8a7"/>
      <g fill="#5b4228"><circle cx="110" cy="12" r="1.8"/><circle cx="118" cy="12" r="1.8"/><path d="m114 15-2 3h4z"/></g>
      <g fill="#e0bb74" opacity=".5"><circle cx="75" cy="14" r="2"/><circle cx="145" cy="45" r="2"/><circle cx="58" cy="49" r="1.5"/></g>
    </svg>`,
  },
  {
    id: "abyss",
    name: "深淵獵場",
    href: "https://abyssal-hunt.pages.dev/",
    artwork: `<svg class="platform-link-art" viewBox="0 0 160 64" aria-hidden="true" focusable="false">
      <path d="m97 0-24 64h34l18-64zm44 0-21 64h11l22-64z" fill="#70b5a0" opacity=".12"/>
      <path d="M160 53q-22-12-44 1T70 55T0 60v4h160z" fill="#071d1d"/>
      <path d="M94 32q18-24 45-4l13-10-1 26-13-10q-22 22-44-2z" fill="#568d7b" stroke="#b5cdb0" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="m114 18 11-8 4 13m-13 19 9 9 3-13" fill="#568d7b" stroke="#b5cdb0" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M104 24q-4-17 6-16l4 2m-15 28 4-6 3 7 3-5" fill="none" stroke="#d8ca8f" stroke-width="1.6" stroke-linecap="round"/>
      <circle cx="114" cy="10" r="3" fill="#ecd09c"/><circle cx="104" cy="28" r="2" fill="#f5ead3"/>
      <g fill="none" stroke="#91bca8" opacity=".55"><circle cx="75" cy="20" r="3"/><circle cx="83" cy="8" r="2"/><circle cx="52" cy="45" r="2"/></g>
    </svg>`,
  },
]);

class PlatformNav extends HTMLElement {
  connectedCallback() {
    const current = document.body.dataset.game || "home";
    const gameLinks = GAME_REGISTRY.map((game) => {
      const active = current === game.id;
      return `<a class="platform-game-link${active ? " is-active" : ""}" href="${new URL(game.route, baseUrl).href}"${active ? ' aria-current="page"' : ""}>${game.name}</a>`;
    }).join("");
    const companionLinks = COMPANION_GAMES.map(
      (game) => `<a class="platform-external-link platform-external-link--${game.id}" href="${game.href}" target="_blank" rel="noopener noreferrer" aria-label="前往 ${game.name}（另開新分頁）">
        ${game.artwork}
        <span class="platform-link-label">${game.name}</span>
        <svg class="platform-link-arrow" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4 12 12 4M5 4h7v7"/></svg>
      </a>`,
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
