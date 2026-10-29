// todo.md·PRD.md의 변경 표시와 changes.md가 서로 맞는지 검사한다
// 실행(저장소 맨 위에서): node .claude/skills/stage-wrapup/scripts/check-marks.js
// 문제가 있으면 줄 번호와 함께 출력하고 1로 끝난다
const fs = require("fs");
const path = require("path");

const root = process.argv[2] || process.cwd();
const read = (f) => fs.readFileSync(path.join(root, f), "utf8").replace(/\r\n/g, "\n");
const changes = read("changes.md").replace(/<!--[\s\S]*?-->/g, ""); // 양식 주석은 뺀다

const problems = [];
const KINDS = ["추가", "변경", "취소"];

// changes.md 맨 위 「요약에 쓰는 말」 목록
const wordsLine = changes.split("\n").find((l) => l.startsWith("**요약에 쓰는 말**"));
const WORDS = wordsLine ? wordsLine.split(":").slice(1).join(":").split("·").map((w) => w.trim()).filter(Boolean) : [];
if (WORDS.length === 0) problems.push("changes.md: 「요약에 쓰는 말」 줄을 찾지 못함");

// changes.md의 상세 항목(### C-n)과 목록 표의 번호
const details = new Map();
const detailRe = /^### C-(\d+)\n([\s\S]*?)(?=^### C-\d+|(?![\s\S]))/gm;
for (const m of changes.matchAll(detailRe)) details.set(Number(m[1]), m[2]);
const listed = new Set([...changes.matchAll(/^\| \[C-(\d+)\]\(#c-(\d+)\)/gm)].map((m) => {
  if (m[1] !== m[2]) problems.push(`changes.md 목록: C-${m[1]}의 링크가 #c-${m[2]}로 되어 있음`);
  return Number(m[1]);
}));
for (const n of listed) if (!details.has(n)) problems.push(`changes.md: 목록의 C-${n}에 상세 항목(### C-${n})이 없음`);
for (const n of details.keys()) if (!listed.has(n)) problems.push(`changes.md: 상세 C-${n}이 목록 표에 없음`);
for (const [n, body] of details) {
  if (/^- 날짜 \/ 커밋: [^/]*\/\s*$/m.test(body)) problems.push(`changes.md C-${n}: 커밋 번호가 비어 있음(커밋 후 채운다)`);
  if (!/^- 이유: \S/m.test(body)) problems.push(`changes.md C-${n}: 이유가 비어 있음`);
}

// todo.md·PRD.md의 표시: (구분 · 요약 / [changes.md C-n](changes.md#c-n), ...)
const markRe = /\(([^()]*?) · ([^()/]*?) \/ ((?:\[changes\.md C-\d+\]\(changes\.md#c-\d+\)(?:, )?)+)\)/g;
const used = new Set();
for (const file of ["todo.md", "PRD.md"]) {
  read(file).split("\n").forEach((line, i) => {
    const where = `${file}:${i + 1}`;
    if (line.includes("changes.md C-") && !markRe.test(line)) problems.push(`${where}: 표시 형식이 맞지 않음`);
    markRe.lastIndex = 0;
    for (const m of line.matchAll(markRe)) {
      const kinds = m[1].split("·").map((k) => k.trim());
      for (const k of kinds) if (!KINDS.includes(k)) problems.push(`${where}: 구분 「${k}」는 추가·변경·취소가 아님`);
      for (const w of m[2].split(",").map((x) => x.trim())) {
        if (!WORDS.includes(w)) problems.push(`${where}: 요약 「${w}」가 changes.md 목록에 없음`);
      }
      for (const link of m[3].matchAll(/C-(\d+)\]\(changes\.md#c-(\d+)\)/g)) {
        const n = Number(link[1]);
        used.add(n);
        if (link[1] !== link[2]) problems.push(`${where}: C-${link[1]} 링크가 #c-${link[2]}로 되어 있음`);
        if (!details.has(n)) problems.push(`${where}: C-${n}이 changes.md에 없음`);
      }
      if (kinds.includes("취소") && !/~~.+~~/.test(line)) problems.push(`${where}: 취소한 할 일은 취소선(~~)으로 남겨야 함`);
    }
  });
}
for (const n of details.keys()) if (!used.has(n)) problems.push(`changes.md C-${n}: todo·PRD 어디에서도 가리키지 않음`);

if (problems.length) {
  console.log(problems.map((p) => `- ${p}`).join("\n"));
  console.log(`\n문제 ${problems.length}개`);
  process.exit(1);
}
console.log(`변경 표시 검사 통과 (C-${[...details.keys()].join(", C-")})`);
