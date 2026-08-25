# 第三方元件與對應原始碼

## Fairy-Stockfish NNUE WebAssembly

中國象棋 L10 會在使用者瀏覽器中載入下列本機隨附檔案；不會把棋局傳到伺服器：

- 套件：`fairy-stockfish-nnue.wasm` 1.1.11
- 上游來源：<https://github.com/fairy-stockfish/fairy-stockfish.wasm/tree/5589ea54f322e8e76c199440e55ae39fe5d3b09c>
- 授權：GNU General Public License v3.0（完整條文見專案根目錄 `LICENSE`）
- 隨附物件碼：`games/xiangqi/vendor/fairy-stockfish-nnue-1.1.11/stockfish.js`、`stockfish.wasm`、`stockfish.worker.js`

這個專案將上述上游引擎的瀏覽器封裝放在 `games/xiangqi/xiangqi-grandmaster-worker.js`；封裝程式與其餘專案原始碼同以 GPL-3.0-or-later 提供。部署的物件碼與 GitHub 儲存庫中的對應原始碼使用相同公開位置；若要重建或修改引擎，請由上游 commit 取得完整來源與 Emscripten 建置說明。

Fairy-Stockfish 是其作者與貢獻者的專案名稱；本專案未主張其商標或原始作者身分。
