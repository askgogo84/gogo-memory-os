import type { Metadata } from "next";
import { Geist_Mono, Newsreader, Onest } from "next/font/google";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Final AskGogo website typography. The logged-in product uses the exact same
// editorial/display voice so the handoff from askgogo.in to app.askgogo.in feels
// like one product, not a separate SaaS dashboard.
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
});

const onest = Onest({
  variable: "--font-onest",
  subsets: ["latin"],
});

const description =
  "Meet Gogo — your personal AI that remembers, plans, acts and keeps working when you're away.";

export const metadata: Metadata = {
  metadataBase: new URL("https://app.askgogo.in"),
  title: "AskGogo — Meet Gogo",
  description,
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: "/icon.svg",
  },
  openGraph: {
    type: "website",
    siteName: "AskGogo",
    title: "AskGogo — Meet Gogo",
    description,
    url: "https://app.askgogo.in",
    images: [
      {
        url: "/askgogo-og.png",
        width: 1200,
        height: 630,
        alt: "AskGogo — Meet Gogo",
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistMono.variable} ${newsreader.variable} ${onest.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
