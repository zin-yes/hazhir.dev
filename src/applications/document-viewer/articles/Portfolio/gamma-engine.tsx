export default function GammaEngineDocument() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      :root {
        --fg: #0f172a;
        --muted: #475569;
        --line: #cbd5e1;
        --chip: #f1f5f9;
      }
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
        color: var(--fg);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      }
      .page {
        min-height: 100%;
        padding: 40px;
        max-width: 720px;
        margin: 0 auto;
      }
      .title {
        margin: 0;
        font-size: 26px;
        font-weight: 800;
        letter-spacing: 0.01em;
      }
      .subtitle {
        margin: 6px 0 0;
        color: var(--muted);
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .divider {
        margin: 20px 0;
        width: 100%;
        height: 1px;
        background: var(--line);
      }
      p, li {
        color: var(--muted);
        font-size: 14px;
        line-height: 1.72;
        letter-spacing: 0.01em;
        margin: 0 0 14px;
      }
      .section-label {
        margin: 28px 0 4px;
        color: #64748b;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.2em;
        text-transform: uppercase;
      }
      .caption {
        text-align: center;
        color: #94a3b8;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
        margin: -4px 0 22px;
      }
      .commit-timeline {
        margin: 16px 0 20px;
        padding: 0;
        list-style: none;
        border-left: 2px solid var(--line);
        padding-left: 16px;
      }
      .commit-timeline li {
        position: relative;
        margin-bottom: 10px;
        font-size: 13px;
        line-height: 1.55;
      }
      .commit-timeline li::before {
        content: "";
        position: absolute;
        left: -21px;
        top: 7px;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--line);
        border: 2px solid #ffffff;
      }
      .commit-timeline li strong {
        color: var(--fg);
        font-weight: 700;
      }
      .screenshot {
        width: 100%;
        border-radius: 8px;
        border: 1px solid var(--line);
        margin: 16px 0;
        display: block;
      }
      .tag {
        display: inline-flex;
        align-items: center;
        border-radius: 9999px;
        background: var(--chip);
        color: #334155;
        padding: 2px 8px;
        font-size: 11px;
        font-weight: 700;
        line-height: 1.2;
        letter-spacing: 0.03em;
        white-space: nowrap;
        margin-right: 4px;
      }
      a {
        color: var(--fg);
        text-decoration: underline;
      }
      code {
        font-family: "Geist Mono", ui-monospace, monospace;
        font-size: 12px;
        background: var(--chip);
        padding: 1px 5px;
        border-radius: 4px;
      }
      @media (max-width: 600px) {
        .page { padding: 24px 16px; }
        .title { font-size: 22px; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <h1 class="title">Gamma Engine</h1>
      <p class="subtitle">A small PBR game engine built with Java and OpenGL</p>

      <div class="divider"></div>

      <p>
        This is actually the third iteration of a game engine I've been building on and off since 2018. The <a href="https://github.com/zin-yes/zed">first version was called Zed</a>, and I learned a lot from it. I tried rewriting it in C++ at one point but didn't have enough experience with the language yet, so I went back to Java. It's the first language I ever learned because I wanted to make Minecraft mods, so it was what I was most comfortable with.
      </p>

      <p>
        The goal was to build a proper engine with rendering, audio, and physics, and to make sure I actually understood everything instead of just using a framework.
      </p>

      <div class="section-label">Rendering</div>
      <div class="divider"></div>

      <p>
        The renderer supports full PBR materials with up to <strong>six texture maps</strong> per object: albedo, normal, height, roughness, metallic, and ambient occlusion. Surfaces also use parallax mapping, which samples a height map to give flat geometry the illusion of real depth.
      </p>

      <img src="/articles/ge_bricks.png" alt="PBR brick material with parallax mapping" class="screenshot" loading="lazy" decoding="async" width="1280" height="720" />
      <p class="caption">PBR brick material. Albedo, normal, height (parallax), roughness, metallic, AO.</p>

      <img src="/articles/ge_rusty_metal.png" alt="PBR rusted iron material" class="screenshot" loading="lazy" decoding="async" width="1280" height="720" />
      <p class="caption">Rusted iron material on the same geometry. Same pipeline, different texture set.</p>

      <div class="section-label">Component system</div>
      <div class="divider"></div>

      <p>
        The engine uses a scene graph where everything is a component. Each frame it walks the tree and calls input, update, and render on each node. Loading a 3D model automatically spins up the right sub-components for its meshes.
      </p>

      <!-- Architecture diagram -->
      <div style="width:100%;border-radius:10px;border:1px solid var(--line);margin:16px 0;padding:20px 24px;background:#fafbfc;font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;line-height:1.7;color:#475569;">
        <div style="color:#0f172a;font-weight:700;margin-bottom:10px;font-family:Inter,system-ui,sans-serif;font-size:12px;letter-spacing:0.04em;">COMPONENT HIERARCHY</div>
        <div>
          <span style="color:#0f172a;font-weight:600;">GameComponent</span> <span style="color:#94a3b8;">(abstract)</span><br>
          ├─ <span style="color:#2563eb;">ShaderComponent</span> <span style="color:#94a3b8;">(abstract)</span><br>
          │&nbsp;&nbsp;└─ PBRShader<br>
          ├─ <span style="color:#2563eb;">ViewControllerComponent</span> <span style="color:#94a3b8;">(abstract)</span><br>
          │&nbsp;&nbsp;└─ FreeMoveComponent<br>
          ├─ <span style="color:#2563eb;">TextureComponent</span><br>
          ├─ <span style="color:#2563eb;">MeshComponent</span><br>
          ├─ <span style="color:#2563eb;">ModelComponent</span><br>
          └─ <span style="color:#2563eb;">SkyboxComponent</span><br>
        </div>
      </div>

      <div class="section-label">Blueprints</div>
      <div class="divider"></div>

      <p>
        Scene objects are defined in a simple <code>.gmf</code> file. Six lines is all it takes to describe a fully textured PBR object. A factory reads the file and builds the whole component tree automatically.
      </p>

      <!-- Blueprint mock-up -->
      <div style="width:100%;border-radius:10px;border:1px solid var(--line);margin:16px 0;padding:16px 20px;background:#fafbfc;font-family:'Geist Mono',ui-monospace,monospace;font-size:12px;line-height:1.8;color:#475569;">
        <div style="color:#94a3b8;margin-bottom:2px;"># bricks.gmf</div>
        <div><span style="color:#2563eb;">shader:</span> pbr</div>
        <div><span style="color:#2563eb;">model_file:</span> game_resources/cube.obj</div>
        <div><span style="color:#2563eb;">albedo_file:</span> game_resources/bricks/albedo.jpg</div>
        <div><span style="color:#2563eb;">normal_file:</span> game_resources/bricks/normals.jpg</div>
        <div><span style="color:#2563eb;">height_file:</span> game_resources/bricks/disp.png</div>
        <div><span style="color:#2563eb;">height_scale:</span> 0.1</div>
      </div>

      <div class="section-label">Audio</div>
      <div class="divider"></div>

      <p>
        The engine has 3D positional audio using OpenAL. Sound sources are placed in the scene and the listener follows the camera, so audio pans and attenuates based on distance and direction.
      </p>

      <div style="position:relative;width:100%;padding-bottom:56.25%;margin:16px 0;border-radius:8px;overflow:hidden;border:1px solid var(--line);">
        <iframe src="https://www.youtube.com/embed/gJfuA5QdcIg?list=PLX4lr9FAXutj6FOBKhatsV7Cn2M1iyogU" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>
      </div>
      <p class="caption">Audio devlog. This one got <a href="https://x.com/LWJGL/status/1103349628701949952">shared by LWJGL on Twitter</a>, which felt pretty cool to me at the time.</p>

      <div class="section-label">Physics</div>
      <div class="divider"></div>

      <p>
        Physics is handled by JBullet, a Java port of the Bullet physics engine. Objects in the scene can have rigid bodies with collision shapes, and the physics world steps alongside the engine loop.
      </p>

      <div style="position:relative;width:100%;padding-bottom:56.25%;margin:16px 0;border-radius:8px;overflow:hidden;border:1px solid var(--line);">
        <iframe src="https://www.youtube.com/embed/Tm4v8HJItcw?list=PLX4lr9FAXutj6FOBKhatsV7Cn2M1iyogU" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>
      </div>
      <p class="caption">Physics devlog showing JBullet integration.</p>

      <div class="section-label">Stack</div>
      <div class="divider"></div>

      <p>
        <span class="tag">Java</span>
        <span class="tag">OpenGL</span>
        <span class="tag">GLSL</span>
        <span class="tag">LWJGL 3</span>
        <span class="tag">Assimp</span>
        <span class="tag">JOML</span>
        <span class="tag">GLFW</span>
        <span class="tag">STBImage</span>
        <span class="tag">OpenAL</span>
        <span class="tag">JBullet</span>
        <span class="tag">Maven</span>
      </p>

      <div class="divider"></div>

      <p style="font-size: 12px; color: #94a3b8; margin-bottom: 0;">
        <a href="https://github.com/zin-yes/gamma-engine">GitHub</a>
      </p>
    </main>
  </body>
</html>
`;
}
