package net.minecraft.world.level.levelgen;

// Records real Minecraft 1.20.6 outputs (Terralith datapack, seed 1337) for engine/features and engine/block-state:
//   1. WorldgenRandom decoration and feature seeds plus the draws that follow (ChunkGenerator.applyBiomeDecoration
//      seeding: new WorldgenRandom(new XoroshiroRandomSource(...)), setDecorationSeed, setFeatureSeed).
//   2. FeatureSorter.buildFeaturesPerStep over the overworld biome source's possible biomes (placed feature ids per step).
//   3. Biome.BIOME_INFO_NOISE samples (noise_based_count / noise_threshold_count) and NormalNoise over a legacy
//      WorldgenRandom (noise based block state providers).
//   4. Every placed feature listed by a possible biome, run on a synthetic world (see FakeWorld) at origin chunk
//      (3, -7) with its real step/index feature seed: the placement modifier chain's positions, and the writes of
//      placeWithBiomeCheck (WorldGenLevel calls the fake world does not support are recorded as errors).
//   5. Block state classification for every registered block (isAir, blocksMotion, isSolid, canBeReplaced, fluid,
//      sturdy faces, LeavesBlock, DoublePlantBlock, liquid()) and a canSurvive probe matrix (single neighbor below/above/north, everything else air).
// Build against the remapped server jar (see engine/noise/fixtures/ReferenceVectors.java for the remap), Java 21:
//   javac -proc:none -cp mapped.jar:<server libraries> -d classes FeaturesReference.java
//   java -cp classes:mapped.jar:<server libraries> net.minecraft.world.level.levelgen.FeaturesReference \
//     <world/datapacks containing Terralith> features/fixtures/features-reference.json.gz block-state/fixtures/block-state-reference.json.gz
import com.google.gson.*;
import java.io.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.GZIPOutputStream;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.Holder;
import net.minecraft.core.HolderSet;
import net.minecraft.core.RegistryAccess;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.RegistryDataLoader;
import net.minecraft.server.RegistryLayer;
import net.minecraft.server.packs.PackType;
import net.minecraft.server.packs.repository.PackRepository;
import net.minecraft.server.packs.repository.ServerPacksSource;
import net.minecraft.server.packs.resources.MultiPackResourceManager;
import net.minecraft.world.level.EmptyBlockGetter;
import net.minecraft.world.level.LevelReader;
import net.minecraft.world.level.biome.Biome;
import net.minecraft.world.level.biome.FeatureSorter;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.LeavesBlock;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.BlockStateProperties;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraft.world.level.dimension.LevelStem;
import net.minecraft.world.level.levelgen.placement.PlacedFeature;
import net.minecraft.world.level.levelgen.synth.NormalNoise;
import net.minecraft.world.level.material.FluidState;
import net.minecraft.world.level.validation.DirectoryValidator;

public class FeaturesReference {
    static JsonPrimitive longString(long value) { return new JsonPrimitive(Long.toString(value)); }

    static JsonObject drawsAfterSeed(WorldgenRandom random) {
        JsonObject draws = new JsonObject();
        draws.add("nextLong", longString(random.nextLong()));
        draws.addProperty("nextInt16a", random.nextInt(16));
        draws.addProperty("nextInt16b", random.nextInt(16));
        draws.addProperty("nextFloat", random.nextFloat());
        draws.addProperty("nextDouble", random.nextDouble());
        draws.addProperty("nextBoolean", random.nextBoolean());
        draws.addProperty("nextInt", random.nextInt());
        draws.addProperty("nextInt5", random.nextInt(5));
        draws.addProperty("nextInt1000", random.nextInt(1000));
        draws.addProperty("nextGaussian", random.nextGaussian());
        return draws;
    }

