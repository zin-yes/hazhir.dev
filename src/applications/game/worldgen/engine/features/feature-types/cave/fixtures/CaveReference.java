package net.minecraft.world.level.levelgen;

// Records real Minecraft 1.20.6 writes (Terralith datapack, seed 1337) of the cave and ore feature types: ore,
// scattered_ore, geode, dripstone_cluster, large_dripstone, pointed_dripstone, underwater_magma,
// netherrack_replace_blobs and lake. Every configured feature of those types (registry entries plus inline ones in
// placed features) runs through the real ConfiguredFeature.place on a synthetic layered world (see baseState:
// keep it identical to ../testing/cave-world.ts) at a list of origins with two random seeds. The world is a
// WorldGenLevel proxy over real ProtoChunk sections, so OreFeature's BulkSectionAccess writes land like in the game.
// Output: the final block differences against the base world, the return value and the random state afterwards.
// Build and run (Java 21, remapped server jar plus server libraries, see engine/noise/fixtures/ReferenceVectors.java):
//   javac -proc:none -cp mapped.jar:<server libraries> -d classes CaveReference.java
//   java -cp classes:mapped.jar:<server libraries> net.minecraft.world.level.levelgen.CaveReference \
//     <world/datapacks containing Terralith> cave/fixtures/cave-reference.json.gz
import com.google.gson.*;
import java.io.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.GZIPOutputStream;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Holder;
import net.minecraft.core.Registry;
import net.minecraft.core.RegistryAccess;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.RegistryDataLoader;
import net.minecraft.server.RegistryLayer;
import net.minecraft.server.packs.PackType;
import net.minecraft.server.packs.repository.PackRepository;
import net.minecraft.server.packs.repository.ServerPacksSource;
import net.minecraft.server.packs.resources.MultiPackResourceManager;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.LevelHeightAccessor;
import net.minecraft.world.level.biome.Biome;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.chunk.ProtoChunk;
import net.minecraft.world.level.chunk.UpgradeData;
import net.minecraft.world.level.dimension.LevelStem;
import net.minecraft.world.level.levelgen.feature.ConfiguredFeature;
import net.minecraft.world.level.levelgen.feature.Feature;
import net.minecraft.world.level.levelgen.placement.PlacedFeature;
import net.minecraft.world.level.material.FluidState;
import net.minecraft.world.level.validation.DirectoryValidator;

public class CaveReference {
    static final long WORLD_SEED = 1337L;
    static final int CENTER_CHUNK_X = 3;
    static final int CENTER_CHUNK_Z = -7;
    static final int MIN_Y = -64;
    static final int HEIGHT = 384;

