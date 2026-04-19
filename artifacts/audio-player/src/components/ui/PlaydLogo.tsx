interface Props { size?: number }

/**
 * PLAYD brand icon. Uses the pre-rendered PNG so the quality matches
 * the PWA home-screen icon exactly with no white-corner artifacts.
 */
export function PlaydLogo({ size = 36 }: Props) {
  const base = import.meta.env.BASE_URL ?? '/';
  return (
    <img
      src={`${base}icons/icon-192.png`}
      alt="PLAYD"
      width={size}
      height={size}
      style={{ borderRadius: Math.round(size * 0.21), display: 'block' }}
    />
  );
}
