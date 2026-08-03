import ChatPanel from "../components/chat/ChatPanel";

export default function AIAssistantPage() {
  return (
    <div className="w-full flex flex-col" style={{ height: "calc(100vh - 150px)" }}>
      <div className="mb-4 flex-shrink-0">
        <h1 className="text-3xl font-bold text-slate-900">AI Assistant</h1>
        <p className="mt-2 text-sm text-slate-600">
          Chat, speak a voice message, upload a file, or ask about tasks, projects, KPIs, and more.
        </p>
      </div>
      <div className="flex-1 min-h-0">
        <ChatPanel variant="page" />
      </div>
    </div>
  );
}
