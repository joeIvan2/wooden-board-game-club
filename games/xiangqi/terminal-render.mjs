/**
 * 對局終結時，最後一步必須先完整呈現在棋盤與棋譜上，
 * 才顯示將死／困斃結果。這也避免舊一手的選取框被誤認為致勝著。
 */
export function renderCommittedTerminalMove(renderers, status) {
  renderers.renderBoard();
  renderers.renderMoveList();
  renderers.renderCaptured();
  renderers.finishGame(status);
  renderers.renderSidebar(status);
  renderers.updateControls();
}
