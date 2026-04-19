interface Props { size?: number }

export function PlaydLogo({ size = 36 }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      width={size}
      height={size}
      aria-hidden="true"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <path d="M12 2C6.477 2 2 6.477 2 12v5a3 3 0 003 3h1a1 1 0 001-1v-5a1 1 0 00-1-1H4v-1a8 8 0 0116 0v1h-2a1 1 0 00-1 1v5a1 1 0 001 1h1a3 3 0 003-3v-5c0-5.523-4.477-10-10-10z" />
    </svg>
  );
}
