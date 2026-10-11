// 계산식 단위 테스트. 실행: node v2/test/measure.test.js
const assert = require("node:assert/strict");
const m = require("../measure.js");

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`통과  ${name}`);
  } catch (error) {
    failed++;
    console.log(`실패  ${name}\n      ${error.message}`);
  }
}
const near = (actual, expected, tol, label) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: ${actual} (기대 ${expected} ± ${tol})`);

// 지름 d(m) 과일을 center(테이블 위 x, z)에 두고, 카메라에서 가장자리(높이 r)를 겨눈 시선이 테이블에 닿는 두 점을 만든다
function tableHits(camera, cx, cz, d, dirX, dirZ) {
  const r = d / 2;
  const H = camera[1];
  const len = Math.hypot(dirX, dirZ);
  const ux = dirX / len, uz = dirZ / len;
  return [1, -1].map((s) => {
    const ex = cx + s * r * ux, ez = cz + s * r * uz;  // 가장자리(높이 r)
    const k = H / (H - r);                              // 시선을 테이블(높이 0)까지 연장
    return [camera[0] + (ex - camera[0]) * k, 0, camera[2] + (ez - camera[2]) * k];
  });
}

// ---------- 3단계: AR 크기 측정 ----------
test("1차 보정식과 같은 결과 (높이 400mm, 측정 75mm)", () => {
  const camera = [0, 0.4, 0];
  const r = m.measureFruitAr([-0.0375, 0, 0], [0.0375, 0, 0], camera);
  near(r.sizeMm, m.correctRoundFruit(75, 400), 1e-9, "크기");
  near(r.rawMm, 75, 1e-9, "보정 전");
  near(r.heightMm, 400, 1e-9, "높이");
});

test("카메라 바로 아래 지름 70mm 과일: 크기 70mm, 표면까지 거리 = 높이 - 지름", () => {
  const camera = [0, 0.4, 0];
  const [a, b] = tableHits(camera, 0, 0, 0.07, 1, 0);
  const r = m.measureFruitAr(a, b, camera);
  near(r.sizeMm, 70, 1e-6, "크기");
  near(r.distanceMm, 400 - 70, 1e-6, "거리");
});

test("옆으로 비켜 있는 과일(가로 50mm, 세로 20mm 떨어짐): 크기와 거리", () => {
  const camera = [0, 0.35, 0];
  const [a, b] = tableHits(camera, 0.05, 0.02, 0.065, 0.05, 0.02);
  const r = m.measureFruitAr(a, b, camera);
  near(r.sizeMm, 65, 1e-6, "크기");
  const expected = (Math.hypot(0.05, 0.35 - 0.0325, 0.02) - 0.0325) * 1000;
  near(r.distanceMm, expected, 1e-6, "거리");
});

test("같은 위치 두 점은 계산하지 않음", () => {
  assert.equal(m.measureFruitAr([0.1, 0, 0.1], [0.1, 0, 0.1], [0, 0.4, 0]), null);
});

test("카메라가 테이블이나 과일 꼭대기보다 낮으면 계산하지 않음", () => {
  assert.equal(m.measureFruitAr([0, 0, 0], [0.07, 0, 0], [0, -0.1, 0]), null);
  assert.equal(m.measureFruitAr([0, 0, 0], [0.07, 0, 0], [0, 0.03, 0]), null);
});

// ---------- 카메라 값 ----------
test("투영 행렬에서 초점거리와 중심", () => {
  const p = new Float32Array(16);
  p[0] = 2 * 300 / 360; p[5] = 2 * 300 / 780; p[8] = 0.1; p[9] = -0.05;
  const k = m.intrinsicsFromProjection(p, 360, 780);
  near(k.fx, 300, 1e-4, "fx");
  near(k.fy, 300, 1e-4, "fy");
  near(k.cx, 162, 1e-4, "cx");
  near(k.cy, 370.5, 1e-4, "cy");
});

test("세계 좌표를 화면 좌표로: 정면 점은 화면 가운데", () => {
  const ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const p = new Float32Array(16);
  p[0] = 1.5; p[5] = 0.7; p[10] = -1; p[11] = -1; p[14] = -0.02;
  const s = m.projectToScreen([0, 0, -1], ident, p, 400, 800);
  near(s.x, 200, 1e-6, "x");
  near(s.y, 400, 1e-6, "y");
  assert.equal(m.projectToScreen([0, 0, 1], ident, p, 400, 800), null);
});

if (failed) {
  console.log(`\n${failed}개 실패`);
  process.exit(1);
}
console.log("\n모두 통과");
