// ---------- 화면 요소 ----------
const homeScreen = document.getElementById("screen-home");
const photoScreen = document.getElementById("screen-photo");
const homeMessage = document.getElementById("home-message");
const inputCamera = document.getElementById("input-camera");
const inputGallery = document.getElementById("input-gallery");
const canvas = document.getElementById("photo-canvas");
const ctx = canvas.getContext("2d");

// ---------- 상태 ----------
// photo: 불러온 사진(원본 픽셀 크기 유지)
// view: 화면 좌표 = 사진 좌표 * scale + (offsetX, offsetY), 단위는 CSS 픽셀
let photo = null;
const view = { scale: 1, minScale: 1, maxScale: 1, offsetX: 0, offsetY: 0 };
const MAX_ZOOM = 10; // 화면 맞춤 대비 최대 확대 배율

// ---------- 첫 화면 버튼 ----------
document.getElementById("btn-camera").addEventListener("click", () => inputCamera.click());
document.getElementById("btn-gallery").addEventListener("click", () => inputGallery.click());
document.getElementById("btn-records").addEventListener("click", () => {
  homeMessage.textContent = "기록 기능은 준비 중입니다.";
});
document.getElementById("btn-back").addEventListener("click", showHome);

inputCamera.addEventListener("change", onFileSelected);
inputGallery.addEventListener("change", onFileSelected);

async function onFileSelected(event) {
  const file = event.target.files[0];
  event.target.value = ""; // 같은 사진을 다시 골라도 change가 발생하도록
  if (!file) return;

  try {
    // 사진의 회전 정보(EXIF)를 반영해 원래 방향으로 읽는다
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    if (photo) photo.close();
    photo = bitmap;
    showPhoto();
  } catch (error) {
    console.error(error);
    homeMessage.textContent = "사진을 불러오지 못했습니다. 다른 사진을 선택해 주세요.";
  }
}

// ---------- 화면 전환 ----------
function showHome() {
  photoScreen.hidden = true;
  homeScreen.hidden = false;
}

function showPhoto() {
  homeScreen.hidden = true;
  photoScreen.hidden = false;
  resizeCanvas();
  fitToScreen();
  draw();
}

// ---------- 캔버스 크기와 화면 맞춤 ----------
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
}

// 화면 크기가 바뀌면(폰 회전, 폴드 화면 전환) 다시 맞춘다
window.addEventListener("resize", () => {
  if (photoScreen.hidden || !photo) return;
  resizeCanvas();
  fitToScreen();
  draw();
});

// ---------- 핀치 줌과 드래그 이동 ----------
const pointers = new Map(); // 화면에 닿아 있는 손가락들
let lastPinch = null;       // 직전 두 손가락의 중심과 간격

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

canvas.addEventListener("pointerdown", (event) => {
  // 손가락이 캔버스 밖으로 나가도 이벤트를 계속 받는다(실패해도 동작에는 지장 없음)
  try {
    canvas.setPointerCapture(event.pointerId);
  } catch (error) {
    // 무시
  }
  pointers.set(event.pointerId, canvasPoint(event));
  lastPinch = null;
});

canvas.addEventListener("pointermove", (event) => {
  if (!pointers.has(event.pointerId)) return;
  const prev = pointers.get(event.pointerId);
  const curr = canvasPoint(event);
  pointers.set(event.pointerId, curr);

  if (pointers.size === 1) {
    // 한 손가락: 사진 이동
    view.offsetX += curr.x - prev.x;
    view.offsetY += curr.y - prev.y;
  } else if (pointers.size === 2) {
    // 두 손가락: 중심을 기준으로 확대·축소하고, 중심이 움직인 만큼 이동
    const [a, b] = [...pointers.values()];
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const distance = Math.hypot(a.x - b.x, a.y - b.y);

    if (lastPinch) {
      const newScale = clamp(view.scale * (distance / lastPinch.distance), view.minScale, view.maxScale);
      const ratio = newScale / view.scale;
      view.offsetX = center.x - (lastPinch.center.x - view.offsetX) * ratio;
      view.offsetY = center.y - (lastPinch.center.y - view.offsetY) * ratio;
      view.scale = newScale;
    }
    lastPinch = { center, distance };
  }

  keepPhotoInView();
  draw();
});

function endPointer(event) {
  pointers.delete(event.pointerId);
  lastPinch = null;
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);

// PC 확인용: 마우스 휠로 확대·축소
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const p = canvasPoint(event);
  const newScale = clamp(view.scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1), view.minScale, view.maxScale);
  const ratio = newScale / view.scale;
  view.offsetX = p.x - (p.x - view.offsetX) * ratio;
  view.offsetY = p.y - (p.y - view.offsetY) * ratio;
  view.scale = newScale;
  keepPhotoInView();
  draw();
}, { passive: false });

// 사진이 화면 밖으로 완전히 벗어나지 않게 한다
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
