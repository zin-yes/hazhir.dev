package net.minecraft.world.level.levelgen;

// Records real Minecraft 1.20.6 outputs (Terralith datapack, seed 1337) for engine/terrain aquifers + ore veins and
// engine/carvers, by running the real classes on a ProtoChunk without the server:
//   fills:   NoiseBasedChunkGenerator.doFill (Aquifer.NoiseBasedAquifer + OreVeinifier) block names for several chunks
//   aquifer: NoiseBasedAquifer.computeSubstance at random positions and densities
//   carved:  the chunk after doFill + buildSurface (pre) and after applyCarvers (post), with the same 17x17 loop as
//            NoiseBasedChunkGenerator.applyCarvers (the WorldGenRegion is replaced by direct biome-source lookups)
// Build against the remapped server jar (see engine/noise/fixtures/ReferenceVectors.java for the remap), Java 21:
//   javac -proc:none -cp mapped.jar:<server libraries> -d classes CarversReference.java
//   java -cp classes:mapped.jar:<server libraries> net.minecraft.world.level.levelgen.CarversReference <datapacks dir> out.json.gz
// The output is carvers/fixtures/carvers-reference-vectors.json.gz.
import com.google.gson.*;
import java.nio.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.GZIPOutputStream;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Holder;
import net.minecraft.core.LayeredRegistryAccess;
import net.minecraft.core.QuartPos;
import net.minecraft.core.Registry;
import net.minecraft.core.RegistryAccess;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.packs.resources.ResourceManager;
import net.minecraft.tags.TagKey;
import net.minecraft.tags.TagLoader;
import net.minecraft.tags.TagManager;
import net.minecraft.world.level.block.Block;
import net.minecraft.resources.RegistryDataLoader;
import net.minecraft.server.RegistryLayer;
import net.minecraft.server.packs.PackType;
import net.minecraft.server.packs.repository.PackRepository;
import net.minecraft.server.packs.repository.ServerPacksSource;
import net.minecraft.server.packs.resources.MultiPackResourceManager;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.LevelHeightAccessor;
import net.minecraft.world.level.biome.Biome;
import net.minecraft.world.level.biome.BiomeGenerationSettings;
import net.minecraft.world.level.biome.BiomeManager;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.chunk.CarvingMask;
import net.minecraft.world.level.chunk.ChunkAccess;
import net.minecraft.world.level.chunk.LevelChunkSection;
import net.minecraft.world.level.chunk.ProtoChunk;
import net.minecraft.world.level.chunk.UpgradeData;
import net.minecraft.world.level.dimension.LevelStem;
import net.minecraft.world.level.levelgen.blending.Blender;
import net.minecraft.world.level.levelgen.carver.CarvingContext;
import net.minecraft.world.level.levelgen.carver.ConfiguredWorldCarver;
import net.minecraft.world.level.levelgen.carver.WorldCarver;
import net.minecraft.world.level.validation.DirectoryValidator;

public class CarversReference {
    static final long SEED = 1337L;
    static final int MIN_Y = -64;
    static final int HEIGHT = 384;

    static NoiseBasedChunkGenerator generator;
    static NoiseGeneratorSettings settings;
    static RandomState randomState;
    static RegistryAccess.Frozen registryAccess;
    static Registry<Biome> biomeRegistry;
    static Aquifer.FluidPicker fluidPicker;
    static BiomeManager biomeManager;
    static final LevelHeightAccessor HEIGHT_ACCESSOR = new LevelHeightAccessor() {
        public int getHeight() { return HEIGHT; }
        public int getMinBuildHeight() { return MIN_Y; }
    };

    /** The server binds block tags when it loads resources; the carvers' `replaceable` tag is empty until then. */
    static void bindBlockTags(ResourceManager resources) {
        Registry<Block> blocks = BuiltInRegistries.BLOCK;
        TagLoader<Holder<Block>> loader = new TagLoader<>(id -> blocks.getHolder(ResourceKey.create(Registries.BLOCK, id)).map(holder -> (Holder<Block>) holder), TagManager.getTagDir(Registries.BLOCK));
        Map<ResourceLocation, Collection<Holder<Block>>> built = loader.loadAndBuild(resources);
        Map<TagKey<Block>, List<Holder<Block>>> tags = new HashMap<>();
        built.forEach((id, holders) -> tags.put(TagKey.create(Registries.BLOCK, id), List.copyOf(holders)));
        blocks.bindTags(tags);
    }

