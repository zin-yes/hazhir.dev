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

/* ------------------------------------------------------------------ */
/*  Icon map                                                          */
/* ------------------------------------------------------------------ */

const TAB_ICON_MAP: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  Wallpaper,
  User,
  Monitor,
};

type MobileSettingsApplicationProps = {
  initialTab?: string;
};

/* ------------------------------------------------------------------ */
/*  Mobile Settings Application                                       */
/* ------------------------------------------------------------------ */

export default function MobileSettingsApplication({
  initialTab,
}: MobileSettingsApplicationProps) {
  const settingsState = useSettingsState(initialTab);

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
          className="flex-1 min-h-0 flex flex-col p-3 pb-0"
          orientation="horizontal"
        >
          {/* Horizontal tab list for mobile */}
          <TabsList className="w-full shrink-0" variant="line">
            {SETTINGS_TABS.map((tabDefinition) => {
              const IconComponent = TAB_ICON_MAP[tabDefinition.iconName];
              return (
                <TabsTrigger
                  key={tabDefinition.id}
                  value={tabDefinition.id}
                  className="text-xs flex-1"
                >
                  {IconComponent ? (
                    <IconComponent className="size-3.5" />
                  ) : null}
                  {tabDefinition.label}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {/* Tab content panels */}
          <div className="flex-1 min-h-0 min-w-0 w-full pt-3">
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
