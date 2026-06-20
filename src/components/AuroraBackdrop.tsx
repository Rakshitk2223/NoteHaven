/**
 * AuroraBackdrop — the signature ambient layer. Two slowly drifting indigo/cyan
 * orbs (defined in index.css as `.aurora-backdrop`) sit fixed behind the whole
 * app at z-0. Page roots are transparent so this glows through behind cards.
 * Rendered once, globally, in App.tsx. Honours prefers-reduced-motion.
 */
export function AuroraBackdrop() {
  return <div className="aurora-backdrop" aria-hidden="true" />;
}

export default AuroraBackdrop;
