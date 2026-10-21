/** Damla: Pamukkale logotype, drawn in code: a water drop holding three travertine steps and a turquoise pool, the
 * wordmark and the place name. Original artwork. `compact` drops the place name line. */
export function DamlaDropGlyph({ className, gold = false }: { className?: string; gold?: boolean }) {
  const id = gold ? 'dmG' : 'dmB';
  return (
    <svg viewBox="0 0 64 80" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}Body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={gold ? '#fff6d0' : '#e9fdff'} /><stop offset=".55" stopColor={gold ? '#ffd45e' : '#7fe6ee'} /><stop offset="1" stopColor={gold ? '#d18a12' : '#1d9fb8'} />
        </linearGradient>
        <clipPath id={`${id}Clip`}><path d="M32 3C40 16 58 34 58 50a26 26 0 0 1-52 0C6 34 24 16 32 3Z" /></clipPath>
      </defs>
      <path d="M32 3C40 16 58 34 58 50a26 26 0 0 1-52 0C6 34 24 16 32 3Z" fill={`url(#${id}Body)`} />
      <g clipPath={`url(#${id}Clip)`}>
        <path d="M2 50h60v30H2z" fill={gold ? '#ffe9a6' : '#f6f2e8'} />
        <path d="M2 50q8 4 15 0t15 0 15 0 15 0" fill="none" stroke={gold ? '#c99325' : '#c9bfae'} strokeWidth="1.6" />
        <path d="M10 58h44v22H10z" fill={gold ? '#ffdf86' : '#ece6da'} />
        <ellipse cx="32" cy="58" rx="16" ry="3.4" fill={gold ? '#ffcf3d' : '#3fd0d4'} />
        <path d="M18 67h28v13H18z" fill={gold ? '#f7cf63' : '#e2dacb'} />
        <ellipse cx="32" cy="67" rx="9" ry="2.6" fill={gold ? '#ffc02a' : '#22b4c6'} />
      </g>
      <path d="M22 26c-3 5-5 10-5 15" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" fill="none" opacity=".75" />
      <path d="M32 3C40 16 58 34 58 50a26 26 0 0 1-52 0C6 34 24 16 32 3Z" fill="none" stroke="#fff" strokeOpacity=".7" strokeWidth="1.6" />
    </svg>
  );
}

export function DamlaLogo({ compact = false, className, place = 'PAMUKKALE' }: { compact?: boolean; className?: string; place?: string }) {
  return (
    <svg viewBox={compact ? '0 0 240 80' : '0 0 240 100'} className={className} role="img" aria-label="Damla: Pamukkale" focusable="false">
      <defs>
        <linearGradient id="dmWord" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset=".6" stopColor="#dff8f7" /><stop offset="1" stopColor="#8fe3e6" /></linearGradient>
      </defs>
      <g transform="translate(4 4) scale(.9)"><DamlaDropGlyphInline /></g>
      <text x="70" y="56" fill="url(#dmWord)" fontFamily="var(--font-barlow), sans-serif" fontWeight="700" fontSize="46" letterSpacing="4" stroke="#0c3a48" strokeWidth=".8" paintOrder="stroke">DAMLA</text>
      {!compact && <text x="72" y="84" fill="#9fe7e6" fontFamily="var(--font-barlow), sans-serif" fontWeight="600" fontSize="15" letterSpacing="7.2">{place}</text>}
    </svg>
  );
}
/** The glyph as an SVG group (inside another SVG). */
function DamlaDropGlyphInline() {
  return (
    <g>
      <path d="M32 3C40 16 58 34 58 50a26 26 0 0 1-52 0C6 34 24 16 32 3Z" fill="#7fe6ee" />
      <path d="M8 52q6 3 12 0t12 0 12 0 12 0v14a24 24 0 0 1-48 0z" fill="#f6f2e8" />
      <ellipse cx="32" cy="60" rx="15" ry="3.2" fill="#3fd0d4" />
      <ellipse cx="32" cy="69" rx="8" ry="2.4" fill="#22b4c6" />
      <path d="M22 26c-3 5-5 10-5 15" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" fill="none" opacity=".75" />
      <path d="M32 3C40 16 58 34 58 50a26 26 0 0 1-52 0C6 34 24 16 32 3Z" fill="none" stroke="#fff" strokeOpacity=".8" strokeWidth="1.6" />
    </g>
  );
}
