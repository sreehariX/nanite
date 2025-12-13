import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nanite Eval",
  description: "Find the best model and prompt for your repository",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "'Geist Sans', sans-serif" }}>{children}</body>
    </html>
  );
}