    /** Block states are created after Bootstrap (Blocks must not initialize before it). */
    static final class States {
        static final BlockState AIR = Blocks.AIR.defaultBlockState();
        static final BlockState CAVE_AIR = Blocks.CAVE_AIR.defaultBlockState();
        static final BlockState VOID_AIR = Blocks.VOID_AIR.defaultBlockState();
        static final BlockState WATER = Blocks.WATER.defaultBlockState();
        static final BlockState LAVA = Blocks.LAVA.defaultBlockState();
        static final BlockState BEDROCK = Blocks.BEDROCK.defaultBlockState();
        static final BlockState GRASS = Blocks.GRASS_BLOCK.defaultBlockState();
        static final BlockState SAND = Blocks.SAND.defaultBlockState();
        static final BlockState DIRT = Blocks.DIRT.defaultBlockState();
        static final BlockState[] UPPER_POOL = {
        Blocks.STONE.defaultBlockState(), Blocks.STONE.defaultBlockState(), Blocks.STONE.defaultBlockState(), Blocks.STONE.defaultBlockState(),
        Blocks.STONE.defaultBlockState(), Blocks.STONE.defaultBlockState(), Blocks.GRANITE.defaultBlockState(), Blocks.DIORITE.defaultBlockState(),
        Blocks.ANDESITE.defaultBlockState(), Blocks.TUFF.defaultBlockState(), Blocks.CALCITE.defaultBlockState(), Blocks.BASALT.defaultBlockState(),
        Blocks.SMOOTH_BASALT.defaultBlockState(), Blocks.BLACKSTONE.defaultBlockState(), Blocks.NETHERRACK.defaultBlockState(),
        Blocks.YELLOW_TERRACOTTA.defaultBlockState(), Blocks.TERRACOTTA.defaultBlockState(), Blocks.ORANGE_TERRACOTTA.defaultBlockState(),
        Blocks.RED_TERRACOTTA.defaultBlockState(), Blocks.BROWN_TERRACOTTA.defaultBlockState(), Blocks.RED_SAND.defaultBlockState(),
        Blocks.DIRT.defaultBlockState(), Blocks.COARSE_DIRT.defaultBlockState(), Blocks.GRAVEL.defaultBlockState(), Blocks.SAND.defaultBlockState(),
        Blocks.DRIPSTONE_BLOCK.defaultBlockState(), Blocks.DEEPSLATE.defaultBlockState(), Blocks.MOSSY_COBBLESTONE.defaultBlockState(),
        Blocks.CRIMSON_NYLIUM.defaultBlockState(), Blocks.PODZOL.defaultBlockState(),
    };
        static final BlockState[] LOWER_POOL = {
        Blocks.DEEPSLATE.defaultBlockState(), Blocks.DEEPSLATE.defaultBlockState(), Blocks.DEEPSLATE.defaultBlockState(), Blocks.DEEPSLATE.defaultBlockState(),
        Blocks.DEEPSLATE.defaultBlockState(), Blocks.DEEPSLATE.defaultBlockState(), Blocks.DEEPSLATE.defaultBlockState(), Blocks.DEEPSLATE.defaultBlockState(),
        Blocks.TUFF.defaultBlockState(), Blocks.TUFF.defaultBlockState(), Blocks.CALCITE.defaultBlockState(), Blocks.SMOOTH_BASALT.defaultBlockState(),
        Blocks.BLACKSTONE.defaultBlockState(), Blocks.BASALT.defaultBlockState(), Blocks.STONE.defaultBlockState(), Blocks.LAVA.defaultBlockState(),
        Blocks.DRIPSTONE_BLOCK.defaultBlockState(), Blocks.NETHERRACK.defaultBlockState(),
    };

    }

    static int surfaceHeight(int x, int z) { return 52 + Math.floorMod(x * 7 + z * 13, 14); }
    static int cellKind(int x, int z) { return Math.floorMod((x >> 3) * 7 + (z >> 3) * 11, 6); }
    static int upperCavernFloor(int x, int z) { return 8 + Math.floorMod(x * 7 + z * 3, 4); }
    static int upperCavernCeiling(int x, int z) { return upperCavernFloor(x, z) + 7 + Math.floorMod(x * 5 + z * 11, 6); }
    static int deepCavernFloor(int x, int z) { return -40 + Math.floorMod(x * 3 + z * 5, 3); }
    static int deepCavernCeiling(int x, int z) { return deepCavernFloor(x, z) + 6 + Math.floorMod(x + z * 7, 5); }

    /** Layered synthetic world: rolling surface 52..65 over a sea at 62, dry and flooded caverns, a lava-floored deep cavern and a mixed block pool. */
    static BlockState baseState(int x, int y, int z) {
        if (y < MIN_Y || y >= MIN_Y + HEIGHT) return States.VOID_AIR;
        if (y == MIN_Y) return States.BEDROCK;
        int surface = surfaceHeight(x, z);
        if (y > surface) return y <= 62 ? States.WATER : States.AIR;
        int kind = cellKind(x, z);
        if (kind == 2 || kind == 3 || kind == 4) {
            int floor = upperCavernFloor(x, z);
            if (y > floor && y < upperCavernCeiling(x, z)) return kind == 4 && y <= floor + 3 ? States.WATER : States.CAVE_AIR;
        }
        if (kind == 1 || kind == 3) {
            int floor = deepCavernFloor(x, z);
            if (y > floor && y < deepCavernCeiling(x, z)) return y <= floor + 1 ? States.LAVA : States.CAVE_AIR;
        }
        if (y == surface) return surface >= 63 ? States.GRASS : States.SAND;
        if (y >= surface - 3) return States.DIRT;
        int index = (x >> 1) * 31 + (y >> 1) * 17 + (z >> 1) * 13 + (x >> 3) * (z >> 3) * 5;
        BlockState[] pool = y < 0 ? States.LOWER_POOL : States.UPPER_POOL;
        return pool[Math.floorMod(index, pool.length)];
    }

