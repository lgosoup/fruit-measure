// ---------- 화면 요소 ----------
const homeScreen = document.getElementById("screen-home");
const homeMessage = document.getElementById("home-message");
const btnStart = document.getElementById("btn-start");
const arRoot = document.getElementById("ar-root");
const arUi = document.getElementById("ar-ui");
const arCanvas = document.getElementById("ar-canvas");
const arCtx = arCanvas.getContext("2d");
const arGuide = document.getElementById("ar-guide");
const btnCapture = document.getElementById("btn-capture");
const photoScreen = document.getElementById("screen-photo");
const photoInfo = document.getElementById("photo-info");
const photoStatus = document.getElementById("photo-status");
const canvas = document.getElementById("photo-canvas");
const ctx = canvas.getContext("2d");

const RETICLE_COLOR = "#22d3ee"; // 1차 기준선과 같은 색
const FRUIT_COLOR = "#e879f9";   // 1차 과일선과 같은 색
const MIN_AR_DISTANCE_MM = 300;  // AR은 30cm보다 가까우면 불안정하다
const btnPoint = document.getElementById("btn-point");
const arDone = document.getElementById("ar-done");

// ---------- AR 지원 확인 ----------
// 크롬(안드로이드)에서 ARCore를 쓸 수 있을 때만 측정을 시작할 수 있다
async function checkArSupport() {
  let supported = false;
  try {
    supported = !!navigator.xr && await navigator.xr.isSessionSupported("immersive-ar");
  } catch (error) {
    console.error(error);
  }
  btnStart.disabled = !supported;
  if (supported) {
    setHomeMessage("과일을 테이블 위에 놓고 측정 시작을 누르세요.", false);
  } else {
    setHomeMessage("이 브라우저에서는 AR을 쓸 수 없습니다. 갤럭시 Z 플립6의 크롬에서 열어 주세요.", true);
  }
}

function setHomeMessage(text, warn) {
  homeMessage.textContent = text;
  homeMessage.classList.toggle("guide-warn", warn);
}

checkArSupport();

// ---------- AR 세션 ----------
// xr: 실행 중인 AR 세션과 WebGL 자원. AR이 아닐 때는 null
let xr = null;
let reticleHit = null;    // 조준점 방향으로 찾은 테이블 면 위 위치(세계 좌표 [x, y, z]). 못 찾으면 null
let captureRequested = false;
let pointRequested = false;
// arPoints: 과일 양 끝을 겨눈 시선이 테이블 면에 닿은 위치(세계 좌표). arResult: 크기 측정 결과
let arPoints = [];
let arResult = null;
let arNote = null;        // 잠깐 보여줄 안내 { text, until }. 매 프레임 안내에 덮이지 않게 한다

function showArNote(text) {
  arNote = { text, until: performance.now() + 3000 };
}

btnStart.addEventListener("click", startAr);
document.getElementById("btn-ar-close").addEventListener("click", () => xr && xr.session.end());
btnCapture.addEventListener("click", () => {
  captureRequested = true;
});
btnPoint.addEventListener("click", () => {
  pointRequested = true;
});
document.getElementById("btn-remeasure").addEventListener("click", resetArMeasure);

// AR 화면 위 버튼을 누를 때 AR 쪽 터치(select)로 처리되지 않게 한다
arRoot.addEventListener("beforexrselect", (event) => event.preventDefault());

async function startAr() {
  if (xr) return;
  btnStart.disabled = true;
  let session = null;
  try {
    session = await navigator.xr.requestSession("immersive-ar", {
      requiredFeatures: ["hit-test", "dom-overlay", "camera-access"],
      domOverlay: { root: arRoot },
    });
    const glCanvas = document.createElement("canvas");
    const gl = glCanvas.getContext("webgl2", { xrCompatible: true });
    session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
    const refSpace = await session.requestReferenceSpace("local");
    const viewerSpace = await session.requestReferenceSpace("viewer");
    const hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
    xr = { session, gl, refSpace, hitTestSource, binding: new XRWebGLBinding(session, gl), blit: null };
  } catch (error) {
    console.error(error);
    if (session) session.end().catch(() => {});
    btnStart.disabled = false;
    setHomeMessage(
      "AR을 시작하지 못했습니다. 카메라 권한을 허용했는지, 'AR용 Google Play 서비스'가 설치·업데이트되어 있는지 확인해 주세요.",
      true);
    return;
  }
  session.addEventListener("end", onArEnd);
  homeScreen.hidden = true;
  arRoot.hidden = false;
  showArUi();
  resizeArCanvas();
  session.requestAnimationFrame(onXrFrame);
}

function onArEnd() {
  xr = null;
  reticleHit = null;
  captureRequested = false;
  arNote = null;
  resetArMeasure();
  arRoot.hidden = true;
  photoScreen.hidden = true;
  homeScreen.hidden = false;
  btnStart.disabled = false;
  setHomeMessage("과일을 테이블 위에 놓고 측정 시작을 누르세요.", false);
}

