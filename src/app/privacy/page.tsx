import PrivacyPolicy from "@/components/legal/privacy-policy";

export const metadata = {
  title: "Privacy Policy — hazhir.dev",
};

export default function PrivacyPage() {
  return (
    <main className="h-full overflow-auto bg-background text-white">
      <PrivacyPolicy />
    </main>
  );
}
