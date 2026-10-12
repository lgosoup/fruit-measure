// 윤곽 자동 인식 테스트: 실행 `node v2/test/detect.test.js`
// 테이블 위 구를 카메라로 찍은 사진을 계산으로 그려, 인식한 윤곽에서 거리·크기가 다시 나오는지 확인한다
const assert = require("node:assert");
const { cameraDirToWorld, normalize, distanceFromCone, measureFruitCone, pixelToRay } = require("../measure.js");
const { detectFruit } = require("../detect.js");

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("ok  ", name);
  } catch (error) {
    failed++;
    console.log("FAIL", name, "\n     ", error.message);
  }
}

// 아래를 pitchDeg만큼 내려다보는 카메라(카메라 → 세계 행렬, 열 우선)
function cameraPose(position, pitchDeg) {
  const t = (pitchDeg * Math.PI) / 180;
  const up = [0, Math.cos(t), -Math.sin(t)];
  const back = [0, Math.sin(t), Math.cos(t)]; // 카메라 +z(앞의 반대)
  return [1, 0, 0, 0, up[0], up[1], up[2], 0, back[0], back[1], back[2], 0, position[0], position[1], position[2], 1];
}

// 장면: 테이블(y=0) 위 반지름 r 구. 옵션으로 그림자, 반사광, 경계에 붙은 과일색 물체(윤곽 끊김), 꼭지, 잡음
function render(opt) {
  const { width, height, k, pose, center, r } = opt;
  const cam = [pose[12], pose[13], pose[14]];
  const table = opt.table || [120, 118, 112];
  const fruit = opt.fruit || [235, 140, 25];
  const light = normalize([0.4, 1, 0.3]);
  let noiseSeed = 7;
  const noise = () => {
    noiseSeed = (noiseSeed * 1103515245 + 12345) % 2147483648;
    return (noiseSeed / 2147483648 - 0.5) * 2 * (opt.noise || 0);
  };
  const data = new Uint8ClampedArray(width * height * 4);
  const SS = 2; // 경계가 매끄럽도록 한 픽셀을 2x2로 나눠 그린다
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const p = { x: x + (sx + 0.5) / SS, y: y + (sy + 0.5) / SS };
          const c = shade(normalize(cameraDirToWorld(pose, pixelToRay(p, k))));
          for (let i = 0; i < 3; i++) sum[i] += c[i];
        }
      }
      const o = (y * width + x) * 4;
      for (let i = 0; i < 3; i++) data[o + i] = sum[i] / (SS * SS) + noise();
      data[o + 3] = 255;
    }
  }
  return { width, height, data };

  function shade(u) {
    // 구와 만나는지
    const oc = [cam[0] - center[0], cam[1] - center[1], cam[2] - center[2]];
    const b = oc[0] * u[0] + oc[1] * u[1] + oc[2] * u[2];
    const disc = b * b - (oc[0] ** 2 + oc[1] ** 2 + oc[2] ** 2 - r * r);
    if (disc >= 0) {
      const t = -b - Math.sqrt(disc);
      const hit = [cam[0] + u[0] * t, cam[1] + u[1] * t, cam[2] + u[2] * t];
      const n = normalize([hit[0] - center[0], hit[1] - center[1], hit[2] - center[2]]);
      if (opt.stem && n[1] > 0.985) return [90, 70, 30];
      const lambert = Math.max(0, n[0] * light[0] + n[1] * light[1] + n[2] * light[2]);
      const view = -(n[0] * u[0] + n[1] * u[1] + n[2] * u[2]);
      if (opt.highlight && lambert > 0.97 && view > 0.5) return [255, 245, 225];
      const f = 0.45 + 0.55 * lambert;
      return fruit.map((v) => v * f);
    }
    // 테이블
    if (u[1] >= 0) return [200, 200, 200];
    const t = -cam[1] / u[1];
    const p = [cam[0] + u[0] * t, 0, cam[2] + u[2] * t];
    if (opt.blob) {
      // 과일 옆에 붙은 과일색 물체: 이쪽 윤곽이 끊긴다
      const bx = center[0] + r * 1.15, bz = center[2];
      if (Math.hypot(p[0] - bx, p[2] - bz) < r * 0.45) return fruit.map((v) => v * 0.9);
    }
    if (opt.shadow) {
      const sx = center[0] - r * 0.5, sz = center[2] - r * 0.4;
      if (Math.hypot(p[0] - sx, p[2] - sz) < r * 1.25) return table.map((v) => v * 0.45);
    }
    return table;
  }
}

// 구 중심이 사진에 찍히는 위치를 가리킨 지점으로 쓴다
function seedFor(opt) {
  const cam = [opt.pose[12], opt.pose[13], opt.pose[14]];
  const m = opt.pose;
  const w = [opt.center[0] - cam[0], opt.center[1] - cam[1], opt.center[2] - cam[2]];
  // 세계 → 카메라: 회전의 전치
  const c = [
    m[0] * w[0] + m[1] * w[1] + m[2] * w[2],
    m[4] * w[0] + m[5] * w[1] + m[6] * w[2],
    m[8] * w[0] + m[9] * w[1] + m[10] * w[2],
  ];
  const img = [c[0], -c[1], -c[2]];
  return {
    x: opt.k.cx + opt.k.fx * img[0] / img[2] + (opt.seedShift || [0, 0])[0],
    y: opt.k.cy + opt.k.fy * img[1] / img[2] + (opt.seedShift || [0, 0])[1],
  };
}

