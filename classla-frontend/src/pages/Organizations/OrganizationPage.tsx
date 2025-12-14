import React from "react";
import { Routes, Route, Navigate, useParams } from "react-router-dom";
import OrganizationLayout from "./components/OrganizationLayout";
import TemplatesTab from "./components/TemplatesTab";
import MembersTab from "./components/MembersTab";
import SettingsTab from "./components/SettingsTab";

const OrganizationPage: React.FC = () => {
  const { orgSlug } = useParams<{ orgSlug: string }>();

  return (
    <OrganizationLayout>
      <Routes>
        <Route path="templates" element={<TemplatesTab />} />
        <Route path="members" element={<MembersTab />} />
        <Route path="settings" element={<SettingsTab />} />
        <Route path="*" element={<Navigate to="templates" replace />} />
      </Routes>
    </OrganizationLayout>
  );
};

export default OrganizationPage;
