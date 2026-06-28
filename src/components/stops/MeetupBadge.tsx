/** Small badge for customer stops that also include a driver meet-up instruction. */
export function MeetupBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-violet-100 text-violet-800 ${className}`.trim()}
    >
      MEET-UP
    </span>
  );
}
