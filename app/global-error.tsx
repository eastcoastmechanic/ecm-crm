"use client";

/**
 * Last-resort page when the root layout itself fails. It replaces the whole document,
 * so it carries its own html/body and inline styles (globals.css does not load here).
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined;
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a1628",
          color: "#ffffff",
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding: 16,
        }}
      >
        <title>Something went wrong | East Coast Mechanical</title>
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, margin: "0 0 12px" }}>Something went wrong</h1>
          <p style={{ fontSize: 15, lineHeight: 1.5, margin: "0 0 16px", color: "#c5cbd6" }}>
            That didn&apos;t go through on our end. Try again, or call East Coast Mechanical at{" "}
            <a href="tel:+17743436369" style={{ color: "#ffffff" }}>
              (774) 343-6369
            </a>
            .
          </p>
          {digest && <p style={{ fontSize: 12, color: "#8a93a3", margin: "0 0 16px" }}>Reference: {digest}</p>}
          <button
            type="button"
            onClick={() => retry()}
            style={{
              background: "#e8502a",
              color: "#ffffff",
              border: 0,
              borderRadius: 8,
              padding: "10px 18px",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try Again
          </button>
        </div>
      </body>
    </html>
  );
}
