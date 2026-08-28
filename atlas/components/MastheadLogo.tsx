"use client";
// Tiny client widget: the masthead logo <img> that hides itself if the file is
// missing (onError). Isolated so detail/masthead views can stay server
// components. Mirrors the SparkLogo pattern in components/Gallery.tsx.
import type React from "react";

export default function MastheadLogo({
  src,
  alt,
  style,
  className,
}: {
  src: string;
  alt: string;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      onError={(e) => {
        e.currentTarget.style.display = "none";
      }}
      style={style}
    />
  );
}
