package net.minecraft.world.level.levelgen;

// Records real Minecraft 1.20.6 outputs (Terralith datapack, seed 1337) for the ground feature types in
// engine/features/feature-types/ground (disk, vegetation_patch, waterlogged_vegetation_patch, multiface_growth,
// vines, bamboo, seagrass, kelp, sea_pickle, coral_*, spring_feature, sculk_patch, block_pile):
//   1. Every configured feature of those types (all vanilla + Terralith ids) is placed directly with
//      ConfiguredFeature.place at several origins in three synthetic scenario worlds (see `terrain`, mirrored by
//      ground-scenario-world.ts), with a decoration-seeded WorldgenRandom. The recorded values are the return value,
//      the final block written at every position and the random state afterwards.
//   2. The multiface "attach" faces (Block.isFaceFull of the support or collision shape) and collision-full blocks
//      for every registered block, as exceptions to the recorded sturdy faces (see block-faces.generated.ts).
// Build and run (Java 21, mapped.jar + server libraries as for FeaturesReference.java; `datapacks` is a folder
// holding the Terralith pack directory):
//   javac -proc:none -cp mapped.jar:<server libraries> -d classes GroundReference.java
//   java -cp classes:mapped.jar:<server libraries> net.minecraft.world.level.levelgen.GroundReference \
//     <datapacks> features/feature-types/ground/fixtures/ground-reference.json.gz
import com.google.gson.*;
import java.io.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.GZIPOutputStream;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.Holder;
import net.minecraft.core.Registry;
import net.minecraft.core.RegistryAccess;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.RegistryDataLoader;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.RegistryLayer;
import net.minecraft.server.packs.PackType;
import net.minecraft.server.packs.repository.PackRepository;
import net.minecraft.server.packs.repository.ServerPacksSource;
import net.minecraft.server.packs.resources.MultiPackResourceManager;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.EmptyBlockGetter;
import net.minecraft.world.level.LevelHeightAccessor;
import net.minecraft.world.level.biome.Biome;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraft.world.level.chunk.ChunkAccess;
import net.minecraft.world.level.chunk.ProtoChunk;
import net.minecraft.world.level.chunk.UpgradeData;
import net.minecraft.world.level.dimension.LevelStem;
import net.minecraft.world.level.levelgen.feature.ConfiguredFeature;
import net.minecraft.world.level.material.FluidState;
import net.minecraft.world.level.validation.DirectoryValidator;
import net.minecraft.world.phys.shapes.VoxelShape;

public class GroundReference {
    static final String[] SCENARIOS = {"land", "ocean", "peaks"};
    static final int LAND = 0, OCEAN = 1, PEAKS = 2;
    static final String[] PALETTE = {
        "air", "cave_air", "water", "bedrock", "stone", "deepslate", "dirt", "grass_block", "sand", "gravel", "clay", "podzol",
        "coarse_dirt", "snow_block", "calcite", "tuff", "moss_block", "mud", "andesite", "granite", "diorite", "dripstone_block",
        "oak_log", "oak_leaves", "dark_oak_log", "dark_oak_leaves"};
    static final int AIR = 0, CAVE_AIR = 1, WATER = 2, BEDROCK = 3, STONE = 4, DEEPSLATE = 5, DIRT = 6, GRASS = 7, SAND = 8,
        GRAVEL = 9, CLAY = 10, PODZOL = 11, COARSE_DIRT = 12, SNOW_BLOCK = 13, CALCITE = 14, TUFF = 15, MOSS = 16, MUD = 17,
        ANDESITE = 18, GRANITE = 19, DIORITE = 20, DRIPSTONE = 21, OAK_LOG = 22, OAK_LEAVES = 23, DARK_OAK_LOG = 24, DARK_OAK_LEAVES = 25;
    static final int CENTER_CHUNK_X = 3, CENTER_CHUNK_Z = -7;
    static final int DECORATION_STEP = 5;

    // ---- scenario terrain (mirrored in ground-scenario-world.ts: keep both definitions identical) ----

    static int mod(int value, int divisor) { return Math.floorMod(value, divisor); }
    static int div(int value, int divisor) { return Math.floorDiv(value, divisor); }
    static int hash3(int x, int y, int z) { return mod((x * 73856093) ^ (y * 19349663) ^ (z * 83492791), 1000); }

