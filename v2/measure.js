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

if (typeof module !== "undefined") {
  module.exports = { transformPoint, projectToScreen, intrinsicsFromProjection };
}
