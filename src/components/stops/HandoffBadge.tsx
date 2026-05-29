/** Small badge for synthetic / handoff stops (meet-up points, not customer deliveries). */
export function HandoffBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-violet-100 text-violet-800 ${className}`.trim()}
    >
      HANDOFF
    </span>
  );
}
