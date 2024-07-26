export const VERTEX_SHADER = `
attribute int textureIndex;

varying vec3 Normal;
varying vec2 TextureCoordinates;
flat out int TextureIndex;

void main() {
  TextureIndex = textureIndex;
  Normal = normal;

  TextureCoordinates = uv;

  
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const FRAGMENT_SHADER = `
varying vec3 Normal;
varying vec2 TextureCoordinates;
flat in int TextureIndex;

uniform sampler2DArray Texture;

void main() {
  float diff = max(dot(Normal, normalize(vec3(0.5, 1, 0.5))), 0.0);
  vec3 diffuse = vec3(diff) + vec3(0.25);

  vec4 textureColor = texture(Texture, vec3(TextureCoordinates, TextureIndex));
  
  gl_FragColor = vec4((vec4(diffuse, 1.0) * textureColor).rgb, 1.0);

  //if(TextureIndex == 16) {
  //  gl_FragColor = vec4(gl_FragColor.rgb, 0.05);
  //}
}
`;