    static String stateString(BlockState state) {
        String name = net.minecraft.core.registries.BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString();
        TreeMap<String, String> sorted = new TreeMap<>();
        for (Map.Entry<net.minecraft.world.level.block.state.properties.Property<?>, Comparable<?>> entry : state.getValues().entrySet()) {
            sorted.put(entry.getKey().getName(), propertyValueName(entry.getKey(), entry.getValue()));
        }
        if (sorted.isEmpty()) return name;
        StringJoiner joiner = new StringJoiner(",", name + "[", "]");
        for (Map.Entry<String, String> entry : sorted.entrySet()) joiner.add(entry.getKey() + "=" + entry.getValue());
        return joiner.toString();
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    static String propertyValueName(net.minecraft.world.level.block.state.properties.Property property, Comparable value) { return property.getName(value); }

    /** A WorldGenLevel over real ProtoChunk sections; writable chunks are the 3x3 around (3, -7). */
    static final class FakeWorld implements InvocationHandler {
        final Map<Long, ProtoChunk> chunks = new HashMap<>();
        final Set<Long> touchedPositions = new LinkedHashSet<>();
        Holder<Biome> biome;
        Registry<Biome> biomeRegistry;
        RegistryAccess registryAccess;
        LevelHeightAccessor heightAccessor = LevelHeightAccessor.create(MIN_Y, HEIGHT);

        static long key(int chunkX, int chunkZ) { return ((long) chunkX << 32) ^ (chunkZ & 0xffffffffL); }

        ProtoChunk chunk(int chunkX, int chunkZ) {
            return chunks.computeIfAbsent(key(chunkX, chunkZ), ignored -> {
                ProtoChunk created = new ProtoChunk(new ChunkPos(chunkX, chunkZ), UpgradeData.EMPTY, heightAccessor, biomeRegistry, null);
                for (int sectionIndex = 0; sectionIndex < HEIGHT / 16; sectionIndex++) {
                    var section = created.getSection(sectionIndex);
                    for (int localY = 0; localY < 16; localY++) {
                        for (int localZ = 0; localZ < 16; localZ++) {
                            for (int localX = 0; localX < 16; localX++) {
                                section.setBlockState(localX, localY, localZ, baseState(chunkX * 16 + localX, MIN_Y + sectionIndex * 16 + localY, chunkZ * 16 + localZ), false);
                            }
                        }
                    }
                }
                return created;
            });
        }

        BlockState stateAt(int x, int y, int z) {
            if (y < MIN_Y || y >= MIN_Y + HEIGHT) return States.VOID_AIR;
            return chunk(x >> 4, z >> 4).getSection((y - MIN_Y) >> 4).getBlockState(x & 15, y & 15, z & 15);
        }

        BlockState stateAt(BlockPos position) { return stateAt(position.getX(), position.getY(), position.getZ()); }

        void rawSet(int x, int y, int z, BlockState state) {
            chunk(x >> 4, z >> 4).getSection((y - MIN_Y) >> 4).setBlockState(x & 15, y & 15, z & 15, state, false);
        }

        int height(Heightmap.Types type, int x, int z) {
            boolean worldgenType = type == Heightmap.Types.WORLD_SURFACE_WG || type == Heightmap.Types.OCEAN_FLOOR_WG;
            for (int y = MIN_Y + HEIGHT - 1; y >= MIN_Y; y--) {
                BlockState state = worldgenType ? baseState(x, y, z) : stateAt(x, y, z);
                if (type.isOpaque().test(state)) return y + 1;
            }
            return MIN_Y;
        }

        boolean canWrite(BlockPos position) {
            return Math.abs((position.getX() >> 4) - CENTER_CHUNK_X) <= 1 && Math.abs((position.getZ() >> 4) - CENTER_CHUNK_Z) <= 1;
        }

        @SuppressWarnings("unchecked")
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
                    BlockPos position = (BlockPos) arguments[0];
                    if (!canWrite(position)) return false;
                    if (position.getY() < MIN_Y || position.getY() >= MIN_Y + HEIGHT) return true;
                    rawSet(position.getX(), position.getY(), position.getZ(), (BlockState) arguments[1]);
                    touchedPositions.add(position.asLong());
                    return true;
                }
                case "getChunk":
                    if (argumentCount == 2 || argumentCount == 4) return chunk((Integer) arguments[0], (Integer) arguments[1]);
                    break;
                case "getHeight":
                    if (argumentCount == 0) return HEIGHT;
                    if (argumentCount == 3) return height((Heightmap.Types) arguments[0], (Integer) arguments[1], (Integer) arguments[2]);
                    break;
                case "getMinBuildHeight": return MIN_Y;
                case "getBiome": return biome;
                case "getRawBrightness": case "getMaxLocalRawBrightness": return 0;
                case "getSeaLevel": return 63;
                case "getSeed": return WORLD_SEED;
                case "isClientSide": return false;
                case "getSkyDarken": return 0;
                case "getBlockEntity": if (argumentCount == 1) return null; break;
                case "scheduleTick": return null;
                case "getBlockTicks": case "getFluidTicks": return net.minecraft.world.ticks.BlackholeTickAccess.emptyLevelList();
                case "registryAccess": return registryAccess;
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
        StackTraceElement[] trace = cause.getStackTrace();
        return cause.getClass().getSimpleName() + ": " + cause.getMessage() + (trace.length > 0 ? " at " + trace[0] : "");
    }

