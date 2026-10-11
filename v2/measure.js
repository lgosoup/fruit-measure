// 측정 계산(화면과 상관없는 순수 함수). 브라우저와 Node 테스트에서 함께 쓴다

// ---------- 4x4 행렬 (WebXR과 같은 열 우선 Float32Array 16개) ----------
function transformPoint(m, p) {
  const x = p[0], y = p[1], z = p[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

// 세계 좌표 점을 화면 좌표(px)로. 카메라 뒤쪽이면 null
// viewInverse: view.transform.inverse.matrix, projection: view.projectionMatrix
function projectToScreen(point, viewInverse, projection, width, height) {
  const cam = transformPoint(viewInverse, point);
  if (cam[2] >= 0) return null; // 카메라는 -z 방향을 본다
  const ndc = transformPoint(projection, cam);
  return { x: (ndc[0] + 1) / 2 * width, y: (1 - ndc[1]) / 2 * height };
}

// ---------- 카메라 값 ----------
// 투영 행렬에서 이미지(width x height px)의 초점거리와 중심(위쪽 원점)을 구한다
function intrinsicsFromProjection(p, width, height) {
  return {
    fx: p[0] * width / 2,
    fy: p[5] * height / 2,
    cx: (1 - p[8]) * width / 2,
    cy: (1 + p[9]) * height / 2,
    width,
    height,
  };
}

// ---------- AR 크기 측정 ----------
// 둥근 과일은 가장 넓은 부분이 바닥에서 (크기/2)만큼 떠 있어, 가장자리를 겨눈 시선은 실제보다 바깥쪽 바닥에 닿는다
// 측정값 m = 실제값 x H / (H - 실제값/2)  →  실제값 = m x H / (H + m/2)   (1차와 같은 보정식, H: 카메라 높이)
function correctRoundFruit(measuredMm, heightMm) {
  return measuredMm * heightMm / (heightMm + measuredMm / 2);
}

// 테이블 면 위 두 점(세계 좌표 m, y가 위쪽)과 카메라 위치로 과일 크기와 표면까지 거리를 구한다
// 반환: { sizeMm, rawMm, heightMm, distanceMm } 또는 계산할 수 없으면 null
function measureFruitAr(a, b, camera) {
  const rawM = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  if (!(rawM > 0)) return null;
  const tableY = (a[1] + b[1]) / 2;
  const heightM = camera[1] - tableY;
  if (!(heightM > 0)) return null; // 카메라가 테이블보다 낮음
  const sizeM = correctRoundFruit(rawM, heightM);
  const r = sizeM / 2;
  if (!(heightM > 2 * r)) return null; // 카메라가 과일 꼭대기보다 낮음
  // 과일 중심: 두 점의 가운데를 카메라 바로 아래 지점 쪽으로 (H - r) / H만큼 당기고, 높이 r
  const k = (heightM - r) / heightM;
  const mid = [(a[0] + b[0]) / 2, tableY, (a[2] + b[2]) / 2];
  const center = [
    camera[0] + (mid[0] - camera[0]) * k,
    tableY + r,
    camera[2] + (mid[2] - camera[2]) * k,
  ];
  const centerDistM = Math.hypot(camera[0] - center[0], camera[1] - center[1], camera[2] - center[2]);
  return {
    sizeMm: sizeM * 1000,
    rawMm: rawM * 1000,
    heightMm: heightM * 1000,
    distanceMm: (centerDistM - r) * 1000,
  };
}

// ---------- 사진으로 거리 계산 ----------
// 사진 속 점(px)을 카메라에서 나가는 시선 방향으로 바꾼다
function pixelToRay(p, k) {
  return [(p.x - k.cx) / k.fx, (p.y - k.cy) / k.fy, 1];
}

// 과일(구)의 양 끝을 겨눈 두 시선은 구에 접한다. 두 시선 사이 각도의 절반을 α라 하면
// sin α = 반지름 / 중심까지 거리  →  중심까지 거리 = 반지름 / sin α, 표면까지 거리 = 중심까지 거리 - 반지름
// 과일이 사진 가운데에 있지 않아도 성립한다
// 반환: { distanceMm: 표면까지, centerMm: 중심까지 } 또는 계산할 수 없으면 null
function distanceFromPhoto(p1, p2, intrinsics, sizeMm) {
  const a = pixelToRay(p1, intrinsics);
  const b = pixelToRay(p2, intrinsics);
  const cos = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b));
  const angle = Math.acos(Math.min(1, Math.max(-1, cos)));
  if (!(angle > 0) || !(sizeMm > 0)) return null;
  const r = sizeMm / 2;
  const centerMm = r / Math.sin(angle / 2);
  return { distanceMm: centerMm - r, centerMm };
}

if (typeof module !== "undefined") {
  module.exports = {
    transformPoint, projectToScreen, intrinsicsFromProjection, correctRoundFruit, measureFruitAr,
    pixelToRay, distanceFromPhoto,
  };
}
