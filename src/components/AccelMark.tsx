/** Accel's mark: a forward-leaning double chevron ("accelerate") on the red orb. */
export function AccelMark({ className }: { className?: string }) {
  return (
    <span className={className ? `orb ${className}` : 'orb'} aria-hidden="true">
      <svg viewBox="0 0 28 28" fill="none">
        <path d="M6 7l7 7-7 7" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M14 7l7 7-7 7" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