    static String stateString(BlockState state) {
        String name = BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString();
        TreeMap<String, String> sorted = new TreeMap<>();
        for (Map.Entry<Property<?>, Comparable<?>> entry : state.getValues().entrySet()) {
            sorted.put(entry.getKey().getName(), propertyValueName(entry.getKey(), entry.getValue()));
        }
        if (sorted.isEmpty()) return name;
        StringJoiner joiner = new StringJoiner(",", name + "[", "]");
        for (Map.Entry<String, String> entry : sorted.entrySet()) joiner.add(entry.getKey() + "=" + entry.getValue());
        return joiner.toString();
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    static String propertyValueName(Property property, Comparable value) { return property.getName(value); }

    static String fluidName(FluidState fluid) {
        if (fluid.isEmpty()) return "";
        return BuiltInRegistries.FLUID.getKey(fluid.getType()).toString();
    }

    static String flags(BlockState state) {
        StringBuilder builder = new StringBuilder();
        if (state.isAir()) builder.append('A');
        if (state.blocksMotion()) builder.append('M');
        if (state.isSolid()) builder.append('S');
        if (state.canBeReplaced()) builder.append('R');
        builder.append('|').append(fluidName(state.getFluidState()));
        return builder.toString();
    }

    static String sturdyFaces(BlockState state) {
        StringBuilder builder = new StringBuilder();
        for (Direction direction : Direction.values()) {
            if (state.isFaceSturdy(EmptyBlockGetter.INSTANCE, BlockPos.ZERO, direction)) builder.append(direction.getName().charAt(0));
        }
        return builder.toString();
    }

    /** A LevelReader with every block air except the ones placed in `blocks`; light is a fixed raw brightness. */
    static final class FakeLevel implements InvocationHandler {
        final Map<BlockPos, BlockState> blocks = new HashMap<>();
        int rawBrightness = 15;

        BlockState stateAt(Object position) { return blocks.getOrDefault((BlockPos) position, Blocks.AIR.defaultBlockState()); }

        @Override
        public Object invoke(Object proxy, Method method, Object[] arguments) throws Throwable {
            int argumentCount = arguments == null ? 0 : arguments.length;
            switch (method.getName()) {
                case "getBlockState": if (argumentCount == 1) return stateAt(arguments[0]); break;
                case "getFluidState": if (argumentCount == 1) return stateAt(arguments[0]).getFluidState(); break;
                case "getBlockEntity": if (argumentCount == 1) return null; break;
                case "getHeight": if (argumentCount == 0) return 384; break;
                case "getMinBuildHeight": return -64;
                case "getRawBrightness": case "getMaxLocalRawBrightness": return rawBrightness;
                case "getSeaLevel": return 63;
                case "isClientSide": return false;
                case "getSkyDarken": return 0;
                case "hashCode": return System.identityHashCode(proxy);
                case "equals": return proxy == arguments[0];
                case "toString": return "FakeLevel";
                default: break;
            }
            if (method.isDefault()) return InvocationHandler.invokeDefault(proxy, method, arguments);
            throw new UnsupportedOperationException(method.getName());
        }
    }


    /** Synthetic terrain shared with features/test-support/synthetic-world.ts: keep the two in sync. */
    static int terrainHeight(int x, int z) { return 58 + Math.floorMod(x * 7 + z * 13, 11); }

    static BlockState baseState(int x, int y, int z) {
        if (y < -64 || y >= 320) return Blocks.VOID_AIR.defaultBlockState();
        if (y == -64) return Blocks.BEDROCK.defaultBlockState();
        int height = terrainHeight(x, z);
        if (y <= height) {
            if (Math.floorMod(x + z, 9) == 0 && y >= 20 && y <= 30) return Blocks.CAVE_AIR.defaultBlockState();
            if (y == height) return height >= 63 ? Blocks.GRASS_BLOCK.defaultBlockState() : Blocks.SAND.defaultBlockState();
            if (y >= height - 3) return Blocks.DIRT.defaultBlockState();
            return Blocks.STONE.defaultBlockState();
        }
        if (y <= 62) return Blocks.WATER.defaultBlockState();
        return Blocks.AIR.defaultBlockState();
    }

    /** A WorldGenLevel over baseState plus recorded writes; writable chunks are the 3x3 around (3, -7). */
    static final class FakeWorld implements InvocationHandler {
        final Map<BlockPos, BlockState> writes = new HashMap<>();
        final JsonArray writeLog = new JsonArray();
        Holder<Biome> biome;
        RegistryAccess registryAccess;
        net.minecraft.world.level.dimension.DimensionType dimensionType;

        BlockState stateAt(BlockPos position) {
            BlockState written = writes.get(position);
            return written != null ? written : baseState(position.getX(), position.getY(), position.getZ());
        }

        int height(Heightmap.Types type, int x, int z) {
            boolean worldgenType = type == Heightmap.Types.WORLD_SURFACE_WG || type == Heightmap.Types.OCEAN_FLOOR_WG;
            for (int y = 319; y >= -64; y--) {
                BlockPos position = new BlockPos(x, y, z);
                BlockState state = worldgenType ? baseState(x, y, z) : stateAt(position);
                if (type.isOpaque().test(state)) return y + 1;
            }
            return -64;
        }

        boolean canWrite(BlockPos position) {
            return Math.abs((position.getX() >> 4) - 3) <= 1 && Math.abs((position.getZ() >> 4) + 7) <= 1;
        }

        @Override
        public Object invoke(Object proxy, Method method, Object[] arguments) throws Throwable {
            int argumentCount = arguments == null ? 0 : arguments.length;
            switch (method.getName()) {
                case "getBlockState": if (argumentCount == 1) return stateAt((BlockPos) arguments[0]); break;
                case "getFluidState": if (argumentCount == 1) return stateAt((BlockPos) arguments[0]).getFluidState(); break;
                case "isStateAtPosition": return ((java.util.function.Predicate<BlockState>) arguments[1]).test(stateAt((BlockPos) arguments[0]));
                case "isFluidAtPosition": return ((java.util.function.Predicate<FluidState>) arguments[1]).test(stateAt((BlockPos) arguments[0]).getFluidState());
                case "ensureCanWrite": return canWrite((BlockPos) arguments[0]);
                case "setBlock": {
                    BlockPos position = ((BlockPos) arguments[0]).immutable();
                    if (!canWrite(position)) return false;
                    if (position.getY() < -64 || position.getY() >= 320) return true;
                    BlockState state = (BlockState) arguments[1];
                    writes.put(position, state);
                    if (writeLog.size() < 4096) {
                        JsonArray write = new JsonArray();
                        write.add(position.getX()); write.add(position.getY()); write.add(position.getZ()); write.add(stateString(state));
                        writeLog.add(write);
                    }
                    return true;
                }
                case "getHeight":
                    if (argumentCount == 0) return 384;
                    if (argumentCount == 3) return height((Heightmap.Types) arguments[0], (Integer) arguments[1], (Integer) arguments[2]);
                    break;
                case "getMinBuildHeight": return -64;
                case "getBiome": return biome;
                case "getRawBrightness": case "getMaxLocalRawBrightness": return 0;
                case "getSeaLevel": return 63;
                case "getSeed": return 1337L;
                case "isClientSide": return false;
                case "getSkyDarken": return 0;
                case "getBlockEntity": if (argumentCount == 1) return null; break;
                case "getBlockTicks": case "getFluidTicks": return net.minecraft.world.ticks.BlackholeTickAccess.emptyLevelList();
                case "registryAccess": return registryAccess;
                case "dimensionType": return dimensionType;
                case "enabledFeatures": return net.minecraft.world.flag.FeatureFlags.DEFAULT_FLAGS;
                case "getWorldBorder": return new net.minecraft.world.level.border.WorldBorder();
                case "setCurrentlyGenerating": return null;
                case "hashCode": return System.identityHashCode(proxy);
                case "equals": return proxy == arguments[0];
                case "toString": return "FakeWorld";
                default: break;
            }
            if (method.isDefault()) return InvocationHandler.invokeDefault(proxy, method, arguments);
            throw new UnsupportedOperationException(method.getName());
        }
    }

    static String errorText(Throwable error) {
        Throwable cause = error;
        while (cause.getCause() != null) cause = cause.getCause();
        return cause.getClass().getSimpleName() + ": " + cause.getMessage();
    }

    static Boolean survives(BlockState state, FakeLevel fake, LevelReader level, BlockPos position) {
        try {
            return state.canSurvive(level, position);
        } catch (RuntimeException exception) {
            return null;
        }
    }

    static JsonObject survivalProbe(BlockState state, List<BlockState> neighbors, FakeLevel fake, LevelReader level) {
        BlockPos position = new BlockPos(0, 64, 0);
        JsonObject probe = new JsonObject();
        fake.blocks.clear();
        Boolean inAir = survives(state, fake, level, position);
        if (inAir == null) { probe.addProperty("error", true); return probe; }
        probe.addProperty("air", inAir);
        Map<String, BlockPos> neighborPositions = new LinkedHashMap<>();
        neighborPositions.put("below", position.below());
        neighborPositions.put("above", position.above());
        neighborPositions.put("north", position.north());
        for (Map.Entry<String, BlockPos> neighbor : neighborPositions.entrySet()) {
            JsonArray differing = new JsonArray();
            for (BlockState neighborState : neighbors) {
                fake.blocks.clear();
                fake.blocks.put(neighbor.getValue(), neighborState);
                Boolean result = survives(state, fake, level, position);
                if (result == null || result != inAir) differing.add(BuiltInRegistries.BLOCK.getKey(neighborState.getBlock()).toString());
            }
            if (!differing.isEmpty()) probe.add(neighbor.getKey(), differing);
        }
        if (probe.has("below")) {
            JsonArray differingWithWater = new JsonArray();
            JsonArray differingInDarkness = new JsonArray();
            for (BlockState neighborState : neighbors) {
                fake.blocks.clear();
                fake.blocks.put(position.below(), neighborState);
                fake.blocks.put(position.below().east(), Blocks.WATER.defaultBlockState());
                Boolean withWater = survives(state, fake, level, position);
                if (withWater == null || withWater != inAir) differingWithWater.add(BuiltInRegistries.BLOCK.getKey(neighborState.getBlock()).toString());
                fake.blocks.remove(position.below().east());
                fake.rawBrightness = 0;
                Boolean inDarkness = survives(state, fake, level, position);
                fake.rawBrightness = 15;
                if (inDarkness == null || inDarkness != inAir) differingInDarkness.add(BuiltInRegistries.BLOCK.getKey(neighborState.getBlock()).toString());
            }
            if (!differingWithWater.equals(probe.get("below"))) probe.add("belowWithWaterBesideIt", differingWithWater);
            if (!differingInDarkness.equals(probe.get("below"))) probe.add("belowInDarkness", differingInDarkness);
        }
        return probe;
    }

    /** States probed for survival besides the default state: one per alternative value of attachment-like properties. */
    static List<BlockState> survivalStates(Block block) {
        List<BlockState> states = new ArrayList<>();
        BlockState defaultState = block.defaultBlockState();
        states.add(defaultState);
        for (Property<?> property : defaultState.getProperties()) {
            String propertyName = property.getName();
            boolean attachment = propertyName.equals("half") || propertyName.equals("vertical_direction") || propertyName.equals("hanging")
                || propertyName.equals("face") || propertyName.equals("facing") || propertyName.equals("attachment")
                || ((propertyName.equals("north") || propertyName.equals("up") || propertyName.equals("down")) && property.getPossibleValues().contains(Boolean.TRUE));
            if (!attachment) continue;
            for (Object value : property.getPossibleValues()) {
                BlockState alternative = withValue(defaultState, property, value);
                if (alternative != defaultState && !states.contains(alternative)) states.add(alternative);
            }
        }
        return states;
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    static BlockState withValue(BlockState state, Property property, Object value) { return state.setValue(property, (Comparable) value); }

    static void writeGzip(String path, JsonElement json) throws IOException {
        Files.createDirectories(Paths.get(path).toAbsolutePath().getParent());
        try (Writer writer = new OutputStreamWriter(new GZIPOutputStream(new FileOutputStream(path)), "UTF-8")) {
            new Gson().toJson(json, writer);
        }
        System.out.println("wrote " + path);
    }

    public static void main(String[] argv) throws Exception {
        net.minecraft.SharedConstants.tryDetectVersion();
        net.minecraft.server.Bootstrap.bootStrap();
        Path datapacks = Paths.get(argv[0]);
        PackRepository repository = ServerPacksSource.createPackRepository(datapacks, new DirectoryValidator(path -> true));
        repository.reload();
        repository.setSelected(List.of("vanilla", "file/Terralith"));
        MultiPackResourceManager resources = new MultiPackResourceManager(PackType.SERVER_DATA, repository.openAllSelected());
        var initialLayers = RegistryLayer.createRegistryAccess();
        RegistryAccess.Frozen worldgen = RegistryDataLoader.load(resources, initialLayers.getAccessForLoading(RegistryLayer.WORLDGEN), RegistryDataLoader.WORLDGEN_REGISTRIES);
        var worldgenLayers = initialLayers.replaceFrom(RegistryLayer.WORLDGEN, worldgen);
        RegistryAccess.Frozen dimensions = RegistryDataLoader.load(resources, worldgenLayers.getAccessForLoading(RegistryLayer.DIMENSIONS), RegistryDataLoader.DIMENSION_REGISTRIES);
        var dimensionLayers = worldgenLayers.replaceFrom(RegistryLayer.DIMENSIONS, dimensions);
        var reloadable = net.minecraft.server.ReloadableServerResources.loadResources(resources, dimensionLayers,
            net.minecraft.world.flag.FeatureFlags.DEFAULT_FLAGS, net.minecraft.commands.Commands.CommandSelection.DEDICATED, 0,
            Runnable::run, Runnable::run).get();
        reloadable.updateRegistryTags();

        JsonObject features = new JsonObject();

        // 1. WorldgenRandom seeding exactly as ChunkGenerator.applyBiomeDecoration (chunk (3, -7) -> origin block (48, -112)).
        JsonObject seeding = new JsonObject();
        WorldgenRandom random = new WorldgenRandom(new XoroshiroRandomSource(RandomSupport.generateUniqueSeed()));
        long decorationSeed = random.setDecorationSeed(1337L, 48, -112);
        seeding.add("worldSeed", longString(1337L));
        seeding.addProperty("minBlockX", 48);
        seeding.addProperty("minBlockZ", -112);
        seeding.add("decorationSeed", longString(decorationSeed));
        JsonArray featureSeeds = new JsonArray();
        for (int step = 0; step < 11; step++) {
            for (int featureIndex : new int[]{0, 5, 200}) {
                random.setFeatureSeed(decorationSeed, featureIndex, step);
                JsonObject entry = drawsAfterSeed(random);
                entry.addProperty("step", step);
                entry.addProperty("featureIndex", featureIndex);
                featureSeeds.add(entry);
            }
        }
        seeding.add("featureSeeds", featureSeeds);
        // WorldgenRandom.setSeed does not reset the Gaussian cache, so the second Gaussian of a pair leaks across reseeding.
        random.setFeatureSeed(decorationSeed, 1, 9);
        double firstGaussian = random.nextGaussian();
        random.setFeatureSeed(decorationSeed, 2, 9);
        double leakedGaussian = random.nextGaussian();
        double freshGaussian = random.nextGaussian();
        JsonObject gaussianLeak = new JsonObject();
        gaussianLeak.addProperty("first", firstGaussian);
        gaussianLeak.addProperty("afterReseed", leakedGaussian);
        gaussianLeak.addProperty("next", freshGaussian);
        seeding.add("gaussianLeak", gaussianLeak);
        random.setFeatureSeed(decorationSeed, 3, 9);
        seeding.add("forkNextLong", longString(random.fork().nextLong()));
        features.add("seeding", seeding);

        // 2. FeatureSorter over the overworld biome source.
        LevelStem overworld = dimensions.registryOrThrow(Registries.LEVEL_STEM).get(LevelStem.OVERWORLD);
        List<Holder<Biome>> possibleBiomes = List.copyOf(overworld.generator().getBiomeSource().possibleBiomes());
        JsonArray biomeOrder = new JsonArray();
        for (Holder<Biome> biome : possibleBiomes) biomeOrder.add(biome.unwrapKey().orElseThrow().location().toString());
        features.add("possibleBiomes", biomeOrder);
        var placedRegistry = worldgen.registryOrThrow(Registries.PLACED_FEATURE);
        List<FeatureSorter.StepFeatureData> steps = FeatureSorter.buildFeaturesPerStep(possibleBiomes, biome -> biome.value().getGenerationSettings().features(), true);
        JsonArray stepsJson = new JsonArray();
        for (FeatureSorter.StepFeatureData step : steps) {
            JsonArray ids = new JsonArray();
            for (PlacedFeature placed : step.features()) ids.add(placedRegistry.getKey(placed) == null ? "<inline>" : placedRegistry.getKey(placed).toString());
            stepsJson.add(ids);
        }
        features.add("featuresPerStep", stepsJson);

        // 3. Noise used by placement modifiers and block state providers.
        JsonArray infoNoise = new JsonArray();
        int[][] infoPoints = {{0, 0}, {48, -112}, {-1000, 2500}, {4000, 4000}, {-6000, 2000}, {9000, -9000}, {123457, -98765}};
        for (int[] point : infoPoints) {
            for (double factor : new double[]{200.0, 160.0, 80.0, 1.0}) {
                JsonArray sample = new JsonArray();
                sample.add(point[0]); sample.add(point[1]); sample.add(factor);
                sample.add(Biome.BIOME_INFO_NOISE.getValue(point[0] / factor, point[1] / factor, false));
                infoNoise.add(sample);
            }
        }
        features.add("biomeInfoNoise", infoNoise);
        JsonArray providerNoise = new JsonArray();
        NormalNoise legacyNoise = NormalNoise.create(new WorldgenRandom(new LegacyRandomSource(2345L)), new NormalNoise.NoiseParameters(-3, 1.0, 1.0, 1.0, 1.0));
        NormalNoise legacyNoiseTwo = NormalNoise.create(new WorldgenRandom(new LegacyRandomSource(-4851265873398046345L)), new NormalNoise.NoiseParameters(-1, 1.0));
        int[][] blockPoints = {{0, 64, 0}, {48, 70, -112}, {-1000, 63, 2500}, {4000, 120, 4000}, {-123, -40, 77}};
        for (int[] point : blockPoints) {
            JsonArray sample = new JsonArray();
            for (int coordinate : point) sample.add(coordinate);
            sample.add(legacyNoise.getValue(point[0] * 0.005, point[1] * 0.005, point[2] * 0.005));
            sample.add(legacyNoiseTwo.getValue(point[0] * 0.02, point[1] * 0.02, point[2] * 0.02));
            providerNoise.add(sample);
        }
        features.add("legacyNormalNoise", providerNoise);

        // 4. Placed feature runs on the synthetic world.
        net.minecraft.world.level.chunk.ChunkGenerator generator = overworld.generator();
        var dimensionType = worldgen.registryOrThrow(Registries.DIMENSION_TYPE).get(net.minecraft.world.level.dimension.BuiltinDimensionTypes.OVERWORLD);
        JsonArray runs = new JsonArray();
        BlockPos decorationOrigin = new BlockPos(48, -64, -112);
        for (int step = 0; step < steps.size(); step++) {
            List<PlacedFeature> stepFeatures = steps.get(step).features();
            for (int featureIndex = 0; featureIndex < stepFeatures.size(); featureIndex++) {
                PlacedFeature placed = stepFeatures.get(featureIndex);
                Holder<Biome> owner = null;
                for (Holder<Biome> biome : possibleBiomes) {
                    if (biome.value().getGenerationSettings().hasFeature(placed)) { owner = biome; break; }
                }
                JsonObject run = new JsonObject();
                run.addProperty("id", placedRegistry.getKey(placed).toString());
                run.addProperty("step", step);
                run.addProperty("featureIndex", featureIndex);
                run.addProperty("biome", owner.unwrapKey().orElseThrow().location().toString());
                FakeWorld world = new FakeWorld();
                world.biome = owner;
                world.registryAccess = worldgen;
                world.dimensionType = dimensionType;
                net.minecraft.world.level.WorldGenLevel level = (net.minecraft.world.level.WorldGenLevel) Proxy.newProxyInstance(
                    net.minecraft.world.level.WorldGenLevel.class.getClassLoader(), new Class<?>[]{net.minecraft.world.level.WorldGenLevel.class}, world);
                WorldgenRandom featureRandom = new WorldgenRandom(new XoroshiroRandomSource(RandomSupport.generateUniqueSeed()));
                long featureDecorationSeed = featureRandom.setDecorationSeed(1337L, 48, -112);
                featureRandom.setFeatureSeed(featureDecorationSeed, featureIndex, step);
                try {
                    var context = new net.minecraft.world.level.levelgen.placement.PlacementContext(level, generator, Optional.of(placed));
                    java.util.stream.Stream<BlockPos> positions = java.util.stream.Stream.of(decorationOrigin);
                    for (var modifier : placed.placement()) {
                        positions = positions.flatMap(position -> modifier.getPositions(context, featureRandom, position));
                    }
                    JsonArray positionsJson = new JsonArray();
                    for (BlockPos position : positions.limit(512).toList()) {
                        JsonArray positionJson = new JsonArray();
                        positionJson.add(position.getX()); positionJson.add(position.getY()); positionJson.add(position.getZ());
                        positionsJson.add(positionJson);
                    }
                    run.add("positions", positionsJson);
                    run.add("nextLongAfterPositions", longString(featureRandom.nextLong()));
                } catch (Throwable error) {
                    run.addProperty("positionsError", errorText(error));
                }
                featureRandom.setFeatureSeed(featureDecorationSeed, featureIndex, step);
                try {
                    run.addProperty("placed", placed.placeWithBiomeCheck(level, generator, featureRandom, decorationOrigin));
                    run.add("writes", world.writeLog);
                    run.add("nextLongAfterPlacement", longString(featureRandom.nextLong()));
                } catch (Throwable error) {
                    run.addProperty("placementError", errorText(error));
                }
                runs.add(run);
            }
        }
        features.add("placedFeatureRuns", runs);
        writeGzip(argv[1], features);

        // 5. Block state classification and survival probes.
        JsonObject blockStates = new JsonObject();
        JsonObject blocksJson = new JsonObject();
        List<BlockState> neighborStates = new ArrayList<>();
        for (Block block : BuiltInRegistries.BLOCK) neighborStates.add(block.defaultBlockState());
        FakeLevel fake = new FakeLevel();
        LevelReader level = (LevelReader) Proxy.newProxyInstance(LevelReader.class.getClassLoader(), new Class<?>[]{LevelReader.class}, fake);
        for (Block block : BuiltInRegistries.BLOCK) {
            String name = BuiltInRegistries.BLOCK.getKey(block).toString();
            BlockState defaultState = block.defaultBlockState();
            JsonObject blockJson = new JsonObject();
            blockJson.addProperty("default", stateString(defaultState));
            blockJson.addProperty("flags", flags(defaultState));
            blockJson.addProperty("sturdy", sturdyFaces(defaultState));
            if (block instanceof LeavesBlock) blockJson.addProperty("leaves", true);
            if (block instanceof net.minecraft.world.level.block.DoublePlantBlock) blockJson.addProperty("doublePlant", true);
            if (defaultState.liquid()) blockJson.addProperty("liquid", true);
            if (defaultState.hasProperty(BlockStateProperties.WATERLOGGED)) blockJson.addProperty("waterloggable", true);
            JsonObject variants = new JsonObject();
            for (BlockState state : block.getStateDefinition().getPossibleStates()) {
                if (state.hasProperty(BlockStateProperties.WATERLOGGED) && state.getValue(BlockStateProperties.WATERLOGGED)) continue;
                String stateFlags = flags(state);
                if (!stateFlags.equals(flags(defaultState))) variants.addProperty(stateString(state), stateFlags);
            }
            if (!variants.isEmpty()) blockJson.add("variants", variants);
            JsonObject survival = new JsonObject();
            for (BlockState state : survivalStates(block)) survival.add(stateString(state), survivalProbe(state, neighborStates, fake, level));
            blockJson.add("survival", survival);
            blocksJson.add(name, blockJson);
        }
        blockStates.add("blocks", blocksJson);
        writeGzip(argv[2], blockStates);
    }
}
