import type { Metadata } from "next";
import { Geist, Geist_Mono, Fraunces, Karla } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display serif for dashboard page titles (UI/UX brief §3: high-contrast serif
// for display, sans for everything else). Warm + high-contrast to sit with the
// orange/plum palette rather than the cool elegance of a Didone.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "600"],
});

// Body / clean sans (UI/UX brief §3). Karla is the "everything else" face — it
// becomes the --font-sans in @theme (see globals.css). Geist stays loaded above
// so other routes can still reference it via --font-geist-sans.
const karla = Karla({
  variable: "--font-karla",
  subsets: ["latin"],
});

const description =
  "Your AI assistant that lives in WhatsApp — reminders, memory, calendar, money, health — no app, no login, just a message.";

export const metadata: Metadata = {
  metadataBase: new URL("https://app.askgogo.in"),
  title: "AskGogo",
  description,
  openGraph: {
    type: "website",
    siteName: "AskGogo",
    title: "AskGogo",
    description,
    url: "https://app.askgogo.in",
    images: [
      {
        url: "/askgogo-og.png",
        width: 1200,
        height: 630,
        alt: "AskGogo",
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
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} ${karla.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
