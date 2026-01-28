import type { Metadata } from "next";
import "./globals.css";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "HockeyEdge - NHL Betting Predictions & Odds Comparison",
  description: "AI-powered hockey predictions, live odds comparison, and player props for NHL, 4 Nations Face-Off, and Olympic hockey.",
  keywords: ["NHL betting", "hockey predictions", "NHL odds", "player props", "Stanley Cup odds"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className="font-sans antialiased bg-slate-950 text-white min-h-screen flex flex-col"
      >
        <Navigation />
        <main className="flex-grow">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
