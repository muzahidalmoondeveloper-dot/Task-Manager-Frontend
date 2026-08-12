import { createContext, useCallback, useContext, useState } from "react";

const PageContextCtx = createContext(null);

/**
 * App-wide "what record is the user currently looking at" signal
 * (architecture item 9 — validated UI/page context). The chat widget is
 * mounted once at the app root and has no way to know, on its own, that
 * the user has a specific task/rock/issue open in a modal (this app's
 * detail views are modals, not dedicated routes, so React Router's
 * location alone isn't enough). Any page/modal that shows a single
 * record's detail view calls `setPageContext({ pageType, entityId })` when
 * it opens and `clearPageContext()` when it closes; ChatWidget/ChatPanel
 * read the current value and attach it to every chat request so deictic
 * references ("mark this done") can resolve to that exact record.
 *
 * Deliberately a single current value, not a stack — if two detail views
 * were ever open at once (not possible in this app's current UI), the
 * most-recently-opened one wins, which matches "whatever's on screen now".
 *
 * Usage:
 *   const { setPageContext, clearPageContext } = usePageContext();
 *   useEffect(() => {
 *     if (editingTaskId) setPageContext("task", editingTaskId);
 *     else clearPageContext();
 *   }, [editingTaskId]);
 */
export function PageContextProvider({ children }) {
  const [pageContext, setPageContextState] = useState(null);

  const setPageContext = useCallback((pageType, entityId = null) => {
    setPageContextState({ page_type: pageType, entity_id: entityId ?? null });
  }, []);

  const clearPageContext = useCallback(() => {
    setPageContextState(null);
  }, []);

  return (
    <PageContextCtx.Provider value={{ pageContext, setPageContext, clearPageContext }}>
      {children}
    </PageContextCtx.Provider>
  );
}

export function usePageContext() {
  const ctx = useContext(PageContextCtx);
  if (!ctx) {
    throw new Error("usePageContext() must be used within a <PageContextProvider>");
  }
  return ctx;
}
