"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { Tabs } from "@/components/ui/tabs";
import { SettingsTabs } from "./settings-tabs";

export default function SettingsPage() {
  const [tab, setTab] = React.useState(useSearchParams().get("tab") ?? "profile");
  return (
    <>
      <PageHeader title="Settings" description="Your profile, units, notifications, household sharing and data controls." />
      <Tabs label="Settings sections" value={tab} onChange={setTab} tabs={[{ key: "profile", label: "Profile" }, { key: "preferences", label: "Units & display" }, { key: "notifications", label: "Notifications" }, { key: "household", label: "Household & sharing" }, { key: "integrations", label: "Integrations" }, { key: "privacy", label: "Privacy & data" }, { key: "app", label: "App & offline" }]} />
      <div className="max-w-4xl pt-4"><SettingsTabs tab={tab} /></div>
    </>
  );
}