    static int heightAt(int scenario, int x, int z) {
        switch (scenario) {
            case LAND: {
                int base = 62 + mod(x * 7 + z * 13, 9);
                return mod(div(x, 9) * 2 + div(z, 9) * 5, 7) == 0 ? base - 5 : base;
            }
            case OCEAN: return 34 + mod(x * 5 + z * 3, 21);
            default: return 70 + mod(x * 3 + z * 5, 13);
        }
    }

    static int surfaceBlock(int scenario, int x, int z, int height) {
        int patch = mod(div(x, 5) * 3 + div(z, 5) * 7, 8);
        switch (scenario) {
            case LAND: {
                if (height < 62) return (patch & 1) == 0 ? SAND : CLAY;
                int[] top = {GRASS, GRASS, DIRT, SAND, GRAVEL, PODZOL, COARSE_DIRT, GRASS};
                return top[patch];
            }
            case OCEAN: {
                int[] top = {SAND, SAND, GRAVEL, CLAY, DIRT, GRAVEL, SAND, STONE};
                return top[patch];
            }
            default: {
                int[] top = {SNOW_BLOCK, STONE, CALCITE, TUFF, MOSS, MUD, GRASS, SNOW_BLOCK};
                return top[patch];
            }
        }
    }

    static int deepBlock(int x, int y, int z) {
        int value = hash3(div(x, 3), div(y, 3), div(z, 3));
        if (y < 0) return value < 80 ? TUFF : DEEPSLATE;
        if (value < 12) return ANDESITE;
        if (value < 24) return TUFF;
        if (value < 32) return CALCITE;
        if (value < 42) return GRANITE;
        if (value < 52) return DRIPSTONE;
        if (value < 62) return DIORITE;
        return STONE;
    }

    /** CAVE_AIR, WATER or -1 (solid). */
    static int caveBlock(int x, int y, int z) {
        boolean room = y >= 12 && y <= 22 && mod(div(x, 8) * 5 + div(z, 8) * 3, 4) == 0 && mod(x * 5 + z * 3, 9) != 0;
        if (room) return y <= 14 && mod(div(x, 8) + div(z, 8), 2) == 0 ? WATER : CAVE_AIR;
        boolean pocket = y >= 8 && y <= 30 && mod(x * 3 + z * 5 + div(y, 2) * 7, 11) < 4;
        return pocket ? CAVE_AIR : -1;
    }

    static int terrain(int scenario, int x, int y, int z) {
        if (y == -64) return BEDROCK;
        int height = heightAt(scenario, x, z);
        if (y <= height) {
            int cave = caveBlock(x, y, z);
            if (cave >= 0) return cave;
            if (y == height) return surfaceBlock(scenario, x, z, height);
            if (y >= height - 3) {
                int top = surfaceBlock(scenario, x, z, height);
                if (top == SAND) return SAND;
                return scenario == PEAKS ? STONE : DIRT;
            }
            return deepBlock(x, y, z);
        }
        if (y <= 62) return WATER;
        if (scenario != OCEAN) {
            int centerX = 7 * div(x, 7) + 3;
            int centerZ = 7 * div(z, 7) + 3;
            int deltaX = x - centerX;
            int deltaZ = z - centerZ;
            if (Math.abs(deltaX) <= 2 && Math.abs(deltaZ) <= 2 && mod(div(x, 7) * 5 + div(z, 7) * 3, 3) != 2) {
                int centerHeight = heightAt(scenario, centerX, centerZ);
                if (centerHeight >= 63) {
                    int log = scenario == LAND ? OAK_LOG : DARK_OAK_LOG;
                    int leaves = scenario == LAND ? OAK_LEAVES : DARK_OAK_LEAVES;
                    if (deltaX == 0 && deltaZ == 0 && y >= centerHeight + 1 && y <= centerHeight + 5) return log;
                    if (y == centerHeight + 4 || y == centerHeight + 5) return leaves;
                    if (y == centerHeight + 6 && Math.abs(deltaX) <= 1 && Math.abs(deltaZ) <= 1) return leaves;
                }
            }
        }
        return AIR;
    }

    static BlockState[] paletteStates;

    static BlockState baseState(int scenario, int x, int y, int z) {
        if (y < -64 || y >= 320) return Blocks.VOID_AIR.defaultBlockState();
        return paletteStates[terrain(scenario, x, y, z)];
    }

    // ---- reference plumbing ----

