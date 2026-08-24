const INSERT_SQL =
  "INSERT INTO leaderboard_entries (entry_uid, game, level, display_name, ply_count, date_only, moves_json, duplicate_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";

export function d1Driver(db) {
  return {
    async listByGameLevel(game, level, limit) {
      const result = await db
        .prepare(
          "SELECT insertion_order, entry_uid, game, level, display_name, ply_count, date_only FROM leaderboard_entries WHERE game = ? AND level = ? ORDER BY ply_count ASC, insertion_order ASC LIMIT ?"
        )
        .bind(game, level, limit)
        .all();
      return result.results ?? [];
    },
    async findByHash(hash) {
      return (await db
        .prepare("SELECT entry_uid FROM leaderboard_entries WHERE duplicate_hash = ?")
        .bind(hash)
        .first()) ?? null;
    },
    async insertEntry(entry) {
      await db
        .prepare(INSERT_SQL)
        .bind(
          entry.entryUid,
          entry.game,
          entry.level,
          entry.displayName,
          entry.plyCount,
          entry.dateOnly,
          entry.movesJson,
          entry.duplicateHash
        )
        .run();
    },
    async getSummaryByUid(uid) {
      return (await db
        .prepare("SELECT insertion_order, game, level, ply_count FROM leaderboard_entries WHERE entry_uid = ?")
        .bind(uid)
        .first()) ?? null;
    },
    async countBetter(game, level, plyCount, insertionOrder) {
      const row = await db
        .prepare(
          "SELECT COUNT(*) AS n FROM leaderboard_entries WHERE game = ? AND level = ? AND (ply_count < ? OR (ply_count = ? AND insertion_order < ?))"
        )
        .bind(game, level, plyCount, plyCount, insertionOrder)
        .first();
      return row?.n ?? 0;
    },
  };
}

export function memoryDriver(initialRows = []) {
  const rows = initialRows.map((row) => ({ ...row }));
  let nextOrder = rows.reduce(
    (max, row) => Math.max(max, Number(row.insertion_order) || 0),
    0
  );
  return {
    _rows: rows,
    async listByGameLevel(game, level, limit) {
      return rows
        .filter((row) => row.game === game && row.level === level)
        .sort((left, right) => left.ply_count - right.ply_count || left.insertion_order - right.insertion_order)
        .slice(0, limit);
    },
    async findByHash(hash) {
      return rows.find((row) => row.duplicate_hash === hash) ?? null;
    },
    async insertEntry(entry) {
      nextOrder += 1;
      rows.push({
        insertion_order: nextOrder,
        entry_uid: entry.entryUid,
        game: entry.game,
        level: entry.level,
        display_name: entry.displayName,
        ply_count: entry.plyCount,
        date_only: entry.dateOnly,
        moves_json: entry.movesJson,
        duplicate_hash: entry.duplicateHash,
      });
    },
    async getSummaryByUid(uid) {
      const row = rows.find((entry) => entry.entry_uid === uid);
      if (!row) return null;
      return {
        insertion_order: row.insertion_order,
        game: row.game,
        level: row.level,
        ply_count: row.ply_count,
      };
    },
    async countBetter(game, level, plyCount, insertionOrder) {
      return rows.filter(
        (row) => row.game === game && row.level === level &&
          (row.ply_count < plyCount || (row.ply_count === plyCount && row.insertion_order < insertionOrder))
      ).length;
    },
  };
}

export const D1_INSERT_SQL = INSERT_SQL;
