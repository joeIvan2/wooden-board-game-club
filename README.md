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

測試涵蓋平台 UI contract、三款棋的規則、棋譜與本機引擎接線。

## 建置

```powershell
npm run build
```

`dist/` 只包含瀏覽器必要資產，不含測試、CLI 或設計文件，可直接交給 Cloudflare Pages。

## 本機棋力引擎與授權

西洋棋與中國象棋的 **L1–L10 和提示** 都在瀏覽器內使用本機隨附的 Fairy-Stockfish NNUE WebAssembly，分別以 chess / xiangqi UCI 變體分析；五子棋的 **L1–L10** 都使用本機隨附的 Rapfi WebAssembly。三者的局面都不會送到伺服器。

每個等級只改變同一引擎的強度、深度與思考時間；引擎失敗會直接回報，不會由其他來源代下一手。引擎輸出一律回到各遊戲的規則引擎核對合法著法後才會套用。

因為隨附 GPL-3.0 的引擎物件碼，整個專案以 **GPL-3.0-or-later** 提供；完整條文在 [LICENSE](LICENSE)，上游版本、對應原始碼與來源連結見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

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
- `shared/stockfish-engine-worker.js`：西洋棋／中國象棋共用的本機 Fairy-Stockfish UCI 橋接。
- `games/gomoku/`：全新 DOM/SVG 2D 棋盤與 Rapfi WebAssembly 橋接。
- `games/chess/`：完整西洋棋規則、棋譜與原木平台殼層。
- `games/xiangqi/`：完整中國象棋規則、棋譜與原木平台殼層。

現階段沒有啟用線上配對、房間或 WebSocket，介面會明確顯示「本機對局」；排行榜則透過 Pages Functions 與 D1 提供。