function trueDistanceMm(opt) {
  const cam = [opt.pose[12], opt.pose[13], opt.pose[14]];
  return (Math.hypot(cam[0] - opt.center[0], cam[1] - opt.center[1], cam[2] - opt.center[2]) - opt.r) * 1000;
}

function relErr(a, b) {
  return Math.abs(a - b) / b;
}

// 근거리 사진(약 10cm): 거리 확인
const photoK = { fx: 520, fy: 520, cx: 240, cy: 320, width: 480, height: 640 };
const R = 0.035;
function photoScene(extra) {
  // 카메라는 과일 위쪽 비스듬히, 표면에서 약 10cm
  const center = [0, R, 0];
  const pitch = 50;
  const dist = 0.135;
  const t = (pitch * Math.PI) / 180;
  const pos = [center[0], center[1] + dist * Math.sin(t), center[2] + dist * Math.cos(t)];
  return { width: 480, height: 640, k: photoK, pose: cameraPose(pos, pitch), center, r: R, ...extra };
}

function checkPhoto(opt, tol) {
  const image = render(opt);
  const result = detectFruit(image, seedFor(opt), opt.k);
  assert.ok(result.cone, "인식 실패: " + result.error);
  const d = distanceFromCone(result.cone, 2 * R * 1000).distanceMm;
  const truth = trueDistanceMm(opt);
  assert.ok(relErr(d, truth) < tol, `거리 ${d.toFixed(1)}mm, 실제 ${truth.toFixed(1)}mm`);
  return { d, truth, inliers: result.inliers.length, edges: result.edges.length };
}

test("사진 가운데 과일: 거리 1% 이내", () => {
  checkPhoto(photoScene({}), 0.01);
});

test("과일이 사진 가장자리 쪽(비스듬한 윤곽): 거리 1% 이내", () => {
  const opt = photoScene({});
  opt.center = [0.025, R, -0.015];
  checkPhoto(opt, 0.01);
});

test("잡음 + 그림자 + 반사광: 거리 2% 이내", () => {
  checkPhoto(photoScene({ noise: 14, shadow: true, highlight: true }), 0.02);
});

test("윤곽 일부가 끊김(옆에 붙은 과일색 물체) + 꼭지: 거리 2% 이내, 튄 점은 버려짐", () => {
  const r = checkPhoto(photoScene({ blob: true, stem: true, noise: 8 }), 0.02);
  assert.ok(r.inliers < r.edges, "버려진 점이 있어야 함");
});

test("가리킨 지점이 과일 가운데가 아니어도 인식", () => {
  checkPhoto(photoScene({ seedShift: [35, -40], noise: 8 }), 0.015);
});

test("나무색 테이블에서도 인식", () => {
  checkPhoto(photoScene({ table: [165, 120, 80], noise: 8, shadow: true }), 0.02);
});

test("테이블을 가리키면 실패", () => {
  const opt = photoScene({ noise: 8 });
  const result = detectFruit(render(opt), { x: 20, y: 600 }, opt.k);
  assert.strictEqual(result.cone, undefined);
});

test("과일이 사진 밖으로 잘리면 실패(cut)", () => {
  const opt = photoScene({});
  opt.center = [0.07, R, 0];
  const image = render(opt);
  const seed = seedFor(opt);
  seed.x = Math.min(seed.x, opt.width - 30);
  const result = detectFruit(image, seed, opt.k);
  assert.strictEqual(result.error, "cut");
});

// AR(30cm 이상): 원뿔과 카메라 높이로 크기 확인
function arScene(pitch, extra) {
  const center = [0.03, R, -0.02];
  const dist = 0.42;
  const t = (pitch * Math.PI) / 180;
  const pos = [0, center[1] + dist * Math.sin(t), center[2] + dist * Math.cos(t)];
  const k = { fx: 480, fy: 480, cx: 240, cy: 320, width: 480, height: 640 };
  return { width: 480, height: 640, k, pose: cameraPose(pos, pitch), center, r: R, ...extra };
}

function checkAr(opt, tol) {
  const image = render(opt);
  const result = detectFruit(image, seedFor(opt), opt.k);
  assert.ok(result.cone, "인식 실패: " + result.error);
  const dWorld = normalize(cameraDirToWorld(opt.pose, result.cone.d));
  const cam = [opt.pose[12], opt.pose[13], opt.pose[14]];
  const m = measureFruitCone(dWorld, result.cone.sinA, cam, 0);
  assert.ok(m, "크기 계산 실패");
  assert.ok(relErr(m.sizeMm, 2 * R * 1000) < tol, `크기 ${m.sizeMm.toFixed(1)}mm, 실제 ${(2 * R * 1000).toFixed(1)}mm`);
  assert.ok(relErr(m.distanceMm, trueDistanceMm(opt)) < tol,
    `거리 ${m.distanceMm.toFixed(1)}mm, 실제 ${trueDistanceMm(opt).toFixed(1)}mm`);
}

test("AR 바로 위에서 내려다봄: 크기·거리 2% 이내", () => {
  checkAr(arScene(88, { noise: 8 }), 0.02);
});

test("AR 비스듬히(55도) + 그림자 + 반사광: 크기·거리 3% 이내", () => {
  checkAr(arScene(55, { noise: 10, shadow: true, highlight: true }), 0.03);
});

console.log(failed ? `\n${failed}개 실패` : "\n모두 통과");
process.exit(failed ? 1 : 0);
