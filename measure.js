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
// 측정값 m = 실제값 x H / (H - 실제값/2)  →  실제값 = m x H / (H + m/2)   (카드 기준 때와 같은 보정식, H: 카메라 높이)
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
    center,
    radiusM: r,
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

// ---------- 구의 윤곽(원뿔) ----------
// 카메라에서 구를 보면 윤곽을 지나는 시선은 모두 「카메라→구 중심」 축과 같은 각도 α를 이룬다(원뿔).
// 윤곽 위 시선(단위 벡터) u마다 u·d = cos α 이므로, w = d / cos α 로 두면 u·w = 1 인 일차식이 된다.
// rays: 단위 벡터 배열(3개 이상). 반환: { d: 축(단위 벡터), cosA, sinA, alpha } 또는 null
function fitCone(rays) {
  if (rays.length < 3) return null;
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const b = [0, 0, 0];
  for (const u of rays) {
    for (let i = 0; i < 3; i++) {
      b[i] += u[i];
      for (let j = 0; j < 3; j++) A[i][j] += u[i] * u[j];
    }
  }
  const w = solve3(A, b);
  if (!w) return null;
  const len = Math.hypot(w[0], w[1], w[2]);
  const cosA = 1 / len;
  if (!(cosA > 0 && cosA < 1)) return null;
  const d = [w[0] / len, w[1] / len, w[2] / len];
  const sinA = Math.sqrt(1 - cosA * cosA);
  return { d, cosA, sinA, alpha: Math.acos(cosA) };
}

// 3x3 연립방정식(크라메르 공식). 풀 수 없으면 null
function solve3(A, b) {
  const det = (m) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A);
  if (!(Math.abs(D) > 1e-12)) return null;
  return [0, 1, 2].map((k) => det(A.map((row, i) => row.map((v, j) => (j === k ? b[i] : v)))) / D);
}

// 시선 u가 원뿔 윤곽에서 벗어난 각도(라디안)
function coneError(cone, u) {
  const dot = u[0] * cone.d[0] + u[1] * cone.d[1] + u[2] * cone.d[2];
  return Math.abs(Math.acos(Math.min(1, Math.max(-1, dot))) - cone.alpha);
}

// 원뿔 윤곽을 지나는 시선(단위 벡터) n개
function coneRays(cone, n) {
  const d = cone.d;
  // d에 수직인 두 방향
  const t = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = normalize(cross(d, t));
  const e2 = cross(d, e1);
  const rays = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    rays.push([0, 1, 2].map((j) => cone.cosA * d[j] + cone.sinA * (Math.cos(a) * e1[j] + Math.sin(a) * e2[j])));
  }
  return rays;
}

// 사진 방향 시선들을 사진 위 점(px)으로. 카메라 뒤쪽 시선은 뺀다
function raysToPixels(rays, k) {
  return rays.filter((u) => u[2] > 0).map((u) => ({ x: k.cx + k.fx * u[0] / u[2], y: k.cy + k.fy * u[1] / u[2] }));
}

// 원뿔 윤곽을 사진 위 점(px) n개로. 화면에 둘레를 그릴 때 쓴다
function coneOutline(cone, k, n = 72) {
  return raysToPixels(coneRays(cone, n), k);
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / len, v[1] / len, v[2] / len];
}

// 원뿔과 과일 지름으로 표면까지 거리: 중심까지 거리 = 반지름 / sin α (양 끝 두 점으로 구할 때와 같은 식)
function distanceFromCone(cone, sizeMm) {
  if (!cone || !(sizeMm > 0)) return null;
  const r = sizeMm / 2;
  const centerMm = r / cone.sinA;
  return { distanceMm: centerMm - r, centerMm };
}

// 사진 방향(x 오른쪽, y 아래, z 앞)을 WebXR 카메라 방향(y 위, -z 앞)으로 바꾼 뒤 세계 방향으로 돌린다
// cameraMatrix: view.transform.matrix (카메라 → 세계)
function cameraDirToWorld(cameraMatrix, v) {
  const c = [v[0], -v[1], -v[2]];
  const m = cameraMatrix;
  return [
    m[0] * c[0] + m[4] * c[1] + m[8] * c[2],
    m[1] * c[0] + m[5] * c[1] + m[9] * c[2],
    m[2] * c[0] + m[6] * c[1] + m[10] * c[2],
  ];
}