    static JsonPrimitive longString(long value) { return new JsonPrimitive(Long.toString(value)); }

    @SuppressWarnings({"unchecked", "rawtypes"})
    static String propertyValueName(Property property, Comparable value) { return property.getName(value); }

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

    static String errorText(Throwable error) {
        Throwable cause = error;
        while (cause.getCause() != null) cause = cause.getCause();
        return cause.getClass().getSimpleName() + ": " + cause.getMessage();
    }

    /** A WorldGenLevel over the scenario terrain plus recorded writes; writable chunks are the 3x3 around the center chunk. */
    static final class FakeWorld implements InvocationHandler {
        final int scenario;
        final Map<BlockPos, BlockState> writes = new LinkedHashMap<>();
        final Map<Long, ProtoChunk> chunks = new HashMap<>();
        final Registry<Biome> biomeRegistry;
        final Holder<Biome> biome;
        final RegistryAccess registryAccess;
        final net.minecraft.world.level.dimension.DimensionType dimensionType;

        FakeWorld(int scenario, Holder<Biome> biome, Registry<Biome> biomeRegistry, RegistryAccess registryAccess, net.minecraft.world.level.dimension.DimensionType dimensionType) {
            this.scenario = scenario;
            this.registryAccess = registryAccess;
            this.dimensionType = dimensionType;
            this.biome = biome;
            this.biomeRegistry = biomeRegistry;
        }

        BlockState stateAt(BlockPos position) {
            BlockState written = writes.get(position);
            return written != null ? written : baseState(scenario, position.getX(), position.getY(), position.getZ());
        }

        int height(Heightmap.Types type, int x, int z) {
            boolean worldgenType = type == Heightmap.Types.WORLD_SURFACE_WG || type == Heightmap.Types.OCEAN_FLOOR_WG;
            for (int y = 319; y >= -64; y--) {
                BlockState state = worldgenType ? baseState(scenario, x, y, z) : stateAt(new BlockPos(x, y, z));
                if (type.isOpaque().test(state)) return y + 1;
            }
            return -64;
        }

        boolean canWrite(BlockPos position) {
            return Math.abs((position.getX() >> 4) - CENTER_CHUNK_X) <= 1 && Math.abs((position.getZ() >> 4) - CENTER_CHUNK_Z) <= 1;
        }

        ProtoChunk chunk(int chunkX, int chunkZ) {
            return chunks.computeIfAbsent(ChunkPos.asLong(chunkX, chunkZ), key ->
                new ProtoChunk(new ChunkPos(chunkX, chunkZ), UpgradeData.EMPTY, LevelHeightAccessor.create(-64, 384), biomeRegistry, null));
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
                    writes.put(position, (BlockState) arguments[1]);
                    return true;
                }
                case "getChunk": if (argumentCount == 4) return chunk((Integer) arguments[0], (Integer) arguments[1]); break;
                case "scheduleTick": return null;
                case "playSound": case "levelEvent": case "gameEvent": return null;
                case "getEntities": case "getEntitiesOfClass": return List.of();
                case "registryAccess": return registryAccess;
                case "dimensionType": return dimensionType;
                case "getHeight":
                    if (argumentCount == 0) return 384;
                    if (argumentCount == 3) return height((Heightmap.Types) arguments[0], (Integer) arguments[1], (Integer) arguments[2]);
                    break;
                case "getMinBuildHeight": return -64;
                case "getMaxBuildHeight": return 320;
                case "getBiome": return biome;
                case "getRawBrightness": case "getMaxLocalRawBrightness": return 0;
                case "getSeaLevel": return 63;
                case "getSeed": return 1337L;
                case "isClientSide": return false;
                case "getSkyDarken": return 0;
                case "getBlockEntity": if (argumentCount == 1) return null; break;
                case "getBlockTicks": case "getFluidTicks": return net.minecraft.world.ticks.BlackholeTickAccess.emptyLevelList();
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

    static void writeGzip(String path, JsonElement json) throws IOException {
        Files.createDirectories(Paths.get(path).toAbsolutePath().getParent());
        try (Writer writer = new OutputStreamWriter(new GZIPOutputStream(new FileOutputStream(path)), "UTF-8")) {
            new Gson().toJson(json, writer);
        }
        System.out.println("wrote " + path);
    }

    static boolean motionBlocking(int scenario, int x, int y, int z) { return paletteStates[terrain(scenario, x, y, z)].blocksMotion(); }

