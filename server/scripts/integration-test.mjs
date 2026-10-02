// Integration test of the real HTTP app (buildApp) against a throw-away database.
// Usage: copy dist/ into a temp folder next to this server's node_modules and run there
// (see scripts/run-integration-test.ps1) — it must never touch the real data/ folder.
process.env.PUBLIC_BASE_URL ??= "http://localhost";
process.env.STEAM_API_KEY ??= "test";
process.env.JWT_SECRET ??= "test-secret-test-secret-test-secret";

const { db } = await import("./dist/db.js");
const { buildApp } = await import("./dist/app.js");
const { signAccessToken } = await import("./dist/auth/jwt.js");
const { upsertUserFromSteamLogin } = await import("./dist/users.js");

const app = await buildApp();
await app.ready();

const alice = upsertUserFromSteamLogin("76561198000000011", "Alice", null);
const bob = upsertUserFromSteamLogin("76561198000000022", "Bob", null);
const tokenOf = (user) => signAccessToken(user.id, user.steam_id).token;
const A = tokenOf(alice);
const B = tokenOf(bob);

const now = new Date().toISOString();
db.prepare(
  "INSERT OR REPLACE INTO steam_games (appid, title, genres, developers, publishers, release_year, cached_at, review_count) VALUES (?,?,?,?,?,?,?,?)"
).run(620, "Portal 2", JSON.stringify(["Action"]), JSON.stringify(["Valve"]), JSON.stringify(["Valve"]), 2011, now, 100);

const req = (method, url, { token, json, headers = {}, body } = {}) =>
  app.inject({
    method,
    url,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    payload: json !== undefined ? JSON.stringify(json) : body,
  });

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `  → ${detail}`}`);
};

// --- basics & headers
const health = await req("GET", "/health");
check("health 200", health.statusCode === 200 && health.json().ok === true, health.body);
check("nosniff header", health.headers["x-content-type-options"] === "nosniff");
check("frame deny header", health.headers["x-frame-options"] === "DENY");
check("unknown route 404", (await req("GET", "/nope")).statusCode === 404);
const root = await req("GET", "/");
check("/ redirects to Steam login", [301, 302, 303].includes(root.statusCode) && root.headers.location === "/auth/steam", `${root.statusCode} ${root.headers.location}`);

// --- auth
check("profile/me without token → 401", (await req("GET", "/profile/me")).statusCode === 401);
check("profile/me with bad token → 401", (await req("GET", "/profile/me", { token: "x.y.z" })).statusCode === 401);
const me = await req("GET", "/profile/me", { token: A });
check("profile/me → Alice", me.statusCode === 200 && me.json().displayName === "Alice", me.body);

// --- body parsing (Fastify 5 is stricter)
const emptyPost = await req("POST", "/auth/logout", { token: A });
check("POST without body/content-type is accepted", emptyPost.statusCode !== 415, `${emptyPost.statusCode} ${emptyPost.body}`);
const badJson = await req("POST", "/profile/games/batch", { token: A, headers: { "content-type": "application/json" }, body: "{not json" });
check("malformed JSON → 400", badJson.statusCode === 400, `${badJson.statusCode}`);

// --- library + achievements
const batch = await req("POST", "/profile/games/batch", { token: A, json: [{ objectId: "620", shop: "steam", playTimeInMilliseconds: 0, lastTimePlayed: null, isFavorite: false, isPinned: false }] });
check("library batch", batch.statusCode >= 200 && batch.statusCode < 300, `${batch.statusCode} ${batch.body}`);
const games = await req("GET", "/profile/games", { token: A });
const portal = games.json()?.find?.((g) => g.objectId === "620");
check("library lists the game", Boolean(portal), games.body.slice(0, 200));

// --- friends (by Steam ID)
const fr = await req("POST", "/profile/friend-requests", { token: A, json: { data: { friendCode: bob.steam_id } } });
check("friend request by Steam ID → 201", fr.statusCode === 201, `${fr.statusCode} ${fr.body}`);
const received = (await req("GET", "/profile/friend-requests", { token: B })).json();
check("Bob sees RECEIVED request", received.some((r) => r.id === alice.id && r.type === "RECEIVED"), JSON.stringify(received));
const accept = await req("PATCH", `/profile/friend-requests/${alice.id}`, { token: B, json: { data: { requestState: "ACCEPTED" } } });
check("Bob accepts → 204", accept.statusCode === 204, `${accept.statusCode}`);
const self = await req("POST", "/profile/friend-requests", { token: A, json: { data: { friendCode: alice.id } } });
check("friend request to self → 400", self.statusCode === 400, `${self.statusCode}`);

// --- catalogue
const search = await req("POST", "/catalogue/search", { json: { title: "portal", take: 5, skip: 0, publishers: ["Valve"] } });
check("catalogue search", search.statusCode === 200 && search.json().edges?.[0]?.title === "Portal 2", search.body.slice(0, 200));
const pubs = await req("GET", "/catalogue/steam/publishers");
check("publisher list", pubs.statusCode === 200 && pubs.json().includes("Valve"));

// --- uploads (presign + magic bytes)
const presign = await req("POST", "/presigned-urls/profile-image", { token: A, json: { imageExt: "png", imageLength: 100 } });
check("presign PNG", presign.statusCode === 200 && presign.json().presignedUrl, `${presign.statusCode} ${presign.body}`);
const htmlPresign = await req("POST", "/presigned-urls/profile-image", { token: A, json: { imageExt: "html", imageLength: 100 } });
check("presign .html refused (415)", htmlPresign.statusCode === 415, `${htmlPresign.statusCode}`);
if (presign.statusCode === 200) {
  const uploadPath = new URL(presign.json().presignedUrl).pathname + new URL(presign.json().presignedUrl).search;
  const fakePng = await req("PUT", uploadPath, { headers: { "content-type": "image/png" }, body: Buffer.from("<html>not an image</html>") });
  check("non-image bytes refused (415)", fakePng.statusCode === 415, `${fakePng.statusCode} ${fakePng.body}`);
}

// --- long capability tokens still route (maxParamLength)
const longToken = "a".repeat(240);
const blob = await req("GET", `/cloud-blobs/${longToken}`);
check("long /cloud-blobs token reaches the handler", blob.statusCode !== 404 || !/Route .* not found/.test(blob.body), `${blob.statusCode} ${blob.body.slice(0, 80)}`);

// --- updates feed
check("updates without login → 401", (await req("GET", "/updates/latest.yml")).statusCode === 401);
check("updates traversal → 400", (await req("GET", "/updates/..%2F..%2F.env", { token: A })).statusCode === 400);

// --- privacy
db.prepare("UPDATE users SET profile_visibility = 'PRIVATE' WHERE id = ?").run(bob.id);
const stranger = upsertUserFromSteamLogin("76561198000000033", "Carol", null);
const privateSummary = await req("GET", `/users/${bob.id}/trophy-summary`, { token: tokenOf(stranger) });
check("private profile hides trophies from strangers", privateSummary.statusCode === 200 && privateSummary.json().counts.total === 0 && privateSummary.json().games.length === 0, privateSummary.body.slice(0, 120));

await app.close();
console.log(failures ? `\n${failures} FAIL` : "\nALL OK");
process.exit(failures ? 1 : 0);
