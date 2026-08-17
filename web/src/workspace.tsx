import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type DocumentSource = "upload" | "paste" | "active-prompt";

export interface WorkspaceDocument {
  name: string;
  content: string;
  source: DocumentSource;
  loadedAt: string;
}

export interface DocumentStats {
  chars: number;
  words: number;
  lines: number;
}

interface WorkspaceValue {
  document: WorkspaceDocument | null;
  /** Content edited in the editor but not yet re-saved anywhere. */
  dirty: boolean;
  loadDocument: (name: string, content: string, source: DocumentSource) => void;
  /** Live edits from the Markdown editor. Keeps name/source, marks dirty. */
  updateContent: (content: string) => void;
  clearDocument: () => void;
  /** Marks the current content as the new clean baseline (after a save). */
  markClean: () => void;
}

const STORAGE_KEY = "prompt-refiner.workspace.v1";

const WorkspaceContext = createContext<WorkspaceValue | undefined>(undefined);

interface StoredWorkspace {
  document: WorkspaceDocument | null;
  dirty: boolean;
}

function readStored(): StoredWorkspace {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { document: null, dirty: false };
    const parsed = JSON.parse(raw) as Partial<StoredWorkspace>;
    const doc = parsed.document;
    if (
      doc &&
      typeof doc.name === "string" &&
      typeof doc.content === "string" &&
      doc.content.length > 0
    ) {
      return {
        document: doc as WorkspaceDocument,
        dirty: Boolean(parsed.dirty),
      };
    }
  } catch {
    /* corrupt or unavailable storage — start empty */
  }
  return { document: null, dirty: false };
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(readStored, []);
  const [document, setDocument] = useState<WorkspaceDocument | null>(
    initial.document,
  );
  const [dirty, setDirty] = useState(initial.dirty);

  useEffect(() => {
    try {
      if (document) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ document, dirty }));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      /* storage unavailable — in-memory state still works */
    }
  }, [document, dirty]);

  const loadDocument = useCallback(
    (name: string, content: string, source: DocumentSource) => {
      setDocument({
        name,
        content,
        source,
        loadedAt: new Date().toISOString(),
      });
      setDirty(false);
    },
    [],
  );

  const updateContent = useCallback((content: string) => {
    setDocument((current) => (current ? { ...current, content } : current));
    setDirty(true);
  }, []);

  const clearDocument = useCallback(() => {
    setDocument(null);
    setDirty(false);
  }, []);

  const markClean = useCallback(() => setDirty(false), []);

  const value = useMemo<WorkspaceValue>(
    () => ({
      document,
      dirty,
      loadDocument,
      updateContent,
      clearDocument,
      markClean,
    }),
    [document, dirty, loadDocument, updateContent, clearDocument, markClean],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceValue {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return context;
}

export function documentStats(content: string): DocumentStats {
  const words = content.trim().match(/\S+/g);
  return {
    chars: content.length,
    words: words ? words.length : 0,
    lines: content.length === 0 ? 0 : content.split("\n").length,
  };
}
