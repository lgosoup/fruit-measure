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
// view: 화면 좌표 = 사진 좌표 * scale + (offsetX, offsetY), 단위는 CSS 픽셀 (1차와 같음)
let photo = null;
let intrinsics = null;
const view = { scale: 1, minScale: 1, maxScale: 1, offsetX: 0, offsetY: 0 };
const MAX_ZOOM = 10;
// photoPoints: 사진에서 지정한 과일 양 끝(사진 픽셀 좌표), photoResult: 거리 계산 결과
let photoPoints = [];
let photoResult = null;

document.getElementById("btn-retake").addEventListener("click", showArUi);
document.getElementById("btn-reset-fruit").addEventListener("click", () => {
  resetPhotoFruit();
  draw();
});

async function showPhoto(image, cameraIntrinsics) {
  const bitmap = await createImageBitmap(image);
  if (photo) photo.close();
  photo = bitmap;
  intrinsics = cameraIntrinsics;
  arUi.hidden = true;
  arCanvas.hidden = true;
  photoScreen.hidden = false;
  photoInfo.textContent = `${photo.width}×${photo.height}px · 초점거리 ${intrinsics.fx.toFixed(0)}px`;
  resetPhotoFruit();
  resizeCanvas();
  fitToScreen();
  draw();
}

function resetPhotoFruit() {
  photoPoints = [];
  photoResult = null;
  updatePhotoStatus();
}

function addPhotoPoint(p) {
  if (photoPoints.length === 2) photoPoints = [];
  photoResult = null;
  photoPoints.push(p);
  if (photoPoints.length === 2 && arResult) {
    photoResult = distanceFromPhoto(photoPoints[0], photoPoints[1], intrinsics, arResult.sizeMm);
  }
  updatePhotoStatus();
}

function updatePhotoStatus() {
  const sizeNote = arResult
    ? `<span class="status-sub">과일 크기 ${arResult.sizeMm.toFixed(1)}mm(AR) 기준</span>`
    : "";
  let line;
  if (photoResult) {
    line = `카메라~과일 표면 거리 <strong class="status-fruit">${photoResult.distanceMm.toFixed(1)} mm</strong>`;
  } else if (photoPoints.length === 2) {
    line = "두 점이 같은 위치입니다. 과일 양 끝을 다시 터치하세요";
  } else {
    line = `흐리면 다시 찍기, 선명하면 과일 양 끝을 터치하세요 (${photoPoints.length}/2)`;
  }
  photoStatus.innerHTML = `${line}<br>${sizeNote}`;
  document.getElementById("btn-save").disabled = !photoResult;
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
  view.maxScale = fit * MAX_ZOOM;
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
  // 점과 선은 확대 배율과 상관없이 같은 크기로 보이도록 화면 좌표로 그린다
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawPoints(ctx, photoPoints.map(photoToScreen), FRUIT_COLOR);
}

function screenToPhoto(p) {
  return { x: (p.x - view.offsetX) / view.scale, y: (p.y - view.offsetY) / view.scale };
}

function photoToScreen(p) {
  return { x: p.x * view.scale + view.offsetX, y: p.y * view.scale + view.offsetY };
}

// 창 크기뿐 아니라 아래 안내 문구 길이가 바뀌어 사진 영역 크기가 달라져도 다시 맞춘다(그대로 두면 사진이 찌그러짐)
new ResizeObserver(() => {
  if (photoScreen.hidden || !photo) return;
  const wasFit = view.scale <= view.minScale * 1.0001;
  resizeCanvas();
  if (wasFit) {
    fitToScreen();
  } else {
    const rect = canvas.getBoundingClientRect();
    view.minScale = Math.min(rect.width / photo.width, rect.height / photo.height);
    view.maxScale = view.minScale * MAX_ZOOM;
    view.scale = clamp(view.scale, view.minScale, view.maxScale);
    keepPhotoInView();
  }
  draw();
}).observe(canvas);

