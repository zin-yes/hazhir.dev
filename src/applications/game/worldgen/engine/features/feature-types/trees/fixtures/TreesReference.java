package net.minecraft.world.level.levelgen;

// Records real Minecraft 1.20.6 outputs (Terralith datapack) for the tree feature types: every configured feature
// that is a minecraft:tree, minecraft:root_system, minecraft:huge_red_mushroom or minecraft:huge_brown_mushroom is
// placed through ConfiguredFeature.place on a synthetic world at several origins, each with its own seed
// (new WorldgenRandom(new XoroshiroRandomSource(seed))). Per run: the result, every accepted WorldGenLevel.setBlock in
// order, and the next random long. The synthetic world mirrors trees-test-world.ts (keep both in sync): rolling
// plateau terrain with a sandy and muddy shallow, plus short grass, tall grass, poppies, floating stone pillars and, for root systems, a stone and dirt slab floating over x >= 72, z <= -120.
// Also writes block behavior tables as the second output file: BlockState.isSolidRender (huge mushrooms) and, per state,
// the directions from which BlockState.updateShape turns the block into air when it is unsupported (the neighbor
// updates TreeFeature runs along the faces of the placed tree).
//
// The beehive decorator shuffles with Collections.shuffle(list), which uses an unseeded java.util.Random. This harness
// replaces that shared Random (reflection on Collections.r, needs --add-opens java.base/java.util=ALL-UNNAMED) with
// new Random(beehiveShuffleSeed(origin)), the seed the TypeScript port derives from the tree origin.
//
// Build against the remapped server jar (see engine/noise/fixtures/ReferenceVectors.java for the remap), Java 21:
//   javac -proc:none -cp mapped.jar:<server libraries> -d classes TreesReference.java
//   java --add-opens java.base/java.util=ALL-UNNAMED -cp classes:mapped.jar:<server libraries> \
//     net.minecraft.world.level.levelgen.TreesReference <world/datapacks containing Terralith> \
//     feature-types/trees/fixtures/trees-reference.json.gz feature-types/trees/fixtures/block-behavior-reference.json.gz
import com.google.gson.*;
import java.io.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.GZIPOutputStream;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Holder;
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
import net.minecraft.world.level.biome.Biome;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.EntityBlock;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.BlockStateProperties;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraft.world.level.dimension.LevelStem;
import net.minecraft.world.level.levelgen.feature.ConfiguredFeature;
import net.minecraft.world.level.levelgen.feature.Feature;
import net.minecraft.world.level.material.FluidState;
import net.minecraft.world.level.validation.DirectoryValidator;

public class TreesReference {
    static final int[][] ORIGIN_COLUMNS = {{60, -100}, {52, -108}, {68, -92}, {44, -124}, {38, -120}, {33, -95}};
    /** Extra origins under the floating slab, for root systems (azalea trees grow above the slab, hanging roots below it). */
    static final int[][] ROOT_SYSTEM_COLUMNS = {{74, -124}, {76, -122}, {78, -126}};

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

    /** Flat 8x8 plateaus 1-3 blocks apart (land, y 66..69), and a sandy shallow (y 58) west of x = 40. */
    static int terrainHeight(int x, int z) {
        if (x < 40) return 58;
        return 66 + Math.floorMod((x >> 3) * 3 + (z >> 3) * 5, 4);
    }

    static BlockState baseState(int x, int y, int z) {
        if (y < -64 || y >= 320) return Blocks.VOID_AIR.defaultBlockState();
        if (y == -64) return Blocks.BEDROCK.defaultBlockState();
        int height = terrainHeight(x, z);
        if (y <= height) {
            if (Math.floorMod(x + z, 9) == 0 && y >= 20 && y <= 30) return Blocks.CAVE_AIR.defaultBlockState();
            if (y == height) {
                if (height >= 63) return Blocks.GRASS_BLOCK.defaultBlockState();
                return Math.floorMod(x + z, 3) == 0 ? Blocks.MUD.defaultBlockState() : Blocks.SAND.defaultBlockState();
            }
            if (y >= height - 3) return Blocks.DIRT.defaultBlockState();
            return Blocks.STONE.defaultBlockState();
        }
        if (height >= 63) {
            if (Math.floorMod(x * 11 + z * 7, 211) == 0 && y >= height + 3 && y <= height + 14) return Blocks.STONE.defaultBlockState();
            if (x >= 72 && z <= -120 && y == height + 3) return Blocks.STONE.defaultBlockState();
            if (x >= 72 && z <= -120 && y == height + 4) return Blocks.DIRT.defaultBlockState();
            if (y == height + 1) {
                if (Math.floorMod(x * 5 + z * 3, 13) == 0) return Blocks.TALL_GRASS.defaultBlockState();
                if (Math.floorMod(x * 3 + z * 5, 7) == 0) return Blocks.SHORT_GRASS.defaultBlockState();
                if (Math.floorMod(x + z * 3, 17) == 0) return Blocks.POPPY.defaultBlockState();
            }
            if (y == height + 2 && Math.floorMod(x * 5 + z * 3, 13) == 0) {
                return Blocks.TALL_GRASS.defaultBlockState().setValue(BlockStateProperties.DOUBLE_BLOCK_HALF, net.minecraft.world.level.block.state.properties.DoubleBlockHalf.UPPER);
            }
        }
        if (y <= 62) return Blocks.WATER.defaultBlockState();
        return Blocks.AIR.defaultBlockState();
    }

