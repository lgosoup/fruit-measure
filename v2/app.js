// ---------- 화면 요소 ----------
const homeScreen = document.getElementById("screen-home");
const homeMessage = document.getElementById("home-message");
const btnStart = document.getElementById("btn-start");

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
    homeMessage.textContent = "과일을 테이블 위에 놓고 측정 시작을 누르세요.";
    homeMessage.classList.remove("guide-warn");
  } else {
    homeMessage.textContent = "이 브라우저에서는 AR을 쓸 수 없습니다. 갤럭시 Z 플립6의 크롬에서 열어 주세요.";
    homeMessage.classList.add("guide-warn");
  }
}

checkArSupport();
