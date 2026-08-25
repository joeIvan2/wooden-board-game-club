# 楚河漢界 · 象棋衝鋒社

純本機的中國象棋 web 產品。瀏覽器的 L1–L10 與提示使用本機隨附的 Fairy-Stockfish NNUE WebAssembly；規則引擎與棋譜工具仍由原生 ES Modules 提供。所有棋局與私人棋譜只存在你自己的裝置，沒有任何連線。

## 快速開始

```bash
node serve.mjs            # 啟動本機伺服器 → http://127.0.0.1:8787
PORT=9000 node serve.mjs  # 自訂埠
npm test                  # 執行全部 Node assert 測試
```

伺服器預設只綁 `127.0.0.1`（可用 `HOST` 覆覆寫），僅提供本資料夾內的靜態檔，含目錄穿越防護。

## 功能

- **完整規則（9×10，紅先）**：九宮限制、河界、將帥一步直行與照面禁著、士斜行不出宮、象走田字含塞象眼且不可過河、馬走日含蹩馬腿、車直線滑行、炮隔一子打擊、兵卒過河前只進過河後可橫移且永不後退、不得自陷將軍（含自陷照面）、將軍偵測、將死、困斃（無子可動判負）。初始局面合法著法 44 著，與公開 Perft 值一致。
- **模式**：人機對弈（玩家執紅）與雙人對戰；點擊或全鍵盤操作（方向鍵移動游標、Enter 選子／落子、Esc 取消）。
- **對局工具**：新局、悔棋（人機模式自動退回己方回合）、翻面、提示（AI 建議著法）、中文縱線記法棋譜＋座標記法、被吃子力統計、終局面板。
- **隱私**：進度自動存於 `localStorage`，可手動存檔／讀檔；「下載棋譜」以 Blob 在本機產生純文字檔，不上傳任何資料。
- **AI L1–L10**：所有等級與提示都由本機 Fairy-Stockfish NNUE WebAssembly 計算；只調整 UCI Skill Level 與思考時間。引擎失敗時不會改用另一套演算法或代下一手。
- **無障礙**：ARIA grid/label、`aria-live` 播報、roving tabindex、`:focus-visible` 高對比焦點、≥44px 觸控目標、`prefers-reduced-motion` 支援。
- **視覺**：深墨胡桃木主題、朱紅／墨玉棋子、楚河漢界河界與九宮斜線（內嵌 SVG）、桌面雙欄＋手機單欄響應式。

## AI 等級

L1–L10 都採用同一個本機 Fairy-Stockfish 引擎，對應遞增的 UCI Skill Level（0 至 20）與思考時間。所有著法會由 `xiangqi-rules.mjs` 再次核對，任何不合法回傳都不會套用。

## CLI（共用同一套規則／AI 模組）

```bash
node cli/xiangqi-cli.mjs help
node cli/xiangqi-cli.mjs play --level 4 --side red     # 互動對弈
node cli/xiangqi-cli.mjs tournament --a 2 --b 4 --rounds 2   # AI 循環賽
node cli/xiangqi-cli.mjs levels                        # 查看等級參數
```

`play` 內指令：`board|d`、`moves|l [sq]`、`move|m <著法>`（座標 `h3-e3` 或中文 `炮二平五`）、`hint|h`、`undo|u`、`status|s`、`new|n`、`resign|r`、`quit|q`。

`tournament` 每輪互換先後手各賽一局；超過步數上限時依子力裁定。輸出逐局結果與最終積分表。

## 測試

```bash
npm test                              # 全部套件
node tests/rules-special.test.mjs     # 規則特殊例（馬腿/象眼/炮架/照面/牽制/困斃…）
node tests/endgame.test.mjs           # 終局（將死/困斃/一步殺/底線兵）
node tests/ai.test.mjs                # AI 合法性、決定性、戰術、自我對弈
node tests/cli.test.mjs               # CLI smoke（實際 spawn 子程序）
node tests/frontend.test.mjs          # 前端語法(node --check)與結構(id/Worker/CSS/零外連)
```

## 架構

| 檔案 | 職責 |
|------|------|
| `xiangqi-rules.mjs` | 規則引擎（純資料、無 DOM/IO）：著法產生、合法性、將軍/將死/困斃、Perft |
| `xiangqi-notation.mjs` | 中文縱線記法與座標記法互轉、解析 |
| `../../shared/stockfish-engine-worker.js` | Fairy-Stockfish UCI Worker（西洋棋／中國象棋共用） |
| `app.js` / `index.html` / `css/style.css` | 瀏覽器 UI（渲染、鍵盤、存檔、下載、ARIA） |
| `serve.mjs` | 零依賴靜態伺服器 |
| `cli/xiangqi-cli.mjs` | play / tournament CLI |

座標系統：row 0 為黑方底線（上方）、row 9 為紅方底線；欄 a–i 由左至右，列 1–10 由紅方底線起算（如 `h3-e3` 為紅炮平中）。

## 已知限制

- 未裁決長將／長捉等重複局面規則（無三次重複自動和局）。
- 高等級在中局最壞情況可能需要數秒；瀏覽器端有時間保險絲，逾時時會明確要求重開，不會暗中換用另一套 AI。
- 同線超過三枚兵的記法前綴採數字約定，非正式比賽用語。
- 不支援匯入 FEN／外部棋譜格式。

## 隱私聲明

不收集任何資料、無外部請求、無 cookie。棋譜與存檔僅在瀏覽器 `localStorage` 與你主動下載的檔案中。
