import { useEffect, useRef, useState } from "react";
import Select from "../components/Select";
import { Navigate, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import { useAuth } from "../context/AuthContext";
import { apiClient } from "../api/client";
import { invitationApi } from "../api/invitationApi";

const INDUSTRY_OPTIONS = [
  "Software & Technology",
  "Finance & Banking",
  "Healthcare",
  "Education",
  "Retail & E-commerce",
  "Manufacturing",
  "Marketing & Advertising",
  "Consulting",
  "Other",
];

const INVITE_ROLE_OPTIONS = [
  { value: "team_member", label: "Team Member" },
  { value: "team_manager", label: "Team Manager" },
  { value: "admin", label: "Admin" },
];

const PLAN_OPTIONS = [
  {
    value: "starter",
    label: "Starter",
    monthlyPrice: 29,
    limits: "3 teams · 10 users",
  },
  {
    value: "business",
    label: "Business",
    monthlyPrice: 79,
    limits: "10 teams · 20 users",
  },
];

function annualPrice(monthlyPrice) {
  return monthlyPrice * 10; // 2 months free
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export default function OrganizationSetupPage() {
  const navigate = useNavigate();
  const {
    isAuthenticated,
    isAuthLoading,
    hasOrgContext,
    needsOrgSetup,
    loginWithToken,
    reloadUser,
  } = useAuth();

  // Resuming an abandoned wizard for an org that already exists (status
  // pending_setup) vs. a brand-new creation — decided once on mount.
  const resuming = hasOrgContext && needsOrgSetup;
  // Voluntary creation: user already has a working org and chose
  // "Create new organization" from the switcher — they can back out.
  const canCancel = hasOrgContext && !needsOrgSetup;

  // 'plan' | 'details' | 'invite' — resuming an existing pending_setup org
  // already has a plan chosen, so it skips straight to 'details'.
  const [stage, setStage] = useState(resuming ? "details" : "plan");
  const [orgId, setOrgId] = useState(null);

  const [plan, setPlan] = useState("starter");
  const [billingInterval, setBillingInterval] = useState("monthly");

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [logoUrl, setLogoUrl] = useState("");
  const [website, setWebsite] = useState("");
  const [industry, setIndustry] = useState("");

  const [slugAvailable, setSlugAvailable] = useState(null); // null | true | false
  const [checkingSlug, setCheckingSlug] = useState(false);
  const slugCheckTimer = useRef(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [prefillLoaded, setPrefillLoaded] = useState(!resuming);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("team_member");
  const [sentInvites, setSentInvites] = useState([]);
  const [isInviting, setIsInviting] = useState(false);

  // Resuming: prefill the form from the existing pending_setup org.
  useEffect(() => {
    if (!resuming) return;
    apiClient
      .get("/organizations/current")
      .then((org) => {
        setName(org.name || "");
        setSlug(org.slug || "");
        setSlugTouched(true);
        setLogoUrl(org.logo_url || "");
        setWebsite(org.website || "");
        setIndustry(org.industry || "");
        setOrgId(org.id);
      })
      .catch(() => {})
      .finally(() => setPrefillLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isAuthLoading && !isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  function handleNameChange(e) {
    const val = e.target.value;
    setName(val);
    if (!slugTouched) {
      const next = slugify(val);
      setSlug(next);
      scheduleSlugCheck(next);
    }
  }

  function handleSlugChange(e) {
    setSlugTouched(true);
    const next = slugify(e.target.value);
    setSlug(next);
    scheduleSlugCheck(next);
  }

  function scheduleSlugCheck(value) {
    setSlugAvailable(null);
    if (slugCheckTimer.current) clearTimeout(slugCheckTimer.current);
    if (value.length < 2) return;

    slugCheckTimer.current = setTimeout(async () => {
      try {
        setCheckingSlug(true);
        const data = await apiClient.get(
          `/organizations/check-slug?slug=${encodeURIComponent(value)}`
        );
        setSlugAvailable(data.available);
      } catch {
        setSlugAvailable(null);
      } finally {
        setCheckingSlug(false);
      }
    }, 400);
  }

  async function handleDetailsSubmit(e) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Organization name is required.");
      return;
    }
    const resolvedSlug = slug || slugify(name.trim());
    if (!resolvedSlug || resolvedSlug.length < 2) {
      setError("Please enter a valid slug.");
      return;
    }
    if (slugAvailable === false) {
      setError("This slug is already taken. Try another.");
      return;
    }

    try {
      setError("");
      setIsSubmitting(true);

      const details = {
        name: name.trim(),
        logo_url: logoUrl.trim() || null,
        website: website.trim() || null,
        industry: industry || null,
      };

      if (resuming && orgId) {
        await apiClient.put(`/organizations/${orgId}/setup`, details);
        await reloadUser();
      } else {
        // POST /organizations returns a new org-scoped TokenResponse,
        // embedding the freshly created organization.
        const data = await apiClient.post("/organizations", {
          name: name.trim(),
          slug: resolvedSlug,
          plan,
          billing_interval: billingInterval,
        });
        await apiClient.put(`/organizations/${data.organization.id}/setup`, details);
        loginWithToken(data.access_token, data.user, "active", data.refresh_token);
        setOrgId(data.organization.id);
      }

      toast.success(`Organization "${name.trim()}" is ready!`);
      setStage("invite");
    } catch (err) {
      const message = err.message || "Failed to create organization.";
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSendInvite(e) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    try {
      setIsInviting(true);
      await invitationApi.invite({ email: inviteEmail.trim(), role: inviteRole });
      setSentInvites((prev) => [...prev, inviteEmail.trim()]);
      setInviteEmail("");
      toast.success("Invitation sent.");
    } catch (err) {
      toast.error(err.message || "Failed to send invitation.");
    } finally {
      setIsInviting(false);
    }
  }

  function handleFinish() {
    navigate("/dashboard", { replace: true });
  }

  function handleCancel() {
    navigate("/dashboard", { replace: true });
  }

  if (resuming && !prefillLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-sm text-slate-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className={`w-full rounded-2xl bg-white p-8 shadow-sm ${stage === "plan" ? "max-w-2xl" : "max-w-md"}`}>
        {stage === "plan" ? (
          <>
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-slate-900">Choose your plan</h1>
              <p className="mt-2 text-sm text-slate-600">
                Start with a 14-day free trial — no credit card required. Cancel or change anytime.
              </p>
            </div>

            <div className="mb-6 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setBillingInterval("monthly")}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  billingInterval === "monthly" ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700 hover:bg-slate-50"
                }`}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setBillingInterval("annual")}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  billingInterval === "annual" ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700 hover:bg-slate-50"
                }`}
              >
                Annual <span className="font-normal text-emerald-500">— 2 months free</span>
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {PLAN_OPTIONS.map((opt) => {
                const selected = plan === opt.value;
                const price = billingInterval === "annual" ? annualPrice(opt.monthlyPrice) : opt.monthlyPrice;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPlan(opt.value)}
                    className={`rounded-xl border-2 p-5 text-left transition ${
                      selected ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <p className="text-base font-bold text-slate-900">{opt.label}</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900">
                      ${price}
                      <span className="text-sm font-normal text-slate-400">/{billingInterval === "annual" ? "yr" : "mo"}</span>
                    </p>
                    <p className="mt-2 text-xs text-slate-500">{opt.limits}</p>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setStage("details")}
              className="mt-6 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Continue with {PLAN_OPTIONS.find((o) => o.value === plan)?.label}
            </button>
          </>
        ) : stage === "details" ? (
          <>
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-slate-900">
                {resuming ? "Finish setting up your organization" : "Create your organization"}
              </h1>
              <p className="mt-2 text-sm text-slate-600">
                {resuming
                  ? "Pick up where you left off — just a couple of details left."
                  : "Set up your workspace to get started. You can invite team members after."}
              </p>
            </div>

            {error && (
              <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <form onSubmit={handleDetailsSubmit} noValidate className="space-y-5">
              <div>
                <label htmlFor="org-name" className="mb-1 block text-sm font-medium text-slate-700">
                  Organization name
                </label>
                <input
                  id="org-name"
                  value={name}
                  onChange={handleNameChange}
                  placeholder="Acme Corp"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                />
              </div>

              <div>
                <label htmlFor="org-slug" className="mb-1 block text-sm font-medium text-slate-700">
                  URL slug
                </label>
                <div className="flex items-center rounded-lg border border-slate-300 focus-within:border-slate-900 focus-within:ring-2 focus-within:ring-slate-200">
                  <span className="px-3 text-sm text-slate-400 select-none">app/</span>
                  <input
                    id="org-slug"
                    value={slug}
                    onChange={handleSlugChange}
                    disabled={resuming}
                    placeholder="acme-corp"
                    className="flex-1 rounded-r-lg py-2 pr-3 text-sm outline-none bg-transparent disabled:opacity-60"
                  />
                </div>
                {!resuming && slug.length >= 2 && (
                  <p
                    className={`mt-1 text-xs ${
                      checkingSlug
                        ? "text-slate-400"
                        : slugAvailable === false
                        ? "text-red-600"
                        : slugAvailable === true
                        ? "text-green-600"
                        : "text-slate-500"
                    }`}
                  >
                    {checkingSlug
                      ? "Checking availability..."
                      : slugAvailable === false
                      ? `✗ app/${slug} is already taken`
                      : slugAvailable === true
                      ? `✓ app/${slug} is available`
                      : "Lowercase letters, numbers, and hyphens only."}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="org-logo" className="mb-1 block text-sm font-medium text-slate-700">
                  Logo URL <span className="text-slate-400">(optional)</span>
                </label>
                <input
                  id="org-logo"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                />
              </div>

              <div>
                <label htmlFor="org-website" className="mb-1 block text-sm font-medium text-slate-700">
                  Website <span className="text-slate-400">(optional)</span>
                </label>
                <input
                  id="org-website"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://acme.com"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                />
              </div>

              <div>
                <label htmlFor="org-industry" className="mb-1 block text-sm font-medium text-slate-700">
                  Industry <span className="text-slate-400">(optional)</span>
                </label>
                <Select
                  id="org-industry"
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                >
                  <option value="">Select industry</option>
                  {INDUSTRY_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="flex items-center gap-3 pt-1">
                {canCancel && (
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isSubmitting || !name.trim()}
                  className="flex-1 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? "Saving..." : "Create & continue"}
                </button>
              </div>
            </form>
          </>
        ) : (
          <>
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-slate-900">Invite your team</h1>
              <p className="mt-2 text-sm text-slate-600">
                Optional — you can always invite people later from Organization settings.
              </p>
            </div>

            <form onSubmit={handleSendInvite} className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="teammate@company.com"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                />
                <Select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                >
                  {INVITE_ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              </div>
              <button
                type="submit"
                disabled={isInviting || !inviteEmail.trim()}
                className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isInviting ? "Sending..." : "Send invite"}
              </button>
            </form>

            {sentInvites.length > 0 && (
              <ul className="mt-4 space-y-1">
                {sentInvites.map((email) => (
                  <li key={email} className="text-xs text-slate-500">
                    ✓ Invited {email}
                  </li>
                ))}
              </ul>
            )}

            <button
              type="button"
              onClick={handleFinish}
              className="mt-6 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              {sentInvites.length > 0 ? "Finish" : "Skip for now"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
