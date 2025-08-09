export const metadata = {
  title: "FocusFlow",
  description: "Minimal Offline MVP",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
        }}
      >
        <div style={{ maxWidth: 880, margin: "24px auto", padding: "0 16px" }}>
          <h1>FocusFlow — Offline Analyzer</h1>
          {children}
        </div>
      </body>
    </html>
  );
}
