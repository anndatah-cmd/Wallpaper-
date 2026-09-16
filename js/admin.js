let currentUser = null;
let wallpapers = [];

const headerActionsEl = document.getElementById("headerActions");
const unauthorizedEl = document.getElementById("unauthorized");
const adminContentEl = document.getElementById("adminContent");

const uploadForm = document.getElementById("uploadForm");
const uploadBtn = document.getElementById("uploadBtn");
const uploadMessage = document.getElementById("uploadMessage");
const progressBar = document.getElementById("progressBar");
const wallpaperListEl = document.getElementById("wallpaperList");

function renderHeader() {
  headerActionsEl.innerHTML = currentUser
    ? `<span>${currentUser.email}</span><button class="btn" id="logoutBtn">Log out</button>`
    : `<a href="index.html" class="btn">Log in</a>`;
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.addEventListener("click", async () => { await signOut(); location.reload(); });
}

// ---------- Thumbnail generation ----------

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function makeThumbnail(img, maxWidth = 640) {
  const scale = Math.min(1, maxWidth / img.naturalWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
}

// ---------- Upload ----------

uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const title = document.getElementById("title").value.trim();
  const category = document.getElementById("category").value.trim() || "uncategorized";
  const description = document.getElementById("description").value.trim();
  const file = document.getElementById("file").files[0];

  if (!file) return;

  uploadBtn.disabled = true;
  uploadMessage.className = "form-message";
  uploadMessage.textContent = "";
  progressBar.style.width = "10%";

  try {
    const img = await loadImage(file);
    const width = img.naturalWidth;
    const height = img.naturalHeight;

    const id = crypto.randomUUID();
    const ext = file.name.split(".").pop();
    const fullPath = `${id}.${ext}`;
    const thumbPath = `${id}.jpg`;

    progressBar.style.width = "30%";
    const { error: fullErr } = await sb.storage.from("wallpapers").upload(fullPath, file, {
      contentType: file.type,
      upsert: false,
    });
    if (fullErr) throw fullErr;

    progressBar.style.width = "60%";
    const thumbBlob = await makeThumbnail(img);
    const { error: thumbErr } = await sb.storage.from("thumbnails").upload(thumbPath, thumbBlob, {
      contentType: "image/jpeg",
      upsert: false,
    });
    if (thumbErr) throw thumbErr;

    progressBar.style.width = "85%";
    const { error: insertErr } = await sb.from("wallpapers").insert({
      title,
      description,
      category,
      storage_path: fullPath,
      thumbnail_path: thumbPath,
      width,
      height,
      uploaded_by: currentUser.id,
    });
    if (insertErr) throw insertErr;

    progressBar.style.width = "100%";
    uploadMessage.className = "form-message success";
    uploadMessage.textContent = "Uploaded.";
    uploadForm.reset();
    await loadWallpapers();
  } catch (err) {
    uploadMessage.className = "form-message error";
    uploadMessage.textContent = err.message || "Upload failed.";
  } finally {
    uploadBtn.disabled = false;
    setTimeout(() => (progressBar.style.width = "0%"), 600);
  }
});

// ---------- List + delete ----------

function thumbnailUrl(path) {
  return sb.storage.from("thumbnails").getPublicUrl(path).data.publicUrl;
}

function renderList() {
  if (wallpapers.length === 0) {
    wallpaperListEl.innerHTML = `<p class="empty-state">No wallpapers uploaded yet.</p>`;
    return;
  }

  wallpaperListEl.innerHTML = wallpapers
    .map(
      (w) => `
      <div class="table-row">
        <img src="${thumbnailUrl(w.thumbnail_path)}" alt="${w.title}" />
        <div>
          <div class="row-title">${w.title}</div>
          <div class="row-meta">${w.category || "uncategorized"}${w.width ? ` · ${w.width}×${w.height}` : ""}</div>
        </div>
        <div class="row-count">${w.download_count} downloads</div>
        <button class="btn btn-danger" data-id="${w.id}">Delete</button>
      </div>
    `
    )
    .join("");

  wallpaperListEl.querySelectorAll("[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => handleDelete(btn.dataset.id, btn));
  });
}

async function loadWallpapers() {
  const { data, error } = await sb.from("wallpapers").select("*").order("created_at", { ascending: false });
  if (error) {
    wallpaperListEl.innerHTML = `<p class="empty-state">Couldn't load wallpapers: ${error.message}</p>`;
    return;
  }
  wallpapers = data;
  renderList();
}

async function handleDelete(id, btn) {
  const wallpaper = wallpapers.find((w) => w.id === id);
  if (!wallpaper) return;
  if (!confirm(`Delete "${wallpaper.title}"? This can't be undone.`)) return;

  btn.disabled = true;
  btn.textContent = "Deleting…";

  await sb.storage.from("wallpapers").remove([wallpaper.storage_path]);
  await sb.storage.from("thumbnails").remove([wallpaper.thumbnail_path]);
  const { error } = await sb.from("wallpapers").delete().eq("id", id);

  if (error) {
    alert(error.message);
    btn.disabled = false;
    btn.textContent = "Delete";
    return;
  }

  await loadWallpapers();
}

// ---------- Boot / gate ----------

(async function init() {
  const session = await getSession();

  if (!session) {
    location.href = "index.html";
    return;
  }

  currentUser = session.user;
  renderHeader();

  const profile = await getProfile(currentUser.id);

  if (!profile || !profile.is_admin) {
    unauthorizedEl.style.display = "block";
    return;
  }

  adminContentEl.style.display = "block";
  await loadWallpapers();
})();
