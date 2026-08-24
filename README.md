# 原木棋社

給孩子玩的無廣告棋類平台：把五子棋、西洋棋與中國象棋集中在同一張原木棋桌，提供可調整的 L1–L10 AI 與本機對戰。

正式網站：https://wooden-board-game-club.pages.dev/

## 為什麼做這個

市面上的兒童棋類遊戲常被廣告打斷，三種棋又分散在不同 App；AI 難度也往往不是太簡單，就是一下跳得太難。這個作品將三款完整規則與各自的 AI 收進同一個純 2D、無廣告的介面，讓孩子能在熟悉的棋桌上，依自己的程度練習與對弈。

## 畫面預覽

### 首頁

![原木棋社首頁](docs/screenshots/home.png)

### 五子棋

![五子棋](docs/screenshots/gomoku.png)

### 西洋棋

![西洋棋](docs/screenshots/chess.png)

### 中國象棋

![中國象棋](docs/screenshots/xiangqi.png)

## 啟動

```powershell
npm start
```

開啟 `http://127.0.0.1:8787/`。

## 測試

```powershell
npm test
```

測試涵蓋平台 UI contract、五子棋 V4/L1–L10、三款棋規則與 AI。

## 建置

```powershell
npm run build
```

`dist/` 只包含瀏覽器必要資產，不含測試、CLI 或設計文件，可直接交給 Cloudflare Pages。

## 排行榜資料庫

三款遊戲共用獨立 D1 `wooden-board-game-club-leaderboard`，綁定名稱為 `LEADERBOARD_DB`。排行榜只接受玩家擊敗 L6–L10 AI 的完整棋譜；Pages Function 會用各遊戲規則引擎重新播放後才寫入。

```powershell
npx wrangler d1 migrations apply wooden-board-game-club-leaderboard --remote
npx wrangler pages deploy dist --project-name wooden-board-game-club
```

## 架構

- `styles/platform.css`：原木 2D 共用設計 tokens、導覽與響應式規範。
- `shared/game-registry.mjs`：三款遊戲的穩定識別與路由。
- `shared/match-adapter.mjs`：目前使用 `LocalMatchAdapter`；未來遠端 transport 從同一介面接入。
- `shared/leaderboard.mjs`：三款遊戲共用的勝局登記、L6–L10 篩選與排行榜畫面。
- `games/gomoku/`：全新 DOM/SVG 2D 棋盤，沿用既有 V4 AI。
- `games/chess/`：沿用完整西洋棋規則與 AI，套用平台殼層。
- `games/xiangqi/`：沿用完整中國象棋規則與 AI，套用平台殼層。

現階段沒有啟用線上配對、房間或 WebSocket，介面會明確顯示「本機對局」；排行榜則透過 Pages Functions 與 D1 提供。
