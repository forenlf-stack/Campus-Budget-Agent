import type { Metadata } from "next";
import { BottomNavigation } from "@/app/components/bottom-navigation";
import "./globals.css";

export const metadata: Metadata = {
  title: "学生消费助手",
  description: "结合预算、偏好与消费记录的轻量决策工具",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col"><div className="min-h-screen flex-1">{children}</div><BottomNavigation /></body>
    </html>
  );
}
