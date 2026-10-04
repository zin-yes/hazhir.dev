// Verifies the RNG port against vectors produced by the real Minecraft 1.20.6 server classes
// (fixtures/java-reference-vectors.json.gz), plus published java.util.Random, MD5 and SHA-256 vectors.

import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { encodeUtf8, javaStringHashCode, md5, sha256, sha256HashLong } from "./hashing";
import { add64Into, bigIntToHalves, halvesToBigInt, type Int64Halves, multiply64Into, positionalSeed } from "./int64";
import { LegacyRandomSource } from "./legacy-random-source";
import type { RandomSource } from "./random-source";
import { mixStafford13, seedFromHashOf, upgradeSeedTo128bit } from "./random-support";
import { XoroshiroRandomSource } from "./xoroshiro-random-source";

const suiteStartedAt = performance.now();

type JsonScalar = string | number | boolean;
interface SequenceStep {
  op: string;
  args: JsonScalar[];
  result: JsonScalar;
}
interface SequenceVector {
  kind: "xoroshiro" | "legacy" | "xoroshiroRaw";
  seed?: string;
  seedLow?: string;
  seedHigh?: string;
  steps: SequenceStep[];
}
interface RandomReferenceVectors {
  mixStafford13: [string, string][];
  upgradeSeedTo128bit: [string, string, string][];
  seedFromHashOf: [string, string, string, number][];
  positionalSeed: [number, number, number, string][];
  sha256HashLong: [string, string][];
  sequences: SequenceVector[];
}

const reference: RandomReferenceVectors = JSON.parse(
  new TextDecoder().decode(
    Bun.gunzipSync(new Uint8Array(await Bun.file(join(import.meta.dir, "fixtures/java-reference-vectors.json.gz")).arrayBuffer())),
  ),
);

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Replays one recorded Java call on our source and returns the result in the fixture's JSON encoding. */
function replayStep(source: RandomSource, step: SequenceStep): JsonScalar {
  const numberArg = (index: number) => step.args[index] as number;
  switch (step.op) {
    case "nextLong":
      return source.nextLong().toString();
    case "nextInt":
      return source.nextInt();
    case "nextIntBounded":
      return source.nextIntBounded(numberArg(0));
    case "nextIntBetweenInclusive":
      return source.nextIntBetweenInclusive(numberArg(0), numberArg(1));
    case "nextIntInRange":
      return source.nextIntInRange(numberArg(0), numberArg(1));
    case "nextFloat":
      return source.nextFloat();
    case "nextDouble":
      return source.nextDouble();
    case "nextBoolean":
      return source.nextBoolean();
    case "nextGaussian":
      return source.nextGaussian();
    case "triangle":
      return source.triangle(numberArg(0), numberArg(1));
    case "skipThenNextLong":
      source.skip(numberArg(0));
      return source.nextLong().toString();
    case "forkThenNextLong":
      return source.fork().nextLong().toString();
    case "setSeedThenNextLong":
      source.setSeed(BigInt(step.args[0] as string));
      return source.nextLong().toString();
    default:
      throw new Error(`Unhandled op ${step.op}`);
  }
}

function createSource(vector: SequenceVector): RandomSource {
  if (vector.kind === "xoroshiro") return new XoroshiroRandomSource(BigInt(vector.seed!));
  if (vector.kind === "legacy") return new LegacyRandomSource(BigInt(vector.seed!));
  return XoroshiroRandomSource.fromSeed128(BigInt(vector.seedLow!), BigInt(vector.seedHigh!));
}

describe("RandomSupport seeding matches Java", () => {
  test("mixStafford13", () => {
    for (const [input, expected] of reference.mixStafford13) expect(mixStafford13(BigInt(input)).toString()).toBe(expected);
  });

  test("upgradeSeedTo128bit", () => {
    for (const [seed, low, high] of reference.upgradeSeedTo128bit) {
      const upgraded = upgradeSeedTo128bit(BigInt(seed));
      expect([upgraded.low.toString(), upgraded.high.toString()]).toEqual([low, high]);
    }
  });

  test("seedFromHashOf (MD5 over UTF-8, big-endian longs) and String.hashCode", () => {
    for (const [name, low, high, hashCode] of reference.seedFromHashOf) {
      const seed = seedFromHashOf(name);
      expect([seed.low.toString(), seed.high.toString()]).toEqual([low, high]);
      expect(javaStringHashCode(name)).toBe(hashCode);
    }
  });

  test("Mth.getSeed positional seed, including int overflow extremes", () => {
    for (const [x, y, z, expected] of reference.positionalSeed) expect(positionalSeed(x, y, z).toString()).toBe(expected);
  });

  test("BiomeManager.obfuscateSeed (SHA-256 of the little-endian long)", () => {
    for (const [seed, expected] of reference.sha256HashLong) expect(sha256HashLong(BigInt(seed)).toString()).toBe(expected);
  });
});

