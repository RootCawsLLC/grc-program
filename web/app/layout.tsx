import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'grc-program — run it in the browser',
  description:
    'A hosted demo of grc-program: run the real tool against the bundled synthetic fixtures and see the control inventory (the system of record), the DuckDB evidence pipeline (landing -> assertions -> variance), control health as a classification, the four-direction gap assessment, and the emitted OSCAL package — every projection built from the controls.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="wrap">{children}</div>
      </body>
    </html>
  );
}
