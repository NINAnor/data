interface Props {
  preview: string;
  alt: string;
}

export default function DatasetPreview({ preview, alt }: Props) {
  return (
    <div className="relative h-24 max-h-24 w-full overflow-hidden">
      <div
        className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-secondary/10 via-base-200 to-accent/15"
        aria-hidden="true"
      >
        <span className="rounded-full bg-base-100/70 p-2.5 text-secondary shadow-sm">
          <svg
            className="h-8 w-8"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 48 48"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="7" y="9" width="34" height="30" rx="9" fill="currentColor" opacity=".08" />
            <circle cx="31" cy="19" r="4" fill="#cc8614" stroke="none" />
            <path d="m11 34 9-11 7 8 5-6 5 6v3H11Z" fill="currentColor" opacity=".25" />
            <path d="m11 34 9-11 7 8 5-6 5 6M11 34h26" />
          </svg>
        </span>
      </div>
      {preview && (
        <img
          className="absolute inset-0 h-full max-h-24 w-full object-cover"
          src={preview}
          alt={alt}
          loading="lazy"
          decoding="async"
        />
      )}
    </div>
  );
}
