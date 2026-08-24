const actions = document.querySelector("[data-mobile-primary-actions]");
const mobileSlot = document.querySelector("[data-mobile-actions-slot]");

if (actions && mobileSlot) {
  const desktopPosition = document.createComment("primary actions desktop position");
  actions.before(desktopPosition);

  const singleColumn = window.matchMedia("(max-width: 1020px)");

  const placeActions = () => {
    if (singleColumn.matches) {
      mobileSlot.hidden = false;
      if (actions.parentNode !== mobileSlot) mobileSlot.append(actions);
      return;
    }

    if (desktopPosition.parentNode && actions.parentNode !== desktopPosition.parentNode) {
      desktopPosition.after(actions);
    }
    mobileSlot.hidden = true;
  };

  placeActions();
  singleColumn.addEventListener("change", placeActions);
}