    static String nameOf(BlockState state) { return BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString(); }

    static class Palette {
        final List<String> names = new ArrayList<>();
        final Map<String, Integer> ids = new HashMap<>();
        int idOf(String name) { return ids.computeIfAbsent(name, key -> { names.add(key); return names.size() - 1; }); }
    }

    static ProtoChunk filledChunk(int chunkX, int chunkZ) {
        ProtoChunk chunk = new ProtoChunk(new ChunkPos(chunkX, chunkZ), UpgradeData.EMPTY, HEIGHT_ACCESSOR, biomeRegistry, null);
        NoiseChunk noiseChunk = chunk.getOrCreateNoiseChunk(c -> NoiseChunk.forChunk(c, randomState, DensityFunctions.BeardifierMarker.INSTANCE, settings, fluidPicker, Blender.empty()));
        Heightmap oceanFloor = chunk.getOrCreateHeightmapUnprimed(Heightmap.Types.OCEAN_FLOOR_WG);
        Heightmap worldSurface = chunk.getOrCreateHeightmapUnprimed(Heightmap.Types.WORLD_SURFACE_WG);
        ChunkPos pos = chunk.getPos();
        int minBlockX = pos.getMinBlockX();
        int minBlockZ = pos.getMinBlockZ();
        Aquifer aquifer = noiseChunk.aquifer();
        noiseChunk.initializeForFirstCellX();
        int cellWidth = noiseChunk.cellWidth();
        int cellHeight = noiseChunk.cellHeight();
        int cellsXZ = 16 / cellWidth;
        int minCellY = Math.floorDiv(MIN_Y, cellHeight);
        int cellCountY = Math.floorDiv(HEIGHT, cellHeight);
        for (int cellX = 0; cellX < cellsXZ; cellX++) {
            noiseChunk.advanceCellX(cellX);
            for (int cellZ = 0; cellZ < cellsXZ; cellZ++) {
                int sectionIndex = chunk.getSectionsCount() - 1;
                LevelChunkSection section = chunk.getSection(sectionIndex);
                for (int cellY = cellCountY - 1; cellY >= 0; cellY--) {
                    noiseChunk.selectCellYZ(cellY, cellZ);
                    for (int yInCell = cellHeight - 1; yInCell >= 0; yInCell--) {
                        int blockY = (minCellY + cellY) * cellHeight + yInCell;
                        int localY = blockY & 15;
                        int newSectionIndex = chunk.getSectionIndex(blockY);
                        if (sectionIndex != newSectionIndex) {
                            sectionIndex = newSectionIndex;
                            section = chunk.getSection(newSectionIndex);
                        }
                        noiseChunk.updateForY(blockY, (double) yInCell / (double) cellHeight);
                        for (int xInCell = 0; xInCell < cellWidth; xInCell++) {
                            int blockX = minBlockX + cellX * cellWidth + xInCell;
                            noiseChunk.updateForX(blockX, (double) xInCell / (double) cellWidth);
                            for (int zInCell = 0; zInCell < cellWidth; zInCell++) {
                                int blockZ = minBlockZ + cellZ * cellWidth + zInCell;
                                noiseChunk.updateForZ(blockZ, (double) zInCell / (double) cellWidth);
                                BlockState state = noiseChunk.getInterpolatedState();
                                if (state == null) state = settings.defaultBlock();
                                if (state == Blocks.AIR.defaultBlockState()) continue;
                                section.setBlockState(blockX & 15, localY, blockZ & 15, state, false);
                                oceanFloor.update(blockX & 15, blockY, blockZ & 15, state);
                                worldSurface.update(blockX & 15, blockY, blockZ & 15, state);
                            }
                        }
                    }
                }
            }
            noiseChunk.swapSlices();
        }
        noiseChunk.stopInterpolation();
        return chunk;
    }

    static void buildSurface(ProtoChunk chunk) {
        WorldGenerationContext context = new WorldGenerationContext(generator, HEIGHT_ACCESSOR);
        generator.buildSurface(chunk, context, randomState, null, biomeManager, biomeRegistry, Blender.empty());
    }

