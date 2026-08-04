import { useState } from "react";
import { useLocation } from "react-router-dom";
import ChatPanel from "./ChatPanel";

// The full AI Assistant page renders its own always-open ChatPanel — hide
// the floating bubble there so the two don't stack on top of each other.
const HIDDEN_ON_PATHS = ["/ai-assistant"];

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();

  if (HIDDEN_ON_PATHS.includes(location.pathname)) return null;

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 shadow-lg shadow-indigo-500/30 flex items-center justify-center transition-all duration-200 hover:scale-110 hover:shadow-xl hover:shadow-indigo-500/40 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2"
        aria-label="Open AI assistant"
      >
        {isOpen ? (
          <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 10h.01M12 10h.01M16 10h.01M21 16c0 1.1-.9 2-2 2H7l-4 4V6c0-1.1.9-2 2-2h14c1.1 0 2 .9 2 2v10z" />
          </svg>
        )}
      </button>

      {isOpen && <ChatPanel variant="floating" onClose={() => setIsOpen(false)} />}
    </>
  );
}
