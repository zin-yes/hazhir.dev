import type { ComponentType } from "react";
import CVDocument from "./CV";
import AtlasDocument from "./Portfolio/Atlas";
import GammaEngineDocument from "./Portfolio/gamma-engine";
import HazhirDevDocument from "./Portfolio/hazhir.dev";
import MetricJournalDocument from "./Portfolio/metricjournal";

export type DocumentArticle = {
  id: string;
  title: string;
  fileName: string;
  path: string;
  folder?: string;
  Component: ComponentType;
};

export const documents: DocumentArticle[] = [
  {
    id: "CV.document",
    title: "CV",
    fileName: "CV.document",
    path: "CV.document",
    Component: CVDocument,
  },
  {
    id: "Portfolio/Atlas.pdf",
    title: "Atlas",
    fileName: "Atlas.pdf",
    folder: "Portfolio",
    path: "Portfolio/Atlas.pdf",
    Component: AtlasDocument,
  },
  {
    id: "Portfolio/gamma-engine.pdf",
    title: "Gamma Engine",
    fileName: "gamma-engine.pdf",
    folder: "Portfolio",
    path: "Portfolio/gamma-engine.pdf",
    Component: GammaEngineDocument,
  },
  {
    id: "Portfolio/hazhir.dev.pdf",
    title: "hazhir.dev",
    fileName: "hazhir.dev.pdf",
    folder: "Portfolio",
    path: "Portfolio/hazhir.dev.pdf",
    Component: HazhirDevDocument,
  },
  {
    id: "Portfolio/metricjournal.pdf",
    title: "Metric Journal",
    fileName: "metricjournal.pdf",
    folder: "Portfolio",
    path: "Portfolio/metricjournal.pdf",
    Component: MetricJournalDocument,
  },
];

const documentsById = new Map(documents.map((doc) => [doc.id, doc]));

export function getDocumentById(id?: string) {
  if (!id) return undefined;
  return documentsById.get(id);
}
