import "./globals.css";

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
      <body>
        <div className="container">
          <div className="header">
            <div>
              <div className="brand">FocusFlow — Offline Analyzer</div>
              <div className="subtitle">
                Upload audio + agenda to generate a meeting report
              </div>
            </div>
            <a
              className="badge"
              href="https://openai.com"
              target="_blank"
              rel="noreferrer"
            >
              OpenAI
            </a>
          </div>
          {children}
          <div className="footer">
            Local MVP • No integrations • Reports saved under{" "}
            <code>public/reports/</code>
          </div>
        </div>
      </body>
    </html>
  );
}