// ---------- 터치: 짧은 터치는 점 찍기, 한 손가락 끌기는 이동, 두 손가락은 확대·이동 ----------
// 마우스(PC 확인용)도 같은 규칙: 클릭은 점 찍기, 드래그는 이동, 휠은 확대
const TAP_TOLERANCE = 8; // CSS 픽셀. 손가락은 마우스보다 흔들린다
const pointers = new Map(); // 누르고 있는 손가락 id → 위치
let pressStart = null;
let dragging = false;
let tapCancelled = false;   // 두 손가락을 댔던 동작은 점 찍기로 보지 않는다
let pinchFrom = null;       // 직전 두 손가락 거리와 가운데 { dist, mid }

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function pinchState() {
  const [a, b] = [...pointers.values()];
  return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
}

canvas.addEventListener("pointerdown", (event) => {
  try {
    canvas.setPointerCapture(event.pointerId);
  } catch (error) {
    // 무시(실패해도 동작에는 지장 없음)
  }
  pointers.set(event.pointerId, canvasPoint(event));
  if (pointers.size === 1) {
    pressStart = canvasPoint(event);
    dragging = false;
    tapCancelled = false;
  } else if (pointers.size === 2) {
    tapCancelled = true;
    pinchFrom = pinchState();
  }
});

canvas.addEventListener("pointermove", (event) => {
  if (!pointers.has(event.pointerId) || !photo) return;
  const prev = pointers.get(event.pointerId);
  const curr = canvasPoint(event);
  pointers.set(event.pointerId, curr);

  if (pointers.size >= 2) {
    const now = pinchState();
    if (pinchFrom) {
      if (pinchFrom.dist > 0) zoomAt(now.mid, now.dist / pinchFrom.dist);
      view.offsetX += now.mid.x - pinchFrom.mid.x;
      view.offsetY += now.mid.y - pinchFrom.mid.y;
    }
    pinchFrom = now;
  } else {
    if (!dragging && Math.hypot(curr.x - pressStart.x, curr.y - pressStart.y) > TAP_TOLERANCE) dragging = true;
    if (!dragging) return;
    view.offsetX += curr.x - prev.x;
    view.offsetY += curr.y - prev.y;
  }
  keepPhotoInView();
  draw();
});

canvas.addEventListener("pointerup", (event) => {
  if (!pointers.has(event.pointerId)) return;
  if (pointers.size === 1 && !dragging && !tapCancelled && photo) {
    const p = screenToPhoto(canvasPoint(event));
    // 사진 바깥을 터치한 경우는 무시한다
    if (p.x >= 0 && p.y >= 0 && p.x <= photo.width && p.y <= photo.height) {
      addPhotoPoint(p);
      draw();
    }
  }
  endPointer(event);
});
canvas.addEventListener("pointercancel", endPointer);

function endPointer(event) {
  pointers.delete(event.pointerId);
  if (pointers.size < 2) pinchFrom = null;
  if (pointers.size === 1) {
    // 두 손가락 중 하나를 떼면 남은 손가락으로 이어서 이동한다
    dragging = true;
  }
  if (pointers.size === 0) {
    pressStart = null;
    dragging = false;
  }
}

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  if (!photo) return;
  const delta = event.deltaMode === 1 ? event.deltaY * 40 : event.deltaY;
  zoomAt(canvasPoint(event), Math.exp(-delta * 0.0018));
  keepPhotoInView();
  draw();
}, { passive: false });

// p(화면 좌표)를 기준으로 ratio배 확대한다
function zoomAt(p, ratio) {
  const newScale = clamp(view.scale * ratio, view.minScale, view.maxScale);
  const r = newScale / view.scale;
  view.offsetX = p.x - (p.x - view.offsetX) * r;
  view.offsetY = p.y - (p.y - view.offsetY) * r;
  view.scale = newScale;
}

