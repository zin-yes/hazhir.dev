package net.minecraft.world.level.levelgen;

// Records real Minecraft 1.20.6 outputs (Terralith datapack, seed 1337) for engine/density and engine/terrain:
// router functions at single points, every overworld/Terralith density_function registry entry wired like RandomState,
// Climate.Sampler targets (plain and NoiseChunk-cached), and per chunk the cached final density evaluated in
// NoiseBasedChunkGenerator.doFill order (SHA-256 of the little-endian doubles plus every 97th value).
// Lives in net.minecraft.world.level.levelgen to reach package-private NoiseChunk/RandomState members.
// Build against the remapped server jar (see engine/noise/fixtures/ReferenceVectors.java for the remap), Java 21:
//   javac -proc:none -cp mapped.jar:<server libraries> -d classes DensityReference.java
//   java -cp classes:mapped.jar:<server libraries> net.minecraft.world.level.levelgen.DensityReference \
//     <world/datapacks containing Terralith> 0 0 250 263 255 257 -377 123 748 748 -10 -10 out.json.gz
// The output was split into density/fixtures/density-reference-vectors.json.gz (everything but "chunks") and
// terrain/fixtures/noise-chunk-reference-vectors.json.gz ("chunks").
import com.google.gson.*;
import it.unimi.dsi.fastutil.objects.ObjectArrayList;
import java.nio.*;
import java.nio.file.*;
import java.util.*;
import net.minecraft.core.RegistryAccess;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.RegistryDataLoader;
import net.minecraft.server.RegistryLayer;
import net.minecraft.server.packs.PackType;
import net.minecraft.server.packs.repository.PackRepository;
import net.minecraft.server.packs.repository.ServerPacksSource;
import net.minecraft.server.packs.resources.MultiPackResourceManager;
import net.minecraft.world.level.biome.Climate;
import net.minecraft.world.level.levelgen.blending.Blender;
import net.minecraft.world.level.levelgen.structure.pools.JigsawJunction;
import net.minecraft.world.level.levelgen.structure.BoundingBox;
import net.minecraft.world.level.validation.DirectoryValidator;

public class DensityReference {
    static JsonArray target(Climate.TargetPoint t) {
        JsonArray a = new JsonArray();
        a.add(t.temperature()); a.add(t.humidity()); a.add(t.continentalness()); a.add(t.erosion()); a.add(t.depth()); a.add(t.weirdness());
        return a;
    }

