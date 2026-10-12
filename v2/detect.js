// 과일 윤곽 자동 인식(외부 라이브러리 없음). 브라우저와 Node 테스트에서 함께 쓴다
// 1) 가리킨 지점에서 여러 방향으로 선을 뻗어, 과일 색과 달라지는 첫 지점(경계점)을 찾는다
// 2) 경계점들을 구의 윤곽(원뿔)에 맞춘다. 끊긴 경계로 새어 나간 점, 그림자·반사광에서 멈춘 점은 원형에 맞지 않아 버려진다

if (typeof module !== "undefined") {
  // Node 테스트에서는 계산 함수를 불러온다(브라우저에서는 measure.js가 먼저 실린다)
  // eslint-disable-next-line no-global-assign
  ({ pixelToRay, normalize, fitCone, coneError, coneOutline } = require("./measure.js"));
}

const DETECT_RAYS = 120;

// image: { width, height, data(RGBA) }, seed: 과일 안쪽 한 점(px), k: 사진의 초점거리·중심(px)
// 반환: { cone, outline, edges, inliers } 또는 { error: "none" | "cut" | "small" }
function detectFruit(image, seed, k) {
  const edges = findEdgePoints(image, seed);
  const valid = edges.filter(Boolean);
  if (valid.length < DETECT_RAYS * 0.3) return { error: "none" };

  const rays = valid.map((p) => normalize(pixelToRay(p, k)));
  const fit = fitConeRobust(rays, k);
  if (!fit || fit.inliers.length < Math.max(12, DETECT_RAYS * 0.35)) return { error: "none" };
  const { cone } = fit;

  // 가리킨 지점이 찾은 윤곽 안에 있어야 한다
  const seedRay = normalize(pixelToRay(seed, k));
  if (dot(seedRay, cone.d) < cone.cosA) return { error: "none" };

  const outline = coneOutline(cone, k, 72);
  const margin = 2;
  const outside = outline.filter((p) =>
    p.x < -margin || p.y < -margin || p.x > image.width + margin || p.y > image.height + margin).length;
  if (outline.length < 72 || outside > 72 * 0.05) return { error: "cut" };
  const radiusPx = k.fx * Math.tan(cone.alpha);
  if (radiusPx < 8) return { error: "small" };

  return { cone, outline, edges: valid, inliers: fit.inliers.map((i) => valid[i]) };
}

// ---------- 경계점 찾기 ----------
// 각 방향으로 과일 색과의 차이를 재고, 차이가 문턱값을 넘어 계속되는 첫 지점을 경계로 본다
// 문턱값은 모든 선에서 잰 차이를 두 무리(과일/바깥)로 가장 잘 나누는 값(오츠 방법)
function findEdgePoints(image, seed) {
  const { width, height } = image;
  const step = Math.max(1, Math.min(width, height) / 500);
  const ref = seedColor(image, seed, Math.max(2, Math.round(Math.min(width, height) / 120)));

  const profiles = [];
  const all = [];
  for (let i = 0; i < DETECT_RAYS; i++) {
    const a = (i / DETECT_RAYS) * Math.PI * 2;
    const dx = Math.cos(a) * step;
    const dy = Math.sin(a) * step;
    const values = [];
    for (let t = 1; ; t++) {
      const x = seed.x + dx * t;
      const y = seed.y + dy * t;
      if (x < 1 || y < 1 || x > width - 2 || y > height - 2) break;
      const v = colorDistance(sampleColor(image, x, y), ref);
      values.push(v);
      all.push(v);
    }
    profiles.push({ dx, dy, values });
  }
  const threshold = Math.max(25, otsu(all));

  const RUN = 3; // 잡음 한 점에서 멈추지 않도록 문턱값을 연달아 넘어야 경계로 본다
  return profiles.map(({ dx, dy, values }) => {
    for (let t = 0; t + RUN <= values.length; t++) {
      let run = true;
      for (let j = 0; j < RUN; j++) if (values[t + j] <= threshold) run = false;
      if (!run) continue;
      // 문턱값을 지나는 위치를 바로 앞 점과 이어 더 정확히 잡는다
      const prev = t > 0 ? values[t - 1] : 0;
      const frac = values[t] > prev ? (threshold - prev) / (values[t] - prev) : 0;
      const s = t + Math.min(1, Math.max(0, frac)); // values[t]는 seed에서 (t + 1) 걸음
      return { x: seed.x + dx * s, y: seed.y + dy * s };
    }
    return null; // 경계를 못 찾고 사진 끝에 닿음
  });
}

