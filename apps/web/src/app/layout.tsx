import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { AppShell } from "@/components/layout/AppShell";

// Premium Fonts - Space Grotesk (similar to Overused Grotesk)
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "HeadlessX v2.1.2",
  description: "Advanced Stealth Scraping Engine",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="light" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} font-sans antialiased bg-background text-foreground [font-synthesis-weight:none]`}
      >
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
