"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";
import type { DocumentArticle } from "./articles";
import { documents, getDocumentById } from "./articles";

export default function DocumentViewerApplication({
  id,
  mode = "full",
}: {
  id?: string;
  mode?: "full" | "single";
}) {
  const [selectedId, setSelectedId] = useState<string | undefined>(
    id ?? documents[0]?.id
  );

  useEffect(() => {
    if (id) {
      setSelectedId(id);
    }
  }, [id]);

  const selected = useMemo(() => {
    return getDocumentById(selectedId) ?? documents[0];
  }, [selectedId]);

  const groupedDocuments = useMemo(() => {
    return documents.reduce<Record<string, DocumentArticle[]>>((acc, doc) => {
      const key = doc.folder ?? "Documents";
      if (!acc[key]) acc[key] = [];
      acc[key].push(doc);
      return acc;
    }, {});
  }, []);

  const missingRequested = Boolean(id && !getDocumentById(id));

  if (!documents.length) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
        No documents found in the articles folder.
      </div>
    );
  }

  if (mode === "single") {
    return (
      <div className="w-full h-full bg-background text-foreground">
        <ScrollArea className="h-full">
          <div className="px-5 py-4 space-y-4">
            {selected ? <selected.Component /> : null}
          </div>
        </ScrollArea>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-background text-foreground flex">
      <aside className="w-64 border-r border-border/60 flex flex-col">
        <div className="px-4 py-3 text-sm font-semibold">Documents</div>
        <ScrollArea className="flex-1">
          <div className="px-2 pb-2 space-y-4">
            {Object.entries(groupedDocuments).map(([group, docs]) => (
              <div key={group}>
                <div className="px-2 text-xs uppercase tracking-wide text-muted-foreground">
                  {group}
                </div>
                <ul className="mt-2">
                  {docs.map((doc) => {
                    const isActive = doc.id === selected?.id;
                    return (
                      <li key={doc.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(doc.id)}
                          className={cn(
                            "w-full text-left rounded-md px-3 py-2 transition-colors",
                            "hover:bg-accent hover:text-accent-foreground",
                            isActive && "bg-accent text-accent-foreground"
                          )}
                        >
                          <div className="text-sm font-medium">
                            {doc.fileName}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {doc.path}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </ScrollArea>
      </aside>

      <div className="flex-1 flex flex-col">
        <div className="border-b border-border/60 px-5 py-4">
          <div className="text-lg font-semibold">{selected?.title}</div>
          <div className="text-sm text-muted-foreground">
            {selected?.path}
          </div>
          {missingRequested && (
            <div className="mt-2 text-xs text-destructive">
              Requested id "{id}" was not found. Showing the first available
              document instead.
            </div>
          )}
        </div>
        <ScrollArea className="flex-1">
          <div className="px-5 py-4 space-y-4">
            {selected ? <selected.Component /> : null}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
