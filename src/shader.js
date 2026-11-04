// Shader
// A marbled field seen through fluted glass, drawn in WebGL behind a dark
// block. Warped colour bands cycle through four colours and each glass rib
// splits them into red, green and blue fringes. Ported from the Blacklist
// site (blacklist-v2).
//
// Markup: a canvas as the first child of a block with `position: relative`
// and `isolation: isolate`:
//
//   <canvas class="bl-shader" data-shader="{{settings.shader_palette}}" aria-hidden="true"></canvas>
//
// The palette comes from the "Shader palette" theme setting. "none" (or a
// browser without WebGL) leaves the block's own black background showing.
// The field swirls away from the pointer, reduced motion draws one still
// frame, and offscreen it stops rendering.

// Four colours each, from the deepest trough to the brightest glint.
const palettes = {
  graphite: ["#050505", "#1c1c1c", "#3d3d3d", "#8c8c8c"],
  poster: ["#07070c", "#1b2a6b", "#e8321e", "#f4efe6"],
  ember: ["#2a0014", "#ff0a6c", "#ff3d00", "#ffae00"],
  electric: ["#020a3a", "#0038ff", "#00c8ff", "#b8f0ff"],
  sorbet: ["#002b2b", "#00c9b7", "#ff9e7a", "#fff1d6"],
  chrome: ["#0d0e12", "#6f8298", "#dde4ec", "#ffd2a1"],
  moss: ["#08170c", "#2e7d32", "#b5e03a", "#efe6c8"],
  dusk: ["#1a0826", "#6a2bd9", "#c9a2ff", "#ff9a3d"],
  citrus: ["#1c1a04", "#8f9a00", "#ffd400", "#ff7a1a"],
  rust: ["#220705", "#8e2412", "#e0673a", "#f2e4d4"],
  rose: ["#1c0a14", "#7a3b5a", "#e8a3b8", "#fbe9e4"],
  glacier: ["#0a1418", "#3d5a66", "#a9c7cf", "#f7f5ef"],
  sand: ["#1a1410", "#7a6246", "#d8c3a0", "#fff6e5"],
};

