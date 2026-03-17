import CookiePolicy from "@/components/legal/cookie-policy";

export const metadata = {
  title: "Cookie Policy — hazhir.dev",
};

export default function CookiesPage() {
  return (
    <main className="h-full overflow-auto bg-background text-white">
      <CookiePolicy />
    </main>
  );
}
