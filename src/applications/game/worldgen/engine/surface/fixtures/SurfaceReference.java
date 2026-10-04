// Prints the reference values hard-coded in biome-noises.test.ts and surface-system.test.ts, from the real
// Minecraft 1.20.6 classes. Run with the remapped server jar and libraries on the classpath (JDK 21).
import java.lang.reflect.Method;
import java.util.List;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.util.RandomSource;
import net.minecraft.world.level.levelgen.*;
import net.minecraft.world.level.levelgen.synth.PerlinSimplexNoise;

public class SurfaceReference {
    public static void main(String[] args) throws Exception {
        net.minecraft.SharedConstants.tryDetectVersion(); net.minecraft.server.Bootstrap.bootStrap();
        PerlinSimplexNoise temp = new PerlinSimplexNoise(new WorldgenRandom(new LegacyRandomSource(1234L)), List.of(0));
        PerlinSimplexNoise frozen = new PerlinSimplexNoise(new WorldgenRandom(new LegacyRandomSource(3456L)), List.of(-2, -1, 0));
        PerlinSimplexNoise info = new PerlinSimplexNoise(new WorldgenRandom(new LegacyRandomSource(2345L)), List.of(0));
        int[][] points = {{0,0},{17,-33},{1000,2500},{-4096,777},{123456,-98765},{5,5}};
        for (int[] p : points) {
            System.out.println("temp " + p[0] + " " + p[1] + " " + temp.getValue(p[0] / 8.0f, p[1] / 8.0f, false));
            System.out.println("frozen " + p[0] + " " + p[1] + " " + frozen.getValue(p[0] * 0.05, p[1] * 0.05, false));
            System.out.println("info " + p[0] + " " + p[1] + " " + info.getValue(p[0] * 0.2, p[1] * 0.2, false));
        }
        PositionalRandomFactory root = new XoroshiroRandomSource(1337L).forkPositional();
        RandomSource bandRandom = root.fromHashOf(new ResourceLocation("clay_bands"));
        Method generate = SurfaceSystem.class.getDeclaredMethod("generateBands", RandomSource.class);
        generate.setAccessible(true);
        Object[] bands = (Object[]) generate.invoke(null, bandRandom);
        StringBuilder sb = new StringBuilder("bands");
        sb.append(' '); for (Object b : bands) { String n = b.toString(); sb.append(n.contains("light_gray") ? 'l' : n.contains("white") ? 'w' : n.contains("orange") ? 'o' : n.contains("yellow") ? 'y' : n.contains("brown") ? 'b' : n.contains("red") ? 'r' : 't'); }
        System.out.println(sb);
    }
}