    static String featureTypeName(Feature<?> feature) {
        if (feature == Feature.ORE) return "ore";
        if (feature == Feature.SCATTERED_ORE) return "scattered_ore";
        if (feature == Feature.GEODE) return "geode";
        if (feature == Feature.DRIPSTONE_CLUSTER) return "dripstone_cluster";
        if (feature == Feature.LARGE_DRIPSTONE) return "large_dripstone";
        if (feature == Feature.POINTED_DRIPSTONE) return "pointed_dripstone";
        if (feature == Feature.UNDERWATER_MAGMA) return "underwater_magma";
        if (feature == Feature.REPLACE_BLOBS) return "netherrack_replace_blobs";
        if (feature == Feature.LAKE) return "lake";
        return null;
    }

    static JsonArray originJson(String name, int x, int y, int z) {
        JsonArray origin = new JsonArray();
        origin.add(name); origin.add(x); origin.add(y); origin.add(z);
        return origin;
    }

    static void writeGzip(String path, JsonElement json) throws IOException {
        Files.createDirectories(Paths.get(path).toAbsolutePath().getParent());
        try (Writer writer = new OutputStreamWriter(new GZIPOutputStream(new FileOutputStream(path)), "UTF-8")) {
            new Gson().toJson(json, writer);
        }
        System.out.println("wrote " + path);
    }

