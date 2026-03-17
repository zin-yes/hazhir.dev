import Terms from "@/components/legal/terms-of-service";

export const metadata = {
  title: "Terms of Service — hazhir.dev",
};

export default function TermsPage() {
  return (
    <main className="h-full overflow-auto bg-background text-white">
      <Terms />
    </main>
  );
}
