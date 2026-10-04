package net.minecraft.world.level.levelgen;

// Records real Minecraft 1.20.6 outputs (Terralith datapack) for the surface feature types of
// engine/features/feature-types/surface: freeze_top_layer, iceberg, blue_ice, ice_spike, forest_rock, desert_well.
//   1. Biome.getTemperature (private; float bits) for every overworld biome at a grid of positions below and above y 80.
//   2. For each case (configured feature, scenario terrain, random seed, origin) the final block writes, the placed
//      flag and the next random draw, on a synthetic world whose biome varies per 8x8 columns (see FakeWorld; the
//      terrain and biome functions are mirrored in surface-feature-oracle.test.ts, keep them identical).
// Build against the remapped server jar (see engine/noise/fixtures/ReferenceVectors.java for the remap), Java 21:
//   javac -proc:none -cp mapped.jar:<server libraries> -d classes SurfaceReference.java
//   java -cp classes:mapped.jar:<server libraries> net.minecraft.world.level.levelgen.SurfaceReference \
//     <world/datapacks containing Terralith> features/feature-types/surface/fixtures/surface-reference.json.gz
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
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.RegistryLayer;
import net.minecraft.server.packs.PackType;
import net.minecraft.server.packs.repository.PackRepository;
import net.minecraft.server.packs.repository.ServerPacksSource;
import net.minecraft.server.packs.resources.MultiPackResourceManager;
import net.minecraft.world.level.biome.Biome;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraft.world.level.dimension.LevelStem;
import net.minecraft.world.level.levelgen.feature.ConfiguredFeature;
import net.minecraft.world.level.validation.DirectoryValidator;

public class SurfaceReference {
    static final String[] BIOME_NAMES = {
        "minecraft:snowy_plains", "minecraft:plains", "minecraft:frozen_ocean", "minecraft:snowy_slopes", "minecraft:deep_frozen_ocean",
        "minecraft:ice_spikes", "minecraft:taiga", "minecraft:jagged_peaks", "minecraft:desert", "minecraft:frozen_river",
        "minecraft:grove", "minecraft:cold_ocean", "minecraft:snowy_beach", "minecraft:forest",
    };

    record Scenario(String name, int base, int heightScale, String kind) {}

    static final Scenario[] SCENARIOS = {
        new Scenario("land", 66, 1, "land"),
        new Scenario("mountain", 95, 1, "land"),
        new Scenario("mixed", 62, 3, "land"),
        new Scenario("ocean", 38, 1, "ocean"),
        new Scenario("shallow_ocean", 54, 1, "ocean"),
        new Scenario("snowfield", 66, 1, "snowfield"),
        new Scenario("desert", 66, 1, "desert"),
    };

