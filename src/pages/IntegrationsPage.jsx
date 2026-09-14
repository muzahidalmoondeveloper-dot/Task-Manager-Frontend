import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { integrationApi } from "../api/integrationApi";
import { useConfirm } from "../context/ConfirmContext";

const STATUS_BADGE_CLASSES = {
  success: "bg-green-100 text-green-700",
  partial_success: "bg-amber-100 text-amber-700",
  failed: "bg-red-100 text-red-700",
  running: "bg-slate-100 text-slate-600",
  queued: "bg-slate-100 text-slate-600",
};

function StatusPill({ status }) {
  if (!status) return null;
  const label = status.replace(/_/g, " ");
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${STATUS_BADGE_CLASSES[status] || "bg-slate-100 text-slate-600"}`}>
      {label}
    </span>
  );
}

function formatDateTime(iso) {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// Automation Pipeline Audit follow-up: "Connected" is not "Automation
// Working" — this shows the account's last-sync checkpoint/status and
// the most recent Sync Run's real counters (fetched/analyzed/tasks
// created/etc.), so a user can tell the difference between "we imported
// some emails" and "we actually created a Task" without reading logs.
function SyncSummary({ accountStatus }) {
  if (!accountStatus) return null;
  const run = accountStatus.latest_run;

  return (
    <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-slate-500">Last successful sync</span>
        <span className="font-medium text-slate-800">{formatDateTime(accountStatus.last_synced_at)}</span>
      </div>
      {run ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-slate-500">Last run</span>
            <StatusPill status={run.status} />
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-slate-200 pt-2 sm:grid-cols-4">
            <div>
              <p className="text-xs text-slate-500">Fetched</p>
              <p className="font-semibold text-slate-800">{run.fetched_count}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">AI analyzed</p>
              <p className="font-semibold text-slate-800">{run.analyzed_count}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Tasks created</p>
              <p className="font-semibold text-slate-800">{run.tasks_created_count}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Skipped</p>
              <p className="font-semibold text-slate-800">{run.skipped_count}</p>
            </div>
          </div>
          {run.status === "failed" || run.status === "partial_success" ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              Last error: {run.last_error_message || "Some items could not be processed."}
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-xs text-slate-500">No sync has run yet.</p>
      )}
    </div>
  );
}

function ProviderCard({
  title,
  description,
  provider,
  account,
  accountStatus,
  onConnect,
  onDisconnect,
  onSync,
  isSyncing,
  isDisconnecting,
}) {
  const isConnected = Boolean(account);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold text-slate-900">{title}</h2>

          <p className="mt-2 text-sm text-slate-600">{description}</p>

          {isConnected ? (
            <div className="mt-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
              <p className="text-sm font-semibold text-green-700">
                Connected
              </p>
              <p className="mt-1 truncate text-sm text-green-700">
                {account.account_email}
              </p>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-sm font-semibold text-slate-700">
                Not connected
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Connect your {provider} account to import data.
              </p>
            </div>
          )}

          {isConnected ? <SyncSummary accountStatus={accountStatus} /> : null}
        </div>

        {isConnected ? (
          <span className="shrink-0 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
            Connected
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            Not connected
          </span>
        )}
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        {isConnected ? (
          <button
            type="button"
            onClick={() => onDisconnect(account)}
            disabled={isDisconnecting}
            className="rounded-lg border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isDisconnecting ? "Disconnecting..." : `Disconnect ${title}`}
          </button>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Connect {title}
          </button>
        )}

        {isConnected ? (
          <button
            type="button"
            onClick={onSync}
            disabled={isSyncing}
            className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSyncing ? "Syncing..." : `Sync Recent ${title} Data`}
          </button>
        ) : null}
      </div>
    </div>
  );
}

const ACTIVITY_PAGE_SIZE = 10;

// Automation Activity — one row per email/meeting transcript ever
// imported, newest first, paginated (never the entire history at once).
function AutomationActivity() {
  const [items, setItems] = useState([]);
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");

  async function load(nextOffset) {
    try {
      setIsLoading(true);
      setError("");
      const result = await integrationApi.activityItems({ limit: ACTIVITY_PAGE_SIZE, offset: nextOffset });
      setItems(result.items || []);
      setHasMore((result.items || []).length === ACTIVITY_PAGE_SIZE);
      setOffset(nextOffset);
    } catch (err) {
      setError(err.message || "Unable to load automation activity.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    load(0);
  }, []);

  function renderResult(item) {
    if (item.processing_status === "task_created" || item.processing_status === "partially_created") {
      return `${item.tasks_created} Task${item.tasks_created === 1 ? "" : "s"} created`;
    }
    if (item.processing_status === "needs_review") return "Sent for review";
    if (item.processing_status === "no_action_required") return "No action required";
    if (item.processing_status === "failed") return "Failed";
    if (item.processing_status === "discovered" || item.processing_status === "analyzing") return "Processing...";
    return item.processing_status;
  }

  return (
    <section className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-6 py-4">
        <h2 className="text-lg font-semibold text-slate-900">Automation Activity</h2>
        <p className="mt-1 text-sm text-slate-500">What the automation actually did with each email or meeting — not just whether it synced.</p>
      </div>

      {error ? <div className="px-6 py-4 text-sm text-red-700">{error}</div> : null}

      {isLoading ? (
        <div className="px-6 py-8 text-center text-sm text-slate-500">Loading…</div>
      ) : items.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-slate-500">No automation activity yet.</div>
      ) : (
        <div className="divide-y divide-slate-200">
          {items.map((item, idx) => (
            <div key={idx} className="flex flex-col gap-1 px-6 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">{item.item_title || "(no subject)"}</p>
                <p className="text-xs capitalize text-slate-500">
                  {formatDateTime(item.time)} · {item.source === "gmail" ? "Gmail" : item.source === "outlook" ? "Outlook" : "Teams"}
                </p>
                {item.ai_result_summary ? (
                  <p className="mt-0.5 truncate text-xs text-slate-400">{item.ai_result_summary}</p>
                ) : null}
              </div>
              <div className="shrink-0 text-sm font-medium text-slate-700">{renderResult(item)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-slate-200 px-6 py-3">
        <button
          type="button"
          onClick={() => load(Math.max(0, offset - ACTIVITY_PAGE_SIZE))}
          disabled={offset === 0 || isLoading}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => load(offset + ACTIVITY_PAGE_SIZE)}
          disabled={!hasMore || isLoading}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </section>
  );
}

export default function IntegrationsPage() {
  const confirm = useConfirm();
  const [accounts, setAccounts] = useState([]);
  const [statusByProvider, setStatusByProvider] = useState({});
  const [error, setError] = useState("");
  const [isSyncingMicrosoft, setIsSyncingMicrosoft] = useState(false);
  const [isSyncingGoogle, setIsSyncingGoogle] = useState(false);
  const [disconnectingAccountId, setDisconnectingAccountId] = useState(null);

  const googleAccount = useMemo(() => {
    return accounts.find((account) => account.provider === "google");
  }, [accounts]);

  const microsoftAccount = useMemo(() => {
    return accounts.find((account) => account.provider === "microsoft");
  }, [accounts]);

  async function loadAccounts() {
    try {
      setError("");
      const data = await integrationApi.accounts();
      setAccounts(data);
    } catch (err) {
      setError(err.message || "Unable to load integrations.");
    }
  }

  async function loadStatus() {
    try {
      const result = await integrationApi.status();
      const byProvider = {};
      for (const account of result.accounts || []) byProvider[account.provider] = account;
      setStatusByProvider(byProvider);
    } catch {
      // Status is a nice-to-have overlay on top of the accounts list —
      // a failure here must never block the page from showing connected
      // accounts at all.
      setStatusByProvider({});
    }
  }

  useEffect(() => {
    loadAccounts();
    loadStatus();
  }, []);

  async function handleConnectGoogle() {
    try {
      setError("");
      const data = await integrationApi.connectGoogle();
      window.location.href = data.url;
    } catch (err) {
      setError(err.message || "Unable to connect Google.");
      toast.error(err.message || "Unable to connect Google.");
    }
  }

  async function handleConnectMicrosoft() {
    try {
      setError("");
      const data = await integrationApi.connectMicrosoft();
      window.location.href = data.url;
    } catch (err) {
      setError(err.message || "Unable to connect Microsoft.");
      toast.error(err.message || "Unable to connect Microsoft.");
    }
  }

  // Sync button UX follow-up: disable duplicate clicks while the request
  // is in flight, show a clear "Syncing..." state, then a real summary —
  // never a bare "success" when only retrieval happened.
  async function handleSync(provider) {
    const isSyncing = provider === "microsoft" ? isSyncingMicrosoft : isSyncingGoogle;
    if (isSyncing) return;
    const setSyncing = provider === "microsoft" ? setIsSyncingMicrosoft : setIsSyncingGoogle;
    const syncFn = provider === "microsoft" ? integrationApi.syncMicrosoftRecent : integrationApi.syncGoogleRecent;

    try {
      setSyncing(true);
      setError("");
      const result = await syncFn();
      if (result?.sync_run?.status === "failed") {
        toast.error(result.message || "Sync failed.");
      } else if (result?.sync_run?.status === "partial_success") {
        toast(result.message || "Sync partially completed.", { icon: "⚠️" });
      } else {
        toast.success(result.message || "Sync complete.");
      }
      await Promise.all([loadAccounts(), loadStatus()]);
    } catch (err) {
      toast.error(err.message || `Unable to sync ${provider === "microsoft" ? "Microsoft" : "Gmail"} data.`);
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnectAccount(account) {
    const confirmed = await confirm({
      message: `Disconnect ${account.account_email} from ${account.provider}?`,
      tone: "danger",
      confirmLabel: "Disconnect",
    });

    if (!confirmed) return;

    try {
      setError("");
      setDisconnectingAccountId(account.id);

      const result = await integrationApi.disconnectAccount(account.id);

      toast.success(result.message || "Account disconnected.");

      await loadAccounts();
    } catch (err) {
      setError(err.message || "Unable to disconnect account.");
      toast.error(err.message || "Unable to disconnect account.");
    } finally {
      setDisconnectingAccountId(null);
    }
  }

  return (
    <div className="w-full">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Integrations</h1>

        <p className="mt-2 text-sm text-slate-600">
          Connect Gmail, Outlook, Google Calendar, Microsoft Calendar, and Teams
          meetings.
        </p>
      </div>

      {error ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <ProviderCard
          title="Google"
          provider="google"
          description="Connect Gmail and Google Calendar."
          account={googleAccount}
          accountStatus={statusByProvider.google}
          onConnect={handleConnectGoogle}
          onDisconnect={handleDisconnectAccount}
          onSync={() => handleSync("google")}
          isSyncing={isSyncingGoogle}
          isDisconnecting={disconnectingAccountId === googleAccount?.id}
        />

        <ProviderCard
          title="Microsoft"
          provider="microsoft"
          description="Connect Outlook Mail, Microsoft Calendar, and Teams meetings."
          account={microsoftAccount}
          accountStatus={statusByProvider.microsoft}
          onConnect={handleConnectMicrosoft}
          onDisconnect={handleDisconnectAccount}
          onSync={() => handleSync("microsoft")}
          isSyncing={isSyncingMicrosoft}
          isDisconnecting={disconnectingAccountId === microsoftAccount?.id}
        />
      </div>

      <section className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">
            Connected Accounts
          </h2>
        </div>

        <div className="divide-y divide-slate-200">
          {accounts.map((account) => (
            <div
              key={account.id}
              className="flex flex-col justify-between gap-4 px-6 py-4 sm:flex-row sm:items-center"
            >
              <div>
                <p className="font-medium text-slate-900">
                  {account.account_email}
                </p>

                <p className="text-sm capitalize text-slate-500">
                  {account.provider}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                  Connected
                </span>

                <button
                  type="button"
                  onClick={() => handleDisconnectAccount(account)}
                  disabled={disconnectingAccountId === account.id}
                  className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {disconnectingAccountId === account.id
                    ? "Disconnecting..."
                    : "Disconnect"}
                </button>
              </div>
            </div>
          ))}

          {!accounts.length ? (
            <div className="p-6 text-sm text-slate-500">
              No accounts connected yet.
            </div>
          ) : null}
        </div>
      </section>

      <AutomationActivity />
    </div>
  );
}
