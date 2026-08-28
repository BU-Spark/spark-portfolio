"use client";
// Guards against losing unsaved edits. While `isDirty`:
//   - adds a native beforeunload warning (tab close / reload / external nav)
//   - guardedPush(href) confirms before an in-app router.push
import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";

export function useUnsavedGuard(isDirty: boolean) {
  const router = useRouter();

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Required for the prompt to show in some browsers.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  const guardedPush = useCallback(
    (href: string) => {
      if (
        isDirty &&
        !window.confirm("You have unsaved changes. Leave this page and discard them?")
      ) {
        return;
      }
      router.push(href);
    },
    [isDirty, router]
  );

  return { guardedPush };
}
