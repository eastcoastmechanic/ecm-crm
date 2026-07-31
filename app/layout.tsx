import type { Metadata, Viewport } from "next";
import { DM_Sans, DM_Mono, Orbitron } from "next/font/google";
import ServiceWorkerRegister from "./service-worker-register";
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

const orbitron = Orbitron({
  variable: "--font-syne",
  weight: ["700", "800", "900"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ECM Platform",
  description: "CRM, billing, and diagnostics for East Coast Mechanical",
};

export const viewport: Viewport = {
  themeColor: "#0a1628",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${dmMono.variable} ${orbitron.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-navy text-white font-sans">
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
