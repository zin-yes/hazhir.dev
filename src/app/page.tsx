import { auth } from "@/auth";
import { signIn, signOut } from "next-auth/react";
import Image from "next/image";

export default async function HomePage() {
  const session = await auth();
  return (
    <main className="w-full h-[100vh] flex flex-col justify-center items-center">
      <div className="flex flex-col p-8 rounded-xl gap-2">
        <Image
          src={session?.user?.image ?? ""}
          alt="Profile picture"
          width={64}
          height={64}
        />
        <h2 className="text-xl">{session?.user?.name ?? "No name"}</h2>
        <span>{session?.user?.email ?? "No email"}</span>
        <span>{session?.user?.id ?? "No id"}</span>
      </div>
    </main>
  );
}
