import { NextResponse, type NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dataRoot = path.join(
  process.cwd(),
  "src",
  "applications",
  "visual-novel",
  "data"
);
const scenesDir = path.join(dataRoot, "scenes");
const charactersPath = path.join(dataRoot, "characters.json");

const SCENE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function isSafeSceneId(value: string) {
  return SCENE_ID_PATTERN.test(value);
}

async function readJsonFile(filePath: string) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJsonFile(filePath: string, data: unknown) {
  const payload = JSON.stringify(data, null, 2) + "\n";
  await fs.writeFile(filePath, payload, "utf8");
}

async function readScenes() {
  const files = await fs.readdir(scenesDir);
  const sceneFiles = files.filter((file) => file.endsWith(".json"));

  const scenes = await Promise.all(
    sceneFiles.map(async (fileName) => {
      const fullPath = path.join(scenesDir, fileName);
      const data = await readJsonFile(fullPath);
      const id = data?.id || fileName.replace(/\.json$/, "");
      return { id, fileName, data };
    })
  );

  scenes.sort((a, b) => a.id.localeCompare(b.id));
  return scenes;
}

export async function GET() {
  try {
    const [characters, scenes] = await Promise.all([
      readJsonFile(charactersPath),
      readScenes(),
    ]);

    return NextResponse.json({ characters, scenes });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Failed to load data." },
      { status: 500 }
    );
  }
}

type EditorAction =
  | { action: "saveCharacters"; characters: unknown }
  | { action: "saveScene"; scene: unknown }
  | { action: "createScene"; scene: unknown }
  | { action: "deleteScene"; sceneId: string }
  | { action: "renameScene"; fromId: string; toId: string };

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as EditorAction;

    switch (body.action) {
      case "saveCharacters": {
        await writeJsonFile(charactersPath, body.characters);
        return NextResponse.json({ ok: true });
      }
      case "createScene": {
        const scene = body.scene as { id?: string };
        if (!scene?.id || !isSafeSceneId(scene.id)) {
          return NextResponse.json(
            { error: "Invalid scene id." },
            { status: 400 }
          );
        }

        const filePath = path.join(scenesDir, `${scene.id}.json`);
        try {
          await fs.access(filePath);
          return NextResponse.json(
            { error: "Scene already exists." },
            { status: 409 }
          );
        } catch {
          await writeJsonFile(filePath, scene);
          return NextResponse.json({ ok: true });
        }
      }
      case "saveScene": {
        const scene = body.scene as { id?: string };
        if (!scene?.id || !isSafeSceneId(scene.id)) {
          return NextResponse.json(
            { error: "Invalid scene id." },
            { status: 400 }
          );
        }

        const filePath = path.join(scenesDir, `${scene.id}.json`);
        await writeJsonFile(filePath, scene);
        return NextResponse.json({ ok: true });
      }
      case "deleteScene": {
        if (!body.sceneId || !isSafeSceneId(body.sceneId)) {
          return NextResponse.json(
            { error: "Invalid scene id." },
            { status: 400 }
          );
        }

        const filePath = path.join(scenesDir, `${body.sceneId}.json`);
        await fs.unlink(filePath);
        return NextResponse.json({ ok: true });
      }
      case "renameScene": {
        if (
          !body.fromId ||
          !body.toId ||
          !isSafeSceneId(body.fromId) ||
          !isSafeSceneId(body.toId)
        ) {
          return NextResponse.json(
            { error: "Invalid scene id." },
            { status: 400 }
          );
        }

        const fromPath = path.join(scenesDir, `${body.fromId}.json`);
        const toPath = path.join(scenesDir, `${body.toId}.json`);
        await fs.rename(fromPath, toPath);
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Failed to save data." },
      { status: 500 }
    );
  }
}
