# 原木棋社 — Design System

> 這份文件是平台全域設計規範。自動搜尋結果只保留可用性原則；視覺方向以使用者指定的「原木、高質感、全 2D」為最高準則。

## Product architecture

- 一個首頁、三個遊戲頁：五子棋、西洋棋、中國象棋。
- 共用頂部導覽、狀態語彙、控制元件與響應式斷點。
- 遊戲規則與 AI 保持獨立模組；畫面層只能透過 game adapter 取用。
- 現階段是本機對局；線上模式只保留 adapter 契約與「準備中」狀態，不假裝已連線。

## Visual language

- 風格：現代木作棋桌，平面 2D，細緻但克制。
- 主背景：深胡桃木；棋盤：淺楓木／蜂蜜橡木；細節：霧面黃銅。
- 不使用玻璃擬態、霓虹、3D 透視、WebGL、外部字型或照片材質。
- 木紋以低對比 CSS gradients 表現，不干擾棋線、棋子與文字。
- 陰影只表達實際層級：背景、木框、棋盤、棋子、浮層。

## Tokens

| Token | Value | Role |
|---|---:|---|
| `--walnut-950` | `#120b06` | 頁面最深背景 |
| `--walnut-900` | `#1b1009` | 主要背景 |
| `--walnut-800` | `#2a190e` | 面板 |
| `--walnut-700` | `#3b2413` | 木框 |
| `--maple-300` | `#d8ae72` | 淺棋盤 |
| `--maple-400` | `#bf8b4f` | 棋盤陰影 |
| `--brass-400` | `#d2aa5b` | 強調、焦點 |
| `--brass-200` | `#f0d28f` | 高亮文字 |
| `--paper-100` | `#f5ead3` | 主文字、白棋 |
| `--ink-900` | `#20150c` | 深色棋線、黑棋 |
| `--vermilion-500` | `#c9472d` | 紅方、主要操作 |
| `--jade-500` | `#36745f` | 可行落點、成功 |

## Typography

- UI：`Microsoft JhengHei`, `PingFang TC`, `Noto Sans TC`, system-ui。
- 品牌與棋子：`BiauKai`, `DFKai-SB`, `KaiTi`, `Noto Serif TC`, serif。
- 不載入外部字型，避免網路依賴與 layout shift。
- 內文最小 16px（手機），輔助標籤可 12–14px，但需維持 4.5:1 對比。

## Components

- 導覽：單列木作工具列；品牌在左、三遊戲切換置中／可換行、本機狀態在右。
- 卡片：12–18px 圓角、1px 黃銅低透明邊、兩層陰影。
- 按鈕與 select：最小 44px 高；主要按鈕朱紅，其餘胡桃木；hover 不縮放版面。
- 棋盤：永遠 2D 正視；棋線位於木紋之上、互動格與棋子之下。
- 密集交點棋盤：以整張棋盤做座標吸附；禁止用相互重疊的 44px 偽元素命中區。觸控須可按住拖曳預覽、放開落子，鍵盤格仍各自可操作；手機版棋盤完整貼合木框，不得依賴內部橫向捲動。
- 狀態：文字與圖形共同表達，不只靠紅／綠色。
- Focus：3px 黃銅 focus-visible ring，不能被 overflow 裁切。

## Responsive rules

- 驗證寬度：375、768、1024、1440px。
- 1024px 以下，棋盤與控制列改為單欄；手機先顯示棋盤，再顯示控制。
- 頁面不能水平溢出。棋盤若因 44px 觸控下限需要捲動，只能在木框內部捲動。
- 導覽可換行但不可遮蔽內容；所有遊戲切換連結維持 44px 點擊高度。

## Motion and accessibility

- 微互動 150–240ms，只動 opacity、color、transform。
- `prefers-reduced-motion: reduce` 時關閉非必要動畫。
- 具備 skip link、語意化地標、ARIA grid、鍵盤走位與 live status。
- 所有圖示使用同一套 inline SVG，不用 emoji 當 UI icon。

## Forbidden patterns

- 3D 棋盤、透視鏡頭、可旋轉視角或 WebGL。
- 粉色／藍色 SaaS 配色、液態玻璃、過量模糊、發光霓虹。
- 低對比木紋蓋過棋線、hover 導致版面位移、無焦點狀態。
- 把尚未完成的線上功能描述為可用。

## Delivery gate

- 三個遊戲都能從共用導覽到達，且目前頁有 `aria-current="page"`。
- 三個棋盤皆為 2D；五子棋沒有 Three.js/import map/WebGL。
- 375/768/1024/1440px 無頁面水平溢出。
- 觸控目標至少 44px、鍵盤可操作、console 0 error、reduced motion 生效。
- 原有規則／AI 測試與平台 UI contract 全數通過。
