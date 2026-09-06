import { useEffect, useState } from "react";

// The app's Dark Mode toggle (Sidebar.jsx / ProfilePage.jsx) is a plain DOM
// side effect — it flips `html.night` and persists a preference to
// localStorage, with no React context in between. That's fine for styling
// (everything else in this app is themed purely through CSS selectors
// scoped under `html.night`, see src/index.css), but a few charts draw
// directly to SVG with inline `fill`/`stroke` colors, which CSS can never
// reach. Those need to know the theme in JS.
//
// Rather than introduce a theme context (a bigger architectural change than
// this fix calls for) this just observes the one thing that already reflects
// the current theme — the `night` class on <html> — via MutationObserver, so
// it works no matter which existing code path toggles it and re-renders any
// component that calls it when the theme changes.
export function useNightMode() {
  const [isNight, setIsNight] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("night")
  );

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setIsNight(root.classList.contains("night"));
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isNight;
}
