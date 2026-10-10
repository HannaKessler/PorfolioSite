export function bindCarousels(root: HTMLElement) {
  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const scroll = target.closest<HTMLButtonElement>("[data-scroll]");
    if (!scroll) return;
    const track = scroll.parentElement?.querySelector<HTMLElement>(".os-track");
    if (!track) return;
    track.scrollBy({
      left: Number(scroll.dataset.scroll) * Math.max(track.clientWidth * 0.8, 220),
      behavior: "smooth",
    });
  });

  root.addEventListener(
    "scroll",
    (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.classList.contains("os-track")) syncTrack(target);
    },
    true,
  );

  root.addEventListener(
    "load",
    (event) => {
      if (event.target instanceof HTMLImageElement) syncScrollers(root);
    },
    true,
  );

  let resizeFrame = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => syncScrollers(root));
  });

  syncScrollers(root);
}

export function syncScrollers(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(".os-track").forEach(syncTrack);
}

function syncTrack(track: HTMLElement) {
  const row = track.closest(".os-row");
  if (!row) return;
  const prev = row.querySelector<HTMLButtonElement>('[data-scroll="-1"]');
  const next = row.querySelector<HTMLButtonElement>('[data-scroll="1"]');
  // Show a button only when that direction can actually scroll.
  showButton(prev, track, track.scrollLeft > 2);
  showButton(next, track, track.scrollLeft + track.clientWidth < track.scrollWidth - 2);
}

function showButton(button: HTMLButtonElement | null, track: HTMLElement, show: boolean) {
  if (!button || button.hidden === !show) return;
  // Keep keyboard focus in the row if the focused button is about to disappear.
  if (!show && document.activeElement === button) track.focus({ preventScroll: true });
  button.hidden = !show;
}