    /** A WorldGenLevel over baseState plus recorded writes; writable chunks are the 3x3 around (3, -7). */
    static final class FakeWorld implements InvocationHandler {
        final Map<BlockPos, BlockState> writes = new HashMap<>();
        final Map<BlockPos, BlockEntity> blockEntities = new HashMap<>();
        final List<Object[]> writeLog = new ArrayList<>();
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
        @SuppressWarnings("unchecked")
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
                    writeLog.add(new Object[]{position.getX(), position.getY(), position.getZ(), stateString(state)});
                    if (state.hasBlockEntity()) {
                        blockEntities.put(position, ((EntityBlock) state.getBlock()).newBlockEntity(position, state));
                    } else {
                        blockEntities.remove(position);
                    }
                    return true;
                }
                case "getBlockEntity": if (argumentCount == 1) return blockEntities.get((BlockPos) arguments[0]); break;
                case "scheduleTick": return null;
                case "blockUpdated": case "levelEvent": case "gameEvent": case "playSound": return null;
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

    static void writeGzip(String path, JsonElement json) throws IOException {
        Files.createDirectories(Paths.get(path).toAbsolutePath().getParent());
        try (Writer writer = new OutputStreamWriter(new GZIPOutputStream(new FileOutputStream(path)), "UTF-8")) {
            new Gson().toJson(json, writer);
        }
        System.out.println("wrote " + path);
    }

    /** A LevelAccessor with every block air except the ones in `blocks`. */
    static final class ProbeLevel implements InvocationHandler {
        final Map<BlockPos, BlockState> blocks = new HashMap<>();

        BlockState stateAt(Object position) { return blocks.getOrDefault((BlockPos) position, Blocks.AIR.defaultBlockState()); }

        @Override
        @SuppressWarnings("unchecked")
        public Object invoke(Object proxy, Method method, Object[] arguments) throws Throwable {
            int argumentCount = arguments == null ? 0 : arguments.length;
            switch (method.getName()) {
                case "getBlockState": if (argumentCount == 1) return stateAt(arguments[0]); break;
                case "getFluidState": if (argumentCount == 1) return stateAt(arguments[0]).getFluidState(); break;
                case "isStateAtPosition": return ((java.util.function.Predicate<BlockState>) arguments[1]).test(stateAt(arguments[0]));
                case "isFluidAtPosition": return ((java.util.function.Predicate<FluidState>) arguments[1]).test(stateAt(arguments[0]).getFluidState());
                case "getBlockEntity": return null;
                case "scheduleTick": return null;
                case "getHeight": return 384;
                case "getMinBuildHeight": return -64;
                case "getRawBrightness": case "getMaxLocalRawBrightness": return 0;
                case "getSeaLevel": return 63;
                case "isClientSide": return false;
                case "hashCode": return System.identityHashCode(proxy);
                case "equals": return proxy == arguments[0];
                case "toString": return "ProbeLevel";
                default: break;
            }
            if (method.isDefault()) return InvocationHandler.invokeDefault(proxy, method, arguments);
            throw new UnsupportedOperationException(method.getName());
        }
    }