// 가리킨 지점 주변 색(채널별 가운데값). 반사광 몇 점에 끌려가지 않게 한다
function seedColor(image, seed, radius) {
  const rs = [], gs = [], bs = [];
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      const px = Math.round(seed.x + x);
      const py = Math.round(seed.y + y);
      if (px < 0 || py < 0 || px >= image.width || py >= image.height) continue;
      const i = (py * image.width + px) * 4;
      rs.push(image.data[i]);
      gs.push(image.data[i + 1]);
      bs.push(image.data[i + 2]);
    }
  }
  const median = (arr) => arr.sort((a, b) => a - b)[arr.length >> 1];
  return [median(rs), median(gs), median(bs)];
}

// 3x3 평균 색(잡음 완화)
function sampleColor(image, x, y) {
  const cx = Math.round(x);
  const cy = Math.round(y);
  const { width, data } = image;
  let r = 0, g = 0, b = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const o = ((cy + j) * width + (cx + i)) * 4;
      r += data[o];
      g += data[o + 1];
      b += data[o + 2];
    }
  }
  return [r / 9, g / 9, b / 9];
}

// 색 차이: 색의 비율(밝기와 무관한 색감) 차이를 주로 보고, 밝기 차이는 약하게 본다
// 과일의 어두운 쪽 면은 같은 색감이라 과일로, 회색·흰색 테이블은 색감이 달라 바깥으로 본다
function colorDistance(c, ref) {
  const sc = c[0] + c[1] + c[2] + 30;
  const sr = ref[0] + ref[1] + ref[2] + 30;
  let chroma = 0;
  for (let i = 0; i < 3; i++) {
    const d = (c[i] + 10) / sc - (ref[i] + 10) / sr;
    chroma += d * d;
  }
  const light = Math.log(sc / sr);
  return Math.sqrt(chroma * 300 * 300 + light * light * 40 * 40);
}

function otsu(values) {
  const BINS = 256;
  let max = 0;
  for (const v of values) if (v > max) max = v;
  if (!(max > 0)) return 0;
  const hist = new Array(BINS).fill(0);
  for (const v of values) hist[Math.min(BINS - 1, Math.floor((v / max) * BINS))]++;
  const total = values.length;
  let sumAll = 0;
  for (let i = 0; i < BINS; i++) sumAll += i * hist[i];
  let sumB = 0, wB = 0, best = 0, bestVar = -1;
  for (let i = 0; i < BINS; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      best = i;
    }
  }
  return ((best + 1) / BINS) * max;
}

// ---------- 원뿔 맞추기(튀는 점 버리기) ----------
// 경계점 3개로 원뿔을 만들어 보고, 가장 많은 점이 들어맞는 원뿔을 고른 뒤 맞는 점들로 다시 맞춘다
function fitConeRobust(rays, k) {
  const pixelAngle = 1 / Math.max(k.fx, k.fy);
  let seed = 12345; // 결과가 매번 같도록 정해진 순서의 난수
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const inliersOf = (cone) => {
    const tol = Math.max(2 * pixelAngle, cone.alpha * 0.03);
    const list = [];
    rays.forEach((u, i) => {
      if (coneError(cone, u) < tol) list.push(i);
    });
    return list;
  };

  let best = null;
  for (let iter = 0; iter < 300; iter++) {
    const a = Math.floor(random() * rays.length);
    const b = Math.floor(random() * rays.length);
    const c = Math.floor(random() * rays.length);
    if (a === b || b === c || a === c) continue;
    const cone = fitCone([rays[a], rays[b], rays[c]]);
    if (!cone) continue;
    const inliers = inliersOf(cone);
    if (!best || inliers.length > best.inliers.length) best = { cone, inliers };
  }
  if (!best) return null;
  // 맞는 점 전부로 두 번 다시 맞춘다
  for (let n = 0; n < 2; n++) {
    const cone = fitCone(best.inliers.map((i) => rays[i]));
    if (!cone) break;
    best = { cone, inliers: inliersOf(cone) };
  }
  return best;
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

if (typeof module !== "undefined") {
  module.exports = { detectFruit, findEdgePoints, colorDistance, otsu };
}
