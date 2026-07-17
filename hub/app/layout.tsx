import type { Metadata } from "next";
import { Space_Grotesk, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

// The prototype ships the "Grotesk" pairing: Space Grotesk (display) + IBM Plex
// Sans (body) + IBM Plex Mono (eyebrows/labels/counts). next/font self-hosts
// these and exposes each as a CSS variable consumed by globals.css.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://sparkshowcase.vercel.app"),
  title: "BU Spark! Project Gallery",
  description:
    "Browse student-built projects from BU Spark! practicums, and co-labs — searchable by discipline, program, partner, and the technologies behind each build.",
  openGraph: {
    title: "BU Spark! Project Gallery",
    description: "Student-built projects, with real partners and real impact.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // The font variables MUST live on <html> (:root), because globals.css
    // declares --display/--body/--mono on :root referencing them. If they sat
    // on <body> instead, var(--font-body) would be empty at :root and the
    // font-family would collapse to an invalid value → browser serif default.
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${ibmPlexSans.variable} ${ibmPlexMono.variable}`}
    >
      <body>
        {children}
        {/* Privacy-friendly, cookieless web analytics + Core Web Vitals. Both
            no-op locally and until enabled in the Vercel project dashboard. */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
