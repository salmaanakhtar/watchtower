// BrandMark per DESIGN_LANGUAGE.md §6.1: a beacon/eye glyph in guardian teal,
// monochrome, no gradients.
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg bg-(--wt-guardian-600) text-white${className ? ` ${className}` : ""}`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <path
          d="M12 4c-4 0-7 3-7 8v2l-1 3h16l-1-3v-2c0-5-3-8-7-8Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="13" r="1.6" fill="currentColor" />
      </svg>
    </span>
  );
}
