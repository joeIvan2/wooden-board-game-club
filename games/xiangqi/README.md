# 楚河漢界 · 象棋衝鋒社

純本機的中國象棋 web 產品。瀏覽器的 L1–L10 與提示僅使用本機隨附的 Fairy-Stockfish NNUE WebAssembly；規則與記譜由原生 ES Modules 提供。所有棋局與私人棋譜只存在使用者裝置，沒有遠端 AI 或棋局上傳。

## 快速開始

```bash
node serve.mjs            # 啟動本機伺服器 → http://127.0.0.1:8787
PORT=9000 node serve.mjs  # 自訂埠
npm test                  # 執行 Node assert 測試
```

伺服器預設只綁 `127.0.0.1`（可由 `HOST` 覆寫），僅提供本資料夾內的靜態檔，並含目錄穿越防護。

## 功能

- **完整規則（9×10，紅先）**：九宮、河界、照面禁著、馬腿、象眼、炮架、將軍／將死／困斃與合法著法驗證。
- **模式與操作**：人機對弈、雙人對戰、點擊、觸控與全鍵盤操作。
- **對局工具**：新局、悔棋、翻面、提示、中文縱線／座標記法、被吃子力統計、終局面板與私人棋譜下載。
- **AI L1–L10**：所有等級與提示均由同一個 Fairy-Stockfish NNUE WebAssembly 計算；透過 UCI Skill Level 與思考時間區分難度。規則模組會再次核對引擎回傳著法；若引擎失敗，畫面明確回報，絕不暗中改用其他演算法。
- **隱私與無障礙**：資料僅保存在 `localStorage` 與使用者主動下載的檔案；支援 ARIA、鍵盤焦點、44px 觸控目標與 reduced motion。

## 測試

```bash
npm test                              # 根目錄的整合測試
node tests/rules-special.test.mjs     # 規則特殊例
node tests/terminal-render.test.mjs   # 終局最後一步與終端棋盤呈現
node tests/frontend.test.mjs          # UI、Worker、CSS 與零外連契約
```

## 架構

| 檔案 | 職責 |
|---|---|
| `xiangqi-rules.mjs` | 規則、合法著法、將軍／終局與 Perft |
| `xiangqi-notation.mjs` | 中文縱線與座標記法 |
| `../../shared/stockfish-engine-worker.js` | 共用 Fairy-Stockfish UCI Worker（西洋棋／中國象棋） |
| `app.js` / `index.html` / `css/style.css` | 瀏覽器 UI、存檔、下載與無障礙互動 |
| `serve.mjs` | 零依賴本機靜態伺服器 |

座標系統：row 0 為黑方底線（上方）、row 9 為紅方底線；欄 a–i 由左至右，列 1–10 由紅方底線起算（例如 `h3-e3` 為紅炮平中）。

## 已知限制

- 未裁決長將／長捉等重複局面規則。
- 高等級中局分析可能需要數秒；逾時或引擎異常時會明確要求重試，不會切換到其他 AI。
- 不支援匯入 FEN／外部棋譜格式。

## 隱私聲明

不收集資料、無外部請求、無 cookie。棋譜與存檔只存在瀏覽器 `localStorage` 和使用者主動下載的檔案。