    public static void main(String[] argv) throws Exception {
        net.minecraft.SharedConstants.tryDetectVersion();
        net.minecraft.server.Bootstrap.bootStrap();
        Path datapacks = Paths.get(argv[0]);
        PackRepository repository = ServerPacksSource.createPackRepository(datapacks, new DirectoryValidator(path -> true));
        repository.reload();
        System.out.println("available packs: " + repository.getAvailableIds());
        repository.setSelected(List.of("vanilla", "file/Terralith"));
        MultiPackResourceManager resources = new MultiPackResourceManager(PackType.SERVER_DATA, repository.openAllSelected());
        var layers = RegistryLayer.createRegistryAccess();
        RegistryAccess.Frozen worldgen = RegistryDataLoader.load(resources, layers.getAccessForLoading(RegistryLayer.WORLDGEN), RegistryDataLoader.WORLDGEN_REGISTRIES);
        NoiseGeneratorSettings settings = worldgen.registryOrThrow(Registries.NOISE_SETTINGS).get(NoiseGeneratorSettings.OVERWORLD);
        RandomState randomState = RandomState.create(settings, worldgen.lookupOrThrow(Registries.NOISE), 1337L);
        NoiseRouter router = randomState.router();
        JsonObject out = new JsonObject();

        // 1. Router functions at single points (markers transparent outside a NoiseChunk).
        String[] names = {"barrier", "fluidLevelFloodedness", "fluidLevelSpread", "lava", "temperature", "vegetation", "continents", "erosion", "depth", "ridges", "initialDensityWithoutJaggedness", "finalDensity", "veinToggle", "veinRidged", "veinGap"};
        DensityFunction[] functions = {router.barrierNoise(), router.fluidLevelFloodednessNoise(), router.fluidLevelSpreadNoise(), router.lavaNoise(), router.temperature(), router.vegetation(), router.continents(), router.erosion(), router.depth(), router.ridges(), router.initialDensityWithoutJaggedness(), router.finalDensity(), router.veinToggle(), router.veinRidged(), router.veinGap()};
        JsonArray routerPoints = new JsonArray();
        Random random = new Random(20260604L);
        int[][] anchors = {{0, 0}, {4000, 4000}, {-6000, 2000}, {9000, -9000}, {-160, -160}, {-3000, -7000}, {12000, 12000}, {123456, -654321}};
        for (int[] anchor : anchors) {
            for (int i = 0; i < 40; i++) {
                int x = anchor[0] + random.nextInt(512) - 256, y = random.nextInt(384) - 64, z = anchor[1] + random.nextInt(512) - 256;
                JsonObject point = new JsonObject();
                point.addProperty("x", x); point.addProperty("y", y); point.addProperty("z", z);
                DensityFunction.SinglePointContext context = new DensityFunction.SinglePointContext(x, y, z);
                for (int f = 0; f < names.length; f++) point.addProperty(names[f], functions[f].compute(context));
                routerPoints.add(point);
            }
        }
        JsonObject bounds = new JsonObject();
        for (int f = 0; f < names.length; f++) { JsonArray b = new JsonArray(); b.add(functions[f].minValue()); b.add(functions[f].maxValue()); bounds.add(names[f], b); }
        out.add("routerBounds", bounds);
        out.add("routerPoints", routerPoints);

        // 2. Climate.Sampler from RandomState (markers stripped).
        JsonArray climate = new JsonArray();
        for (int[] anchor : anchors) {
            for (int i = 0; i < 40; i++) {
                int qx = (anchor[0] >> 2) + random.nextInt(128) - 64, qy = random.nextInt(96) - 16, qz = (anchor[1] >> 2) + random.nextInt(128) - 64;
                JsonObject point = new JsonObject();
                point.addProperty("quartX", qx); point.addProperty("quartY", qy); point.addProperty("quartZ", qz);
                point.add("target", target(randomState.sampler().sample(qx, qy, qz)));
                climate.add(point);
            }
        }
        out.add("climate", climate);

        // 2b. Every overworld/Terralith density_function registry entry, wired like RandomState's NoiseWiringHelper.
        DensityFunction.Visitor wiring = new DensityFunction.Visitor() {
            private final Map<DensityFunction, DensityFunction> memo = new HashMap<>();
            @Override
            public DensityFunction.NoiseHolder visitNoise(DensityFunction.NoiseHolder holder) {
                return new DensityFunction.NoiseHolder(holder.noiseData(), randomState.getOrCreateNoise(holder.noiseData().unwrapKey().orElseThrow()));
            }
            @Override
            public DensityFunction apply(DensityFunction function) {
                return memo.computeIfAbsent(function, f -> f instanceof net.minecraft.world.level.levelgen.synth.BlendedNoise blended
                    ? blended.withNewRandom(randomState.random.fromHashOf(new net.minecraft.resources.ResourceLocation("terrain"))) : f);
            }
        };
        var densityRegistry = worldgen.registryOrThrow(Registries.DENSITY_FUNCTION);
        JsonArray registryVectors = new JsonArray();
        List<String> ids = new ArrayList<>();
        for (var key : densityRegistry.registryKeySet()) {
            String id = key.location().toString();
            boolean overworld = id.startsWith("minecraft:overworld/") || id.startsWith("terralith:") || id.equals("minecraft:shift_x") || id.equals("minecraft:shift_z") || id.equals("minecraft:y") || id.equals("minecraft:zero");
            if (overworld) ids.add(id);
        }
        Collections.sort(ids);
        int[][] registryPoints = new int[24][];
        for (int i = 0; i < registryPoints.length; i++) {
            int[] anchor = anchors[i % anchors.length];
            registryPoints[i] = new int[]{anchor[0] + random.nextInt(512) - 256, random.nextInt(384) - 64, anchor[1] + random.nextInt(512) - 256};
        }
        JsonArray pointList = new JsonArray();
        for (int[] point : registryPoints) { JsonArray a = new JsonArray(); a.add(point[0]); a.add(point[1]); a.add(point[2]); pointList.add(a); }
        out.add("registryPoints", pointList);
        for (String id : ids) {
            DensityFunction wired = densityRegistry.get(new net.minecraft.resources.ResourceLocation(id)).mapAll(wiring);
            JsonObject entry = new JsonObject();
            entry.addProperty("id", id);
            entry.addProperty("minValue", wired.minValue());
            entry.addProperty("maxValue", wired.maxValue());
            JsonArray values = new JsonArray();
            for (int[] point : registryPoints) values.add(wired.compute(new DensityFunction.SinglePointContext(point[0], point[1], point[2])));
            entry.add("values", values);
            registryVectors.add(entry);
        }
        out.add("registryFunctions", registryVectors);

        // 3. Whole chunks: cached final density in doFill order, plus the NoiseChunk-cached climate sampler.
        JsonArray chunks = new JsonArray();
        String fullPath = System.getProperty("fullDensityOutput");
        JsonObject fullOutput = fullPath == null ? null : new JsonObject();
        for (int c = 1; c + 1 < argv.length; c += 2) {
            int chunkX = Integer.parseInt(argv[c]), chunkZ = Integer.parseInt(argv[c + 1]);
            Beardifier beardifier = new Beardifier(new ObjectArrayList<Beardifier.Rigid>().iterator(), new ObjectArrayList<JigsawJunction>().iterator());
            Aquifer.FluidStatus lava = new Aquifer.FluidStatus(-54, net.minecraft.world.level.block.Blocks.LAVA.defaultBlockState());
            Aquifer.FluidStatus water = new Aquifer.FluidStatus(settings.seaLevel(), settings.defaultFluid());
            Aquifer.FluidPicker picker = (x, y, z) -> y < Math.min(-54, settings.seaLevel()) ? lava : water;
            NoiseChunk noiseChunk = new NoiseChunk(4, randomState, chunkX * 16, chunkZ * 16, settings.noiseSettings(), beardifier, settings, picker, Blender.empty());

            Climate.Sampler cachedSampler = noiseChunk.cachedClimateSampler(router, settings.spawnTarget());
            JsonArray cachedClimate = new JsonArray();
            for (int qx = 0; qx < 4; qx++) for (int qz = 0; qz < 4; qz++) for (int qy = -16; qy < 80; qy += 7) {
                JsonObject point = new JsonObject();
                point.addProperty("quartX", chunkX * 4 + qx); point.addProperty("quartY", qy); point.addProperty("quartZ", chunkZ * 4 + qz);
                point.add("target", target(cachedSampler.sample(chunkX * 4 + qx, qy, chunkZ * 4 + qz)));
                cachedClimate.add(point);
            }

            DensityFunction.Visitor wrapVisitor = noiseChunk::wrap;
            NoiseRouter wiredRouter = router.mapAll(wrapVisitor);
            DensityFunction cachedFinal = DensityFunctions.cacheAllInCell(DensityFunctions.add(wiredRouter.finalDensity(), DensityFunctions.BeardifierMarker.INSTANCE)).mapAll(wrapVisitor);
            ByteBuffer densities = ByteBuffer.allocate(384 * 256 * 8).order(ByteOrder.LITTLE_ENDIAN);
            double[] values = new double[384 * 256];
            noiseChunk.initializeForFirstCellX();
            for (int cellX = 0; cellX < 4; cellX++) {
                noiseChunk.advanceCellX(cellX);
                for (int cellZ = 0; cellZ < 4; cellZ++) {
                    for (int cellY = 95; cellY >= 0; cellY--) {
                        noiseChunk.selectCellYZ(cellY, cellZ);
                        for (int yInCell = 3; yInCell >= 0; yInCell--) {
                            int blockY = (-16 + cellY) * 4 + yInCell;
                            noiseChunk.updateForY(blockY, yInCell / 4.0);
                            for (int xInCell = 0; xInCell < 4; xInCell++) {
                                int localX = cellX * 4 + xInCell;
                                noiseChunk.updateForX(chunkX * 16 + localX, xInCell / 4.0);
                                for (int zInCell = 0; zInCell < 4; zInCell++) {
                                    int localZ = cellZ * 4 + zInCell;
                                    noiseChunk.updateForZ(chunkZ * 16 + localZ, zInCell / 4.0);
                                    values[(blockY + 64) * 256 + localZ * 16 + localX] = cachedFinal.compute(noiseChunk);
                                }
                            }
                        }
                    }
                }
                noiseChunk.swapSlices();
            }
            noiseChunk.stopInterpolation();
            for (double value : values) densities.putDouble(value);
            JsonObject chunk = new JsonObject();
            chunk.addProperty("chunkX", chunkX); chunk.addProperty("chunkZ", chunkZ);
            chunk.addProperty("finalDensitySha256", HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(densities.array())));
            JsonArray samples = new JsonArray();
            for (int index = 0; index < values.length; index += 97) samples.add(values[index]);
            chunk.add("finalDensityEvery97th", samples);
            if (fullOutput != null) fullOutput.add(chunkX + "," + chunkZ, new JsonPrimitive(Base64.getEncoder().encodeToString(densities.array())));
            chunk.add("cachedClimate", cachedClimate);
            chunks.add(chunk);
            System.out.println("chunk " + chunkX + "," + chunkZ + " done");
        }
        out.add("chunks", chunks);
        try (var gzip = new java.util.zip.GZIPOutputStream(Files.newOutputStream(Paths.get(argv[argv.length - 1])))) {
            // JSON has no Infinity/NaN literals: emit them as strings ("Infinity", "-Infinity", "NaN").
            String json = new Gson().toJson(out).replaceAll("([:,\\[])(-?Infinity|NaN)", "$1\"$2\"");
            gzip.write(json.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        }
        if (fullOutput != null) Files.writeString(Paths.get(fullPath), new Gson().toJson(fullOutput));
        System.out.println("wrote " + argv[argv.length - 1]);
    }
}