    /** Origins per scenario: surface above (and inside, for the first column) the ground at ten columns, plus cave floor / ceiling / pool cells. */
    static List<int[]> scenarioOrigins(int scenario) {
        List<int[]> origins = new ArrayList<>();
        int[][] columns = {{51, -109}, {56, -104}, {60, -100}, {49, -105}, {54, -110}, {58, -108}, {62, -104}, {53, -99}, {57, -101}, {50, -100}};
        for (int index = 0; index < columns.length; index++) {
            int x = columns[index][0], z = columns[index][1];
            int floor = 200;
            while (!motionBlocking(scenario, x, floor, z)) floor--;
            origins.add(new int[]{x, floor + 1, z});
            if (index == 0) origins.add(new int[]{x, floor, z});
        }
        int floorOrigins = 0, ceilingOrigins = 0, poolOrigins = 0;
        for (int z = -111; z <= -98 && (floorOrigins < 3 || ceilingOrigins < 2 || poolOrigins < 1); z++) {
            for (int x = 49; x <= 62; x++) {
                for (int y = 9; y <= 30; y++) {
                    int block = terrain(scenario, x, y, z);
                    boolean below = motionBlocking(scenario, x, y - 1, z);
                    boolean above = motionBlocking(scenario, x, y + 1, z);
                    if (block == CAVE_AIR && below && floorOrigins < 3 && (x + z) % 5 == 0) { origins.add(new int[]{x, y, z}); floorOrigins++; }
                    else if (block == CAVE_AIR && above && ceilingOrigins < 2 && (x + z) % 4 == 0) { origins.add(new int[]{x, y, z}); ceilingOrigins++; }
                    else if (block == WATER && below && poolOrigins < 1) { origins.add(new int[]{x, y, z}); poolOrigins++; }
                }
            }
        }
        // Spring candidates: a solid cell with a solid roof, and exactly one non-solid neighbor among west, east, north, south and below.
        int springOrigins = 0;
        for (int z = -111; z <= -98 && springOrigins < 3; z++) {
            for (int x = 49; x <= 62 && springOrigins < 3; x++) {
                for (int y = 9; y <= 30 && springOrigins < 3; y++) {
                    if (!motionBlocking(scenario, x, y, z) || !motionBlocking(scenario, x, y + 1, z)) continue;
                    int openNeighbors = 0;
                    if (!motionBlocking(scenario, x - 1, y, z)) openNeighbors++;
                    if (!motionBlocking(scenario, x + 1, y, z)) openNeighbors++;
                    if (!motionBlocking(scenario, x, y, z - 1)) openNeighbors++;
                    if (!motionBlocking(scenario, x, y, z + 1)) openNeighbors++;
                    if (!motionBlocking(scenario, x, y - 1, z)) openNeighbors++;
                    if (openNeighbors == 1 && (x + y + z) % 3 == 0) { origins.add(new int[]{x, y, z}); springOrigins++; }
                }
            }
        }
        return origins;
    }

    static final Set<String> GROUND_TYPES = Set.of("disk", "vegetation_patch", "waterlogged_vegetation_patch", "multiface_growth", "vines",
        "bamboo", "seagrass", "kelp", "sea_pickle", "coral_tree", "coral_claw", "coral_mushroom", "spring_feature", "sculk_patch", "block_pile");

    /** The coral types only occur inline, inside warm_ocean_vegetation, so that configured feature is recorded too. */
    static final Set<String> INLINE_GROUND_TYPE_CARRIERS = Set.of("minecraft:warm_ocean_vegetation");

    static int sturdyMask(BlockState state) {
        int mask = 0;
        for (Direction direction : Direction.values()) {
            if (state.isFaceSturdy(EmptyBlockGetter.INSTANCE, BlockPos.ZERO, direction)) mask |= 1 << direction.ordinal();
        }
        return mask;
    }