    static BlockState parse(String text) {
        int bracket = text.indexOf('[');
        String name = bracket < 0 ? text : text.substring(0, bracket);
        BlockState state = BuiltInRegistries.BLOCK.get(new ResourceLocation(name)).defaultBlockState();
        if (bracket >= 0) {
            for (String pair : text.substring(bracket + 1, text.length() - 1).split(",")) {
                String[] parts = pair.split("=");
                for (Property<?> property : state.getProperties()) {
                    if (property.getName().equals(parts[0])) state = withParsed(state, property, parts[1]);
                }
            }
        }
        return state;
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    static BlockState withParsed(BlockState state, Property property, String value) {
        return state.setValue(property, (Comparable) property.getValue(value).orElseThrow());
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

    static int noise(int x, int z) { return Math.floorMod(x * 7 + z * 13, 11) + Math.floorMod(x * 3 - z * 5, 7); }

    static int surfaceHeight(Scenario scenario, int x, int z) { return scenario.base() + scenario.heightScale() * noise(x, z); }

    static String surfaceBlock(Scenario scenario, int x, int z) {
        int variant = Math.floorMod(x * 5 + z * 11, 13);
        switch (scenario.kind()) {
            case "snowfield": return Math.floorMod(x + z * 3, 19) == 0 ? "minecraft:packed_ice" : "minecraft:snow_block";
            case "desert": return "minecraft:sand";
            case "ocean": return variant < 6 ? "minecraft:gravel" : "minecraft:sand";
            default:
                switch (variant) {
                    case 0: case 1: return "minecraft:snow_block";
                    case 2: return "minecraft:packed_ice";
                    case 3: return "minecraft:ice";
                    case 4: return "minecraft:sand";
                    case 5: return "minecraft:oak_leaves[distance=1,persistent=true]";
                    case 7: return "minecraft:podzol";
                    case 8: return "minecraft:mycelium";
                    case 9: return "minecraft:dirt";
                    case 10: return "minecraft:stone";
                    case 11: return "minecraft:gravel";
                    default: return "minecraft:grass_block";
                }
        }
    }

    static String subsurfaceBlock(Scenario scenario) {
        switch (scenario.kind()) {
            case "desert": return "minecraft:sandstone";
            case "ocean": return "minecraft:gravel";
            case "snowfield": return "minecraft:snow_block";
            default: return "minecraft:dirt";
        }
    }

    static BlockState baseState(Scenario scenario, int x, int y, int z) {
        if (y < -64 || y >= 320) return Blocks.VOID_AIR.defaultBlockState();
        if (y == -64) return Blocks.BEDROCK.defaultBlockState();
        int height = surfaceHeight(scenario, x, z);
        if (y <= height) {
            if (scenario.kind().equals("desert") && Math.floorMod(x + 2 * z, 29) == 0 && (y == height - 1 || y == height - 2)) return Blocks.CAVE_AIR.defaultBlockState();
            if (y == height) return parse(surfaceBlock(scenario, x, z));
            if (y >= height - 3) return parse(subsurfaceBlock(scenario));
            return Blocks.STONE.defaultBlockState();
        }
        if (scenario.kind().equals("ocean") && y >= 50 && y <= 62 && Math.floorMod(x * 3 + z * 5, 7) == 0) return Blocks.PACKED_ICE.defaultBlockState();
        if (y <= 62) {
            if (y == 62 && height < 62 && Math.floorMod(x * 3 + z * 7, 10) == 0) return parse("minecraft:kelp[age=5]");
            return Blocks.WATER.defaultBlockState();
        }
        if (y == height + 1 && scenario.kind().equals("land") && Math.floorMod(x + z, 17) == 0) return parse("minecraft:snow[layers=3]");
        return Blocks.AIR.defaultBlockState();
    }

    /** A WorldGenLevel over baseState plus recorded writes; writable chunks are the 3x3 around (centerChunkX, centerChunkZ). */
    static final class FakeWorld implements InvocationHandler {
        final Scenario scenario;
        final int centerChunkX;
        final int centerChunkZ;
        final Map<BlockPos, BlockState> writes = new HashMap<>();
        final List<Holder<Biome>> biomes;

        FakeWorld(Scenario scenario, int centerChunkX, int centerChunkZ, List<Holder<Biome>> biomes) {
            this.scenario = scenario;
            this.centerChunkX = centerChunkX;
            this.centerChunkZ = centerChunkZ;
            this.biomes = biomes;
        }

        BlockState stateAt(BlockPos position) {
            BlockState written = writes.get(position);
            return written != null ? written : baseState(scenario, position.getX(), position.getY(), position.getZ());
        }

        int height(Heightmap.Types type, int x, int z) {
            boolean worldgenType = type == Heightmap.Types.WORLD_SURFACE_WG || type == Heightmap.Types.OCEAN_FLOOR_WG;
            for (int y = 319; y >= -64; y--) {
                BlockPos position = new BlockPos(x, y, z);
                BlockState state = worldgenType ? baseState(scenario, x, y, z) : stateAt(position);
                if (type.isOpaque().test(state)) return y + 1;
            }
            return -64;
        }

        boolean canWrite(BlockPos position) {
            return Math.abs((position.getX() >> 4) - centerChunkX) <= 1 && Math.abs((position.getZ() >> 4) - centerChunkZ) <= 1;
        }

        Holder<Biome> biomeAt(BlockPos position) {
            return biomes.get(Math.floorMod((position.getX() >> 3) * 5 + (position.getZ() >> 3) * 3, biomes.size()));
        }

        @Override
        public Object invoke(Object proxy, Method method, Object[] arguments) throws Throwable {
            int argumentCount = arguments == null ? 0 : arguments.length;
            switch (method.getName()) {
                case "getBlockState": if (argumentCount == 1) return stateAt((BlockPos) arguments[0]); break;
                case "getFluidState": if (argumentCount == 1) return stateAt((BlockPos) arguments[0]).getFluidState(); break;
                case "isStateAtPosition": return ((java.util.function.Predicate<BlockState>) arguments[1]).test(stateAt((BlockPos) arguments[0]));
                case "ensureCanWrite": return canWrite((BlockPos) arguments[0]);
                case "setBlock": {
                    BlockPos position = ((BlockPos) arguments[0]).immutable();
                    if (!canWrite(position)) return false;
                    if (position.getY() < -64 || position.getY() >= 320) return true;
                    writes.put(position, (BlockState) arguments[1]);
                    return true;
                }
                case "getHeight":
                    if (argumentCount == 0) return 384;
                    if (argumentCount == 3) return height((Heightmap.Types) arguments[0], (Integer) arguments[1], (Integer) arguments[2]);
                    break;
                case "getMinBuildHeight": return -64;
                case "getBiome": return biomeAt((BlockPos) arguments[0]);
                case "getRawBrightness": case "getMaxLocalRawBrightness": case "getBrightness": return 0;
                case "getSeaLevel": return 63;
                case "getSeed": return 1337L;
                case "isClientSide": return false;
                case "getBlockEntity": if (argumentCount == 1) return null; break;
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

    static Holder<Biome> biomeHolder(net.minecraft.core.Registry<Biome> registry, String id) {
        return registry.getHolderOrThrow(ResourceKey.create(Registries.BIOME, new ResourceLocation(id)));
    }

    record Case(String feature, String scenario, long seed, int originX, int originY, int originZ) {}

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

        var biomeRegistry = worldgen.registryOrThrow(Registries.BIOME);
        var configuredRegistry = worldgen.registryOrThrow(Registries.CONFIGURED_FEATURE);
        LevelStem overworld = dimensions.registryOrThrow(Registries.LEVEL_STEM).get(LevelStem.OVERWORLD);
        net.minecraft.world.level.chunk.ChunkGenerator generator = overworld.generator();
        JsonObject root = new JsonObject();

        // 1. Biome.getTemperature over every possible overworld biome.
        Method getTemperature = Biome.class.getDeclaredMethod("getTemperature", BlockPos.class);
        getTemperature.setAccessible(true);
        int[][] temperaturePoints = {
            {0, 64, 0}, {48, 70, -112}, {-1000, 63, 2500}, {4000, 81, 4000}, {-6000, 120, 2000}, {9000, 200, -9000},
            {123457, 95, -98765}, {17, 100, 33}, {-250, 62, -777}, {512, 80, 512}, {1500, 150, -2300}, {-3000, 319, 3000},
            {64, 64, 64}, {70, 66, 71}, {-13, 90, 5}, {321, 72, -654}, {2222, 64, 2222}, {-4096, 110, 777},
        };
        JsonArray temperatures = new JsonArray();
        List<String> possibleIds = new ArrayList<>();
        for (Holder<Biome> biome : overworld.generator().getBiomeSource().possibleBiomes()) possibleIds.add(biome.unwrapKey().orElseThrow().location().toString());
        Collections.sort(possibleIds);
        for (String id : possibleIds) {
            Biome biome = biomeHolder(biomeRegistry, id).value();
            JsonObject entry = new JsonObject();
            entry.addProperty("biome", id);
            JsonArray samples = new JsonArray();
            for (int[] point : temperaturePoints) {
                float temperature = (Float) getTemperature.invoke(biome, new BlockPos(point[0], point[1], point[2]));
                samples.add(Float.floatToRawIntBits(temperature));
            }
            entry.add("temperatureBits", samples);
            temperatures.add(entry);
        }
        JsonArray pointsJson = new JsonArray();
        for (int[] point : temperaturePoints) { JsonArray p = new JsonArray(); for (int c : point) p.add(c); pointsJson.add(p); }
        root.add("temperaturePoints", pointsJson);
        root.add("temperatures", temperatures);

        // 2. Feature cases.
        List<Holder<Biome>> biomes = new ArrayList<>();
        JsonArray biomeNames = new JsonArray();
        for (String id : BIOME_NAMES) { biomes.add(biomeHolder(biomeRegistry, id)); biomeNames.add(id); }
        root.add("biomes", biomeNames);

        List<Case> cases = new ArrayList<>();
        int[][] chunkOrigins = {{3, -7}, {-5, 12}, {40, 40}, {-100, -33}, {7, 7}, {250, -90}};
        for (Scenario scenario : SCENARIOS) {
            for (int[] chunk : chunkOrigins) cases.add(new Case("minecraft:freeze_top_layer", scenario.name(), 0, chunk[0] * 16, -64, chunk[1] * 16));
        }
        long[] seeds = {1337L, 42L, -7L, 987654321L, 123L, 99991L, 5L, 31337L};
        int[][] horizontalOrigins = {{50, 20}, {-83, 111}, {641, -255}};
        for (long seed : seeds) {
            for (int[] horizontal : horizontalOrigins) {
                cases.add(new Case("minecraft:iceberg_packed", "ocean", seed, horizontal[0], 63, horizontal[1]));
                cases.add(new Case("minecraft:iceberg_blue", "ocean", seed, horizontal[0] + 3, 63, horizontal[1] - 5));
                cases.add(new Case("minecraft:iceberg_packed", "shallow_ocean", seed, horizontal[0], 63, horizontal[1]));
                cases.add(new Case("minecraft:ice_spike", "snowfield", seed, horizontal[0], 120, horizontal[1]));
                cases.add(new Case("minecraft:ice_spike", "snowfield", seed, horizontal[0] + 9, 66, horizontal[1] + 2));
                cases.add(new Case("minecraft:forest_rock", "land", seed, horizontal[0], 70, horizontal[1]));
                cases.add(new Case("terralith:cherry/rock", "mixed", seed, horizontal[0] + 1, 90, horizontal[1] - 1));
            }
            for (int originY : new int[]{40, 48, 55, 58, 60, 62, 63}) {
                for (int[] horizontal : horizontalOrigins) cases.add(new Case("minecraft:blue_ice", "ocean", seed, horizontal[0] + originY, originY, horizontal[1]));
            }
            for (int offset = 0; offset < 12; offset++) cases.add(new Case("minecraft:desert_well", "desert", seed, 20 + offset * 7, 67 + offset % 3, -40 + offset * 11));
        }

        JsonArray caseResults = new JsonArray();
        for (Case testCase : cases) {
            Scenario scenario = null;
            for (Scenario candidate : SCENARIOS) if (candidate.name().equals(testCase.scenario())) scenario = candidate;
            BlockPos origin = new BlockPos(testCase.originX(), testCase.originY(), testCase.originZ());
            FakeWorld world = new FakeWorld(scenario, origin.getX() >> 4, origin.getZ() >> 4, biomes);
            net.minecraft.world.level.WorldGenLevel level = (net.minecraft.world.level.WorldGenLevel) Proxy.newProxyInstance(
                net.minecraft.world.level.WorldGenLevel.class.getClassLoader(), new Class<?>[]{net.minecraft.world.level.WorldGenLevel.class}, world);
            ConfiguredFeature<?, ?> feature = configuredRegistry.get(new ResourceLocation(testCase.feature()));
            WorldgenRandom random = new WorldgenRandom(new XoroshiroRandomSource(testCase.seed()));
            JsonObject result = new JsonObject();
            result.addProperty("feature", testCase.feature());
            result.addProperty("scenario", testCase.scenario());
            result.addProperty("seed", Long.toString(testCase.seed()));
            JsonArray originJson = new JsonArray();
            originJson.add(origin.getX()); originJson.add(origin.getY()); originJson.add(origin.getZ());
            result.add("origin", originJson);
            try {
                result.addProperty("placed", feature.place(level, generator, random, origin));
                result.addProperty("nextLong", Long.toString(random.nextLong()));
                JsonArray writes = new JsonArray();
                List<Map.Entry<BlockPos, BlockState>> entries = new ArrayList<>(world.writes.entrySet());
                entries.sort(Comparator.comparingInt((Map.Entry<BlockPos, BlockState> e) -> e.getKey().getY()).thenComparingInt(e -> e.getKey().getZ()).thenComparingInt(e -> e.getKey().getX()));
                for (Map.Entry<BlockPos, BlockState> entry : entries) {
                    JsonArray write = new JsonArray();
                    write.add(entry.getKey().getX()); write.add(entry.getKey().getY()); write.add(entry.getKey().getZ()); write.add(stateString(entry.getValue()));
                    writes.add(write);
                }
                result.add("writes", writes);
            } catch (Throwable error) {
                Throwable cause = error;
                while (cause.getCause() != null) cause = cause.getCause();
                result.addProperty("error", cause.getClass().getSimpleName() + ": " + cause.getMessage());
            }
            caseResults.add(result);
        }
        root.add("cases", caseResults);
        writeGzip(argv[1], root);
    }
}
