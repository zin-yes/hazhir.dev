import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  ComputerIcon,
  DownloadIcon,
  FileIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FolderIcon,
  FolderPlusIcon,
  ImageIcon,
  ImagesIcon,
  InfoIcon,
  LayoutGridIcon,
  ListIcon,
  MenuIcon,
  Music2Icon,
  SearchIcon,
  UploadIcon,
  VideoIcon,
} from "lucide-react";
import Link from "next/link";

export default function MockFileExplorerApplication() {
  return (
    <div className="flex min-h-screen w-full">
      <div className="hidden w-64 flex-col border-r bg-background p-4 md:flex">
        <div className="mb-4 flex items-center gap-2">
          <FolderIcon className="h-6 w-6" />
          <h2 className="text-lg font-medium">File Explorer</h2>
        </div>
        <nav className="flex flex-col gap-2">
          <Link
            href="#"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
            prefetch={false}
          >
            <ComputerIcon className="h-5 w-5" />
            This PC
          </Link>
          <Link
            href="#"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
            prefetch={false}
          >
            <FileTextIcon className="h-5 w-5" />
            Documents
          </Link>
          <Link
            href="#"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
            prefetch={false}
          >
            <DownloadIcon className="h-5 w-5" />
            Downloads
          </Link>
          <Link
            href="#"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
            prefetch={false}
          >
            <ImagesIcon className="h-5 w-5" />
            Pictures
          </Link>
          <Link
            href="#"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
            prefetch={false}
          >
            <Music2Icon className="h-5 w-5" />
            Music
          </Link>
          <Link
            href="#"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
            prefetch={false}
          >
            <VideoIcon className="h-5 w-5" />
            Videos
          </Link>
        </nav>
      </div>
      <div className="flex flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-4 border-b bg-background px-4 md:h-16 md:px-6">
          <Button variant="outline" size="icon" className="md:hidden">
            <MenuIcon className="h-5 w-5" />
            <span className="sr-only">Toggle sidebar</span>
          </Button>
          <div className="flex flex-1 items-center gap-4">
            <div className="relative flex-1">
              <SearchIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search files and folders..."
                className="w-full rounded-md bg-muted/40 pl-8 focus:bg-background"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon">
                  <LayoutGridIcon className="h-5 w-5" />
                  <span className="sr-only">View options</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>
                  <ListIcon className="mr-2 h-4 w-4" />
                  List
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <LayoutGridIcon className="mr-2 h-4 w-4" />
                  Grid
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <InfoIcon className="mr-2 h-4 w-4" />
                  Details
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon">
              <UploadIcon className="h-5 w-5" />
              <span className="sr-only">Upload</span>
            </Button>
            <Button variant="outline" size="icon">
              <FolderPlusIcon className="h-5 w-5" />
              <span className="sr-only">New folder</span>
            </Button>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-4 md:p-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            <div className="group relative flex flex-col items-center justify-center rounded-md border bg-muted/40 p-4 transition-colors hover:bg-muted">
              <FolderIcon className="h-12 w-12 text-muted-foreground" />
              <div className="mt-2 text-center text-sm font-medium">
                Documents
              </div>
              <div className="absolute inset-0 z-10 cursor-pointer" />
            </div>
            <div className="group relative flex flex-col items-center justify-center rounded-md border bg-muted/40 p-4 transition-colors hover:bg-muted">
              <FileIcon className="h-12 w-12 text-muted-foreground" />
              <div className="mt-2 text-center text-sm font-medium">
                file.txt
              </div>
              <div className="absolute inset-0 z-10 cursor-pointer" />
            </div>
            <div className="group relative flex flex-col items-center justify-center rounded-md border bg-muted/40 p-4 transition-colors hover:bg-muted">
              <ImageIcon className="h-12 w-12 text-muted-foreground" />
              <div className="mt-2 text-center text-sm font-medium">
                image.jpg
              </div>
              <div className="absolute inset-0 z-10 cursor-pointer" />
            </div>
            <div className="group relative flex flex-col items-center justify-center rounded-md border bg-muted/40 p-4 transition-colors hover:bg-muted">
              <VideoIcon className="h-12 w-12 text-muted-foreground" />
              <div className="mt-2 text-center text-sm font-medium">
                video.mp4
              </div>
              <div className="absolute inset-0 z-10 cursor-pointer" />
            </div>
            <div className="group relative flex flex-col items-center justify-center rounded-md border bg-muted/40 p-4 transition-colors hover:bg-muted">
              <Music2Icon className="h-12 w-12 text-muted-foreground" />
              <div className="mt-2 text-center text-sm font-medium">
                song.mp3
              </div>
              <div className="absolute inset-0 z-10 cursor-pointer" />
            </div>
            <div className="group relative flex flex-col items-center justify-center rounded-md border bg-muted/40 p-4 transition-colors hover:bg-muted">
              <FolderIcon className="h-12 w-12 text-muted-foreground" />
              <div className="mt-2 text-center text-sm font-medium">
                Downloads
              </div>
              <div className="absolute inset-0 z-10 cursor-pointer" />
            </div>
            <div className="group relative flex flex-col items-center justify-center rounded-md border bg-muted/40 p-4 transition-colors hover:bg-muted">
              <FileIcon className="h-12 w-12 text-muted-foreground" />
              <div className="mt-2 text-center text-sm font-medium">
                presentation.pptx
              </div>
              <div className="absolute inset-0 z-10 cursor-pointer" />
            </div>
            <div className="group relative flex flex-col items-center justify-center rounded-md border bg-muted/40 p-4 transition-colors hover:bg-muted">
              <FileSpreadsheetIcon className="h-12 w-12 text-muted-foreground" />
              <div className="mt-2 text-center text-sm font-medium">
                data.xlsx
              </div>
              <div className="absolute inset-0 z-10 cursor-pointer" />
            </div>
            <div className="group relative flex flex-col items-center justify-center rounded-md border bg-muted/40 p-4 transition-colors hover:bg-muted">
              <FileIcon className="h-12 w-12 text-muted-foreground" />
              <div className="mt-2 text-center text-sm font-medium">
                report.docx
              </div>
              <div className="absolute inset-0 z-10 cursor-pointer" />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
