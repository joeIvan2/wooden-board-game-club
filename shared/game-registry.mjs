export const GAME_REGISTRY = Object.freeze([
  Object.freeze({
    id: "gomoku",
    name: "五子棋",
    subtitle: "十五路攻防",
    route: "games/gomoku/",
    board: Object.freeze({ rows: 15, columns: 15 }),
  }),
  Object.freeze({
    id: "chess",
    name: "西洋棋",
    subtitle: "經典戰術棋局",
    route: "games/chess/",
    board: Object.freeze({ rows: 8, columns: 8 }),
  }),
  Object.freeze({
    id: "xiangqi",
    name: "中國象棋",
    subtitle: "楚河漢界",
    route: "games/xiangqi/",
    board: Object.freeze({ rows: 10, columns: 9 }),
  }),
]);

export function getGameDefinition(id) {
  return GAME_REGISTRY.find((game) => game.id === id) ?? null;
}
