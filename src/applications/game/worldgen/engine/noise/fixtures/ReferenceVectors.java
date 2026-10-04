// Generates java-reference-vectors.json (split into random/fixtures and noise/fixtures as .json.gz) by calling the
// real Minecraft 1.20.6 server classes. Build: remap server-1.20.6.jar with the official server mappings
// (ProGuard -> SRG, then SpecialSource), then
//   javac -proc:none -cp mapped.jar:<server libraries> ReferenceVectors.java
//   java -cp .:mapped.jar:<server libraries> ReferenceVectors noises.json reference.json
// where noises.json is the merged vanilla + Terralith `noise` registry from loadTerralithOnVanilla.
import com.google.gson.*;
import java.nio.file.*;
import java.util.*;
import net.minecraft.util.Mth;
import net.minecraft.util.RandomSource;
import net.minecraft.world.level.biome.BiomeManager;
import net.minecraft.world.level.levelgen.*;
import net.minecraft.world.level.levelgen.synth.*;
import it.unimi.dsi.fastutil.doubles.DoubleArrayList;

public class ReferenceVectors {
    static JsonArray arr(Object... values) {
        JsonArray a = new JsonArray();
        for (Object v : values) {
            if (v instanceof Long l) a.add(Long.toString(l));
            else if (v instanceof Integer i) a.add(i);
            else if (v instanceof Double d) a.add(d);
            else if (v instanceof Float f) a.add((double) f);
            else if (v instanceof Boolean b) a.add(b);
            else a.add(String.valueOf(v));
        }
        return a;
    }

    static void step(JsonArray steps, String op, JsonArray args, Object result) {
        JsonObject s = new JsonObject();
        s.addProperty("op", op);
        s.add("args", args);
        s.add("result", arr(result).get(0));
        steps.add(s);
    }

    static JsonArray runSequence(RandomSource r) {
        JsonArray steps = new JsonArray();
        for (int i = 0; i < 4; i++) step(steps, "nextLong", arr(), r.nextLong());
        for (int i = 0; i < 4; i++) step(steps, "nextInt", arr(), r.nextInt());
        for (int bound : new int[]{1, 2, 3, 7, 16, 100, 256, 1000, 1 << 30, 1 << 30 | 1, Integer.MAX_VALUE, 3, 5, 6, 17, 1 << 20}) step(steps, "nextIntBounded", arr(bound), r.nextInt(bound));
        for (int i = 0; i < 3; i++) step(steps, "nextIntBetweenInclusive", arr(-5, 5), r.nextIntBetweenInclusive(-5, 5));
        step(steps, "nextIntInRange", arr(-100, 37), r.nextInt(-100, 37));
        for (int i = 0; i < 3; i++) step(steps, "nextFloat", arr(), r.nextFloat());
        for (int i = 0; i < 3; i++) step(steps, "nextDouble", arr(), r.nextDouble());
        for (int i = 0; i < 4; i++) step(steps, "nextBoolean", arr(), r.nextBoolean());
        for (int i = 0; i < 5; i++) step(steps, "nextGaussian", arr(), r.nextGaussian());
        step(steps, "triangle", arr(2.5, 1.5), r.triangle(2.5, 1.5));
        r.consumeCount(10); step(steps, "skipThenNextLong", arr(10), r.nextLong());
        step(steps, "forkThenNextLong", arr(), r.fork().nextLong());
        PositionalRandomFactory p = r.forkPositional();
        int[][] positions = {{0, 0, 0}, {1, 2, 3}, {-1, -64, -1}, {123456, 70, -987654}, {30000000, 319, -30000000}, {-7, 13, 2147483647}, {-2147483648, 5, 9}};
        for (int[] pos : positions) step(steps, "positionalAtThenNextLong", arr(pos[0], pos[1], pos[2]), p.at(pos[0], pos[1], pos[2]).nextLong());
        for (String name : new String[]{"minecraft:temperature", "octave_-7", "minecraft:terrain", "aquifer", "", "terralith:ünïcode"}) step(steps, "positionalHashThenNextLong", arr(name), p.fromHashOf(name).nextLong());
        step(steps, "positionalAtThenNextDouble", arr(5, -3, 8), p.at(5, -3, 8).nextDouble());
        step(steps, "setSeedThenNextLong", arr(42L), ((java.util.function.Supplier<Long>) () -> { r.setSeed(42L); return r.nextLong(); }).get());
        step(steps, "nextGaussian", arr(), r.nextGaussian());
        return steps;
    }

    static double[][] NOISE_POINTS = {
        {0, 0, 0}, {0.5, 0.25, 0.125}, {1, 2, 3}, {-1.5, 64, 2.75}, {100.3, -63.9, -250.1},
        {1234.5678, 80, -9876.54321}, {-30000000, 0, 30000000}, {16777215.9, 1.0, -16777216.1},
        {4000 / 4.0, 0, 4000 / 4.0}, {-6000 * 0.25, 16, 2000 * 0.25}, {9000.0, -9000.0, 9000.0}, {33554432.5, -33554431.25, 1e7}
    };

