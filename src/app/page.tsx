import { database } from "@/database";
import { testTable } from "@/database/schema";

export default async function HomePage() {
  await database.insert(testTable).values({
    id: Math.floor(Math.random() * 100000),
    name: "Hello this is a database test.",
  });
  const data = await database.query.testTable.findMany();
  console.log(data);

  return (
    <main className="w-full h-[100vh] flex flex-col items-center justify-center">
      <h1 className="text-2xl font-medium">hazhir.dev</h1>
      <p className="text-md font-light">cool projects coming soon...</p>
    </main>
  );
}
