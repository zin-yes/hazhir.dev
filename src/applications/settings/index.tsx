"use client";

import AccountTabContent from "@/applications/settings/components/tabs/account/account-tab-content";
import AppearanceTabContent from "@/applications/settings/components/tabs/appearance/appearance-tab-content";
import SystemTabContent from "@/applications/settings/components/tabs/system/system-tab-content";
import {
  SETTINGS_TABS,
  useSettingsState,
} from "@/applications/settings/logic/use-settings-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Monitor, User, Wallpaper } from "lucide-react";

/**
 * Icon lookup for the tab triggers.
 * Maps tab definition `iconName` values to their corresponding Lucide components.
 */
const TAB_ICON_MAP: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  Wallpaper,
  User,
  Monitor,
};

type SettingsApplicationProps = {
  initialTab?: string;
};

/**
 * Root settings application.
 *
 * Uses a declarative tab registry (SETTINGS_TABS) so that adding a new tab
 * only requires: (1) adding an entry to SETTINGS_TABS, (2) creating a tab
 * content component, and (3) registering it in the content map below.
 */
export default function SettingsApplication({
  initialTab,
}: SettingsApplicationProps) {
  const settingsState = useSettingsState(initialTab);

  /**
   * Maps each tab id to its rendered content component.
   * To add a new settings tab, create a component and register it here.
   */
  const tabContentByTabId: Record<string, React.ReactNode> = {
    appearance: (
      <AppearanceTabContent
        selectedWallpaperIndex={settingsState.selectedWallpaperIndex}
        clockFormatPreference={settingsState.clockFormatPreference}
        isSlideshowEnabled={settingsState.isSlideshowEnabled}
        slideshowIntervalMilliseconds={
          settingsState.slideshowIntervalMilliseconds
        }
        onWallpaperSelected={settingsState.handleWallpaperSelected}
        onClockFormatChanged={settingsState.handleClockFormatChanged}
        onSlideshowToggled={settingsState.handleSlideshowToggled}
        onSlideshowIntervalChanged={
          settingsState.handleSlideshowIntervalChanged
        }
        onDesktopLayoutReset={settingsState.handleDesktopLayoutReset}
      />
    ),
    account: (
      <AccountTabContent
        userAccountInformation={settingsState.userAccountInformation}
      />
    ),
    system: (
      <SystemTabContent
        systemEnvironmentInformation={
          settingsState.systemEnvironmentInformation
        }
      />
    ),
  };

  return (
    <div className="h-full w-full bg-background text-foreground overflow-hidden">
      <div className="h-full flex flex-col rounded-xl border bg-card/60">
        <Tabs
          value={settingsState.activeTabId}
          onValueChange={settingsState.setActiveTabId}
          className="flex-1 min-h-0 p-3"
          orientation="vertical"
        >
          <div className="flex flex-1 h-full min-h-0 w-full gap-3">
            {/* Vertical tab list - rendered from the declarative SETTINGS_TABS registry */}
            <TabsList className="w-32 sm:w-40 shrink-0" variant="line">
              {SETTINGS_TABS.map((tabDefinition) => {
                const IconComponent = TAB_ICON_MAP[tabDefinition.iconName];
                return (
                  <TabsTrigger
                    key={tabDefinition.id}
                    value={tabDefinition.id}
                    className="text-xs"
                  >
                    {IconComponent ? (
                      <IconComponent className="size-3.5" />
                    ) : null}
                    {tabDefinition.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {/* Tab content panels - each rendered from the content map */}
            <div className="flex-1 min-h-0 min-w-0 w-full">
              {SETTINGS_TABS.map((tabDefinition) => (
                <TabsContent
                  key={tabDefinition.id}
                  value={tabDefinition.id}
                  className="relative h-full min-h-0 w-full"
                >
                  {tabContentByTabId[tabDefinition.id]}
                </TabsContent>
              ))}
            </div>
          </div>
        </Tabs>

        {/* Status bar at the bottom */}
        {settingsState.statusBarMessage ? (
          <div className="border-t px-3 py-1.5 text-[11px] text-muted-foreground truncate">
            {settingsState.statusBarMessage}
          </div>
        ) : null}
      </div>
    </div>
  );
}
