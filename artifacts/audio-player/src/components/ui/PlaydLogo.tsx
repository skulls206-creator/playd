interface Props { size?: number }

/**
 * PLAYD headphones logo.
 * All gradient/filter IDs are prefixed "pl_" to avoid collisions
 * when multiple instances appear on the same page.
 */
export function PlaydLogo({ size = 36 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 180 180" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        {/* Very dark navy background */}
        <radialGradient id="pl_bg" cx="50%" cy="45%" r="70%">
          <stop offset="0%"   stopColor="#18083e"/>
          <stop offset="55%"  stopColor="#0c0520"/>
          <stop offset="100%" stopColor="#060210"/>
        </radialGradient>

        {/* Headband: bright lavender at very top → vivid magenta-purple → deep violet */}
        <linearGradient id="pl_hb" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stopColor="#efc8ff"/>
          <stop offset="22%"  stopColor="#d946ef"/>
          <stop offset="58%"  stopColor="#8b21e8"/>
          <stop offset="100%" stopColor="#6b1fc8"/>
        </linearGradient>

        {/* Left cup — lighter at top-left */}
        <radialGradient id="pl_lc" cx="32%" cy="26%" r="72%" gradientUnits="objectBoundingBox">
          <stop offset="0%"   stopColor="#b87ef5"/>
          <stop offset="50%"  stopColor="#7c3aed"/>
          <stop offset="100%" stopColor="#4a1a95"/>
        </radialGradient>

        {/* Right cup — lighter at top-right */}
        <radialGradient id="pl_rc" cx="68%" cy="26%" r="72%" gradientUnits="objectBoundingBox">
          <stop offset="0%"   stopColor="#b87ef5"/>
          <stop offset="50%"  stopColor="#7c3aed"/>
          <stop offset="100%" stopColor="#4a1a95"/>
        </radialGradient>

        {/* Inner cup oval — dark indigo with slight top glow */}
        <radialGradient id="pl_ov" cx="40%" cy="30%" r="68%">
          <stop offset="0%"   stopColor="#6b28d9" stopOpacity="0.9"/>
          <stop offset="100%" stopColor="#1c0d38"/>
        </radialGradient>

        {/* Crystal cap highlight */}
        <radialGradient id="pl_cap" cx="50%" cy="25%" r="70%">
          <stop offset="0%"   stopColor="white"   stopOpacity="1"/>
          <stop offset="35%"  stopColor="#f0d0ff" stopOpacity="0.85"/>
          <stop offset="100%" stopColor="#9333ea" stopOpacity="0"/>
        </radialGradient>

        {/* Very wide bloom for the ambient glow */}
        <filter id="pl_wide" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="24"/>
        </filter>

        {/* Medium bloom for cup/headband halos */}
        <filter id="pl_mid" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="14"/>
        </filter>

        {/* Tight glow for the crystal cap */}
        <filter id="pl_shine" x="-180%" y="-180%" width="460%" height="460%">
          <feGaussianBlur stdDeviation="8"/>
        </filter>

        <clipPath id="pl_frame">
          <rect width="180" height="180" rx="38"/>
        </clipPath>
      </defs>

      {/* ── Background ── */}
      <rect width="180" height="180" rx="38" fill="url(#pl_bg)"/>

      {/* ── Ambient purple glow — big radial halo, behind everything ── */}
      <ellipse cx="90" cy="100" rx="85" ry="78" fill="#7c3aed" opacity="0.15" filter="url(#pl_wide)" clipPath="url(#pl_frame)"/>
      <ellipse cx="90" cy="88"  rx="58" ry="52" fill="#9333ea" opacity="0.20" filter="url(#pl_mid)"  clipPath="url(#pl_frame)"/>

      {/* ── Wide bloom layer — all shapes blurred behind crisp artwork ── */}
      <g filter="url(#pl_wide)" clipPath="url(#pl_frame)" opacity="0.75">
        <path d="M 34,108 A 56,56 0 0,1 146,108"
              stroke="#8b21e8" strokeWidth="32" strokeLinecap="round" fill="none"/>
        <rect x="5"   y="94" width="58" height="66" rx="20" fill="#7c3aed"/>
        <rect x="117" y="94" width="58" height="66" rx="20" fill="#7c3aed"/>
      </g>

      {/* ── Left ear cup ── */}
      <rect x="5" y="94" width="58" height="66" rx="20"
            fill="url(#pl_lc)" stroke="#c090f8" strokeWidth="2.5" strokeOpacity="0.6"/>
      {/* Left inner oval (driver face) */}
      <ellipse cx="34" cy="128" rx="18" ry="22"
               fill="url(#pl_ov)" stroke="#9d64f0" strokeWidth="2" strokeOpacity="0.55"/>

      {/* ── Right ear cup ── */}
      <rect x="117" y="94" width="58" height="66" rx="20"
            fill="url(#pl_rc)" stroke="#c090f8" strokeWidth="2.5" strokeOpacity="0.6"/>
      {/* Right inner oval */}
      <ellipse cx="146" cy="128" rx="18" ry="22"
               fill="url(#pl_ov)" stroke="#9d64f0" strokeWidth="2" strokeOpacity="0.55"/>

      {/* ── Headband medium bloom (halo just for the tube) ── */}
      <path d="M 34,108 A 56,56 0 0,1 146,108"
            stroke="#a855f7" strokeWidth="28" strokeLinecap="round" fill="none"
            filter="url(#pl_mid)" opacity="0.55" clipPath="url(#pl_frame)"/>

      {/* ── Headband main tube ── */}
      <path d="M 34,108 A 56,56 0 0,1 146,108"
            stroke="url(#pl_hb)" strokeWidth="28" strokeLinecap="round" fill="none"/>
      {/* Convex highlight — brighter stripe running along tube face */}
      <path d="M 34,108 A 56,56 0 0,1 146,108"
            stroke="#efc8ff" strokeWidth="11" strokeLinecap="round" fill="none" opacity="0.30"/>

      {/* ── Crystal cap at top of arc (90, 52) ── */}
      <ellipse cx="90" cy="53" rx="26" ry="18" fill="#d4a8ff" filter="url(#pl_shine)" opacity="0.75"/>
      <ellipse cx="90" cy="52" rx="13" ry="9"  fill="url(#pl_cap)"/>
      <ellipse cx="90" cy="51" rx="5.5" ry="4" fill="white" opacity="0.98"/>
    </svg>
  );
}