function showArUi() {
  photoScreen.hidden = true;
  arUi.hidden = false;
  arCanvas.hidden = false;
}

function resizeArCanvas() {
  const dpr = window.devicePixelRatio || 1;
  arCanvas.width = Math.round(window.innerWidth * dpr);
  arCanvas.height = Math.round(window.innerHeight * dpr);
}
window.addEventListener("resize", () => {
  if (xr) resizeArCanvas();
});

function onXrFrame(time, frame) {
  if (!xr) return;
  const { session, gl, refSpace, hitTestSource } = xr;
  session.requestAnimationFrame(onXrFrame);

  // 3D는 그리지 않는다. 카메라 화면이 보이도록 투명하게 비운다
  const layer = session.renderState.baseLayer;
  gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const pose = frame.getViewerPose(refSpace);
  if (!pose) {
    reticleHit = null;
    // 위치를 잃으면 카메라 이미지도 받을 수 없다. 촬영 요청은 남겨두지 않는다
    if (captureRequested) {
      captureRequested = false;
      showArNote("위치를 잃어 촬영하지 못했습니다. 조금 떨어져 다시 촬영해 주세요");
    }
    pointRequested = false;
    btnPoint.disabled = true;
    setArGuide(time, "위치를 잃었습니다. 폰을 천천히 움직여 테이블을 비추세요");
    drawArOverlay(null);
    return;
  }
  const view = pose.views[0];

  const hits = frame.getHitTestResults(hitTestSource);
  if (hits.length > 0) {
    const p = hits[0].getPose(refSpace).transform.position;
    reticleHit = [p.x, p.y, p.z];
  } else {
    reticleHit = null;
  }
  if (pointRequested) {
    pointRequested = false;
    if (reticleHit) {
      const c = pose.transform.position;
      addArPoint(reticleHit, [c.x, c.y, c.z]);
    } else {
      showArNote("테이블을 찾은 뒤 점을 찍어 주세요");
    }
  }
  btnPoint.disabled = !reticleHit || arResult !== null;
  btnCapture.disabled = arResult === null;

  let guide;
  if (arResult) guide = "원하는 위치로 다가가 과일이 화면에 다 들어오게 촬영하세요";
  else if (!reticleHit) guide = "폰을 천천히 움직여 테이블을 비추세요";
  else guide = `30cm 이상 떨어져 조준점을 과일 가장자리에 맞추고 점 찍기 (${arPoints.length}/2)`;
  setArGuide(time, guide);

  if (captureRequested) {
    captureRequested = false;
    capture(view, layer);
  }
  drawArOverlay(view);
}

function setArGuide(time, text) {
  if (arNote && time < arNote.until) text = arNote.text;
  else arNote = null;
  if (arGuide.textContent !== text) arGuide.textContent = text;
}

// ---------- AR 크기 측정 ----------
function resetArMeasure() {
  arNote = null;
  arPoints = [];
  arResult = null;
  arDone.hidden = true;
  btnCapture.disabled = true;
}

function addArPoint(hit, cameraPosition) {
  if (arPoints.length === 2) arPoints = [];
  arPoints.push(hit);
  if (arPoints.length < 2) return;

  const result = measureFruitAr(arPoints[0], arPoints[1], cameraPosition);
  if (!result) {
    arPoints = [];
    showArNote("두 점이 같은 위치이거나 계산할 수 없습니다. 과일 양 끝을 다시 찍어 주세요");
    return;
  }
  if (result.distanceMm < MIN_AR_DISTANCE_MM) {
    arPoints = [];
    showArNote(`너무 가깝습니다(약 ${(result.distanceMm / 10).toFixed(0)}cm). 30cm 이상 떨어져 다시 찍어 주세요`);
    return;
  }
  arResult = result;
  arNote = null; // 앞선 실패 안내는 지운다
  document.getElementById("ar-done-size").textContent = result.sizeMm.toFixed(1);
  document.getElementById("ar-done-sub").textContent =
    `보정 전 ${result.rawMm.toFixed(1)}mm · 거리 ${(result.distanceMm / 10).toFixed(1)}cm`;
  arDone.hidden = false;
}

// ---------- AR 화면 위 표시(조준점, 과일 점) ----------
function drawArOverlay(view) {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  arCtx.setTransform(1, 0, 0, 1, 0, 0);
  arCtx.clearRect(0, 0, arCanvas.width, arCanvas.height);
  arCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // 찍은 과일 점과 선
  if (view && arPoints.length > 0) {
    const screen = arPoints
      .map((p) => projectToScreen(p, view.transform.inverse.matrix, view.projectionMatrix, w, h))
      .filter(Boolean);
    drawPoints(arCtx, screen, FRUIT_COLOR);
  }

  // 조준점: 면을 찾으면 청록, 못 찾으면 회색
  const cx = w / 2;
  const cy = h / 2;
  arCtx.strokeStyle = reticleHit ? RETICLE_COLOR : "#9ca3af";
  arCtx.lineWidth = 2;
  arCtx.beginPath();
  arCtx.arc(cx, cy, 14, 0, Math.PI * 2);
  arCtx.moveTo(cx - 24, cy);
  arCtx.lineTo(cx - 6, cy);
  arCtx.moveTo(cx + 6, cy);
  arCtx.lineTo(cx + 24, cy);
  arCtx.moveTo(cx, cy - 24);
  arCtx.lineTo(cx, cy - 6);
  arCtx.moveTo(cx, cy + 6);
  arCtx.lineTo(cx, cy + 24);
  arCtx.stroke();
}