    /** States whose updateShape is probed: the default state plus one per alternative value of attachment-like properties. */
    static List<BlockState> probeStates(Block block) {
        List<BlockState> states = new ArrayList<>();
        BlockState defaultState = block.defaultBlockState();
        states.add(defaultState);
        for (Property<?> property : defaultState.getProperties()) {
            String propertyName = property.getName();
            boolean attachment = propertyName.equals("half") || propertyName.equals("vertical_direction") || propertyName.equals("hanging")
                || propertyName.equals("face") || propertyName.equals("facing") || propertyName.equals("attachment");
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

    /** Bit d is set when updateShape(d) turns the state into air with all neighbors air but not with all neighbors stone or dirt. */
    static int updateShapeAirMask(BlockState state, ProbeLevel probe, net.minecraft.world.level.LevelAccessor level) {
        BlockPos position = new BlockPos(0, 64, 0);
        int mask = 0;
        for (net.minecraft.core.Direction direction : net.minecraft.core.Direction.values()) {
            BlockPos neighborPosition = position.relative(direction);
            try {
                probe.blocks.clear();
                probe.blocks.put(position, state);
                BlockState whenEmpty = state.updateShape(direction, Blocks.AIR.defaultBlockState(), level, position, neighborPosition);
                boolean survivesWhenSupported = false;
                for (BlockState support : new BlockState[]{Blocks.STONE.defaultBlockState(), Blocks.DIRT.defaultBlockState()}) {
                    probe.blocks.clear();
                    probe.blocks.put(position, state);
                    for (net.minecraft.core.Direction around : net.minecraft.core.Direction.values()) probe.blocks.put(position.relative(around), support);
                    if (!state.updateShape(direction, support, level, position, neighborPosition).isAir()) survivesWhenSupported = true;
                }
                if (whenEmpty.isAir() && survivesWhenSupported) mask |= 1 << direction.ordinal();
            } catch (RuntimeException exception) {
                // blocks whose updateShape needs more of the level than the probe provides are left out
            }
        }
        return mask;
    }

    /**
     * java.util.HashSet<BlockPos> iteration order after add / remove sequences, for JavaHashPositionSet. Scenarios 0-9
     * are random clouds, 10-24 layered discs added row by row like a foliage placer does, 25 and up anti-diagonal lines
     * (positions (x + i, y, z - i) share a bucket in tables up to 64, which forces nine-node bins). All are drained with
     * iterator().next() + iterator.remove() like TreeFeature.updateLeaves.
     * Each scenario: `ops` as flat [kind, x, y, z] (0 add, 1 HashSet.remove, 2 iterator pop of the first element)
     * and `checkpoints` {afterOps, order flat [x, y, z]}.
     */
    static JsonArray hashSetScenarios() {
        JsonArray scenarios = new JsonArray();
        for (int scenarioIndex = 0; scenarioIndex < 50; scenarioIndex++) {
            Random random = new Random(500 + scenarioIndex);
            int centerX = random.nextInt(400) - 200;
            int centerY = 60 + random.nextInt(60);
            int centerZ = random.nextInt(400) - 200;
            HashSet<BlockPos> set = new HashSet<>();
            JsonArray ops = new JsonArray();
            JsonArray checkpoints = new JsonArray();
            int[] operationCount = {0};
            List<BlockPos> toAdd = new ArrayList<>();
            if (scenarioIndex < 10) {
                int radius = 2 + random.nextInt(8);
                int count = 20 + random.nextInt(500);
                for (int index = 0; index < count; index++) {
                    toAdd.add(new BlockPos(centerX + random.nextInt(2 * radius + 1) - radius, centerY + random.nextInt(2 * radius + 1) - radius, centerZ + random.nextInt(2 * radius + 1) - radius));
                }
            } else if (scenarioIndex >= 25) {
                int lineCount = 1 + random.nextInt(4);
                for (int line = 0; line < lineCount; line++) {
                    int startX = centerX + random.nextInt(9) - 4;
                    int startZ = centerZ + random.nextInt(9) - 4;
                    int y = centerY - random.nextInt(3);
                    int length = 8 + random.nextInt(30);
                    for (int step = 0; step < length; step++) toAdd.add(new BlockPos(startX + step, y, startZ - step));
                }
            } else {
                int layers = 2 + random.nextInt(8);
                for (int layer = 0; layer < layers; layer++) {
                    int radius = 1 + random.nextInt(6);
                    for (int x = -radius; x <= radius; x++) {
                        for (int z = -radius; z <= radius; z++) {
                            if (Math.abs(x) == radius && Math.abs(z) == radius && random.nextBoolean()) continue;
                            toAdd.add(new BlockPos(centerX + x, centerY - layer, centerZ + z));
                        }
                    }
                }
            }
            for (BlockPos position : toAdd) { set.add(position); recordOperation(ops, operationCount, 0, position); }
            checkpoints.add(checkpoint(set, operationCount[0]));
            List<BlockPos> snapshot = new ArrayList<>(set);
            int removals = random.nextInt(snapshot.size() / 2 + 1);
            for (int index = 0; index < removals; index++) {
                BlockPos position = snapshot.get(random.nextInt(snapshot.size()));
                set.remove(position);
                recordOperation(ops, operationCount, 1, position);
            }
            checkpoints.add(checkpoint(set, operationCount[0]));
            int pops = random.nextInt(set.size() + 1);
            for (int index = 0; index < pops; index++) {
                Iterator<BlockPos> iterator = set.iterator();
                BlockPos popped = iterator.next();
                iterator.remove();
                recordOperation(ops, operationCount, 2, popped);
                if (random.nextInt(3) == 0) {
                    BlockPos readded = snapshot.get(random.nextInt(snapshot.size()));
                    set.add(readded);
                    recordOperation(ops, operationCount, 0, readded);
                }
            }
            checkpoints.add(checkpoint(set, operationCount[0]));
            JsonObject scenario = new JsonObject();
            scenario.add("ops", ops);
            scenario.add("checkpoints", checkpoints);
            scenarios.add(scenario);
        }
        return scenarios;
    }

    static void recordOperation(JsonArray ops, int[] operationCount, int kind, BlockPos position) {
        ops.add(kind); ops.add(position.getX()); ops.add(position.getY()); ops.add(position.getZ());
        operationCount[0]++;
    }

    static JsonObject checkpoint(Set<BlockPos> set, int operationCount) {
        JsonObject checkpoint = new JsonObject();
        checkpoint.addProperty("afterOps", operationCount);
        JsonArray order = new JsonArray();
        for (BlockPos position : set) { order.add(position.getX()); order.add(position.getY()); order.add(position.getZ()); }
        checkpoint.add("order", order);
        return checkpoint;
    }

    static long beehiveShuffleSeed(int x, int y, int z) { return (x * 3129871L) ^ (z * 116129781L) ^ y; }

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
        var dimensionType = worldgen.registryOrThrow(Registries.DIMENSION_TYPE).get(net.minecraft.world.level.dimension.BuiltinDimensionTypes.OVERWORLD);
        Holder<Biome> biome = worldgen.registryOrThrow(Registries.BIOME).getHolderOrThrow(net.minecraft.world.level.biome.Biomes.FOREST);

        Field shuffleRandomField = Collections.class.getDeclaredField("r");
        shuffleRandomField.setAccessible(true);

        JsonObject output = new JsonObject();
        List<String> palette = new ArrayList<>();
        Map<String, Integer> paletteIndex = new HashMap<>();
        JsonArray runs = new JsonArray();
        var configuredRegistry = worldgen.registryOrThrow(Registries.CONFIGURED_FEATURE);
        List<String> ids = new ArrayList<>();
        for (var key : configuredRegistry.keySet()) {
            Feature<?> feature = configuredRegistry.get(key).feature();
            String typeId = BuiltInRegistries.FEATURE.getKey(feature).toString();
            if (typeId.equals("minecraft:tree") || typeId.equals("minecraft:root_system") || typeId.equals("minecraft:huge_red_mushroom") || typeId.equals("minecraft:huge_brown_mushroom")) ids.add(key.toString());
        }
        Collections.sort(ids);
        int runIndex = 0;
        for (String id : ids) {
            ConfiguredFeature<?, ?> configured = configuredRegistry.get(net.minecraft.resources.ResourceLocation.tryParse(id));
            boolean rootSystem = configured.feature() instanceof net.minecraft.world.level.levelgen.feature.RootSystemFeature;
            List<int[]> columns = new ArrayList<>(Arrays.asList(ORIGIN_COLUMNS));
            if (rootSystem) columns.addAll(Arrays.asList(ROOT_SYSTEM_COLUMNS));
            for (int[] column : columns) {
                int originY = terrainHeight(column[0], column[1]) + 1;
                long seed = 7000L + runIndex * 31L;
                runIndex++;
                FakeWorld world = new FakeWorld();
                world.biome = biome;
                world.registryAccess = worldgen;
                world.dimensionType = dimensionType;
                net.minecraft.world.level.WorldGenLevel level = (net.minecraft.world.level.WorldGenLevel) Proxy.newProxyInstance(
                    net.minecraft.world.level.WorldGenLevel.class.getClassLoader(), new Class<?>[]{net.minecraft.world.level.WorldGenLevel.class}, world);
                WorldgenRandom random = new WorldgenRandom(new XoroshiroRandomSource(seed));
                shuffleRandomField.set(null, new Random(beehiveShuffleSeed(column[0], originY, column[1])));
                JsonObject run = new JsonObject();
                run.addProperty("id", id);
                run.addProperty("seed", seed);
                JsonArray origin = new JsonArray();
                origin.add(column[0]); origin.add(originY); origin.add(column[1]);
                run.add("origin", origin);
                try {
                    boolean placed = configured.place(level, generator, random, new BlockPos(column[0], originY, column[1]));
                    run.addProperty("placed", placed);
                    JsonArray writes = new JsonArray();
                    for (Object[] write : world.writeLog) {
                        writes.add((Integer) write[0]); writes.add((Integer) write[1]); writes.add((Integer) write[2]);
                        Integer index = paletteIndex.get((String) write[3]);
                        if (index == null) { index = palette.size(); palette.add((String) write[3]); paletteIndex.put((String) write[3], index); }
                        writes.add(index);
                    }
                    run.add("writes", writes);
                    run.addProperty("nextLong", Long.toString(random.nextLong()));
                } catch (Throwable error) {
                    run.addProperty("error", errorText(error));
                }
                runs.add(run);
            }
        }
        JsonArray paletteJson = new JsonArray();
        for (String state : palette) paletteJson.add(state);
        output.add("palette", paletteJson);
        output.add("runs", runs);
        output.add("hashSetScenarios", hashSetScenarios());
        writeGzip(argv[1], output);

        // BlockState.isSolidRender per block: the default state value and the states that differ from it.
        JsonObject solidRender = new JsonObject();
        for (Block block : BuiltInRegistries.BLOCK) {
            BlockState defaultState = block.defaultBlockState();
            boolean defaultValue = defaultState.isSolidRender(EmptyBlockGetter.INSTANCE, BlockPos.ZERO);
            JsonObject variants = new JsonObject();
            boolean anyTrue = defaultValue;
            for (BlockState state : block.getStateDefinition().getPossibleStates()) {
                if (state.hasProperty(BlockStateProperties.WATERLOGGED) && state.getValue(BlockStateProperties.WATERLOGGED)) continue;
                boolean value = state.isSolidRender(EmptyBlockGetter.INSTANCE, BlockPos.ZERO);
                if (value) anyTrue = true;
                if (value != defaultValue) variants.addProperty(differingProperties(defaultState, state), value);
            }
            if (!anyTrue) continue;
            JsonObject entry = new JsonObject();
            entry.addProperty("default", defaultValue);
            if (!variants.isEmpty()) entry.add("variants", variants);
            solidRender.add(BuiltInRegistries.BLOCK.getKey(block).toString(), entry);
        }
        JsonObject updateShapeAir = new JsonObject();
        ProbeLevel probe = new ProbeLevel();
        net.minecraft.world.level.LevelAccessor probeLevel = (net.minecraft.world.level.LevelAccessor) Proxy.newProxyInstance(
            net.minecraft.world.level.LevelAccessor.class.getClassLoader(), new Class<?>[]{net.minecraft.world.level.LevelAccessor.class}, probe);
        for (Block block : BuiltInRegistries.BLOCK) {
            BlockState defaultState = block.defaultBlockState();
            if (defaultState.isAir()) continue;
            int defaultMask = updateShapeAirMask(defaultState, probe, probeLevel);
            JsonObject variants = new JsonObject();
            for (BlockState state : probeStates(block)) {
                if (state == defaultState) continue;
                int mask = updateShapeAirMask(state, probe, probeLevel);
                if (mask != defaultMask) variants.addProperty(differingProperties(defaultState, state), mask);
            }
            if (defaultMask == 0 && variants.isEmpty()) continue;
            JsonObject entry = new JsonObject();
            entry.addProperty("default", defaultMask);
            if (!variants.isEmpty()) entry.add("variants", variants);
            updateShapeAir.add(BuiltInRegistries.BLOCK.getKey(block).toString(), entry);
        }
        JsonObject blockBehavior = new JsonObject();
        blockBehavior.add("solidRender", solidRender);
        blockBehavior.add("updateShapeAir", updateShapeAir);
        writeGzip(argv[2], blockBehavior);
    }

    /** "key=value,key=value" over the properties where `state` differs from `defaultState`, sorted by name. */
    static String differingProperties(BlockState defaultState, BlockState state) {
        TreeMap<String, String> differing = new TreeMap<>();
        for (Map.Entry<Property<?>, Comparable<?>> entry : state.getValues().entrySet()) {
            if (!defaultState.getValues().get(entry.getKey()).equals(entry.getValue())) {
                differing.put(entry.getKey().getName(), propertyValueName(entry.getKey(), entry.getValue()));
            }
        }
        StringJoiner joiner = new StringJoiner(",");
        for (Map.Entry<String, String> entry : differing.entrySet()) joiner.add(entry.getKey() + "=" + entry.getValue());
        return joiner.toString();
    }
}
