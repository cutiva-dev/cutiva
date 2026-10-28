import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./landing.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://cutiva.dev"),
  title: "Cutiva — The open-source video editing SDK for every platform",
  description: "Add trimming, splitting, audio and MP4 export to React, React Native and Flutter apps. Open source, Apache-2.0, runs on the device.",
  icons: "/cutiva-mark.svg",
  openGraph: {
    title: "Cutiva — Add video editing to any app",
    description: "The open-source video editing SDK for React, React Native and Flutter.",
    url: "https://cutiva.dev",
  },
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
