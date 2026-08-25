# 第三方元件與對應原始碼

## Fairy-Stockfish NNUE WebAssembly

西洋棋與中國象棋 L1–L10 會在使用者瀏覽器中載入下列本機隨附檔案；不會把棋局傳到伺服器：

- 套件：`fairy-stockfish-nnue.wasm` 1.1.11
- 上游來源：<https://github.com/fairy-stockfish/fairy-stockfish.wasm/tree/5589ea54f322e8e76c199440e55ae39fe5d3b09c>
- 授權：GNU General Public License v3.0（完整條文見專案根目錄 `LICENSE`）
- 隨附物件碼：`games/xiangqi/vendor/fairy-stockfish-nnue-1.1.11/stockfish.js`、`stockfish.wasm`、`stockfish.worker.js`

這個專案將上述上游引擎的瀏覽器封裝放在 `shared/stockfish-engine-worker.js`；封裝程式與其餘專案原始碼同以 GPL-3.0-or-later 提供。部署的物件碼與 GitHub 儲存庫中的對應原始碼使用相同公開位置；若要重建或修改引擎，請由上游 commit 取得完整來源與 Emscripten 建置說明。

Fairy-Stockfish 是其作者與貢獻者的專案名稱；本專案未主張其商標或原始作者身分。

## Rapfi classic WebAssembly（封存，未發布）

此倉庫保留的 Rapfi classic WebAssembly 物件碼已不在 `dist/` 發布清單中，也不會由五子棋載入；五子棋 L1–L10 使用本機 V4 Pattern 模組。以下保留來源與授權資訊，供封存物件碼對應原始碼。

- 包裝來源：<https://github.com/CyanXLab/GomokuAI/tree/822be514c7fa563ed2a735628cb60868b913c792/public/build/fallback>
- 引擎上游：<https://github.com/dhbloo/rapfi>
- 引擎版本：Rapfi 0.43.02（包裝來源標示上游 commit `3aedf3a`）
- 授權：GNU General Public License v3.0（完整條文見專案根目錄 `LICENSE`）
- 隨附物件碼：`games/gomoku/vendor/rapfi-classic-0.43.02/rapfi-single.js`、`rapfi-single.wasm`、`rapfi.data`

Rapfi 的完整可重建原始碼與 Emscripten 建置說明可由上游儲存庫取得。