// cameraDirToWorld의 반대: 세계 방향을 사진 방향(x 오른쪽, y 아래, z 앞)으로
function worldDirToCamera(cameraMatrix, v) {
  const m = cameraMatrix;
  const c = [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[4] * v[0] + m[5] * v[1] + m[6] * v[2],
    m[8] * v[0] + m[9] * v[1] + m[10] * v[2],
  ];
  return [c[0], -c[1], -c[2]];
}

// AR: 테이블 위에 놓인 구는 중심이 테이블에서 반지름 r만큼 떠 있다.
// 중심 = 카메라 + (r / sin α) · d  이고 중심 높이 = 테이블 + r 이므로
// H + (r / sin α) · d_y = r  →  r = H / (1 - d_y / sin α)   (H: 카메라 높이, d_y: 축의 위 방향 성분, 내려다보면 음수)
// 보정식 없이 바로 구해진다. dWorld: 세계 좌표 축(단위 벡터), camera: 카메라 위치, tableY: 테이블 높이(m)
// 반환: { sizeMm, heightMm, distanceMm, center, radiusM } 또는 계산할 수 없으면 null
function measureFruitCone(dWorld, sinA, camera, tableY) {
  const heightM = camera[1] - tableY;
  if (!(heightM > 0) || !(sinA > 0)) return null;
  const denom = 1 - dWorld[1] / sinA;
  if (!(denom > 1)) return null; // 축이 테이블 쪽을 향하지 않음
  const r = heightM / denom;
  const centerDistM = r / sinA;
  const center = [0, 1, 2].map((i) => camera[i] + centerDistM * dWorld[i]);
  return {
    sizeMm: 2 * r * 1000,
    heightMm: heightM * 1000,
    distanceMm: (centerDistM - r) * 1000,
    center,
    radiusM: r,
  };
}

// ---------- 회전타원체(가로·세로) ----------
// 과일은 세로축이 테이블에 수직(세계 y)인 회전타원체로 본다: 가로 반지름 a, 세로 반지름 c.
// 테이블 면(y = tableY)을 기준으로 세로 방향만 s = a / c 배 늘리면 반지름 a인 구가 되고, 그 구도 테이블에 놓인다.
// 늘려도 직선은 직선, 접하는 선은 접하는 선이므로 늘린 공간에서는 구의 계산(원뿔)을 그대로 쓴다.
function stretchPoint(p, s, tableY) {
  return [p[0], tableY + (p[1] - tableY) * s, p[2]];
}

function stretchDir(v, s) {
  return normalize([v[0], v[1] * s, v[2]]);
}

// 중심에서 방향 w(단위 벡터)로 회전타원체 표면까지 길이
function spheroidRadiusAlong(w, a, c) {
  const horizontal = w[0] * w[0] + w[2] * w[2];
  return 1 / Math.sqrt(horizontal / (a * a) + (w[1] * w[1]) / (c * c));
}

// 시선이 수직(바로 내려다봄)에서 기운 각도(도). dWorld: 카메라 → 과일 방향
function viewTiltDeg(dWorld) {
  return (Math.acos(Math.min(1, Math.max(-1, -dWorld[1]))) * 180) / Math.PI;
}

// 늘린 공간의 원뿔(cone: d, sinA)과 비율 s로 가로·세로 크기와 표면까지 거리를 구한다
// 표면까지 거리: 카메라에서 과일 중심을 향한 선이 표면과 만나는 점까지
// 반환: { widthMm, verticalMm, sizeMm(=가로), heightMm(카메라 높이), distanceMm, center, a, c, s } 또는 null
function measureSpheroidCone(cone, s, camera, tableY) {
  const sphere = measureFruitCone(cone.d, cone.sinA, stretchPoint(camera, s, tableY), tableY);
  if (!sphere) return null;
  const a = sphere.radiusM;
  const c = a / s;
  const center = stretchPoint(sphere.center, 1 / s, tableY);
  const v = [center[0] - camera[0], center[1] - camera[1], center[2] - camera[2]];
  const centerDistM = Math.hypot(v[0], v[1], v[2]);
  const w = [v[0] / centerDistM, v[1] / centerDistM, v[2] / centerDistM];
  return {
    widthMm: 2 * a * 1000,
    verticalMm: 2 * c * 1000,
    sizeMm: 2 * a * 1000,
    heightMm: (camera[1] - tableY) * 1000,
    distanceMm: (centerDistM - spheroidRadiusAlong(w, a, c)) * 1000,
    center,
    a,
    c,
    s,
  };
}

