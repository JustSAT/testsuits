import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// The project the user is working in, Qase style: every project page lives
// under /projects/:id/…, and the last one opened is remembered so global
// entry points (/, /runs, /matrix) land back in it.

const KEY = "ts_project";

/** The project in the URL, if any. */
export function projectIdFromPath(pathname: string): string | null {
  return pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null;
}

export function rememberedProjectId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** The current project: the one in the URL, else the last one opened. Remembers it. */
export function useCurrentProjectId(): string | null {
  const { pathname } = useLocation();
  const fromPath = projectIdFromPath(pathname);
  useEffect(() => {
    if (fromPath) {
      try {
        localStorage.setItem(KEY, fromPath);
      } catch {
        // Private mode: the URL still carries the project.
      }
    }
  }, [fromPath]);
  return fromPath ?? rememberedProjectId();
}

/** Forget a remembered project that no longer exists or is not visible. */
export function forgetProject(id: string) {
  try {
    if (localStorage.getItem(KEY) === id) localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