// 사진이 화면 밖으로 완전히 벗어나지 않게 한다(1차와 같음)
function keepPhotoInView() {
  const rect = canvas.getBoundingClientRect();
  const w = photo.width * view.scale;
  const h = photo.height * view.scale;
  view.offsetX = w <= rect.width ? (rect.width - w) / 2 : clamp(view.offsetX, rect.width - w, 0);
  view.offsetY = h <= rect.height ? (rect.height - h) / 2 : clamp(view.offsetY, rect.height - h, 0);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// ---------- 기록 저장과 목록 ----------
// 1차와 같은 저장 공간을 함께 쓴다. 2차 기록에는 거리가 더해진다
// records: [{ no: 측정 번호, sizeMm: 크기, distanceMm: 표면까지 거리(1차 기록에는 없음), at: 측정 시각(ISO) }]
const STORAGE_KEY = "fruit-measure-records";
const recordsScreen = document.getElementById("screen-records");
const btnSave = document.getElementById("btn-save");

btnSave.addEventListener("click", saveRecord);
document.getElementById("btn-records").addEventListener("click", showRecords);
document.getElementById("btn-records-back").addEventListener("click", () => {
  recordsScreen.hidden = true;
  homeScreen.hidden = false;
});

function loadRecords() {
  try {
    const records = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!Array.isArray(records)) return [];
    // 저장된 값이 손상되어도 앱이 멈추지 않도록 형식이 맞는 기록만 쓴다(1차와 같은 기준)
    return records.filter((r) =>
      r && Number.isFinite(r.no) && Number.isFinite(r.sizeMm) && !Number.isNaN(new Date(r.at).getTime()));
  } catch (error) {
    return [];
  }
}

function saveRecord() {
  if (!photoResult || !arResult) return;
  const records = loadRecords();
  const record = {
    // 지운 번호가 있어도 겹치지 않도록 가장 큰 번호 다음으로 매긴다(1차와 같음)
    no: records.reduce((max, r) => Math.max(max, r.no), 0) + 1,
    sizeMm: Math.round(arResult.sizeMm * 10) / 10,
    distanceMm: Math.round(photoResult.distanceMm * 10) / 10,
    at: new Date().toISOString(),
  };
  records.push(record);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (error) {
    console.error(error);
    photoStatus.textContent = "브라우저에 저장하지 못했습니다. 저장 공간 설정을 확인해 주세요.";
    return;
  }
  // 다음 과일을 바로 잴 수 있도록 AR 화면으로 돌아가 크기부터 다시 잰다
  resetArMeasure();
  showArUi();
  showArNote(`${record.no}번 기록 저장됨 · 크기 ${record.sizeMm.toFixed(1)}mm · 거리 ${record.distanceMm.toFixed(1)}mm. 다음 과일을 재세요`);
}

let pendingDeleteNo = null; // 「정말 삭제」 확인을 기다리는 기록 번호

function showRecords() {
  pendingDeleteNo = null;
  renderRecords();
  homeScreen.hidden = true;
  recordsScreen.hidden = false;
}

function renderRecords() {
  const records = loadRecords();
  const body = document.getElementById("records-body");
  body.textContent = "";
  for (const r of records) {
    const row = body.insertRow();
    row.insertCell().textContent = r.no;
    row.insertCell().textContent = r.sizeMm.toFixed(1);
    // 1차(PC)에서 잰 기록은 거리가 없다
    row.insertCell().textContent = Number.isFinite(r.distanceMm) ? r.distanceMm.toFixed(1) : "–";
    row.insertCell().textContent = new Date(r.at).toLocaleString("ko-KR");
    const button = document.createElement("button");
    button.type = "button";
    button.className = r.no === pendingDeleteNo ? "btn-delete btn-delete-confirm" : "btn-delete";
    button.textContent = r.no === pendingDeleteNo ? "정말 삭제" : "삭제";
    button.addEventListener("click", () => onDeleteClick(r.no));
    row.insertCell().appendChild(button);
  }
  document.getElementById("records-empty").hidden = records.length > 0;
  document.getElementById("records-table").hidden = records.length === 0;
}

// 처음 누르면 확인 상태로 바뀌고, 같은 줄을 한 번 더 누르면 삭제한다(1차와 같음)
function onDeleteClick(no) {
  if (pendingDeleteNo !== no) {
    pendingDeleteNo = no;
    renderRecords();
    return;
  }
  pendingDeleteNo = null;
  const records = loadRecords().filter((r) => r.no !== no);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (error) {
    console.error(error);
  }
  renderRecords();
}
