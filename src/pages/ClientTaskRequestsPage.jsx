import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { taskRequestApi } from "../api/taskRequestApi";
import { userApi } from "../api/userApi";

const STATUS_BADGE = {
  pending: "bg-amber-100 text-amber-700",
  converted: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
};

function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Clients don't have a scoreboard — this is the "normal list" shown instead
// when a client is clicked on the Users page: every task request they've
// submitted, across all of their projects.
export default function ClientTaskRequestsPage() {
  const { userId } = useParams();
  const navigate = useNavigate();

  const [client, setClient] = useState(null);
  const [requests, setRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setIsLoading(true);
        setError("");
        const [users, requestData] = await Promise.all([
          userApi.list(),
          taskRequestApi.listForClient(userId),
        ]);
        if (cancelled) return;
        setClient((users || []).find((u) => String(u.id) === String(userId)) || null);
        setRequests(requestData || []);
      } catch (err) {
        if (!cancelled) setError(err.message || "Unable to load this client's requests.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <button
        type="button"
        onClick={() => navigate("/users")}
        className="mb-4 text-sm font-medium text-slate-500 hover:text-slate-700"
      >
        ← Back to Users
      </button>

      <div className="mb-6 flex items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-500 text-base font-bold text-white">
          {(client?.full_name || client?.email || "C").slice(0, 2).toUpperCase()}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{client?.full_name || "Client"}</h1>
          <p className="text-sm text-slate-500">{client?.email}</p>
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Task Requests</h2>
        <p className="mb-4 text-sm text-slate-500">
          Clients don't have a scoreboard — this is a plain list of every task request this client has submitted.
        </p>

        {isLoading ? (
          <p className="text-sm text-slate-500">Loading task requests...</p>
        ) : error ? (
          <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>
        ) : requests.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            This client hasn't submitted any task requests yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {requests.map((request) => (
              <li key={request.id} className="flex flex-col gap-2 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-slate-900">{request.title}</p>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_BADGE[request.status] || STATUS_BADGE.pending}`}>
                    {request.status}
                  </span>
                  {request.project_name ? (
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                      {request.project_name}
                    </span>
                  ) : null}
                </div>
                {request.description ? (
                  <p className="text-sm text-slate-500">{request.description}</p>
                ) : null}
                <p className="text-xs text-slate-400">Submitted {formatDate(request.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
