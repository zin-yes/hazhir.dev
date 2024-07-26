import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  AccessibilityIcon,
  AppWindowIcon,
  ClockIcon,
  LayoutGridIcon,
  LockIcon,
  MenuIcon,
  NetworkIcon,
  PowerIcon,
  SearchIcon,
  SettingsIcon,
  UserIcon,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function MockSettingsApplication() {
  return (
    <div className="flex w-full bg-background h-full overflow-hidden">
      <aside className="hidden w-64 flex-col border-r bg-background p-6 sm:flex sticky">
        <div className="flex items-center gap-2">
          <SettingsIcon className="h-6 w-6 text-primary" />
          <h2 className="text-xl font-semibold">Settings</h2>
        </div>
        <nav className="mt-8 flex flex-col space-y-1">
          <Link
            href="#"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            prefetch={false}
          >
            <SettingsIcon className="h-5 w-5 text-muted-foreground" />
            General
          </Link>
          <Link
            href="#"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            prefetch={false}
          >
            <NetworkIcon className="h-5 w-5 text-muted-foreground" />
            Network
          </Link>
          <Link
            href="#"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            prefetch={false}
          >
            <LockIcon className="h-5 w-5 text-muted-foreground" />
            Security
          </Link>
          <Link
            href="#"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            prefetch={false}
          >
            <AppWindowIcon className="h-5 w-5 text-muted-foreground" />
            Apps
          </Link>
          <Link
            href="#"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            prefetch={false}
          >
            <UserIcon className="h-5 w-5 text-muted-foreground" />
            Accounts
          </Link>
          <Link
            href="#"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            prefetch={false}
          >
            <ClockIcon className="h-5 w-5 text-muted-foreground" />
            Date & Time
          </Link>
          <Link
            href="#"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            prefetch={false}
          >
            <AccessibilityIcon className="h-5 w-5 text-muted-foreground" />
            Accessibility
          </Link>
        </nav>
      </aside>
      <div className="flex flex-col w-full h-full">
        <header className="border-b bg-background px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" className="sm:hidden">
                <MenuIcon className="h-6 w-6" />
                <span className="sr-only">Toggle Sidebar</span>
              </Button>
              <h1 className="text-xl font-semibold">Settings</h1>
            </div>
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon">
                <SearchIcon className="h-5 w-5" />
                <span className="sr-only">Search</span>
              </Button>
              <Button variant="ghost" size="icon">
                <PowerIcon className="h-5 w-5" />
                <span className="sr-only">Options</span>
              </Button>
            </div>
          </div>
        </header>
        <ScrollArea className="flex-1 h-full">
          <div className="w-full p-6 md:p-10">
            <div className="mb-8 flex items-center justify-between">
              <h1 className="text-2xl font-bold">General Settings</h1>
              <Button variant="outline">Save Changes</Button>
            </div>
            <div className="grid gap-8">
              <Card>
                <CardHeader>
                  <CardTitle>Appearance</CardTitle>
                  <CardDescription>
                    Choose the visual theme and accent color for your
                    application.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4">
                    <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                      <Label htmlFor="theme">Theme</Label>
                      <Select>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select theme" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="light">Light</SelectItem>
                          <SelectItem value="dark">Dark</SelectItem>
                          <SelectItem value="system">System</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Language</CardTitle>
                  <CardDescription>
                    Set the language for the user interface.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                    <Label htmlFor="language">Language</Label>
                    <Select>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select language" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="se">Svenska</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Startup</CardTitle>
                  <CardDescription>
                    Configure how the application behaves on startup.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4">
                    <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                      <Label htmlFor="startup-action">Startup Action</Label>
                      <Select>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select startup action" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="open-last-project">
                            Open last project
                          </SelectItem>
                          <SelectItem value="open-new-project">
                            Open new project
                          </SelectItem>
                          <SelectItem value="show-welcome-screen">
                            Show welcome screen
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                      <Label htmlFor="startup-window">Startup Window</Label>
                      <Select>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select startup window" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="maximized">Maximized</SelectItem>
                          <SelectItem value="minimized">Minimized</SelectItem>
                          <SelectItem value="normal">Normal</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>About</CardTitle>
                  <CardDescription>
                    View information about the application and its version.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4">
                    <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                      <Label>Application</Label>
                      <div>hazhirOS</div>
                    </div>
                    <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                      <Label>Version</Label>
                      <div>1.0.0</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
