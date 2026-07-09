import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Deadball Economics - Set-piece xG",
  description: "A tactical set-piece xG lab built with Next.js, React and TypeScript.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
