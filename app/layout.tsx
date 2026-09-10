import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif, Manrope } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// AskGogo website display face. Keep the product shell and public story feeling
// like one brand rather than two separate applications.
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const description =
  "Meet Gogo — your personal AI that remembers, plans, acts and keeps working when you're away.";

export const metadata: Metadata = {
  metadataBase: new URL("https://app.askgogo.in"),
  title: "AskGogo — Meet Gogo",
  description,
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
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} ${manrope.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