// 점과 선(1차와 같은 모양). points: 화면 좌표
function drawPoints(context, points, color) {
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 2;
  if (points.length === 2) {
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    context.lineTo(points[1].x, points[1].y);
    context.stroke();
  }
  for (const p of points) {
    context.beginPath();
    context.arc(p.x, p.y, 6, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.arc(p.x, p.y, 2, 0, Math.PI * 2);
    context.fill();
  }
}

// ---------- 촬영: AR 화면과 같은 카메라 이미지를 가져온다 ----------
function capture(view, layer) {
  if (!view.camera) {
    showArNote("카메라 이미지를 가져오지 못했습니다. 다시 촬영해 주세요");
    return;
  }
  let image;
  try {
    image = readCameraImage(view.camera);
  } catch (error) {
    console.error(error);
    showArNote("카메라 이미지를 가져오지 못했습니다. 다시 촬영해 주세요");
    return;
  } finally {
    xr.gl.bindFramebuffer(xr.gl.FRAMEBUFFER, layer.framebuffer);
  }
  const intrinsics = intrinsicsFromProjection(view.projectionMatrix, image.width, image.height);
  showPhoto(image, intrinsics);
}

// 카메라 텍스처를 화면 크기 그대로 복사해 읽는다(셰이더로 그린 뒤 readPixels)
function readCameraImage(camera) {
  const gl = xr.gl;
  const width = camera.width;
  const height = camera.height;
  const texture = xr.binding.getCameraImage(camera);
  if (!xr.blit) xr.blit = createBlit(gl);
  const { program, buffer } = xr.blit;

  const target = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, target);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);

  gl.viewport(0, 0, width, height);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  const loc = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(gl.getUniformLocation(program, "uTex"), 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.deleteFramebuffer(fb);
  gl.deleteTexture(target);

  // WebGL은 아래쪽부터 읽으므로 위아래를 뒤집는다
  const image = new ImageData(width, height);
  const row = width * 4;
  for (let y = 0; y < height; y++) {
    image.data.set(pixels.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  }
  return image;
}

function createBlit(gl) {
  const vs = `#version 300 es
    in vec2 aPos;
    out vec2 vUv;
    void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
  const fs = `#version 300 es
    precision mediump float;
    uniform sampler2D uTex;
    in vec2 vUv;
    out vec4 color;
    void main() { color = texture(uTex, vUv); }`;
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  return { program, buffer };
}

// ---------- 찍은 사진 화면 ----------
// photo: 찍은 사진(카메라 이미지 픽셀 크기 유지), intrinsics: 그 사진의 초점거리·중심(px)
let photo = null;
let intrinsics = null;
const view = { scale: 1, minScale: 1, maxScale: 1, offsetX: 0, offsetY: 0 };

document.getElementById("btn-retake").addEventListener("click", showArUi);

async function showPhoto(image, cameraIntrinsics) {
  const bitmap = await createImageBitmap(image);
  if (photo) photo.close();
  photo = bitmap;
  intrinsics = cameraIntrinsics;
  arUi.hidden = true;
  arCanvas.hidden = true;
  photoScreen.hidden = false;
  photoInfo.textContent =
    `${photo.width}×${photo.height}px · 초점거리 ${intrinsics.fx.toFixed(0)}px`;
  photoStatus.textContent = "사진이 선명한지 확인하세요. 흐리면 다시 찍기를 누르세요.";
  resizeCanvas();
  fitToScreen();
  draw();
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
}

// 사진 전체가 잘리지 않고 화면 가운데에 보이도록 배율과 위치를 정한다
function fitToScreen() {
  const rect = canvas.getBoundingClientRect();
  const fit = Math.min(rect.width / photo.width, rect.height / photo.height);
  view.minScale = fit;
  view.maxScale = fit * 10;
  view.scale = fit;
  view.offsetX = (rect.width - photo.width * fit) / 2;
  view.offsetY = (rect.height - photo.height * fit) / 2;
}

function draw() {
  if (!photo) return;
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.offsetX, dpr * view.offsetY);
  ctx.drawImage(photo, 0, 0);
}

window.addEventListener("resize", () => {
  if (photoScreen.hidden || !photo) return;
  resizeCanvas();
  fitToScreen();
  draw();
});