    static int fullFacesMask(VoxelShape shape) {
        int mask = 0;
        for (Direction direction : Direction.values()) if (Block.isFaceFull(shape, direction)) mask |= 1 << direction.ordinal();
        return mask;
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

        paletteStates = new BlockState[PALETTE.length];
        for (int index = 0; index < PALETTE.length; index++) {
            paletteStates[index] = BuiltInRegistries.BLOCK.get(new ResourceLocation(PALETTE[index])).defaultBlockState();
        }

        JsonObject reference = new JsonObject();
        reference.add("scenarioNames", new Gson().toJsonTree(SCENARIOS));
        reference.add("palette", new Gson().toJsonTree(PALETTE));

        LevelStem overworld = dimensions.registryOrThrow(Registries.LEVEL_STEM).get(LevelStem.OVERWORLD);
        net.minecraft.world.level.chunk.ChunkGenerator generator = overworld.generator();
        Registry<Biome> biomeRegistry = worldgen.registryOrThrow(Registries.BIOME);
        Holder<Biome> biome = biomeRegistry.getHolderOrThrow(net.minecraft.world.level.biome.Biomes.PLAINS);
        var dimensionType = worldgen.registryOrThrow(Registries.DIMENSION_TYPE).get(net.minecraft.world.level.dimension.BuiltinDimensionTypes.OVERWORLD);
        var configuredRegistry = worldgen.registryOrThrow(Registries.CONFIGURED_FEATURE);

        List<ResourceLocation> featureIds = new ArrayList<>();
        for (ResourceLocation id : configuredRegistry.keySet()) {
            String typePath = BuiltInRegistries.FEATURE.getKey(configuredRegistry.get(id).feature()).getPath();
            if (GROUND_TYPES.contains(typePath) || INLINE_GROUND_TYPE_CARRIERS.contains(id.toString())) featureIds.add(id);
        }
        featureIds.sort(Comparator.comparing(ResourceLocation::toString));

        // Terrain parity samples so the TypeScript mirror can prove it builds the same world.
        JsonArray terrainSamples = new JsonArray();
        for (int scenario = 0; scenario < SCENARIOS.length; scenario++) {
            for (int x = 40; x <= 72; x += 3) {
                for (int z = -120; z <= -90; z += 3) {
                    for (int y = -64; y <= 100; y += 4) {
                        JsonArray sample = new JsonArray();
                        sample.add(scenario); sample.add(x); sample.add(y); sample.add(z); sample.add(terrain(scenario, x, y, z));
                        terrainSamples.add(sample);
                    }
                }
            }
        }
        reference.add("terrainSamples", terrainSamples);

        JsonArray runs = new JsonArray();
        Map<String, Integer> stateIndexByName = new LinkedHashMap<>();
        long decorationSeed;
        {
            WorldgenRandom seedRandom = new WorldgenRandom(new XoroshiroRandomSource(RandomSupport.generateUniqueSeed()));
            decorationSeed = seedRandom.setDecorationSeed(1337L, CENTER_CHUNK_X * 16, CENTER_CHUNK_Z * 16);
        }
        reference.addProperty("step", DECORATION_STEP);
        reference.add("featureIds", new Gson().toJsonTree(featureIds.stream().map(ResourceLocation::toString).toList()));
        JsonArray originsJson = new JsonArray();
        for (int scenario = 0; scenario < SCENARIOS.length; scenario++) {
            JsonArray scenarioOrigins = new JsonArray();
            for (int[] origin : scenarioOrigins(scenario)) { JsonArray originJson = new JsonArray(); for (int value : origin) originJson.add(value); scenarioOrigins.add(originJson); }
            originsJson.add(scenarioOrigins);
        }
        reference.add("origins", originsJson);

        int featureIndexCounter = 0;
        for (int featureNumber = 0; featureNumber < featureIds.size(); featureNumber++) {
            ResourceLocation id = featureIds.get(featureNumber);
            ConfiguredFeature<?, ?> configured = configuredRegistry.get(id);
            for (int scenario = 0; scenario < SCENARIOS.length; scenario++) {
                List<int[]> origins = scenarioOrigins(scenario);
                for (int originIndex = 0; originIndex < origins.size(); originIndex++) {
                    int[] origin = origins.get(originIndex);
                    int featureIndex = featureIndexCounter++;
                    FakeWorld world = new FakeWorld(scenario, biome, biomeRegistry, worldgen, dimensionType);
                    net.minecraft.world.level.WorldGenLevel level = (net.minecraft.world.level.WorldGenLevel) Proxy.newProxyInstance(
                        net.minecraft.world.level.WorldGenLevel.class.getClassLoader(), new Class<?>[]{net.minecraft.world.level.WorldGenLevel.class}, world);
                    WorldgenRandom random = new WorldgenRandom(new XoroshiroRandomSource(RandomSupport.generateUniqueSeed()));
                    random.setFeatureSeed(decorationSeed, featureIndex, DECORATION_STEP);
                    JsonObject run = new JsonObject();
                    run.addProperty("feature", id.toString());
                    run.addProperty("scenario", scenario);
                    run.addProperty("originIndex", originIndex);
                    run.addProperty("featureIndex", featureIndex);
                    try {
                        boolean placed = configured.place(level, generator, random, new BlockPos(origin[0], origin[1], origin[2]));
                        run.addProperty("placed", placed);
                        run.add("nextLong", longString(random.nextLong()));
                        JsonArray writesJson = new JsonArray();
                        for (Map.Entry<BlockPos, BlockState> entry : world.writes.entrySet()) {
                            BlockPos position = entry.getKey();
                            Integer stateIndex = stateIndexByName.computeIfAbsent(stateString(entry.getValue()), key -> stateIndexByName.size());
                            writesJson.add(position.getX() - origin[0]); writesJson.add(position.getY() - origin[1]); writesJson.add(position.getZ() - origin[2]); writesJson.add(stateIndex);
                        }
                        run.add("writes", writesJson);
                    } catch (Throwable error) {
                        run.addProperty("error", errorText(error));
                        error.printStackTrace(System.err);
                    }
                    runs.add(run);
                }
            }
        }
        reference.add("states", new Gson().toJsonTree(new ArrayList<>(stateIndexByName.keySet())));
        reference.add("runs", runs);

        // Attach faces: Block.isFaceFull(support shape) || isFaceFull(collision shape), against the recorded sturdy faces.
        JsonObject attachExceptions = new JsonObject();
        JsonObject collisionFullOverrides = new JsonObject();
        for (Block block : BuiltInRegistries.BLOCK) {
            BlockState state = block.defaultBlockState();
            String name = BuiltInRegistries.BLOCK.getKey(block).toString();
            try {
                int sturdy = sturdyMask(state);
                int attach = fullFacesMask(state.getBlockSupportShape(EmptyBlockGetter.INSTANCE, BlockPos.ZERO))
                    | fullFacesMask(state.getCollisionShape(EmptyBlockGetter.INSTANCE, BlockPos.ZERO));
                if (attach != sturdy) attachExceptions.addProperty(name, attach);
                boolean collisionFull = state.isCollisionShapeFullBlock(EmptyBlockGetter.INSTANCE, BlockPos.ZERO);
                if (collisionFull != (sturdy == 63)) collisionFullOverrides.addProperty(name, collisionFull);
            } catch (RuntimeException exception) {
                System.err.println("faces failed for " + name + ": " + exception);
            }
        }
        // java.util.HashSet<BlockPos> iteration order for patch-shaped position sets (tree bins included).
        JsonArray hashSetOrders = new JsonArray();
        int[][] hashSetCases = {{1, 6, 3, 40}, {2, 8, 4, 120}, {3, 8, 6, 200}, {4, 12, 7, 400}, {5, 5, 2, 70}, {6, 16, 10, 900}};
        for (int[] hashSetCase : hashSetCases) {
            Random positionRandom = new Random(hashSetCase[0]);
            HashSet<BlockPos> set = new HashSet<>();
            JsonArray inserted = new JsonArray();
            for (int attempt = 0; attempt < hashSetCase[3]; attempt++) {
                BlockPos position = new BlockPos(48 + positionRandom.nextInt(hashSetCase[1] * 2 + 1) - hashSetCase[1], 60 + positionRandom.nextInt(hashSetCase[2]), -104 + positionRandom.nextInt(hashSetCase[1] * 2 + 1) - hashSetCase[1]);
                if (set.add(position)) { inserted.add(position.getX()); inserted.add(position.getY()); inserted.add(position.getZ()); }
            }
            JsonArray order = new JsonArray();
            for (BlockPos position : set) { order.add(position.getX()); order.add(position.getY()); order.add(position.getZ()); }
            JsonObject hashSetOrder = new JsonObject();
            hashSetOrder.add("inserted", inserted);
            hashSetOrder.add("order", order);
            hashSetOrders.add(hashSetOrder);
        }
        reference.add("hashSetOrders", hashSetOrders);
        reference.add("attachFaceExceptions", attachExceptions);
        reference.add("collisionFullOverrides", collisionFullOverrides);
        writeGzip(argv[1], reference);
    }
}
