import type { Metadata } from "next";
import "./globals.css";
import Providers from "./components/Providers";

export const metadata: Metadata = {
  title: "Drive Utility Web",
  description: "Workspace Drive Management Tool",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
