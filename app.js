// ---------- 화면 요소 ----------
const homeScreen = document.getElementById("screen-home");
const photoScreen = document.getElementById("screen-photo");
const homeMessage = document.getElementById("home-message");
const inputPhoto = document.getElementById("input-photo");
const photoStatus = document.getElementById("photo-status");
const canvas = document.getElementById("photo-canvas");
const ctx = canvas.getContext("2d");

// ---------- 상태 ----------
// photo: 불러온 사진(원본 픽셀 크기 유지)
// view: 화면 좌표 = 사진 좌표 * scale + (offsetX, offsetY), 단위는 CSS 픽셀
let photo = null;
const view = { scale: 1, minScale: 1, maxScale: 1, offsetX: 0, offsetY: 0 };
const MAX_ZOOM = 10; // 화면 맞춤 대비 최대 확대 배율

// 기준 사물: 신용카드 가로 길이
const CARD_WIDTH_MM = 85.6;
const CARD_COLOR = "#22d3ee";
// cardPoints: 카드 양 끝 점(원본 사진 픽셀 좌표). 확대 배율과 상관없이 같은 값이 나오도록 사진 좌표로 저장한다
let cardPoints = [];
let mmPerPixel = null; // 원본 사진 1픽셀이 실제 몇 mm인지

// ---------- 첫 화면 버튼 ----------
document.getElementById("btn-open").addEventListener("click", () => inputPhoto.click());
document.getElementById("btn-records").addEventListener("click", () => {
  homeMessage.textContent = "기록 기능은 준비 중입니다.";
});
document.getElementById("btn-back").addEventListener("click", showHome);
document.getElementById("btn-reset-card").addEventListener("click", () => {
  resetCard();
  draw();
});

inputPhoto.addEventListener("change", onFileSelected);

async function onFileSelected(event) {
  const file = event.target.files[0];
  event.target.value = ""; // 같은 사진을 다시 골라도 change가 발생하도록
  if (!file) return;

  try {
    // 사진의 회전 정보(EXIF)를 반영해 원래 방향으로 읽는다
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    if (photo) photo.close();
    photo = bitmap;
    resetCard();
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

  // 점과 선은 확대 배율과 상관없이 같은 크기로 보이도록 화면 좌표로 그린다
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawPoints(cardPoints, CARD_COLOR);
}

function drawPoints(points, color) {
  const screen = points.map(photoToScreen);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  if (screen.length === 2) {
    ctx.beginPath();
    ctx.moveTo(screen[0].x, screen[0].y);
    ctx.lineTo(screen[1].x, screen[1].y);
    ctx.stroke();
  }
  for (const p of screen) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------- 좌표 변환 ----------
function screenToPhoto(p) {
  return { x: (p.x - view.offsetX) / view.scale, y: (p.y - view.offsetY) / view.scale };
}

function photoToScreen(p) {
  return { x: p.x * view.scale + view.offsetX, y: p.y * view.scale + view.offsetY };
}

// ---------- 신용카드 기준 지정 ----------
function resetCard() {
  cardPoints = [];
  mmPerPixel = null;
  updateStatus();
}

function addCardPoint(photoPoint) {
  // 이미 두 점이 있으면 새로 지정을 시작한다
  if (cardPoints.length === 2) resetCard();
  cardPoints.push(photoPoint);
  if (cardPoints.length === 2) {
    const [a, b] = cardPoints;
    const lengthPx = Math.hypot(a.x - b.x, a.y - b.y);
    mmPerPixel = lengthPx > 0 ? CARD_WIDTH_MM / lengthPx : null;
  }
  updateStatus();
}

function updateStatus() {
  if (cardPoints.length < 2 || !mmPerPixel) {
    photoStatus.textContent = `신용카드 가로 양 끝을 클릭하세요 (${cardPoints.length}/2)`;
    return;
  }
  const [a, b] = cardPoints;
  const lengthPx = Math.hypot(a.x - b.x, a.y - b.y);
  photoStatus.innerHTML =
    `<strong>기준 설정됨</strong> · 카드 ${lengthPx.toFixed(0)}px = ${CARD_WIDTH_MM}mm · 1px = ${mmPerPixel.toFixed(4)}mm`;
}

// 브라우저 창 크기가 바뀌면 다시 맞춘다
window.addEventListener("resize", () => {
  if (photoScreen.hidden || !photo) return;
  resizeCanvas();
  fitToScreen();
  draw();
});

// ---------- 클릭(점 찍기)과 드래그(이동) ----------
// 누른 위치에서 조금이라도 움직이면 드래그로 보고, 거의 움직이지 않고 떼면 클릭으로 본다
const CLICK_TOLERANCE = 5; // CSS 픽셀
let dragFrom = null;  // 직전 마우스 위치
let pressStart = null; // 누른 위치
let dragging = false;

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

canvas.addEventListener("pointerdown", (event) => {
  // 마우스가 캔버스 밖으로 나가도 이벤트를 계속 받는다(실패해도 동작에는 지장 없음)
  try {
    canvas.setPointerCapture(event.pointerId);
  } catch (error) {
    // 무시
  }
  dragFrom = canvasPoint(event);
  pressStart = dragFrom;
  dragging = false;
});

canvas.addEventListener("pointermove", (event) => {
  if (!dragFrom) return;
  const curr = canvasPoint(event);
  if (!dragging && Math.hypot(curr.x - pressStart.x, curr.y - pressStart.y) > CLICK_TOLERANCE) {
    dragging = true;
  }
  if (!dragging) return;
  view.offsetX += curr.x - dragFrom.x;
  view.offsetY += curr.y - dragFrom.y;
  dragFrom = curr;
  keepPhotoInView();
  draw();
});

canvas.addEventListener("pointerup", (event) => {
  if (dragFrom && !dragging) {
    const p = screenToPhoto(canvasPoint(event));
    // 사진 바깥을 클릭한 경우는 무시한다
    if (p.x >= 0 && p.y >= 0 && p.x <= photo.width && p.y <= photo.height) {
      addCardPoint(p);
      draw();
    }
  }
  endDrag();
});
canvas.addEventListener("pointercancel", endDrag);

function endDrag() {
  dragFrom = null;
  pressStart = null;
  dragging = false;
}

// ---------- 마우스 휠 확대·축소 ----------
// 휠 위치를 기준으로 확대하고, 페이지가 스크롤되지 않게 막는다
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const p = canvasPoint(event);
  // 휠을 굴린 양에 비례해 확대(한 칸 약 1.2배). 줄 단위로 오는 경우도 픽셀 단위로 맞춘다
  const delta = event.deltaMode === 1 ? event.deltaY * 40 : event.deltaY;
  const newScale = clamp(view.scale * Math.exp(-delta * 0.0018), view.minScale, view.maxScale);
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
