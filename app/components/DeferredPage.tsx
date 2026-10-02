import { Component, Suspense, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Loading } from "./states";

class PageErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) {
      return (
        <div className="state error" role="alert">
          <strong>This page couldn’t load.</strong>
          <span>Check your connection, then reload the page.</span>
          <button type="button" className="btn-ghost" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function DeferredPage({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <PageErrorBoundary key={location.pathname}>
      <Suspense fallback={<Loading label="Loading page…" />}>{children}</Suspense>
    </PageErrorBoundary>
  );
}