describe("random sources replay recorded Java call sequences exactly", () => {
  for (const vector of reference.sequences) {
    const label = vector.kind === "xoroshiroRaw" ? `${vector.seedLow},${vector.seedHigh}` : vector.seed;
    test(`${vector.kind} seed ${label}`, () => {
      const source = createSource(vector);
      let positional: ReturnType<RandomSource["forkPositional"]> | null = null;
      for (const step of vector.steps) {
        let actual: JsonScalar;
        if (step.op.startsWith("positional")) {
          // The Java harness forks one positional factory right before the first positional step.
          positional ??= source.forkPositional();
          if (step.op === "positionalAtThenNextLong") {
            actual = positional.at(step.args[0] as number, step.args[1] as number, step.args[2] as number).nextLong().toString();
          } else if (step.op === "positionalAtThenNextDouble") {
            actual = positional.at(step.args[0] as number, step.args[1] as number, step.args[2] as number).nextDouble();
          } else {
            actual = positional.fromHashOf(step.args[0] as string).nextLong().toString();
          }
        } else {
          actual = replayStep(source, step);
        }
        expect({ op: step.op, args: step.args, result: actual }).toEqual({ op: step.op, args: step.args, result: step.result });
      }
    });
  }

  test("positional fromSeed equals at() for the same positional seed", () => {
    const root = new XoroshiroRandomSource(BigInt(1337)).forkPositional();
    const legacyRoot = new LegacyRandomSource(BigInt(1337)).forkPositional();
    for (const [x, y, z] of [
      [12, -40, 99],
      [-30000000, 319, 30000000],
    ]) {
      expect(root.fromSeed(positionalSeed(x, y, z)).nextLong()).toBe(root.at(x, y, z).nextLong());
      expect(legacyRoot.fromSeed(positionalSeed(x, y, z)).nextLong()).toBe(legacyRoot.at(x, y, z).nextLong());
    }
  });
});

describe("published reference vectors", () => {
  test("java.util.Random first nextInt for seeds 0 and 42", () => {
    expect(new LegacyRandomSource(BigInt(0)).nextInt()).toBe(-1155484576);
    expect(new LegacyRandomSource(BigInt(42)).nextInt()).toBe(-1170105035);
  });

  test("MD5 RFC 1321 test suite", () => {
    const vectors: [string, string][] = [
      ["", "d41d8cd98f00b204e9800998ecf8427e"],
      ["a", "0cc175b9c0f1b6a831c399e269772661"],
      ["abc", "900150983cd24fb0d6963f7d28e17f72"],
      ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
      ["abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"],
      ["1234567890".repeat(8), "57edf4a22be3c955ac49da2e2107b67a"],
    ];
    for (const [input, expected] of vectors) expect(toHex(md5(encodeUtf8(input)))).toBe(expected);
  });

  test("SHA-256 FIPS 180-2 vectors, including a two-block message", () => {
    const vectors: [string, string][] = [
      ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
      ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
      [
        "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
        "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
      ],
    ];
    for (const [input, expected] of vectors) expect(toHex(sha256(encodeUtf8(input)))).toBe(expected);
  });
});

describe("int64 halves arithmetic agrees with BigInt on wrapping edge cases", () => {
  test("multiply and add over carry-heavy operands", () => {
    const interesting = [
      "0",
      "1",
      "-1",
      "4294967295",
      "4294967296",
      "-4294967296",
      "9223372036854775807",
      "-9223372036854775808",
      "116129781",
      "-7046029254386353131",
      "7640891576956012809",
      "123456789123456789",
    ].map((text) => BigInt(text));
    const first: Int64Halves = { high: 0, low: 0 };
    const second: Int64Halves = { high: 0, low: 0 };
    const out: Int64Halves = { high: 0, low: 0 };
    for (const left of interesting) {
      for (const right of interesting) {
        bigIntToHalves(left, first);
        bigIntToHalves(right, second);
        multiply64Into(first.high, first.low, second.high, second.low, out);
        expect(halvesToBigInt(out.high, out.low)).toBe(BigInt.asIntN(64, left * right));
        add64Into(first.high, first.low, second.high, second.low, out);
        expect(halvesToBigInt(out.high, out.low)).toBe(BigInt.asIntN(64, left + right));
      }
    }
  });
});

describe("performance", () => {
  test("hot-path costs (reported, loosely bounded)", () => {
    const xoroshiro = new XoroshiroRandomSource(BigInt(1337));
    const iterations = 2_000_000;
    let checksum = 0;
    let startedAt = performance.now();
    for (let index = 0; index < iterations; index++) checksum += xoroshiro.nextDouble();
    const nextDoubleNanoseconds = ((performance.now() - startedAt) * 1e6) / iterations;

    const legacy = new LegacyRandomSource(BigInt(1337));
    startedAt = performance.now();
    for (let index = 0; index < iterations; index++) checksum += legacy.nextInt();
    const legacyNextIntNanoseconds = ((performance.now() - startedAt) * 1e6) / iterations;

    const positional = xoroshiro.forkPositional();
    const positionalIterations = 500_000;
    startedAt = performance.now();
    for (let index = 0; index < positionalIterations; index++) checksum += positional.at(index, -index, index * 3).nextInt();
    const positionalNanoseconds = ((performance.now() - startedAt) * 1e6) / positionalIterations;

    console.log(
      `xoroshiro nextDouble ${nextDoubleNanoseconds.toFixed(1)} ns, legacy nextInt ${legacyNextIntNanoseconds.toFixed(1)} ns, ` +
        `positional at()+nextInt ${positionalNanoseconds.toFixed(1)} ns (checksum ${checksum.toFixed(3)})`,
    );
    expect(Number.isFinite(checksum)).toBe(true);
    expect(nextDoubleNanoseconds).toBeLessThan(200);
    expect(positionalNanoseconds).toBeLessThan(2000);
  });
});

afterAll(() => {
  console.log(`random.test.ts wall-clock ${(performance.now() - suiteStartedAt).toFixed(0)} ms`);
});
