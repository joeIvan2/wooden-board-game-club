export const MATCH_CONNECTION = Object.freeze({
  LOCAL: "local",
  REMOTE: "remote",
});

export class LocalMatchAdapter extends EventTarget {
  constructor(gameId) {
    super();
    this.gameId = gameId;
    this.connection = MATCH_CONNECTION.LOCAL;
    this.status = "ready";
  }

  publish(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail: Object.freeze({ ...detail }) }));
  }

  close() {
    this.status = "closed";
    this.publish("connection", { status: this.status });
  }
}

export class RemoteMatchAdapter extends EventTarget {
  constructor() {
    super();
    this.connection = MATCH_CONNECTION.REMOTE;
    this.status = "unavailable";
  }

  connect() {
    throw new Error("線上對戰尚未啟用；請注入正式 transport 後再連線。");
  }
}

export function createMatchAdapter(gameId, connection = MATCH_CONNECTION.LOCAL) {
  return connection === MATCH_CONNECTION.LOCAL
    ? new LocalMatchAdapter(gameId)
    : new RemoteMatchAdapter();
}
