/**
 * AtlasMark — the Atlas brand glyph.
 *
 * A tilted celestial globe / astrolabe: outer sphere, a perspective equator,
 * a meridian ring, and a polar axis raked to ~22° like an antique gilded
 * globe on its stand. Line-art, inherits `currentColor` so it can be gold on
 * ink in the brand panel or foreground anywhere else.
 *
 * Deliberately NOT a generic "sparkle in a rounded gradient square" — the
 * name Atlas is the titan who holds up the heavens and the word for a book of
 * maps, so the mark is cartographic + celestial, not decorative AI filler.
 */
export function AtlasMark({
  className,
  strokeWidth = 1.3,
}: {
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      {/* sphere */}
      <circle cx="16" cy="16" r="12.6" />
      <g transform="rotate(-22 16 16)">
        {/* equator (foreshortened) */}
        <ellipse cx="16" cy="16" rx="12.6" ry="4.5" opacity="0.9" />
        {/* meridian ring */}
        <ellipse cx="16" cy="16" rx="4.7" ry="12.6" opacity="0.9" />
        {/* polar axis */}
        <line
          x1="16"
          y1="1.6"
          x2="16"
          y2="30.4"
          strokeWidth={strokeWidth * 0.7}
          opacity="0.5"
        />
        {/* poles */}
        <circle cx="16" cy="3.4" r="0.9" fill="currentColor" stroke="none" />
        <circle cx="16" cy="28.6" r="0.9" fill="currentColor" stroke="none" />
      </g>
    </svg>
  );
}
