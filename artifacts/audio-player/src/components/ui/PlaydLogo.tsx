interface Props { size?: number }

/**
 * PLAYD headphones logo — purple neon / crystal style.
 * Single source of truth used by the AuthPage, Sidebar, and any other
 * place that needs the brand icon inline.
 *
 * All gradient / filter IDs are prefixed with "pl_" so they don't
 * collide with other inline SVGs on the same page.
 */
export function PlaydLogo({ size = 36 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 180 180" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        {/* Background */}
        <radialGradient id="pl_bg" cx="50%" cy="42%" r="65%">
          <stop offset="0%"   stopColor="#180d38"/>
          <stop offset="100%" stopColor="#07091a"/>
        </radialGradient>

        {/* Headband gradient — light-pink at top → deep violet at bottom */}
        <linearGradient id="pl_hb" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stopColor="#f0d0ff"/>
          <stop offset="28%"  stopColor="#d946ef"/>
          <stop offset="62%"  stopColor="#7e22ce"/>
          <stop offset="100%" stopColor="#3b0764" stopOpacity="0.85"/>
        </linearGradient>

        {/* Left cup — lighter at top-left corner */}
        <linearGradient id="pl_lc" x1="20%" y1="0%" x2="80%" y2="100%">
          <stop offset="0%"   stopColor="#e0aaff"/>
          <stop offset="42%"  stopColor="#a855f7"/>
          <stop offset="100%" stopColor="#2e1065"/>
        </linearGradient>

        {/* Right cup — lighter at top-right corner */}
        <linearGradient id="pl_rc" x1="80%" y1="0%" x2="20%" y2="100%">
          <stop offset="0%"   stopColor="#e0aaff"/>
          <stop offset="42%"  stopColor="#a855f7"/>
          <stop offset="100%" stopColor="#2e1065"/>
        </linearGradient>

        {/* White crystal highlight at top of headband arc */}
        <radialGradient id="pl_cap" cx="50%" cy="20%" r="70%">
          <stop offset="0%"   stopColor="white"   stopOpacity="0.95"/>
          <stop offset="45%"  stopColor="#e0aaff" stopOpacity="0.45"/>
          <stop offset="100%" stopColor="#9333ea" stopOpacity="0"/>
        </radialGradient>

        {/* Bloom glow (very soft, large radius) */}
        <filter id="pl_bloom" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="15"/>
        </filter>

        {/* Soft glow for cap highlight */}
        <filter id="pl_shine" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="5"/>
        </filter>

        {/* Clip to rounded frame */}
        <clipPath id="pl_frame">
          <rect width="180" height="180" rx="38"/>
        </clipPath>
      </defs>

      {/* ── Background ── */}
      <rect width="180" height="180" rx="38" fill="url(#pl_bg)"/>

      {/* ── Bloom layer (blurred, behind everything) ── */}
      <g filter="url(#pl_bloom)" clipPath="url(#pl_frame)" opacity="0.7">
        {/* Headband bloom */}
        <path d="M 34,110 A 56,56 0 0,1 146,110"
              stroke="#9d4fef" strokeWidth="28" strokeLinecap="round" fill="none"/>
        {/* Left cup bloom */}
        <rect x="12" y="100" width="44" height="58" rx="14" fill="#8b21e8"/>
        {/* Right cup bloom */}
        <rect x="124" y="100" width="44" height="58" rx="14" fill="#8b21e8"/>
      </g>

      {/* ── Left ear cup ── */}
      <rect x="12" y="100" width="44" height="58" rx="14"
            fill="url(#pl_lc)" stroke="#c084fc" strokeWidth="1.5" strokeOpacity="0.75"/>
      {/* Left cushion ring */}
      <ellipse cx="34" cy="130" rx="12" ry="16"
               fill="none" stroke="#d8b4fe" strokeWidth="1.5" strokeOpacity="0.4"/>
      {/* Left inner centre dot */}
      <ellipse cx="34" cy="130" rx="5" ry="6" fill="#c084fc" opacity="0.22"/>

      {/* ── Right ear cup ── */}
      <rect x="124" y="100" width="44" height="58" rx="14"
            fill="url(#pl_rc)" stroke="#c084fc" strokeWidth="1.5" strokeOpacity="0.75"/>
      {/* Right cushion ring */}
      <ellipse cx="146" cy="130" rx="12" ry="16"
               fill="none" stroke="#d8b4fe" strokeWidth="1.5" strokeOpacity="0.4"/>
      {/* Right inner centre dot */}
      <ellipse cx="146" cy="130" rx="5" ry="6" fill="#c084fc" opacity="0.22"/>

      {/* ── Headband ── */}
      {/* Main gradient stroke */}
      <path d="M 34,110 A 56,56 0 0,1 146,110"
            stroke="url(#pl_hb)" strokeWidth="16" strokeLinecap="round" fill="none"/>
      {/* Shimmer overlay (thin highlight on edge) */}
      <path d="M 34,110 A 56,56 0 0,1 146,110"
            stroke="#c084fc" strokeWidth="16" strokeLinecap="round" fill="none" opacity="0.32"/>

      {/* ── Crystal cap highlight at top of arc (90, 54) ── */}
      <ellipse cx="90" cy="55" rx="18" ry="11" fill="url(#pl_cap)" filter="url(#pl_shine)"/>
      <ellipse cx="90" cy="54" rx="8"  ry="5"  fill="white" opacity="0.78"/>
    </svg>
  );
}
