// Difficulty labels for the one bundled Rapfi engine.  The browser no longer
// loads the retired V4 search; every level maps to Rapfi in the worker and
// differs only in that engine's fixed strength/time/depth profile.
export const AI_ENGINE_VERSION = "Rapfi-classic-0.43.02";

const names = [
  "入門", "基礎", "均衡", "進階", "專家",
  "挑戰", "菁英", "大師", "宗師", "傳奇",
];

export const AI_LEVELS = Object.freeze(names.map((name, index) => Object.freeze({
  id: `l${index + 1}`,
  level: index + 1,
  label: `L${index + 1} ${name}`,
  shortLabel: `L${index + 1}`,
  description: `Rapfi 五子棋引擎 · L${index + 1}`,
  engine: "rapfi",
})));