const vertex = `
  attribute vec2 position;
  void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

const fragment = `
  precision highp float;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform vec3 uColors[4];
  uniform vec3 uGround;
  uniform vec2 uPointer;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    mat2 turn = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 4; i++) {
      value += amplitude * noise(p);
      p = turn * p * 2.03;
      amplitude *= 0.5;
    }
    return value;
  }

  float field(vec2 frag, float unit, float t) {
    vec2 p = frag / unit * 1.6;
    vec2 away = (frag - uPointer) / unit;
    p += away * 1.5 * exp(-dot(away, away) * 5.0);
    vec2 q = vec2(fbm(p + t * 0.3), fbm(p + vec2(5.2, 1.3) - t * 0.2));
    vec2 r = vec2(fbm(p + 3.0 * q + vec2(1.7, 9.2) + t * 0.5),
                  fbm(p + 3.0 * q + vec2(8.3, 2.8) - t * 0.4));
    return fbm(p + 3.0 * r) + 0.5 * length(q);
  }

  vec3 pick(float i) {
    if (i < 0.5) return uColors[0];
    if (i < 1.5) return uColors[1];
    if (i < 2.5) return uColors[2];
    return uColors[3];
  }

  vec3 palette(float x) {
    x = fract(x) * 4.0;
    float i = floor(x);
    float blend = smoothstep(0.0, 1.0, fract(x));
    return mix(pick(i), pick(mod(i + 1.0, 4.0)), blend);
  }

  void main() {
    float unit = min(uResolution.x, uResolution.y);
    float t = uTime * 0.15;

    float ribWidth = unit * 0.03;
    float rib = fract(gl_FragCoord.x / ribWidth);
    vec2 frag = gl_FragCoord.xy + vec2((rib - 0.5) * ribWidth * 1.6, 0.0);
    vec2 split = vec2((rib - 0.5) * ribWidth * 0.5, 0.0);

    float bands = 1.3;
    float fR = field(frag + split, unit, t);
    float fG = field(frag, unit, t);
    float fB = field(frag - split, unit, t);

    vec3 color = vec3(palette(fR * bands + t).r, palette(fG * bands + t).g, palette(fB * bands + t).b);
    color = mix(uGround, color, 0.45 + 0.55 * smoothstep(0.3, 1.1, fG));
    color *= 0.8 + 0.2 * sin(rib * 3.1416);

    color += (hash(gl_FragCoord.xy + uTime) - 0.5) * 0.02;
    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`;

function rgb(value) {
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) return [0, 0, 0];
  probe.fillStyle = value;
  probe.fillRect(0, 0, 1, 1);
  const data = probe.getImageData(0, 0, 1, 1).data;
  return [data[0] / 255, data[1] / 255, data[2] / 255];
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

const still =
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function start(canvas, colors) {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
  if (!gl) return false;

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
  gl.useProgram(program);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW
  );
  const position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const resolution = gl.getUniformLocation(program, "uResolution");
  const time = gl.getUniformLocation(program, "uTime");
  const flat = [];
  colors.forEach((color) => flat.push.apply(flat, rgb(color)));
  gl.uniform3fv(gl.getUniformLocation(program, "uColors"), flat);
  const ground = getComputedStyle(document.documentElement)
    .getPropertyValue("--bl-primary")
    .trim();
  gl.uniform3fv(
    gl.getUniformLocation(program, "uGround"),
    rgb(ground || "#171717")
  );

  const pointer = gl.getUniformLocation(program, "uPointer");
  const target = { x: -9999, y: -9999 };
  const current = { x: -9999, y: -9999 };
  window.addEventListener("pointermove", (event) => {
    const box = canvas.getBoundingClientRect();
    // A hidden canvas has no size; skip it so the pointer never becomes NaN,
    // which would flatten the field for good.
    if (!box.width || !box.height) return;
    const scale = canvas.width / box.width;
    target.x = (event.clientX - box.left) * scale;
    target.y = (box.bottom - event.clientY) * scale;
    if (current.x < -999) {
      current.x = target.x;
      current.y = target.y;
    }
  });

  const draw = (now) => {
    current.x += (target.x - current.x) * 0.06;
    current.y += (target.y - current.y) * 0.06;
    gl.uniform2f(pointer, current.x, current.y);
    gl.uniform1f(time, now / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const resize = () => {
    const scale = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(canvas.clientWidth * scale);
    canvas.height = Math.round(canvas.clientHeight * scale);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(resolution, canvas.width, canvas.height);
    if (still) draw(0);
  };
  resize();
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
  else window.addEventListener("resize", resize);
  if (still) return true;

  let frame = 0;
  const loop = (now) => {
    draw(now);
    frame = requestAnimationFrame(loop);
  };
  new IntersectionObserver((entries) => {
    cancelAnimationFrame(frame);
    if (entries[0].isIntersecting) frame = requestAnimationFrame(loop);
  }).observe(canvas);
  return true;
}

// Compiling a shader stalls the first paint on slow phones, so each one
// starts after the page has loaded, once it nears the screen.
function init() {
  if (!window.IntersectionObserver) return;
  Array.prototype.forEach.call(
    document.querySelectorAll("canvas[data-shader]"),
    (canvas) => {
      const colors = palettes[canvas.getAttribute("data-shader")];
      if (!colors) return;
      const near = new IntersectionObserver(
        (entries) => {
          const box = entries[0].boundingClientRect;
          if (!entries[0].isIntersecting || !box.width || !box.height) return;
          near.disconnect();
          if (start(canvas, colors)) {
            requestAnimationFrame(() => canvas.classList.add("is-live"));
          }
        },
        { rootMargin: "200px" }
      );
      near.observe(canvas);
    }
  );
}

if (document.readyState === "complete") init();
else window.addEventListener("load", init, { once: true });