    static int[] namesToIds(ChunkAccess chunk, Palette palette) {
        int[] ids = new int[HEIGHT * 256];
        BlockPos.MutableBlockPos pos = new BlockPos.MutableBlockPos();
        for (int y = MIN_Y; y < MIN_Y + HEIGHT; y++) {
            for (int z = 0; z < 16; z++) {
                for (int x = 0; x < 16; x++) {
                    ids[(y - MIN_Y) * 256 + z * 16 + x] = palette.idOf(nameOf(chunk.getBlockState(pos.set(chunk.getPos().getMinBlockX() + x, y, chunk.getPos().getMinBlockZ() + z))));
                }
            }
        }
        return ids;
    }

    static String encodeU16(int[] ids) {
        ByteBuffer buffer = ByteBuffer.allocate(ids.length * 2).order(ByteOrder.LITTLE_ENDIAN);
        for (int id : ids) buffer.putShort((short) id);
        return Base64.getEncoder().encodeToString(buffer.array());
    }

    static JsonObject chunkJson(ChunkAccess chunk, String key) {
        Palette palette = new Palette();
        int[] ids = namesToIds(chunk, palette);
        JsonObject out = new JsonObject();
        JsonArray names = new JsonArray();
        palette.names.forEach(names::add);
        out.add(key + "Palette", names);
        out.addProperty(key, encodeU16(ids));
        return out;
    }

    static List<Holder<ConfiguredWorldCarver<?>>> carversOf(ChunkPos pos) {
        Holder<Biome> biome = generator.getBiomeSource().getNoiseBiome(QuartPos.fromBlock(pos.getMinBlockX()), 0, QuartPos.fromBlock(pos.getMinBlockZ()), randomState.sampler());
        BiomeGenerationSettings biomeSettings = generator.getBiomeGenerationSettings(biome);
        List<Holder<ConfiguredWorldCarver<?>>> list = new ArrayList<>();
        biomeSettings.getCarvers(GenerationStep.Carving.AIR).forEach(list::add);
        return list;
    }

    /** NoiseBasedChunkGenerator.applyCarvers with the region replaced by direct lookups. Returns [caveStarts, canyonStarts]. */
    static int[] applyCarvers(ProtoChunk chunk, boolean dryRun) {
        WorldgenRandom random = new WorldgenRandom(new LegacyRandomSource(0L));
        ChunkPos center = chunk.getPos();
        NoiseChunk noiseChunk = dryRun ? null : chunk.getOrCreateNoiseChunk(c -> { throw new IllegalStateException(); });
        Aquifer aquifer = dryRun ? null : noiseChunk.aquifer();
        CarvingContext context = dryRun ? null : new CarvingContext(generator, registryAccess, HEIGHT_ACCESSOR, noiseChunk, randomState, settings.surfaceRule());
        CarvingMask mask = dryRun ? null : chunk.getOrCreateCarvingMask(GenerationStep.Carving.AIR);
        int[] starts = new int[2];
        for (int offsetX = -8; offsetX <= 8; offsetX++) {
            for (int offsetZ = -8; offsetZ <= 8; offsetZ++) {
                ChunkPos source = new ChunkPos(center.x + offsetX, center.z + offsetZ);
                int index = 0;
                for (Holder<ConfiguredWorldCarver<?>> holder : carversOf(source)) {
                    ConfiguredWorldCarver<?> carver = holder.value();
                    random.setLargeFeatureSeed(SEED + (long) index, source.x, source.z);
                    if (carver.isStartChunk(random)) {
                        if (carver.worldCarver() == WorldCarver.CANYON) starts[1]++; else starts[0]++;
                        if (!dryRun) carver.carve(context, chunk, biomeManager::getBiome, random, aquifer, source, mask);
                    }
                    index++;
                }
            }
        }
        return starts;
    }

