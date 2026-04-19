interface Props { size?: number }

export function PlaydLogo({ size = 36 }: Props) {
  const base = import.meta.env.BASE_URL ?? '/';
  return (
    <img
      src={`${base}icons/icon-192.png`}
      alt="PLAYD"
      width={size}
      height={size}
      style={{ display: 'block', imageRendering: 'auto' }}
    />
  );
}