    /** First column inside the writable chunks (scan order) whose cell kind is in `kinds`; optionally on land or at sea. */
    static int[] findColumn(int[] kinds, int minSurface, int maxSurface) {
        for (int z = (CENTER_CHUNK_Z - 1) * 16; z < (CENTER_CHUNK_Z + 2) * 16; z++) {
            for (int x = (CENTER_CHUNK_X - 1) * 16 + 6; x < (CENTER_CHUNK_X + 2) * 16 - 6; x++) {
                int surface = surfaceHeight(x, z);
                if (surface < minSurface || surface > maxSurface) continue;
                int kind = cellKind(x, z);
                for (int candidate : kinds) if (candidate == kind) return new int[]{x, z};
            }
        }
        throw new IllegalStateException("no column for kinds " + Arrays.toString(kinds));
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

        LevelStem overworld = dimensions.registryOrThrow(Registries.LEVEL_STEM).get(LevelStem.OVERWORLD);
        net.minecraft.world.level.chunk.ChunkGenerator generator = overworld.generator();
        Registry<Biome> biomeRegistry = worldgen.registryOrThrow(Registries.BIOME);

        // Origins: spread over the writable chunks, in stone, cavern air, flooded cavern, sea and land.
        int[] dryCavern = findColumn(new int[]{2}, 0, 100);
        int[] floodedCavern = findColumn(new int[]{4}, 0, 100);
        int[] deepCavern = findColumn(new int[]{1, 3}, 0, 100);
        int[] sea = findColumn(new int[]{0, 5}, 0, 57);
        int[] land = findColumn(new int[]{0, 5}, 64, 100);
        List<JsonArray> origins = new ArrayList<>();
        int[][] columns = {dryCavern, floodedCavern, deepCavern, sea, land};
        String[] columnNames = {"dry", "flooded", "deep", "sea", "land"};
        for (int columnIndex = 0; columnIndex < columns.length; columnIndex++) {
            int x = columns[columnIndex][0];
            int z = columns[columnIndex][1];
            int surface = surfaceHeight(x, z);
            int floor = upperCavernFloor(x, z);
            int ceiling = upperCavernCeiling(x, z);
            int deepFloor = deepCavernFloor(x, z);
            int deepCeiling = deepCavernCeiling(x, z);
            String name = columnNames[columnIndex];
            origins.add(originJson(name + "-deepslate", x, -50, z));
            origins.add(originJson(name + "-deep-cavern", x, (deepFloor + deepCeiling) / 2, z));
            origins.add(originJson(name + "-stone", x, 2, z));
            origins.add(originJson(name + "-cavern-floor", x, floor + 1, z));
            origins.add(originJson(name + "-cavern-middle", x, (floor + ceiling) / 2, z));
            origins.add(originJson(name + "-cavern-ceiling", x, ceiling - 1, z));
            origins.add(originJson(name + "-below-surface", x, surface - 6, z));
            origins.add(originJson(name + "-surface", x, surface, z));
            origins.add(originJson(name + "-above-surface", x, surface + 1, z));
        }
        long[] seeds = {11L, 4242L};

        // Features of the types under test.
        Registry<ConfiguredFeature<?, ?>> configuredRegistry = worldgen.registryOrThrow(Registries.CONFIGURED_FEATURE);
        Registry<PlacedFeature> placedRegistry = worldgen.registryOrThrow(Registries.PLACED_FEATURE);
        TreeMap<String, ConfiguredFeature<?, ?>> featuresByKey = new TreeMap<>();
        for (var entry : configuredRegistry.entrySet()) {
            if (featureTypeName(entry.getValue().feature()) != null) featuresByKey.put("configured:" + entry.getKey().location(), entry.getValue());
        }
        for (var entry : placedRegistry.entrySet()) {
            Holder<ConfiguredFeature<?, ?>> holder = entry.getValue().feature();
            if (holder.unwrapKey().isPresent()) continue;
            if (featureTypeName(holder.value().feature()) != null) featuresByKey.put("placed:" + entry.getKey().location(), holder.value());
        }

        // Inline placed features of simple_random_selector configured features (vanilla pointed_dripstone is one).
        for (var entry : configuredRegistry.entrySet()) {
            if (entry.getValue().feature() != Feature.SIMPLE_RANDOM_SELECTOR) continue;
            var selectorConfig = (net.minecraft.world.level.levelgen.feature.configurations.SimpleRandomFeatureConfiguration) entry.getValue().config();
            for (int index = 0; index < selectorConfig.features.size(); index++) {
                Holder<PlacedFeature> holder = selectorConfig.features.get(index);
                if (holder.unwrapKey().isPresent()) continue;
                ConfiguredFeature<?, ?> inner = holder.value().feature().value();
                if (featureTypeName(inner.feature()) != null) featuresByKey.put("selector:" + entry.getKey().location() + "#" + index, inner);
            }
        }

        FakeWorld world = new FakeWorld();
        world.biomeRegistry = biomeRegistry;
        world.biome = biomeRegistry.getHolderOrThrow(net.minecraft.world.level.biome.Biomes.PLAINS);
        world.registryAccess = worldgen;
        net.minecraft.world.level.WorldGenLevel level = (net.minecraft.world.level.WorldGenLevel) Proxy.newProxyInstance(
            net.minecraft.world.level.WorldGenLevel.class.getClassLoader(), new Class<?>[]{net.minecraft.world.level.WorldGenLevel.class}, world);

        JsonArray originsJson = new JsonArray();
        origins.forEach(originsJson::add);
        List<String> stateNames = new ArrayList<>();
        Map<String, Integer> stateIndexByName = new HashMap<>();
        JsonArray runs = new JsonArray();
        long startedAt = System.currentTimeMillis();
        for (var featureEntry : featuresByKey.entrySet()) {
            ConfiguredFeature<?, ?> feature = featureEntry.getValue();
            String typeName = featureTypeName(feature.feature());
            for (int originIndex = 0; originIndex < origins.size(); originIndex++) {
                JsonArray originJson = origins.get(originIndex);
                BlockPos origin = new BlockPos(originJson.get(1).getAsInt(), originJson.get(2).getAsInt(), originJson.get(3).getAsInt());
                // Geodes touch tens of thousands of blocks per run: a third of the origins with one seed keeps the fixture small.
                if (typeName.equals("geode") && originIndex % 3 != 0) continue;
                for (long seed : seeds) {
                    if (typeName.equals("geode") && seed != seeds[0]) continue;
                    JsonObject run = new JsonObject();
                    run.addProperty("key", featureEntry.getKey());
                    run.addProperty("type", typeName);
                    run.addProperty("origin", originIndex);
                    run.addProperty("seed", seed);
                    world.touchedPositions.clear();
                    WorldgenRandom random = new WorldgenRandom(new XoroshiroRandomSource(seed));
                    try {
                        run.addProperty("placed", feature.place(level, generator, random, origin));
                        run.addProperty("nextLong", Long.toString(random.nextLong()));
                    } catch (Throwable error) {
                        run.addProperty("error", errorText(error));
                    }
                    // Changed positions: everything setBlock touched, plus a box around the origin for ore (it writes into sections directly).
                    Set<Long> candidates = new LinkedHashSet<>(world.touchedPositions);
                    if (typeName.equals("ore")) {
                        for (int y = origin.getY() - 24; y <= origin.getY() + 24; y++) {
                            for (int z = origin.getZ() - 24; z <= origin.getZ() + 24; z++) {
                                for (int x = origin.getX() - 24; x <= origin.getX() + 24; x++) {
                                    if (y >= MIN_Y && y < MIN_Y + HEIGHT) candidates.add(new BlockPos(x, y, z).asLong());
                                }
                            }
                        }
                    }
                    TreeMap<Long, BlockState> changes = new TreeMap<>();
                    for (long packed : candidates) {
                        BlockPos position = BlockPos.of(packed);
                        BlockState current = world.stateAt(position);
                        BlockState base = baseState(position.getX(), position.getY(), position.getZ());
                        if (current != base) {
                            changes.put(packed, current);
                            world.rawSet(position.getX(), position.getY(), position.getZ(), base);
                        }
                    }
                    JsonArray writes = new JsonArray();
                    List<Map.Entry<Long, BlockState>> sortedChanges = new ArrayList<>(changes.entrySet());
                    sortedChanges.sort(Comparator.comparingInt((Map.Entry<Long, BlockState> change) -> BlockPos.of(change.getKey()).getY())
                        .thenComparingInt(change -> BlockPos.of(change.getKey()).getZ()).thenComparingInt(change -> BlockPos.of(change.getKey()).getX()));
                    for (var change : sortedChanges) {
                        BlockPos position = BlockPos.of(change.getKey());
                        String stateName = stateString(change.getValue());
                        Integer stateIndex = stateIndexByName.get(stateName);
                        if (stateIndex == null) { stateIndex = stateNames.size(); stateNames.add(stateName); stateIndexByName.put(stateName, stateIndex); }
                        JsonArray write = new JsonArray();
                        write.add(position.getX()); write.add(position.getY()); write.add(position.getZ()); write.add(stateIndex);
                        writes.add(write);
                    }
                    run.add("writes", writes);
                    runs.add(run);
                }
            }
            System.out.println(featureEntry.getKey() + " done (" + (System.currentTimeMillis() - startedAt) + " ms)");
        }
        JsonObject output = new JsonObject();
        output.addProperty("seed", WORLD_SEED);
        output.add("origins", originsJson);
        JsonArray statesJson = new JsonArray();
        stateNames.forEach(statesJson::add);
        output.add("states", statesJson);
        output.add("runs", runs);
        writeGzip(argv[1], output);
    }
}