    public static void main(String[] argv) throws Exception {
        net.minecraft.SharedConstants.tryDetectVersion(); net.minecraft.server.Bootstrap.bootStrap();
        JsonObject out = new JsonObject();

        JsonArray mix = new JsonArray();
        long[] mixInputs = {0L, 1L, -1L, 1337L, Long.MIN_VALUE, Long.MAX_VALUE, 0x6A09E667F3BCC909L, -7046029254386353131L, 123456789012345L};
        for (long v : mixInputs) mix.add(arr(v, RandomSupport.mixStafford13(v)));
        out.add("mixStafford13", mix);

        JsonArray upgrade = new JsonArray();
        for (long v : mixInputs) { RandomSupport.Seed128bit s = RandomSupport.upgradeSeedTo128bit(v); upgrade.add(arr(v, s.seedLo(), s.seedHi())); }
        out.add("upgradeSeedTo128bit", upgrade);

        JsonArray hashes = new JsonArray();
        for (String name : new String[]{"minecraft:temperature", "octave_0", "", "terralith:ünïcode"}) { RandomSupport.Seed128bit s = RandomSupport.seedFromHashOf(name); hashes.add(arr(name, s.seedLo(), s.seedHi(), name.hashCode())); }
        out.add("seedFromHashOf", hashes);

        JsonArray seeds = new JsonArray();
        int[][] seedPositions = {{0, 0, 0}, {1, 2, 3}, {-1, -1, -1}, {123456, 70, -987654}, {30000000, 319, -30000000}, {2147483647, -2147483648, 2147483647}, {-2147483648, 0, -2147483648}, {7, -64, 1 << 20}};
        for (int[] pos : seedPositions) seeds.add(arr(pos[0], pos[1], pos[2], Mth.getSeed(pos[0], pos[1], pos[2])));
        out.add("positionalSeed", seeds);

        JsonArray obfuscated = new JsonArray();
        for (long v : mixInputs) obfuscated.add(arr(v, BiomeManager.obfuscateSeed(v)));
        out.add("sha256HashLong", obfuscated);

        JsonArray sequences = new JsonArray();
        long[] sequenceSeeds = {0L, 1L, 1337L, -1L, Long.MIN_VALUE, Long.MAX_VALUE, 0x123456789ABCDEFL};
        for (long seed : sequenceSeeds) {
            for (String kind : new String[]{"xoroshiro", "legacy"}) {
                RandomSource r = kind.equals("xoroshiro") ? new XoroshiroRandomSource(seed) : new LegacyRandomSource(seed);
                JsonObject seq = new JsonObject();
                seq.addProperty("kind", kind);
                seq.addProperty("seed", Long.toString(seed));
                seq.add("steps", runSequence(r));
                sequences.add(seq);
            }
        }
        long[][] rawSeeds = {{0L, 0L}, {1L, 2L}, {-1L, Long.MIN_VALUE}};
        for (long[] raw : rawSeeds) {
            JsonObject seq = new JsonObject();
            seq.addProperty("kind", "xoroshiroRaw");
            seq.addProperty("seedLow", Long.toString(raw[0]));
            seq.addProperty("seedHigh", Long.toString(raw[1]));
            seq.add("steps", runSequence(new XoroshiroRandomSource(raw[0], raw[1])));
            sequences.add(seq);
        }
        out.add("sequences", sequences);

        JsonArray points = new JsonArray();
        for (double[] p : NOISE_POINTS) points.add(arr(p[0], p[1], p[2]));
        out.add("noisePoints", points);

        ImprovedNoise improved = new ImprovedNoise(new XoroshiroRandomSource(1337L));
        JsonObject improvedOut = new JsonObject();
        improvedOut.add("offsets", arr(improved.xo, improved.yo, improved.zo));
        JsonArray improvedValues = new JsonArray();
        for (double[] p : NOISE_POINTS) improvedValues.add(improved.noise(p[0], p[1], p[2]));
        improvedOut.add("values", improvedValues);
        JsonArray improvedScaled = new JsonArray();
        for (double[] p : NOISE_POINTS) improvedScaled.add(improved.noise(p[0], p[1], p[2], 0.75, p[1] * 0.5));
        improvedOut.add("valuesWithYScale", improvedScaled);
        out.add("improvedNoise", improvedOut);

        JsonObject perlinOut = new JsonObject();
        PerlinNoise perlin = PerlinNoise.create(new XoroshiroRandomSource(1337L), -7, new DoubleArrayList(new double[]{1.0, 0.5, 0.0, 2.0}));
        JsonArray perlinValues = new JsonArray();
        for (double[] p : NOISE_POINTS) perlinValues.add(perlin.getValue(p[0], p[1], p[2]));
        perlinOut.add("newValues", perlinValues);
        perlinOut.addProperty("newMaxBroken", perlin.maxBrokenValue(3.0));
        PerlinNoise legacyPerlin = PerlinNoise.createLegacyForBlendedNoise(new LegacyRandomSource(1337L), java.util.stream.IntStream.of(-9, -6, -5, -1, 0));
        JsonArray legacyValues = new JsonArray();
        for (double[] p : NOISE_POINTS) legacyValues.add(legacyPerlin.getValue(p[0], p[1], p[2]));
        perlinOut.add("legacyValues", legacyValues);
        JsonArray legacyScaled = new JsonArray();
        for (double[] p : NOISE_POINTS) legacyScaled.add(legacyPerlin.getValue(p[0], p[1], p[2], 0.3, p[1] * 0.25, false));
        perlinOut.add("legacyValuesWithYScale", legacyScaled);
        JsonArray legacyFixed = new JsonArray();
        for (double[] p : NOISE_POINTS) legacyFixed.add(legacyPerlin.getValue(p[0], p[1], p[2], 0.0, 0.0, true));
        perlinOut.add("legacyValuesFixedY", legacyFixed);
        out.add("perlinNoise", perlinOut);

        JsonObject noiseParams = JsonParser.parseString(Files.readString(Path.of(argv[0]))).getAsJsonObject();
        long worldSeed = 1337L;
        PositionalRandomFactory root = new XoroshiroRandomSource(worldSeed).forkPositional();
        JsonObject normalOut = new JsonObject();
        for (String id : new TreeSet<>(noiseParams.keySet())) {
            JsonObject params = noiseParams.getAsJsonObject(id);
            DoubleArrayList amplitudes = new DoubleArrayList();
            for (JsonElement e : params.getAsJsonArray("amplitudes")) amplitudes.add(e.getAsDouble());
            NormalNoise noise = NormalNoise.create(root.fromHashOf(id), new NormalNoise.NoiseParameters(params.get("firstOctave").getAsInt(), amplitudes));
            JsonObject entry = new JsonObject();
            entry.addProperty("maxValue", noise.maxValue());
            JsonArray values = new JsonArray();
            for (double[] p : NOISE_POINTS) values.add(noise.getValue(p[0], p[1], p[2]));
            entry.add("values", values);
            normalOut.add(id, entry);
        }
        out.add("normalNoiseSeed1337", normalOut);

        JsonArray blendedOut = new JsonArray();
        double[][] blendedConfigs = {{0.25, 0.125, 80, 160, 8}, {0.25, 0.25, 80, 160, 4}, {0.25, 0.375, 80, 60, 8}};
        int[][] blockPositions = {{0, 0, 0}, {1, 1, 1}, {15, -64, 15}, {-1, 63, -1}, {100, 80, -250}, {4000, 120, 4000}, {-6000, 40, 2000}, {9000, -30, -9000}, {12345, 319, -54321}, {-29999999, 200, 29999999}, {3, 7, 11}, {-17, 100, 33}};
        for (double[] c : blendedConfigs) {
            BlendedNoise template = BlendedNoise.createUnseeded(c[0], c[1], c[2], c[3], c[4]);
            BlendedNoise blended = template.withNewRandom(root.fromHashOf(new net.minecraft.resources.ResourceLocation("terrain")));
            JsonObject entry = new JsonObject();
            entry.add("config", arr(c[0], c[1], c[2], c[3], c[4]));
            entry.addProperty("maxValue", blended.maxValue());
            entry.addProperty("minValue", blended.minValue());
            JsonArray values = new JsonArray();
            for (int[] b : blockPositions) values.add(arr(b[0], b[1], b[2], blended.compute(new DensityFunction.SinglePointContext(b[0], b[1], b[2]))));
            entry.add("values", values);
            blendedOut.add(entry);
        }
        out.add("blendedNoiseSeed1337", blendedOut);

        JsonObject simplexOut = new JsonObject();
        LegacyRandomSource endRandom = new LegacyRandomSource(worldSeed);
        endRandom.consumeCount(17292);
        SimplexNoise simplex = new SimplexNoise(endRandom);
        JsonArray simplex2 = new JsonArray();
        JsonArray simplex3 = new JsonArray();
        for (double[] p : NOISE_POINTS) { simplex2.add(simplex.getValue(p[0], p[2])); simplex3.add(simplex.getValue(p[0], p[1], p[2])); }
        simplexOut.add("values2D", simplex2);
        simplexOut.add("values3D", simplex3);
        PerlinSimplexNoise temperatureNoise = new PerlinSimplexNoise(new WorldgenRandom(new LegacyRandomSource(1234L)), List.of(0));
        PerlinSimplexNoise mixedNoise = new PerlinSimplexNoise(new WorldgenRandom(new LegacyRandomSource(2345L)), List.of(-3, -1, 0, 1, 2));
        JsonArray temperatureValues = new JsonArray();
        JsonArray mixedValues = new JsonArray();
        for (double[] p : NOISE_POINTS) { temperatureValues.add(temperatureNoise.getValue(p[0] / 8.0, p[2] / 8.0, false)); mixedValues.add(mixedNoise.getValue(p[0], p[2], true)); }
        simplexOut.add("perlinSimplexOctave0Seed1234", temperatureValues);
        simplexOut.add("perlinSimplexMixedSeed2345", mixedValues);
        out.add("simplexSeed1337", simplexOut);

        Files.writeString(Path.of(argv[1]), new GsonBuilder().disableHtmlEscaping().create().toJson(out));
        System.out.println("wrote " + argv[1]);
    }
}
