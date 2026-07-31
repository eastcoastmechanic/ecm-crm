import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import ChatWidget from "./ChatWidget";

export const metadata: Metadata = {
  title: "East Coast Mechanical | Heating, Cooling & Air Quality",
  description:
    "Heating, cooling, ductless, and ductwork service for the South Shore through the Cape and Islands. Book online or chat with our AI assistant — 24/7 emergency service, factory-trained technicians, 100% guarantee.",
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="relative border-b border-white/6 bg-navy after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-gradient-to-r after:from-accent after:via-gold after:to-transparent">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-5 gap-y-2 px-6 py-3">
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            <Image src="/logo.png" alt="ECM logo" width={44} height={44} className="shrink-0" />
            <span className="whitespace-nowrap font-display text-base font-bold tracking-wide">
              East Coast Mechanical
            </span>
          </Link>
          <nav className="no-scrollbar flex min-w-0 items-center gap-5 overflow-x-auto text-sm">
            <Link href="/" className="shrink-0 whitespace-nowrap text-g300 transition-colors hover:text-white">
              Home
            </Link>
            <Link href="/services" className="shrink-0 whitespace-nowrap text-g300 transition-colors hover:text-white">
              Services
            </Link>
            <Link href="/about" className="shrink-0 whitespace-nowrap text-g300 transition-colors hover:text-white">
              About
            </Link>
            <Link href="/tips" className="shrink-0 whitespace-nowrap text-g300 transition-colors hover:text-white">
              Tips
            </Link>
            <Link href="/faq" className="shrink-0 whitespace-nowrap text-g300 transition-colors hover:text-white">
              FAQ
            </Link>
            <Link href="/contact" className="shrink-0 whitespace-nowrap text-g300 transition-colors hover:text-white">
              Contact
            </Link>
            <a
              href="tel:+17743436369"
              className="hidden shrink-0 whitespace-nowrap text-g300 transition-colors hover:text-white sm:inline"
            >
              (774) 343-6369
            </a>
            <Link
              href="/book"
              className="shrink-0 whitespace-nowrap rounded-lg bg-gradient-to-br from-accent to-accent-2 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white shadow-[0_2px_8px_rgba(232,80,42,.3)] transition-opacity hover:opacity-90"
            >
              Book Now
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-white/8 bg-navy-2">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-10 sm:grid-cols-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Image src="/logo.png" alt="ECM logo" width={32} height={32} />
              <span className="font-display text-sm font-bold">East Coast Mechanical</span>
            </div>
            <p className="text-sm text-g300">Serving the South Shore through the Cape and Islands.</p>
          </div>
          <div className="flex flex-col gap-1 text-sm text-g300">
            <div className="text-xs font-bold uppercase tracking-wide text-g500">Contact</div>
            <a href="tel:+17743436369" className="hover:text-white">
              (774) 343-6369
            </a>
            <span>Mon–Sat, 7am–8pm · 24/7 emergency service</span>
            <Link href="/contact" className="hover:text-white">
              Contact Form
            </Link>
          </div>
          <div className="flex flex-col gap-1 text-sm text-g300">
            <div className="text-xs font-bold uppercase tracking-wide text-g500">Explore</div>
            <Link href="/services" className="hover:text-white">
              Services
            </Link>
            <Link href="/about" className="hover:text-white">
              About Us
            </Link>
            <Link href="/tips" className="hover:text-white">
              Tips &amp; Guides
            </Link>
            <Link href="/faq" className="hover:text-white">
              FAQ
            </Link>
          </div>
          <div className="flex flex-col gap-1 text-sm text-g300">
            <div className="text-xs font-bold uppercase tracking-wide text-g500">Links</div>
            <Link href="/book" className="hover:text-white">
              Book Online
            </Link>
            <Link href="/privacy" className="hover:text-white">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-white">
              Terms of Service
            </Link>
          </div>
        </div>
        <div className="border-t border-white/6 px-6 py-4 text-center text-xs text-g500">
          © {new Date().getFullYear()} East Coast Mechanical. All rights reserved.
        </div>
      </footer>

      <ChatWidget />
    </div>
  );
}
