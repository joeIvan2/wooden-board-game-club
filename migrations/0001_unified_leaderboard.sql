-- 原木棋社三款遊戲共用排行榜。只儲存公開榜與伺服器重放所需的最小資料。
CREATE TABLE IF NOT EXISTS leaderboard_entries (
  insertion_order INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_uid TEXT NOT NULL UNIQUE,
  game TEXT NOT NULL CHECK (game IN ('gomoku', 'chess', 'xiangqi')),
  level INTEGER NOT NULL CHECK (level BETWEEN 6 AND 10),
  display_name TEXT NOT NULL,
  ply_count INTEGER NOT NULL CHECK (ply_count >= 1),
  date_only TEXT NOT NULL,
  moves_json TEXT NOT NULL,
  duplicate_hash TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_game_level_rank
  ON leaderboard_entries (game, level, ply_count ASC, insertion_order ASC);
