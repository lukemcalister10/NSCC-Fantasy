/**
 * Stub body for routes scaffolded by the shared-chrome slice but built later
 * (Standing Rule 9b): S-A owns /admin/*, S-C owns /team/*. Each stub route keeps
 * its own module so those slices replace only files they own; this component is
 * the single piece they share.
 *
 * CLEANUP: once both slices have replaced their stubs this file is orphaned.
 * Neither slice can safely delete it without knowing the other has finished, so
 * removal belongs to a later polish slice, not to either of them.
 */
export function Placeholder({ title }: { title: string }) {
  return (
    <div className="page">
      <h1 className="page-title">{title}</h1>
      <p className="page-sub">Not built yet.</p>
    </div>
  );
}