// 세계 좌표 시선들(윤곽을 지나는 단위 벡터)을 비율 s로 늘린 공간에서 원뿔에 맞추고, 원뿔에서 벗어난 정도(라디안, 제곱평균)를 함께 돌려준다
function fitConeStretched(raysWorld, s) {
  const rays = raysWorld.map((u) => stretchDir(u, s));
  const cone = fitCone(rays);
  if (!cone) return null;
  let sum = 0;
  for (const u of rays) sum += coneError(cone, u) ** 2;
  return { cone, error: Math.sqrt(sum / rays.length) };
}

// 세로/가로 비율 범위. 만감류는 대개 0.7~1.0이고, 꼭지 쪽이 솟은 과일을 위해 위로 여유를 둔다
const SPHEROID_RATIO_MIN = 0.5;
const SPHEROID_RATIO_MAX = 1.5;

// 비스듬히 본 윤곽 시선들에서 세로/가로 비율을 바꿔 가며 원뿔이 가장 잘 맞는 값을 찾는다
// 바로 위에서 보면 세로가 윤곽에 드러나지 않으므로 이 계산은 비스듬히 본 경우에만 쓴다
// errorOf(s): 비율 s에서 원뿔에서 벗어난 정도(작을수록 잘 맞음). 반환: 가장 잘 맞는 s
function searchSpheroidRatio(errorOf) {
  // 세로/가로 비율 q = 1 / s를 고르게 훑은 뒤, 가장 좋은 값 주변을 황금분할로 좁힌다
  let bestQ = 1;
  let bestError = Infinity;
  const STEPS = 20;
  for (let i = 0; i <= STEPS; i++) {
    const q = SPHEROID_RATIO_MIN + ((SPHEROID_RATIO_MAX - SPHEROID_RATIO_MIN) * i) / STEPS;
    const e = errorOf(1 / q);
    if (e < bestError) {
      bestError = e;
      bestQ = q;
    }
  }
  const stepQ = (SPHEROID_RATIO_MAX - SPHEROID_RATIO_MIN) / STEPS;
  let lo = Math.max(SPHEROID_RATIO_MIN, bestQ - stepQ);
  let hi = Math.min(SPHEROID_RATIO_MAX, bestQ + stepQ);
  const g = (Math.sqrt(5) - 1) / 2;
  let x1 = hi - g * (hi - lo);
  let x2 = lo + g * (hi - lo);
  let e1 = errorOf(1 / x1);
  let e2 = errorOf(1 / x2);
  for (let i = 0; i < 30; i++) {
    if (e1 < e2) {
      hi = x2; x2 = x1; e2 = e1;
      x1 = hi - g * (hi - lo); e1 = errorOf(1 / x1);
    } else {
      lo = x1; x1 = x2; e1 = e2;
      x2 = lo + g * (hi - lo); e2 = errorOf(1 / x2);
    }
  }
  return 1 / ((lo + hi) / 2);
}

// 윤곽 시선들(세계 좌표, 4개 이상)로 가로·세로를 함께 구한다. 점 찍기(가로 양 끝, 세로 위·아래 끝)에 쓴다
// 반환: measureSpheroidCone 결과 + { tiltDeg } 또는 null
function measureSpheroidRays(raysWorld, camera, tableY) {
  if (raysWorld.length < 4) return null;
  const errorOf = (s) => {
    const fit = fitConeStretched(raysWorld, s);
    return fit ? fit.error : Infinity;
  };
  const s = searchSpheroidRatio(errorOf);
  const fit = fitConeStretched(raysWorld, s);
  if (!fit) return null;
  const result = measureSpheroidCone(fit.cone, s, camera, tableY);
  if (!result) return null;
  const v = normalize([result.center[0] - camera[0], result.center[1] - camera[1], result.center[2] - camera[2]]);
  result.tiltDeg = viewTiltDeg(v);
  return result;
}

if (typeof module !== "undefined") {
  module.exports = {
    transformPoint, projectToScreen, intrinsicsFromProjection, correctRoundFruit, measureFruitAr,
    pixelToRay, distanceFromPhoto, fitCone, coneError, coneOutline, distanceFromCone, cameraDirToWorld,
    measureFruitCone, normalize, coneRays, raysToPixels, worldDirToCamera, stretchPoint, stretchDir, spheroidRadiusAlong, viewTiltDeg,
    measureSpheroidCone, fitConeStretched, searchSpheroidRatio, measureSpheroidRays,
    SPHEROID_RATIO_MIN, SPHEROID_RATIO_MAX,
  };
}
