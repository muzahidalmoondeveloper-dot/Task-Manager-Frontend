import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import ProtectedRoute from "./ProtectedRoute";
import { useAuth } from "../context/AuthContext";

import LoginPage from "../pages/LoginPage";
import RegisterPage from "../pages/RegisterPage";
import ForgotPasswordPage from "../pages/ForgotPasswordPage";
import DashboardPage from "../pages/DashboardPage";
import UsersPage from "../pages/UsersPage";
import UserScoreboardPage from "../pages/UserScoreboardPage";
import ClientTaskRequestsPage from "../pages/ClientTaskRequestsPage";
import OrganizationScoreboardPage from "../pages/OrganizationScoreboardPage";
import TeamsPage from "../pages/TeamsPage";
import ProjectsPage from "../pages/ProjectsPage";
import ProjectDetailPage from "../pages/ProjectDetailPage";
import ReportEditPage from "../pages/ReportEditPage";
import ReportPreviewPage from "../pages/ReportPreviewPage";
import TasksPage from "../pages/TasksPage";
import IssuesPage from "../pages/IssuesPage";
import MeetingsPage from "../pages/MeetingsPage";
import MeetingDetailPage from "../pages/MeetingDetailPage";
import CreateMeetingPage from "../pages/CreateMeetingPage";
import ClientOnboardingsPage from "../pages/ClientOnboardingsPage";
import OnboardingDetailPage from "../pages/OnboardingDetailPage";
import OnboardingTemplatesPage from "../pages/OnboardingTemplatesPage";
import TeamDetailPage from "../pages/TeamDetailPage";
import AppLayout from "../components/layout/AppLayout";
import ClientLayout from "../components/layout/ClientLayout";
import ClientProjectViewPage from "../pages/ClientProjectViewPage";
import IntegrationsPage from "../pages/IntegrationsPage";
import AIAssistantPage from "../pages/AIAssistantPage";
import ProfilePage from "../pages/ProfilePage";
import OrganizationPage from "../pages/OrganizationPage";
import OrganizationSetupPage from "../pages/OrganizationSetupPage";
import AcceptInvitationPage from "../pages/AcceptInvitationPage";

function RootRedirect() {
  const { user } = useAuth();
  return <Navigate to={user?.role === "client" ? "/client" : "/dashboard"} replace />;
}

export default function AppRouter() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<RootRedirect />} />

        {/* Public */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/accept-invitation" element={<AcceptInvitationPage />} />

        {/* Auth required, org NOT required — first-time org setup */}
        <Route path="/setup/organization" element={<OrganizationSetupPage />} />

        {/* Auth + org context required */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/users/:userId/scoreboard" element={<UserScoreboardPage />} />
            <Route path="/users/:userId/client-requests" element={<ClientTaskRequestsPage />} />
            <Route path="/meetings" element={<MeetingsPage />} />
            <Route path="/meetings/new" element={<CreateMeetingPage />} />
            <Route path="/meetings/:meetingId" element={<MeetingDetailPage />} />
            <Route path="/scoreboard" element={<OrganizationScoreboardPage />} />
            <Route path="/teams" element={<TeamsPage />} />
            <Route path="/teams/:teamId" element={<TeamDetailPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
            <Route path="/reports/:reportId/edit" element={<ReportEditPage />} />
            <Route path="/reports/:reportId/preview" element={<ReportPreviewPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/issues" element={<IssuesPage />} />
            <Route path="/onboarding" element={<ClientOnboardingsPage />} />
            <Route path="/onboarding/templates" element={<OnboardingTemplatesPage />} />
            <Route path="/onboarding/:onboardingId" element={<OnboardingDetailPage />} />
            <Route path="/integrations" element={<IntegrationsPage />} />
            <Route path="/ai-assistant" element={<AIAssistantPage />} />
            <Route path="/organization" element={<OrganizationPage />} />
          </Route>

          <Route element={<ClientLayout />}>
            <Route path="/client" element={<ClientProjectViewPage />} />
            <Route path="/client/projects/:projectId" element={<ClientProjectViewPage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