    public static void main(String[] argv) throws Exception {
        net.minecraft.SharedConstants.tryDetectVersion();
        net.minecraft.server.Bootstrap.bootStrap();
        PackRepository repository = ServerPacksSource.createPackRepository(Paths.get(argv[0]), new DirectoryValidator(path -> true));
        repository.reload();
        repository.setSelected(List.of("vanilla", "file/Terralith"));
        MultiPackResourceManager resources = new MultiPackResourceManager(PackType.SERVER_DATA, repository.openAllSelected());
        bindBlockTags(resources);
        LayeredRegistryAccess<RegistryLayer> layers = RegistryLayer.createRegistryAccess();
        RegistryAccess.Frozen worldgen = RegistryDataLoader.load(resources, layers.getAccessForLoading(RegistryLayer.WORLDGEN), RegistryDataLoader.WORLDGEN_REGISTRIES);
        layers = layers.replaceFrom(RegistryLayer.WORLDGEN, worldgen);
        RegistryAccess.Frozen dimensions = RegistryDataLoader.load(resources, layers.getAccessForLoading(RegistryLayer.DIMENSIONS), RegistryDataLoader.DIMENSION_REGISTRIES);
        layers = layers.replaceFrom(RegistryLayer.DIMENSIONS, dimensions);
        registryAccess = layers.compositeAccess();
        biomeRegistry = registryAccess.registryOrThrow(Registries.BIOME);
        generator = (NoiseBasedChunkGenerator) registryAccess.registryOrThrow(Registries.LEVEL_STEM).get(LevelStem.OVERWORLD).generator();
        settings = generator.generatorSettings().value();
        randomState = RandomState.create(settings, registryAccess.lookupOrThrow(Registries.NOISE), SEED);
        Aquifer.FluidStatus lava = new Aquifer.FluidStatus(-54, Blocks.LAVA.defaultBlockState());
        Aquifer.FluidStatus sea = new Aquifer.FluidStatus(settings.seaLevel(), settings.defaultFluid());
        int seaLevel = settings.seaLevel();
        fluidPicker = (x, y, z) -> y < Math.min(-54, seaLevel) ? lava : sea;
        biomeManager = new BiomeManager((qx, qy, qz) -> generator.getBiomeSource().getNoiseBiome(qx, qy, qz, randomState.sampler()), BiomeManager.obfuscateSeed(SEED));

        JsonObject out = new JsonObject();
        int[][] anchors = {{0, 0}, {250, 263}, {-377, 123}, {748, 748}, {-10, -10}, {562, -563}, {-200, 400}, {900, -100}};

        // 1. fills: pick chunks with veins, aquifer water, aquifer lava, plus plain ones.
        JsonArray fills = new JsonArray();
        JsonArray aquiferSamples = new JsonArray();
        Random picker = new Random(20260604L);
        int veinChunks = 0, lavaChunks = 0, waterChunks = 0, plainChunks = 0, scanned = 0;
        outer:
        for (int[] anchor : anchors) {
            for (int dx = 0; dx < 12; dx += 3) {
                for (int dz = 0; dz < 12; dz += 3) {
                    if (veinChunks >= 4 && lavaChunks >= 3 && waterChunks >= 3 && plainChunks >= 3) break outer;
                    int chunkX = anchor[0] + dx;
                    int chunkZ = anchor[1] + dz;
                    ProtoChunk chunk = filledChunk(chunkX, chunkZ);
                    scanned++;
                    boolean hasVein = false, hasAquiferLava = false, hasAquiferWater = false;
                    BlockPos.MutableBlockPos pos = new BlockPos.MutableBlockPos();
                    for (int y = MIN_Y; y < 50; y++) {
                        for (int z = 0; z < 16; z++) {
                            for (int x = 0; x < 16; x++) {
                                String name = nameOf(chunk.getBlockState(pos.set(chunkX * 16 + x, y, chunkZ * 16 + z)));
                                if (name.equals("minecraft:raw_iron_block") || name.equals("minecraft:deepslate_iron_ore") || name.equals("minecraft:copper_ore") || name.equals("minecraft:tuff") || name.equals("minecraft:granite")) hasVein = true;
                                if (name.equals("minecraft:lava") && y > -50) hasAquiferLava = true;
                                if (name.equals("minecraft:water") && y < 40 && y > -40) hasAquiferWater = true;
                            }
                        }
                    }
                    boolean take = false;
                    if (hasVein && veinChunks < 4) { veinChunks++; take = true; }
                    if (hasAquiferLava && lavaChunks < 3) { lavaChunks++; take = true; }
                    if (hasAquiferWater && waterChunks < 3) { waterChunks++; take = true; }
                    if (!take && !hasVein && !hasAquiferLava && !hasAquiferWater && plainChunks < 3) { plainChunks++; take = true; }
                    if (!take) continue;
                    JsonObject entry = chunkJson(chunk, "blocks");
                    entry.addProperty("chunkX", chunkX);
                    entry.addProperty("chunkZ", chunkZ);
                    fills.add(entry);

                    Aquifer aquifer = chunk.getOrCreateNoiseChunk(c -> { throw new IllegalStateException(); }).aquifer();
                    double[] densities = {0.0, 0.0, 0.0, -0.02, -0.1, -0.5, -1.0};
                    JsonArray samples = new JsonArray();
                    for (int sample = 0; sample < 700; sample++) {
                        int x = chunkX * 16 + picker.nextInt(16);
                        int z = chunkZ * 16 + picker.nextInt(16);
                        int y = MIN_Y + picker.nextInt(HEIGHT);
                        double density = densities[picker.nextInt(densities.length)];
                        BlockState state = aquifer.computeSubstance(new DensityFunction.SinglePointContext(x, y, z), density);
                        JsonArray row = new JsonArray();
                        row.add(x); row.add(y); row.add(z); row.add(density);
                        row.add(state == null ? "null" : nameOf(state));
                        samples.add(row);
                    }
                    JsonObject sampleEntry = new JsonObject();
                    sampleEntry.addProperty("chunkX", chunkX);
                    sampleEntry.addProperty("chunkZ", chunkZ);
                    sampleEntry.add("samples", samples);
                    aquiferSamples.add(sampleEntry);
                }
            }
        }
        System.out.println("scanned " + scanned + " chunks: vein " + veinChunks + " lava " + lavaChunks + " water " + waterChunks + " plain " + plainChunks);
        out.add("fills", fills);
        out.add("aquifer", aquiferSamples);

        // 2. carved chunks: keep those that add coverage (canyon carving, restored top material, plenty of cave volume).
        JsonArray carved = new JsonArray();
        int canyonChunks = 0, topMaterialChunks = 0, bigCaveChunks = 0;
        outerCarve:
        for (int[] anchor : anchors) {
            for (int dx = 0; dx < 10; dx++) {
                for (int dz = 0; dz < 10; dz++) {
                    if (canyonChunks >= 3 && topMaterialChunks >= 3 && bigCaveChunks >= 3) break outerCarve;
                    int chunkX = anchor[0] + dx * 4;
                    int chunkZ = anchor[1] + dz * 4;
                    ProtoChunk probe = new ProtoChunk(new ChunkPos(chunkX, chunkZ), UpgradeData.EMPTY, HEIGHT_ACCESSOR, biomeRegistry, null);
                    int[] starts = applyCarvers(probe, true);
                    if (starts[0] < 40) continue;
                    ProtoChunk chunk = filledChunk(chunkX, chunkZ);
                    buildSurface(chunk);
                    Palette prePalette = new Palette();
                    int[] preIds = namesToIds(chunk, prePalette);
                    applyCarvers(chunk, false);
                    Palette postPalette = new Palette();
                    int[] postIds = namesToIds(chunk, postPalette);
                    int changed = 0, restored = 0;
                    for (int i = 0; i < preIds.length; i++) {
                        String before = prePalette.names.get(preIds[i]);
                        String after = postPalette.names.get(postIds[i]);
                        if (!before.equals(after)) {
                            changed++;
                            if (before.equals("minecraft:dirt")) restored++;
                        }
                    }
                    boolean wantCanyon = starts[1] > 0 && changed > 3000 && canyonChunks < 3;
                    boolean wantTop = restored > 0 && topMaterialChunks < 3;
                    boolean wantBig = changed > 6000 && bigCaveChunks < 3;
                    if (!wantCanyon && !wantTop && !wantBig) continue;
                    if (wantCanyon) canyonChunks++;
                    if (wantTop) topMaterialChunks++;
                    if (wantBig) bigCaveChunks++;
                    JsonObject entry = chunkJson(chunk, "post");
                    JsonObject preEntry = new JsonObject();
                    JsonArray preNames = new JsonArray();
                    prePalette.names.forEach(preNames::add);
                    entry.add("prePalette", preNames);
                    entry.addProperty("pre", encodeU16(preIds));
                    entry.addProperty("chunkX", chunkX);
                    entry.addProperty("chunkZ", chunkZ);
                    entry.addProperty("caveStarts", starts[0]);
                    entry.addProperty("canyonStarts", starts[1]);
                    entry.addProperty("changedBlocks", changed);
                    entry.addProperty("restoredDirt", restored);
                    carved.add(entry);
                    System.out.println("carved chunk " + chunkX + "," + chunkZ + " starts " + starts[0] + "/" + starts[1] + " changed " + changed + " restoredDirt " + restored);
                }
            }
        }
        out.add("carved", carved);
        try (var writer = new java.io.OutputStreamWriter(new GZIPOutputStream(Files.newOutputStream(Paths.get(argv[1]))))) {
            writer.write(new Gson().toJson(out));
        }
    }
}
