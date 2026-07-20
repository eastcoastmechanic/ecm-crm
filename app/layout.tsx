import type { Metadata } from "next";
import { DM_Sans, DM_Mono, Anton } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  weight: ["400", "500"],
  subsets: ["latin"],
});

const anton = Anton({
  variable: "--font-syne",
  weight: ["400"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ECM Platform",
  description: "CRM, billing, and diagnostics for East Coast Mechanical",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${dmMono.variable} ${anton.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-navy text-white font-sans">
        {children}
      </body>
    </html>
  );
}
