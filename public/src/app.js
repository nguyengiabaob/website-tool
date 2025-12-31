let player;
let videos = [];
let index = 0;
let direction = 1; // 1 forward, -1 backward

function setError(msg) {
  const el = document.getElementById("error");
  if (!msg) {
    el.style.display = "none";
    el.textContent = "";
  } else {
    el.style.display = "block";
    el.textContent = msg;
  }
}

function updateMeta() {
  const title = document.getElementById("video-title");
  const sub = document.getElementById("video-sub");
  const link = document.getElementById("watch-link");
  if (!videos.length) {
    title.textContent = "No video";
    sub.textContent = "";
    link.href = "#";
    return;
  }
  const v = videos[index];
  title.textContent = v.title || v.id;
  sub.textContent = `${v.duration || "?"}s`;
  link.href = v.url;
}

function createPlayer(videoId) {
  if (player && player.loadVideoById) {
    player.loadVideoById(videoId);
    return;
  }
  player = new YT.Player("player", {
    height: "360",
    width: "640",
    videoId: videoId,
    playerVars: { autoplay: 1, controls: 1, modestbranding: 1, rel: 0 },
    events: {
      onReady: (e) => {
        try {
          e.target.mute();
          e.target.playVideo();
        } catch (e) {}
      },
      onStateChange: (e) => {
        const YT = window.YT;
        if (!YT) return;
        if (e.data === YT.PlayerState.ENDED) onVideoEnded();
        if (e.data === YT.PlayerState.PLAYING) {
          setTimeout(() => {
            try {
              const d = Math.round(player.getDuration() || 0);
              if (d > 60) onVideoEnded();
            } catch (e) {}
          }, 400);
        }
      },
    },
  });
}

function onVideoEnded() {
  if (!videos.length) return;
  let next = index + direction;
  if (next >= videos.length || next < 0) {
    direction = -direction;
    next = index + direction;
  }
  index = Math.max(0, Math.min(videos.length - 1, next));
  updateMeta();
  createPlayer(videos[index].id);
}

function renderThumbs() {
  const el = document.getElementById("thumbs");
  el.innerHTML = "";
  videos.forEach((v, i) => {
    const d = document.createElement("div");
    d.className = "t";
    const img = document.createElement("img");
    img.src = v.thumbnail;
    d.appendChild(img);
    const p = document.createElement("div");
    p.textContent = v.title || v.id;
    p.style.fontSize = "0.8rem";
    p.style.marginTop = "6px";
    d.appendChild(p);
    d.addEventListener("click", () => {
      index = i;
      updateMeta();
      createPlayer(videos[index].id);
    });
    el.appendChild(d);
  });
}

function loadList(list, append = false) {
  if (!append) {
    videos = list || [];
    index = 0;
    direction = 1;
  } else videos = videos.concat(list || []);
  if (videos.length) {
    updateMeta();
    renderThumbs();
    createPlayer(videos[index].id);
    document.getElementById("more-btn").disabled = false;
  } else {
    setError("No shorts found for that channel.");
  }
}

document.getElementById("fetch-btn").addEventListener("click", async () => {
  setError(null);
  const url = document.getElementById("channel-input").value.trim();
  if (!url) return setError("Enter a channel URL");
  try {
    const res = await fetch(
      "/api/puppeteer-scrape?channelUrl=" +
        encodeURIComponent(url) +
        "&limit=60"
    );
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return setError(j.error || "Fetch failed");
    }
    const j = await res.json();
    loadList(j.videos || []);
  } catch (e) {
    setError(String(e));
  }
});

document.getElementById("more-btn").addEventListener("click", async () => {
  setError(null);
  const url = document.getElementById("channel-input").value.trim();
  if (!url) return setError("Enter a channel URL");
  try {
    const res = await fetch(
      "/api/puppeteer-scrape?channelUrl=" +
        encodeURIComponent(url) +
        "&limit=120"
    );
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return setError(j.error || "Fetch failed");
    }
    const j = await res.json();
    loadList(j.videos || [], true);
  } catch (e) {
    setError(String(e));
  }
});
